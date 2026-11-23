package api

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The dedicated call-window handle lives at package scope rather than on the
// Api struct or behind an exported method. Wails v3 binds every exported method
// of a registered service to the frontend, so an exported SetCallWindow would
// become a JavaScript-callable binding. Keeping the setter unexported and
// package-level means only Go code (cmd/run.go, which composes the app and its
// windows) can inject the window, while the call-event emitters in this package
// can reach it through the show/hide helpers below.
//
// callWindow is guarded by callWindowMu because visibility is toggled from
// meowcaller's event callbacks (arbitrary goroutines), whereas injection
// happens once during startup on the main thread.
var (
	callWindowMu sync.RWMutex
	callWindow   *application.WebviewWindow
)

// SetCallWindow injects the single hidden call window created by cmd/run.go.
// It is a package-level function (not an Api method), so Wails does not bind
// it to JavaScript, even though the name is exported for cmd to call.
func SetCallWindow(w *application.WebviewWindow) {
	callWindowMu.Lock()
	callWindow = w
	callWindowMu.Unlock()
}

func getCallWindow() *application.WebviewWindow {
	callWindowMu.RLock()
	w := callWindow
	callWindowMu.RUnlock()
	return w
}

// showCallWindow reveals and focuses the dedicated call window. Webview window
// operations must run on Wails' main thread, so the work is dispatched with
// application.InvokeAsync. Nil-safe: a no-op when no call window was injected
// (e.g. before startup or in unit tests).
func showCallWindow() {
	w := getCallWindow()
	if w == nil {
		return
	}
	application.InvokeAsync(func() {
		w.UnMinimise()
		w.Show()
		w.Focus()
	})
}

// hideCallWindow hides the dedicated call window. Also dispatched on the main
// thread via application.InvokeAsync and nil-safe. Hiding is idempotent, so
// duplicate end signals are harmless.
func hideCallWindow() {
	w := getCallWindow()
	if w == nil {
		return
	}
	application.InvokeAsync(func() {
		w.Hide()
	})
}
