package api

import (
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
)

// groupMetaIndex is an in-memory snapshot of the locally stored group
// metadata (whats4linux_groups in app.db). It is built with a single batch
// query so GetChatList never issues one SQLite point-query per group, and a
// missing row is just a map miss instead of an error that used to be logged
// once per group per poll.
type groupMetaIndex struct {
	byJID map[string]wa.Group
}

// loadGroupMetaIndex reads every cached group in one query. The chat list is
// deliberately local-only (it runs before/around connect), so the local app
// DB is the name source; repairGroupNames heals missing/empty rows in the
// background after Connected. Genuine DB failures are logged once here rather
// than per group.
func (a *Api) loadGroupMetaIndex() groupMetaIndex {
	idx := groupMetaIndex{byJID: make(map[string]wa.Group)}
	if a.cw == nil {
		return idx
	}
	groups, err := a.cw.FetchGroups()
	if err != nil {
		slog.Warn("GetChatList: failed to load local group metadata cache", "err", err, "source", "groups")
		return idx
	}
	for _, g := range groups {
		idx.byJID[g.JID] = g
	}
	return idx
}

// parentName mirrors wa.AppDatabase.ParentCommunityName but resolves from the
// already-loaded snapshot: parent row name first, then any child row that
// cached the parent name. It avoids an extra point-query per subgroup.
func (idx groupMetaIndex) parentName(parentJID string) string {
	if parentJID == "" {
		return ""
	}
	if g, ok := idx.byJID[parentJID]; ok && g.Name != "" {
		return g.Name
	}
	for _, g := range idx.byJID {
		if g.ParentJID == parentJID && g.ParentName != "" {
			return g.ParentName
		}
	}
	return ""
}

// missingGroupCache is a short-lived negative cache for group JIDs whose
// metadata is not in the local snapshot yet (typical right after a reconnect
// / app-state sync, before the background repair stores the rows). It exists
// only to coalesce repeated per-JID work and debug logging across the rapid
// frontend chat-list polls; the batch load itself means no per-group DB fetch
// is ever retried. Entries expire quickly so a repaired name shows up as soon
// as it is persisted.
var missingGroupCache = struct {
	sync.Mutex
	seen map[string]time.Time
}{seen: make(map[string]time.Time)}

const missingGroupTTL = 5 * time.Second

// noteMissingGroup reports whether jid was first seen as missing within the
// TTL window, and refreshes its entry. The map is pruned opportunistically so
// it cannot grow without bound.
func noteMissingGroup(jid string) bool {
	now := time.Now()
	missingGroupCache.Lock()
	defer missingGroupCache.Unlock()
	if t, ok := missingGroupCache.seen[jid]; ok && now.Sub(t) < missingGroupTTL {
		return false
	}
	missingGroupCache.seen[jid] = now
	for k, t := range missingGroupCache.seen {
		if now.Sub(t) >= missingGroupTTL {
			delete(missingGroupCache.seen, k)
		}
	}
	return true
}

// clearMissingGroup drops a JID from the negative cache once its metadata is
// available again.
func clearMissingGroup(jid string) {
	missingGroupCache.Lock()
	delete(missingGroupCache.seen, jid)
	missingGroupCache.Unlock()
}

type GroupJoinRequest struct {
	JID         string `json:"jid"`
	Requester   string `json:"requester"`
	RequestedAt int64  `json:"requested_at"`
}

func (a *Api) GetGroupJoinRequests(groupJID string) ([]GroupJoinRequest, error) {
	if a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return nil, err
	}
	reqs, err := a.waClient.GetGroupRequestParticipants(a.ctx, jid)
	if err != nil {
		return nil, err
	}
	out := make([]GroupJoinRequest, 0, len(reqs))
	for _, r := range reqs {
		out = append(out, GroupJoinRequest{
			JID:         r.JID.String(),
			Requester:   a.contactNameForJID(r.JID),
			RequestedAt: r.RequestedAt.Unix(),
		})
	}
	return out, nil
}

