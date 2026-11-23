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
// capable backend. beeep only supports title/body/icon, so actions are
// requested but cannot be delivered.
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
