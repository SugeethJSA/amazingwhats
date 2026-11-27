//go:build !linux && !windows

package notify

import (
	"github.com/gen2brain/beeep"
)

func init() {
	// beeep uses AppName for the notification source on every platform.
	beeep.AppName = AppName
}

// Notify is the graceful fallback for platforms without a native action-
// capable backend. beeep only supports title/body/icon, so neither the message
// Open/Reply pair nor the incoming-call Accept/Decline pair can be delivered
// here. The call still shows as an alert; answering it requires the app window.
func Notify(opts Options) error {
	iconPath, err := resolveIconPath(opts)
	if err != nil {
		return err
	}
	return beeep.Notify(opts.Title, opts.Body, iconPath)
}

// Close is a no-op for the beeep fallback.
func Close() error {
	return nil
}