func (a *Api) ApproveGroupJoinRequest(groupJID string, requesterJIDs []string) error {
	return a.updateJoinRequests(groupJID, requesterJIDs, whatsmeow.ParticipantChangeApprove)
}

func (a *Api) RejectGroupJoinRequest(groupJID string, requesterJIDs []string) error {
	return a.updateJoinRequests(groupJID, requesterJIDs, whatsmeow.ParticipantChangeReject)
}

func (a *Api) updateJoinRequests(groupJID string, requesterJIDs []string, action whatsmeow.ParticipantRequestChange) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	jids := make([]types.JID, len(requesterJIDs))
	for i, r := range requesterJIDs {
		jids[i], err = types.ParseJID(r)
		if err != nil {
			return fmt.Errorf("invalid JID %s: %w", r, err)
		}
	}
	_, err = a.waClient.UpdateGroupRequestParticipants(a.ctx, jid, jids, action)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("%s %d join requests in %s", action, len(jids), groupJID), "source", "groups")
	a.app.Event.Emit("wa:chat_list_refresh")
	return nil
}

func (a *Api) SetGroupMemberAddMode(groupJID string, mode string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	var m types.GroupMemberAddMode
	switch strings.ToLower(mode) {
	case "admin_add":
		m = types.GroupMemberAddModeAdmin
	case "all_member_add":
		m = "all_member_add"
	default:
		return fmt.Errorf("invalid member add mode: %s", mode)
	}
	err = a.waClient.SetGroupMemberAddMode(a.ctx, jid, m)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Set group %s member add mode to %s", groupJID, mode), "source", "groups")
	return nil
}

func (a *Api) SetGroupJoinApprovalMode(groupJID string, requireApproval bool) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	err = a.waClient.SetGroupJoinApprovalMode(a.ctx, jid, requireApproval)
	if err != nil {
		return err
	}
	state := "on"
	if !requireApproval {
		state = "off"
	}
	slog.Info(fmt.Sprintf("Set group %s join approval to %s", groupJID, state), "source", "groups")
	return nil
}

func (a *Api) SetGroupTopic(groupJID, topic string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	err = a.waClient.SetGroupTopic(a.ctx, jid, "", "", topic)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Set group %s topic", groupJID), "source", "groups")
	return nil
}

func (a *Api) SetGroupDescription(groupJID, description string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	if strings.HasSuffix(groupJID, "@g.us") {
		info, err := a.waClient.GetGroupInfo(a.ctx, jid)
		if err == nil && info.IsParent {
			return a.waClient.SetGroupDescription(a.ctx, jid, description)
		}
	}
	return a.waClient.SetGroupTopic(a.ctx, jid, "", "", description)
}

func (a *Api) LinkGroupToCommunity(parentJID, childJID string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	parent, err := types.ParseJID(parentJID)
	if err != nil {
		return err
	}
	child, err := types.ParseJID(childJID)
	if err != nil {
		return err
	}
	err = a.waClient.LinkGroup(a.ctx, parent, child)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Linked group %s to community %s", childJID, parentJID), "source", "communities")
	a.app.Event.Emit("wa:chat_list_refresh")
	return nil
}

func (a *Api) UnlinkGroupFromCommunity(parentJID, childJID string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	parent, err := types.ParseJID(parentJID)
	if err != nil {
		return err
	}
	child, err := types.ParseJID(childJID)
	if err != nil {
		return err
	}
	err = a.waClient.UnlinkGroup(a.ctx, parent, child)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Unlinked group %s from community %s", childJID, parentJID), "source", "communities")
	a.app.Event.Emit("wa:chat_list_refresh")
	return nil
}

func (a *Api) SetDisappearingTimerDefault(timerSeconds int64) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	duration := time.Duration(timerSeconds) * time.Second
	err := a.waClient.SetDefaultDisappearingTimer(a.ctx, duration)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Set default disappearing timer to %ds", timerSeconds), "source", "privacy")
	return nil
}
