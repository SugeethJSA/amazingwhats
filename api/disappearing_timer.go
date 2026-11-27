package api

import (
	"context"
	"fmt"
	"time"

	waBinary "github.com/polymorfa/hypermeow/binary"
	"github.com/polymorfa/hypermeow/types"
)

// disappearingTimerUSyncTimeout bounds the account-default timer read. The
// usync query is a normal IQ round-trip; without a deadline a stalled socket
// would leave the privacy screen's read pending indefinitely.
const disappearingTimerUSyncTimeout = 15 * time.Second

// parseDisappearingModeDuration pulls the first valid disappearing_mode
// duration (in seconds) out of the <list> node returned by a usync query.
// usync returns the <list> child directly, so its children are <user> nodes.
// The bool reports whether a trustworthy value was found: a missing child,
// missing/malformed duration, or a negative value is never reported as 0/off.
func parseDisappearingModeDuration(list *waBinary.Node) (int64, bool) {
	if list == nil {
		return 0, false
	}
	for _, user := range list.GetChildren() {
		if user.Tag != "user" {
			continue
		}
		mode, ok := user.GetOptionalChildByTag("disappearing_mode")
		if !ok {
			continue
		}
		if duration, ok := disappearingModeDuration(&mode); ok {
			return duration, true
		}
	}
	return 0, false
}

// disappearingModeDuration reads the duration attribute of one
// <disappearing_mode> node. The wire encoder writes it as a decimal string
// (privacysettings.go uses strconv.Itoa), so GetInt64 is the primary reader;
// hypermeow's binary decoder can also surface numeric attributes as int64,
// which is accepted as a fallback. Everything else is rejected.
func disappearingModeDuration(mode *waBinary.Node) (int64, bool) {
	if mode == nil {
		return 0, false
	}
	ag := mode.AttrGetter()
	duration, ok := ag.GetInt64("duration", true)
	if ok && ag.OK() && duration >= 0 {
		return duration, true
	}
	if raw, exists := mode.Attrs["duration"]; exists {
		if n, isInt64 := raw.(int64); isInt64 && n >= 0 {
			return n, true
		}
	}
	return 0, false
}

// GetDisappearingTimerDefault reads the account-level default disappearing
// timer, in seconds (0 = off), fresh from the server on every call.
//
// HyperMeow has no high-level getter and IsOnWhatsApp discards the
// disappearing_mode child, but DangerousInternals().Usync returns the raw
// <list> node, so the same query HyperMeow uses can be sent for our own JID
// and the duration read directly. Nothing is cached: a write is only ever
// confirmed by a later read from the server.
func (a *Api) GetDisappearingTimerDefault() (int64, error) {
	if a == nil || a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return 0, fmt.Errorf("not logged in")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, disappearingTimerUSyncTimeout)
	defer cancel()

	// Match IsOnWhatsApp's self-query shape: canonicalize a possible LID to
	// its phone JID, then address the legacy user server with the E164 number.
	ownJID := canonicalUserJID(ctx, a.waClient, *a.waClient.Store.ID)
	selfJID := types.NewJID("+"+ownJID.User, types.LegacyUserServer)

	list, err := a.waClient.DangerousInternals().Usync(ctx, []types.JID{selfJID}, "query", "interactive", []waBinary.Node{
		{Tag: "disappearing_mode"},
	})
	if err != nil {
		return 0, fmt.Errorf("failed to read default disappearing timer: %w", err)
	}
	duration, ok := parseDisappearingModeDuration(list)
	if !ok {
		return 0, fmt.Errorf("default disappearing timer missing or invalid in usync response")
	}
	return duration, nil
}
