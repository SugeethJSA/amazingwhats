//go:build windows

package api

import (
	"log/slog"
	"os"

	"github.com/lugvitc/amazingwhats/internal/misc"
	"golang.org/x/sys/windows/registry"
)

// applyStartAtLogin reconciles the Windows per-user Run key with the saved
// setting. The "--hidden" flag keeps autostart in the tray instead of popping
// a window on sign-in. Failures are logged but never break settings saving.
func (a *Api) applyStartAtLogin() {
	enabled, _ := a.GetSettings()["startAtLogin"].(bool)
	key, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		slog.Warn("autostart: could not open Run key", "error", err, "source", "settings")
		return
	}
	defer func() { _ = key.Close() }()

	if !enabled {
		if err := key.DeleteValue(misc.AppName); err != nil && err != registry.ErrNotExist {
			slog.Warn("autostart: could not remove Run entry", "error", err, "source", "settings")
		}
		return
	}

	exe, err := os.Executable()
	if err != nil {
		slog.Warn("autostart: could not resolve executable", "error", err, "source", "settings")
		return
	}
	if err := key.SetStringValue(misc.AppName, `"`+exe+`" --hidden`); err != nil {
		slog.Warn("autostart: could not write Run entry", "error", err, "source", "settings")
	}
}
