package api

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/lugvitc/amazingwhats/internal/notify"
	"github.com/lugvitc/amazingwhats/internal/store"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
)

// statusReactionsKey is the app_settings.json key for the Status >
// "Status reactions" switch. It matches the frontend AppSettings key so the
// generic settings snapshot and these dedicated bindings stay in sync.
const statusReactionsKey = "statusReactions"

type StatusPrivacyEntry struct {
	Type      string   `json:"type"`
	JIDs      []string `json:"jids,omitempty"`
	IsDefault bool     `json:"is_default"`
}

func (a *Api) SetStatusMessage(text string) error {
	if a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	err := a.waClient.SetStatusMessage(a.ctx, types.SetStatusInput{Text: &text})
	if err != nil {
		return err
	}
	slog.Info("Status message updated", "source", "profile", "text_len", len(text))
	return nil
}

func (a *Api) GetStatusPrivacy() ([]StatusPrivacyEntry, error) {
	if a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	entries, err := a.waClient.GetStatusPrivacy(a.ctx)
	if err != nil {
		return nil, err
	}
	out := make([]StatusPrivacyEntry, 0, len(entries))
	for _, e := range entries {
		jids := make([]string, len(e.List))
		for i, j := range e.List {
			jids[i] = j.String()
		}
		out = append(out, StatusPrivacyEntry{
			Type:      string(e.Type),
			JIDs:      jids,
			IsDefault: e.IsDefault,
		})
	}
	return out, nil
}

// GetStatusReactionsEnabled reports the Status > "Status reactions" switch.
// The default (true) matches the frontend AppSettings default, so existing
// installs keep receiving reaction notifications until they opt out.
func (a *Api) GetStatusReactionsEnabled() bool {
	enabled, ok := a.GetSettings()[statusReactionsKey].(bool)
	if !ok {
		return true
	}
	return enabled
}

// SetStatusReactionsEnabled persists the Status reaction notification switch
// and emits wa:status_reactions_toggled so the Settings UI stays in sync when
// the value is changed from either side.
func (a *Api) SetStatusReactionsEnabled(enabled bool) error {
	current := a.GetSettings()
	// Copy-on-write: readers of GetSettings must never observe a map being
	// mutated in place (the same convention store.SetNotificationsEnabled uses).
	next := make(map[string]any, len(current)+1)
	for key, value := range current {
		next[key] = value
	}
	next[statusReactionsKey] = enabled
	if err := store.SaveSettings(next); err != nil {
		return err
	}
	if a.ctx != nil && a.app != nil {
		a.app.Event.Emit("wa:status_reactions_toggled", enabled)
	}
	return nil
}

// notifyStatusReaction raises a desktop notification when someone reacts to
// one of the user's own status updates.
//
// HyperMeow has no dedicated status-reaction event: a reaction to a status is
// delivered as a normal *events.Message whose chat is status@broadcast and
// whose content is a ReactionMessage. Such reactions are addressed only to the
// status author, so any reaction from another sender in that feed is a reaction
// to one of our own statuses. Reaction removals (empty emoji) are ignored.
func (a *Api) notifyStatusReaction(v *events.Message, emoji string) {
	if a.windowFocused.Load() {
		return
	}
	if !store.GetNotificationsEnabled() || !a.GetStatusReactionsEnabled() {
		return
	}

	sender := a.notificationSenderJID(v)
	name := ""
	if !sender.IsEmpty() {
		name = a.contactNameForJID(sender)
	}
	if name == "" {
		name = strings.TrimSpace(v.Info.PushName)
	}
	if name == "" {
		name = "Someone"
	}

	body := "Reacted to your status"
	if emoji = strings.TrimSpace(emoji); emoji != "" {
		body = "Reacted " + emoji + " to your status"
	}

	opts := notify.Options{
		Title:   name,
		Body:    body,
		Actions: false, // status@broadcast is not a chat we can open or reply in
	}
	if !sender.IsEmpty() && a.imageCache != nil {
		if avatar, _, err := a.imageCache.ReadAvatarByJID(sender.String()); err == nil {
			opts.Avatar = avatar
		}
	}
	if len(opts.Avatar) == 0 {
		opts.FallbackAvatar = notify.PlaceholderAvatar(false)
	}
	if err := notify.Notify(opts); err != nil {
		// Log the error only; never log notification payload/JIDs.
		slog.Warn("Status reaction notification failed", "source", "status", "error", err)
	}
}
