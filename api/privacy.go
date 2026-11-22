package api

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"log/slog"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// redactJID returns a log-safe, non-reversible representation of a JID: a
// short hash of the full identifier plus its (non-personal) server/domain.
// This keeps diagnostics correlatable without exposing phone numbers or LIDs.
func redactJID(jid string) string {
	if jid == "" {
		return "<empty>"
	}
	server := ""
	if i := strings.LastIndexByte(jid, '@'); i >= 0 {
		server = jid[i+1:]
	}
	sum := sha256.Sum256([]byte(jid))
	digest := hex.EncodeToString(sum[:])
	if len(digest) > 8 {
		digest = digest[:8]
	}
	if server == "" {
		return digest
	}
	return digest + "@" + server
}

type PrivacySettingsResponse struct {
	GroupAdd     string `json:"group_add"`
	LastSeen     string `json:"last_seen"`
	Status       string `json:"status"`
	Profile      string `json:"profile"`
	ReadReceipts string `json:"read_receipts"`
	Online       string `json:"online"`
	CallAdd      string `json:"call_add"`
}

type BlockedContact struct {
	JID  string `json:"jid"`
	Name string `json:"name"`
}

// GetPrivacySettings fetches the user's current privacy settings from the server.
func (a *Api) GetPrivacySettings() (PrivacySettingsResponse, error) {
	if a.waClient.Store.ID == nil {
		return PrivacySettingsResponse{}, fmt.Errorf("not logged in")
	}
	settings := a.waClient.GetPrivacySettings(a.ctx)
	return PrivacySettingsResponse{
		GroupAdd:     string(settings.GroupAdd),
		LastSeen:     string(settings.LastSeen),
		Status:       string(settings.Status),
		Profile:      string(settings.Profile),
		ReadReceipts: string(settings.ReadReceipts),
		Online:       string(settings.Online),
		CallAdd:      string(settings.CallAdd),
	}, nil
}

// SetPrivacySetting updates a single privacy setting on the server.
// settingType: "groupadd", "last", "status", "profile", "readreceipts", "online", "calladd"
// value: "all", "contacts", "contact_blacklist", "none", "match_last_seen", "known"
func (a *Api) SetPrivacySetting(settingType, value string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	st := types.PrivacySettingType(settingType)
	val := types.PrivacySetting(value)
	_, err := a.waClient.SetPrivacySetting(a.ctx, st, val)
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Set %s → %s", settingType, value), "source", "privacy")
	return nil
}

// GetBlockList returns all blocked contacts.
func (a *Api) GetBlockList() ([]BlockedContact, error) {
	if a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	// An empty DHash forces a full fetch. A cached DHash can be added later to
	// skip the round-trip when the server-side blocklist has not changed.
	blocklist, err := a.waClient.GetBlocklist(a.ctx, "")
	if err != nil {
		return nil, err
	}
	result := make([]BlockedContact, 0, len(blocklist.Items))
	for _, item := range blocklist.Items {
		// Blocklist entries now carry both a LID and a PN. Prefer the PN so the
		// UI keeps showing phone-number JIDs, falling back to the LID, then run
		// it through the standard PN/LID canonicalization used by other contact
		// surfaces (LID -> PN lookup plus non-AD normalization).
		jid := item.PN
		if jid.IsEmpty() {
			jid = item.LID
		}
		jid = canonicalUserJID(a.ctx, a.waClient, jid)
		name := jid.User
		if contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, jid); err == nil {
			if contact.FullName != "" {
				name = contact.FullName
			} else if contact.PushName != "" {
				name = contact.PushName
			}
		}
		result = append(result, BlockedContact{JID: jid.String(), Name: name})
	}
	return result, nil
}

// BlockContact blocks a contact by JID. The change is synced to other
// devices via IQ.
func (a *Api) BlockContact(jidStr string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return err
	}
	// Empty DHash: a cached value can be supplied later to skip the round-trip.
	_, err = a.waClient.UpdateBlocklist(a.ctx, jid, events.BlocklistChangeActionBlock, "")
	if err != nil {
		return err
	}
	slog.Info("Blocked contact", "source", "contacts", "jid", redactJID(jid.String()))
	return nil
}

// UnblockContact unblocks a previously blocked contact.
func (a *Api) UnblockContact(jidStr string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return err
	}
	// Empty DHash: a cached value can be supplied later to skip the round-trip.
	_, err = a.waClient.UpdateBlocklist(a.ctx, jid, events.BlocklistChangeActionUnblock, "")
	if err != nil {
		return err
	}
	slog.Info("Unblocked contact", "source", "contacts", "jid", redactJID(jid.String()))
	return nil
}

// SetDisappearingTimer sets the disappearing-message timer for a chat.
// timer: 0 (off), 86400 (24h), 604800 (7d), 7776000 (90d)
func (a *Api) SetDisappearingTimer(chatJID string, timerSeconds int64) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return err
	}
	duration := time.Duration(timerSeconds) * time.Second
	err = a.waClient.SetDisappearingTimer(a.ctx, chat, duration, time.Now())
	if err != nil {
		return err
	}
	slog.Info("Set disappearing timer", "source", "chats", "jid", redactJID(chatJID), "timer_seconds", timerSeconds)
	return nil
}

func (a *Api) GetDisappearingTimer(chatJID string) (int64, error) {
	if a.waClient.Store.ID == nil {
		return 0, fmt.Errorf("not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return 0, err
	}
	if chat.Server == types.GroupServer {
		info, err := a.waClient.GetGroupInfo(a.ctx, chat)
		if err != nil {
			return 0, err
		}
		if info != nil {
			return int64(info.DisappearingTimer), nil
		}
	}
	return 0, nil
}

func (a *Api) SetStatusPrivacy(value string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	_, err := a.waClient.SetPrivacySetting(a.ctx, types.PrivacySettingTypeStatus, types.PrivacySetting(value))
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Set status privacy → %s", value), "source", "privacy")
	return nil
}

// TryFetchPrivacySettings fetches the user's privacy settings, either from
// the in-memory cache or from the server if ignoreCache is true.
func (a *Api) TryFetchPrivacySettings(ignoreCache bool) (PrivacySettingsResponse, error) {
	if a.waClient == nil {
		return PrivacySettingsResponse{}, fmt.Errorf("WhatsApp client is not ready")
	}
	settings, err := a.waClient.TryFetchPrivacySettings(a.ctx, ignoreCache)
	if err != nil {
		return PrivacySettingsResponse{}, err
	}
	return PrivacySettingsResponse{
		GroupAdd:     string(settings.GroupAdd),
		LastSeen:     string(settings.LastSeen),
		Status:       string(settings.Status),
		Profile:      string(settings.Profile),
		ReadReceipts: string(settings.ReadReceipts),
		Online:       string(settings.Online),
		CallAdd:      string(settings.CallAdd),
	}, nil
}

// handleBlocklistEvent processes a blocklist mutation from app state sync.
func (a *Api) handleBlocklistEvent(evt *events.Blocklist) {
	log.Printf("[Privacy] Blocklist changed: %d changes, action=\"%s\"", len(evt.Changes), evt.Action)
	a.app.Event.Emit("wa:chat_list_refresh")
}
