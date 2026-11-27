package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/polymorfa/hypermeow"
	wastore "github.com/polymorfa/hypermeow/store"
	"google.golang.org/protobuf/proto"
)

// minPhoneLen is the minimum length for a phone number (country code + number).
const minPhoneLen = 7

// applyFullHistoryRelink opts the NEXT pairing into a full-history request when
// the user enabled "Request full history on next link". DeviceProps is only
// read while building the registration payload, so an existing session can
// never be affected. The returned function restores the previous value so two
// pairings in one process cannot leak the flag into each other.
func (a *Api) applyFullHistoryRelink() func() {
	value, ok := a.GetSettings()["relinkWithFullHistory"]
	if !ok || value == nil || wastore.DeviceProps == nil {
		return func() {}
	}
	enabled, ok := value.(bool)
	if !ok || !enabled {
		return func() {}
	}
	previous := wastore.DeviceProps.RequireFullSync
	wastore.DeviceProps.RequireFullSync = proto.Bool(true)
	slog.Info("Full-history re-link requested for next pairing", "source", "auth")
	return func() { wastore.DeviceProps.RequireFullSync = previous }
}

// redactPhone keeps only the last four digits so pairing logs never expose a
// full phone number. Unexpectedly short inputs are fully masked.
func redactPhone(phone string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)
	if len(digits) <= 4 {
		return "***"
	}
	return "***" + digits[len(digits)-4:]
}

// PairPhone generates an 8-digit pairing code for linking a phone without
// scanning a QR code. Returns the pairing code string on success.
//
// The client must be connected first (call Login or wait for Connected event).
// WhatsApp validates the client display name; common browser+OS combos only.
func (a *Api) PairPhone(phone string) (string, error) {
	// PairPhone must not race the QR login loop (or app shutdown): use the
	// same lifecycle guards as Login.
	a.loginMu.Lock()
	defer a.loginMu.Unlock()

	if a.isShuttingDown() {
		return "", context.Canceled
	}
	a.lifecycleMu.Lock()
	if a.startupErr != nil {
		err := a.startupErr
		a.lifecycleMu.Unlock()
		return "", err
	}
	if a.waClient == nil {
		a.lifecycleMu.Unlock()
		return "", errors.New("WhatsApp client is not ready")
	}
	client := a.waClient
	a.lifecycleMu.Unlock()

	if client.Store.ID != nil {
		return "", fmt.Errorf("already logged in")
	}
	if !client.IsConnected() {
		return "", fmt.Errorf("client not connected — call Login first")
	}
	phone = strings.TrimSpace(phone)
	if len(phone) < minPhoneLen {
		return "", fmt.Errorf("phone number too short (min %d digits)", minPhoneLen)
	}
	restore := a.applyFullHistoryRelink()
	defer restore()
	code, err := client.PairPhone(a.ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Windows)")
	if err != nil {
		slog.Error(fmt.Sprintf("PairPhone failed for %s: %v", redactPhone(phone), err), "source", "auth")
		return "", fmt.Errorf("pairing failed: %w", err)
	}
	slog.Info(fmt.Sprintf("PairPhone code generated for %s", redactPhone(phone)), "source", "auth")
	// The code is returned to the caller (frontend); do not duplicate it into
	// the generic wa:status stream.
	return code, nil
}

func (a *Api) Logout() error {
	a.loginMu.Lock()
	defer a.loginMu.Unlock()

	if a.isShuttingDown() {
		return context.Canceled
	}
	a.lifecycleMu.Lock()
	if a.startupErr != nil {
		err := a.startupErr
		a.lifecycleMu.Unlock()
		return err
	}
	if a.waClient == nil {
		a.lifecycleMu.Unlock()
		return errors.New("WhatsApp client is not ready")
	}
	client := a.waClient
	a.lifecycleMu.Unlock()

	if client.Store.ID == nil || !client.IsLoggedIn() {
		return fmt.Errorf("not logged in")
	}

	// A logout invalidates the session. Stop everything that could reconnect
	// with the deleted credentials and drop any pending login context.
	a.stopConnectionHealthCheck()
	a.clearLoginState()

	slog.Info("Logging out", "source", "auth")
	if err := client.Logout(a.ctx); err != nil {
		slog.Error(fmt.Sprintf("Logout request failed: %v", err), "source", "auth")
		return fmt.Errorf("logout failed: %w", err)
	}
	slog.Info("Logged out successfully", "source", "auth")
	a.app.Event.Emit("wa:status", "logged_out")
	return nil
}
