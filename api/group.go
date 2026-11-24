package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"log/slog"
	"strings"

	"github.com/lugvitc/amazingwhats/internal/wa"
	"github.com/nyaruka/phonenumbers"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
)

type Group struct {
	GroupName        string             `json:"group_name"`
	GroupTopic       string             `json:"group_topic,omitempty"`
	IsGroupLock      bool               `json:"is_group_lock"`
	IsGroupAnnounce  bool               `json:"is_group_announce"`
	MemberAddMode    string             `json:"member_add_mode"`
	JoinApproval     bool               `json:"join_approval"`
	ParentJID        string             `json:"parent_jid,omitempty"`
	GroupOwner       Contact            `json:"group_owner"`
	GroupCreatedAt   string             `json:"group_created_at"`
	ParticipantCount int                `json:"participant_count"`
	Participants     []GroupParticipant `json:"group_participants"`
}

type GroupParticipant struct {
	Contact Contact `json:"contact"`
	IsAdmin bool    `json:"is_admin"`
	// ActionJID is the participant's stable canonical identity: the LID when
	// HyperMeow/WhatsApp knows one, otherwise the PN. Group
	// promote/demote/remove actions must use this exact identifier;
	// Contact.JID stays the PN-canonical form for display/lookup.
	ActionJID string `json:"action_jid,omitempty"`
}

// isLIDIdentityJID reports whether jid is an LID-form user identity (the lid
// or hosted-lid server). LIDs are the stable Signal identity and are preferred
// over phone numbers for participant addressing.
func isLIDIdentityJID(jid types.JID) bool {
	if jid.IsEmpty() {
		return false
	}
	agent := jid.ActualAgent()
	return agent == types.LIDDomain || agent == types.HostedLIDDomain
}

// canonicalGroupParticipantJID is the pure selection policy for group
// participants. It takes the two already-resolved forms of one identity and
// returns:
//
//   - canonical: the stable identity used for participant keys, admin actions,
//     mute/reaction addressing and de-duplication. A valid LID always wins;
//     the PN is only a fallback when no LID is known.
//   - display: the PN used for contact-name lookup and phone formatting. When
//     no PN is known the LID is returned so the caller still has something to
//     show.
//
// Keeping the policy pure makes it unit-testable without a live client;
// groupParticipantIdentities resolves the two inputs via the device LID map
// and delegates the choice here.
func canonicalGroupParticipantJID(lid, pn types.JID) (canonical, display types.JID) {
	hasLID := isLIDIdentityJID(lid)
	hasPN := !pn.IsEmpty() && !isLIDIdentityJID(pn)
	switch {
	case hasLID && hasPN:
		return lid.ToNonAD(), pn.ToNonAD()
	case hasLID:
		return lid.ToNonAD(), lid.ToNonAD()
	case hasPN:
		return pn.ToNonAD(), pn.ToNonAD()
	default:
		return types.EmptyJID, types.EmptyJID
	}
}

// groupParticipantIdentities resolves a participant's reported JID into its
// stable canonical identity and its display PN using the device LID/PN map.
// HyperMeow reports group participants with a primary JID that is often
// already an LID, but it can be a PN. Device.GetAltJID returns the opposite
// form (LID->PN or PN->LID); resolving both here is what stops a PN report
// from silently discarding the stable LID (D-AUD-008f). When no alternate is
// known we keep the reported form instead of inventing or dropping an
// identity. It deliberately does NOT call canonicalUserJID: that helper is
// the display-name policy used by contacts/chat-list call sites and must keep
// resolving LID->PN unchanged.
func groupParticipantIdentities(ctx context.Context, client *whatsmeow.Client, reported types.JID) (canonical, display types.JID) {
	reported = reported.ToNonAD()
	// canonicalGroupParticipantJID takes (lid, pn) in that order. A reported
	// JID can be either form, so route it into the correct slot before the
	// pure selector sees it — otherwise a PN fallback lands in the lid slot
	// and is discarded as empty.
	fallback := func() (types.JID, types.JID) {
		if isLIDIdentityJID(reported) {
			return canonicalGroupParticipantJID(reported, types.EmptyJID)
		}
		return canonicalGroupParticipantJID(types.EmptyJID, reported)
	}
	if client == nil || client.Store == nil {
		return fallback()
	}
	alt, err := client.Store.GetAltJID(ctx, reported)
	if err != nil || alt.IsEmpty() {
		return fallback()
	}
	if isLIDIdentityJID(reported) {
		return canonicalGroupParticipantJID(reported, alt)
	}
	return canonicalGroupParticipantJID(alt, reported)
}

