// Package notify raises desktop notifications with a small, cross-platform
// surface. It deliberately lives outside api so each operating system can use
// its native notification backend without leaking platform types into the Wails
// service.
//
// The two user actions exposed to notification servers are "open" (focus the
// chat) and "reply" (focus the chat and pre-fill a typed reply). Not all
// platforms support inline text entry; the handler always receives a text
// string, empty where the platform cannot supply one.
package notify

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const (
	// AppName is the application identity shown by every notification backend.
	AppName = "Whats4Linux"

	// ActionOpen raises wa:open_chat for the notification's chat.
	ActionOpen = "open"
	// ActionReply raises wa:notification_reply for the notification's message.
	ActionReply = "reply"
)

// Options describes a single desktop notification. ChatJID and MessageID are
// carried back through activation callbacks so the API layer can emit the
// correct frontend events without keeping its own side table.
type Options struct {
	ChatJID   string
	MessageID string
	SenderJID string
	Title     string
	Body      string
	IconPath  string // optional override; defaults to the embedded app icon
	Image     []byte // optional message thumbnail (JPEG/PNG/...)
	Avatar    []byte // optional chat avatar; preferred over Image when present
	Actions   bool   // whether to expose Open/Reply actions
}

// ActionHandler is invoked when the user activates a notification action.
// text is the inline reply where supported, otherwise empty.
type ActionHandler func(action, chatJID, messageID, text string)

var (
	handlerMu     sync.RWMutex
	actionHandler ActionHandler
)

// SetActionHandler installs the single process-wide notification callback.
// It is safe to call more than once; the latest handler wins. The API service
// registers exactly once via api.New.
func SetActionHandler(h ActionHandler) {
	handlerMu.Lock()
	actionHandler = h
	handlerMu.Unlock()
}

// dispatch is the single entry point from every platform callback.
func dispatch(action, chatJID, messageID, text string) {
	handlerMu.RLock()
	h := actionHandler
	handlerMu.RUnlock()
	if h != nil {
		h(action, chatJID, messageID, text)
	}
}

// appIconPNG is the real 512x512 application icon. go:embed cannot reference a
// parent directory, so build/appicon.png is copied here and kept in sync.
//
//go:embed appicon.png
var appIconPNG []byte

var (
	iconMu      sync.Mutex
	iconPath    string
	iconPathErr error
)

// writeAppIcon extracts the embedded icon to a stable, private path once. Each
// backend needs a real file (freedesktop app_icon and Windows toast.Icon both
// take paths), and keeping a single path avoids leaving temp files behind for
// every notification.
func writeAppIcon() (string, error) {
	iconMu.Lock()
	defer iconMu.Unlock()
	if iconPath != "" {
		return iconPath, nil
	}
	if iconPathErr != nil {
		return "", iconPathErr
	}

	// A fresh private directory avoids writable-path/symlink races in the
	// shared temp folder; it lives for the process lifetime (a few KB).
	dir, err := os.MkdirTemp("", "whats4linux-notify-")
	if err != nil {
		iconPathErr = fmt.Errorf("create notification icon dir: %w", err)
		return "", iconPathErr
	}
	path := filepath.Join(dir, "appicon.png")
	if err := os.WriteFile(path, appIconPNG, 0o600); err != nil {
		iconPathErr = fmt.Errorf("write notification icon: %w", err)
		return "", iconPathErr
	}
	iconPath = path
	return iconPath, nil
}

// resolveIconPath prefers an explicit caller override, then the embedded icon.
func resolveIconPath(opts Options) (string, error) {
	if opts.IconPath != "" {
		return opts.IconPath, nil
	}
	return writeAppIcon()
}
