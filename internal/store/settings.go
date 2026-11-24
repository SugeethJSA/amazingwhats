package store

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"maps"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/lugvitc/amazingwhats/internal/misc"
)

// notificationsKey is the app_settings.json key for the global
// notifications on/off switch.
const notificationsKey = "notifications_enabled"

// notificationsEnabled caches the global notification switch so the hot
// notify path can read it without touching the settings map (which is not
// safe for concurrent access).
var notificationsEnabled atomic.Bool

func init() {
	// Default to enabled until LoadSettings reads the persisted value.
	notificationsEnabled.Store(true)
}

type settings struct {
	mu   sync.Mutex
	f    *os.File
	path string
	data map[string]any
}

var settingsInstance = &settings{
	data: make(map[string]any),
}

func LoadSettings() {
	path := filepath.Join(misc.ConfigDir, "app_settings.json")
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		panic(err)
	}
	// Restrict as well as create with 0600 so older installs are migrated.
	misc.RestrictFile(path)

	settingsInstance.f = f
	settingsInstance.path = path

	decoder := json.NewDecoder(f)
	if err := decoder.Decode(&settingsInstance.data); err != nil {
		if errors.Is(err, io.EOF) {
			// Empty file on first run: nothing to restore.
			if settingsInstance.data == nil {
				settingsInstance.data = make(map[string]any)
			}
		} else {
			// A corrupt/truncated file may have partially populated the map
			// before failing. Log the real error and start from a clean map;
			// the next save rewrites the file atomically.
			log.Printf("store: could not decode %s, using defaults: %v", path, err)
			settingsInstance.data = make(map[string]any)
		}
	}
	notificationsEnabled.Store(notificationsEnabledFrom(settingsInstance.data))
}

func GetSettings() map[string]any {
	return settingsInstance.data
}

func SaveSettings(data map[string]any) error {
	settingsInstance.mu.Lock()
	defer settingsInstance.mu.Unlock()

	// The frontend saves its own settings snapshot, which doesn't include
	// backend-owned keys — carry them over so a generic save can't clobber
	// them (that reset the notification switch back to its default).
	if _, ok := data[notificationsKey]; !ok {
		if cur, ok := settingsInstance.data[notificationsKey]; ok {
			data[notificationsKey] = cur
		}
	}
	settingsInstance.data = data
	// Keep the cached switch in sync in case the whole settings map was
	// replaced by the frontend.
	notificationsEnabled.Store(notificationsEnabledFrom(data))

	return settingsInstance.writeLocked()
}

// GetNotificationsEnabled reports the global notification switch. Safe for
// concurrent use; defaults to true when the setting was never persisted.
func GetNotificationsEnabled() bool {
	return notificationsEnabled.Load()
}

// SetNotificationsEnabled persists the global notification switch to
// app_settings.json and updates the cached value.
func SetNotificationsEnabled(enabled bool) error {
	notificationsEnabled.Store(enabled)

	settingsInstance.mu.Lock()
	defer settingsInstance.mu.Unlock()

	// Copy-on-write so concurrent GetSettings readers never observe a map
	// mutation mid-flight.
	newData := make(map[string]any, len(settingsInstance.data)+1)
	maps.Copy(newData, settingsInstance.data)
	newData[notificationsKey] = enabled
	settingsInstance.data = newData

	return settingsInstance.writeLocked()
}

// notificationsEnabledFrom extracts the switch from a settings map, defaulting
// to true when unset or of an unexpected type.
func notificationsEnabledFrom(data map[string]any) bool {
	if v, ok := data[notificationsKey]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return true
}

// writeLocked persists the current settings map atomically: encode to memory,
// write a sibling temp file, then rename it over the destination. A crash or
// encode failure can therefore never leave a truncated settings file behind.
// The caller must hold settingsInstance.mu.
func (s *settings) writeLocked() error {
	if s.path == "" {
		return errors.New("settings store is not initialised")
	}

	buf, err := json.Marshal(s.data)
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".app_settings-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if _, err := tmp.Write(buf); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}

	// Close the destination handle first so the replacement also works on
	// Windows, where renaming over an open file can be refused.
	if s.f != nil {
		if err := s.f.Close(); err != nil {
			_ = os.Remove(tmpName)
			return err
		}
		s.f = nil
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		_ = os.Remove(tmpName)
		if f, openErr := os.OpenFile(s.path, os.O_RDWR, 0600); openErr == nil {
			s.f = f
		}
		return err
	}
	misc.RestrictFile(s.path)

	// Refresh the kept-open handle so it refers to the live (renamed) file.
	f, err := os.OpenFile(s.path, os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	s.f = f
	return nil
}

func CloseSettings() error {
	settingsInstance.mu.Lock()
	defer settingsInstance.mu.Unlock()

	if settingsInstance.f == nil {
		return nil
	}

	err := settingsInstance.f.Close()
	settingsInstance.f = nil
	return err
}