func (a *Api) FetchGroups() ([]wa.Group, error) {
	if a.cw != nil {
		if err := a.cw.FetchAndStoreGroups(a.waClient); err != nil {
			log.Println("FetchGroups: cache refresh failed:", err)
		}
	}

	groups, err := a.waClient.GetJoinedGroups(a.ctx)
	if err != nil {
		return nil, err
	}

	var result []wa.Group
	for _, g := range groups {
		parentJID := ""
		if !g.LinkedParentJID.IsEmpty() {
			parentJID = g.LinkedParentJID.String()
		}
		result = append(result, wa.Group{
			JID:              g.JID.String(),
			Name:             g.Name,
			Topic:            g.Topic,
			OwnerJID:         g.OwnerJID.String(),
			ParticipantCount: len(g.Participants),
			ParentJID:        parentJID,
			IsParent:         g.IsParent,
			IsDefaultSub:     g.IsDefaultSubGroup,
		})
	}
	return result, nil
}

func (a *Api) GetGroupInfo(jidStr string) (Group, error) {
	if !strings.HasSuffix(jidStr, "@g.us") {
		return Group{}, fmt.Errorf("JID is not a group JID")
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return Group{}, fmt.Errorf("invalid JID: %w", err)
	}

	GroupInfo, err := a.waClient.GetGroupInfo(a.ctx, jid)

	if err != nil {
		return Group{}, err
	}

	// Batch-load the contact store once instead of querying it once per
	// participant (large groups previously cost O(n) individual lookups).
	allContacts, err := a.waClient.Store.Contacts.GetAllContacts(a.ctx)
	if err != nil {
		return Group{}, err
	}

	// buildContact uses the PN-canonical JID only for the contact-name lookup
	// and phone-number display (same policy as the chat list / contact lookups).
	// A participant's stable identity is carried separately in
	// GroupParticipant.ActionJID, resolved by groupParticipantIdentities so
	// a LID is never silently replaced by its PN.
	buildContact := func(jid types.JID) Contact {
		displayJID := canonicalUserJID(a.ctx, a.waClient, jid)
		c, found := allContacts[displayJID]
		fullName, firstName, pushName, businessName := "", "", "", ""
		if found {
			fullName = c.FullName
			firstName = c.FirstName
			pushName = c.PushName
			businessName = c.BusinessName
		}
		// Unnamed participants (and LIDs with no PN mapping) still get a
		// phone-formatted row so the group panel always has something to show.
		phno := ""
		if num, perr := phonenumbers.Parse("+"+displayJID.User, ""); perr == nil {
			phno = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
		}
		return Contact{
			Phno:       phno,
			JID:        displayJID.String(),
			FullName:   fullName,
			Short:      firstName,
			PushName:   pushName,
			IsBusiness: businessName != "",
		}
	}

	participants := make([]GroupParticipant, 0, len(GroupInfo.Participants))
	for _, p := range GroupInfo.Participants {
		// Display/contact lookup stays PN-canonical via buildContact; the
		// action identity is resolved to the stable LID when one is known.
		canonical, _ := groupParticipantIdentities(a.ctx, a.waClient, p.JID)
		actionJID := canonical.String()
		if actionJID == "" {
			actionJID = p.JID.String()
		}
		participants = append(participants, GroupParticipant{
			Contact:   buildContact(p.JID),
			IsAdmin:   p.IsAdmin,
			ActionJID: actionJID,
		})
	}
	parentJID := ""
	if !GroupInfo.LinkedParentJID.IsEmpty() {
		parentJID = GroupInfo.LinkedParentJID.String()
	}
	owner := buildContact(GroupInfo.OwnerJID)
	return Group{
		GroupName:        GroupInfo.GroupName.Name,
		GroupTopic:       GroupInfo.GroupTopic.Topic,
		IsGroupLock:      GroupInfo.GroupLocked.IsLocked,
		IsGroupAnnounce:  GroupInfo.GroupAnnounce.IsAnnounce,
		MemberAddMode:    string(GroupInfo.MemberAddMode),
		JoinApproval:     GroupInfo.GroupMembershipApprovalMode.IsJoinApprovalRequired,
		ParentJID:        parentJID,
		GroupOwner:       owner,
		GroupCreatedAt:   GroupInfo.GroupCreated.Format("2006-01-02 15:04:05"),
		ParticipantCount: GroupInfo.ParticipantCount,
		Participants:     participants,
	}, nil
}

func (a *Api) CreateGroup(name string, participantJIDs []string) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("not logged in")
	}
	participants := make([]types.JID, len(participantJIDs))
	for i, jidStr := range participantJIDs {
		jid, err := types.ParseJID(jidStr)
		if err != nil {
			return "", fmt.Errorf("invalid participant JID %s: %w", jidStr, err)
		}
		participants[i] = jid.ToNonAD()
	}
	groupInfo, err := a.waClient.CreateGroup(a.ctx, whatsmeow.ReqCreateGroup{
		Name:         name,
		Participants: participants,
	})
	if err != nil {
		return "", err
	}
	slog.Info(fmt.Sprintf("Created group %s (%s)", groupInfo.GroupName.Name, groupInfo.JID), "source", "groups")
	return groupInfo.JID.String(), nil
}

func (a *Api) AddGroupParticipants(groupJID string, participantJIDs []string) error {
	return a.updateParticipants(groupJID, participantJIDs, whatsmeow.ParticipantChangeAdd)
}

func (a *Api) RemoveGroupParticipants(groupJID string, participantJIDs []string) error {
	return a.updateParticipants(groupJID, participantJIDs, whatsmeow.ParticipantChangeRemove)
}

func (a *Api) PromoteGroupParticipants(groupJID string, participantJIDs []string) error {
	return a.updateParticipants(groupJID, participantJIDs, whatsmeow.ParticipantChangePromote)
}

func (a *Api) DemoteGroupParticipants(groupJID string, participantJIDs []string) error {
	return a.updateParticipants(groupJID, participantJIDs, whatsmeow.ParticipantChangeDemote)
}

func (a *Api) updateParticipants(groupJID string, participantJIDs []string, action whatsmeow.ParticipantChange) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	// Use the participant JIDs verbatim. Do NOT canonicalize them to PN here:
	// the UI passes back GroupParticipant.action_jid (the primary JID, which
	// may be an LID), and whatsmeow needs that exact identifier for the action.
	jids := make([]types.JID, len(participantJIDs))
	for i, p := range participantJIDs {
		jids[i], err = types.ParseJID(p)
		if err != nil {
			return fmt.Errorf("invalid JID %s: %w", p, err)
		}
	}
	_, err = a.waClient.UpdateGroupParticipants(a.ctx, jid, jids, action)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("%s %d participants in %s", action, len(jids), groupJID), "source", "groups")
	return nil
}

func (a *Api) SetGroupName(groupJID, name string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	return a.waClient.SetGroupName(a.ctx, jid, name)
}

func (a *Api) SetGroupPhoto(groupJID, base64Data string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return fmt.Errorf("decode base64: %w", err)
	}
	_, err = a.waClient.SetGroupPhoto(a.ctx, jid, data)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Set group photo for %s", groupJID), "source", "groups")
	return nil
}

func (a *Api) LeaveGroup(groupJID string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	err = a.waClient.LeaveGroup(a.ctx, jid)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Left group %s", groupJID), "source", "groups")
	return nil
}

func (a *Api) AcceptGroupInviteLink(inviteCode string) (string, error) {
	info, err := a.waClient.GetGroupInfoFromLink(a.ctx, inviteCode)
	if err != nil {
		return "", fmt.Errorf("get group info from link: %w", err)
	}
	jid, err := a.waClient.JoinGroupWithLink(a.ctx, inviteCode)
	if err != nil {
		return "", fmt.Errorf("join group with link: %w", err)
	}
	slog.Info(fmt.Sprintf("Joined group %s (%s)", info.GroupName.Name, jid), "source", "groups")
	return jid.String(), nil
}

func (a *Api) GetGroupInviteLink(groupJID string) (string, error) {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return "", err
	}
	link, err := a.waClient.GetGroupInviteLink(a.ctx, jid, false)
	if err != nil {
		return "", err
	}
	return link, nil
}

func (a *Api) SetGroupAnnounce(groupJID string, announce bool) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	return a.waClient.SetGroupAnnounce(a.ctx, jid, announce)
}

func (a *Api) SetGroupLocked(groupJID string, locked bool) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return err
	}
	return a.waClient.SetGroupLocked(a.ctx, jid, locked)
}

func (a *Api) CreateCommunity(name, description string) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("not logged in")
	}
	groupInfo, err := a.waClient.CreateGroup(a.ctx, whatsmeow.ReqCreateGroup{
		Name:        name,
		GroupParent: types.GroupParent{IsParent: true},
	})
	if err != nil {
		return "", err
	}
	if description != "" {
		jid, parseErr := types.ParseJID(groupInfo.JID.String())
		if parseErr == nil {
			if descErr := a.waClient.SetGroupTopic(a.ctx, jid, "", "", description); descErr != nil {
				slog.Warn(fmt.Sprintf("Failed to set community description: %v", descErr), "source", "communities")
			}
		}
	}
	slog.Info(fmt.Sprintf("Created community %s (%s)", name, groupInfo.JID), "source", "communities")
	return groupInfo.JID.String(), nil
}

func (a *Api) CreateCommunitySubGroup(parentJID, name string, participantJIDs []string) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("not logged in")
	}
	parent, err := types.ParseJID(parentJID)
	if err != nil {
		return "", fmt.Errorf("invalid parent JID: %w", err)
	}
	participants := make([]types.JID, len(participantJIDs))
	for i, jidStr := range participantJIDs {
		jid, err := types.ParseJID(jidStr)
		if err != nil {
			return "", fmt.Errorf("invalid participant JID %s: %w", jidStr, err)
		}
		participants[i] = jid.ToNonAD()
	}
	groupInfo, err := a.waClient.CreateGroup(a.ctx, whatsmeow.ReqCreateGroup{
		Name:              name,
		Participants:      participants,
		GroupLinkedParent: types.GroupLinkedParent{LinkedParentJID: parent},
	})
	if err != nil {
		return "", err
	}
	slog.Info(fmt.Sprintf("Created subgroup %s (%s) in %s", name, groupInfo.JID, parentJID), "source", "communities")
	return groupInfo.JID.String(), nil
}
