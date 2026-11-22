// Package tray hosts the in-process system tray. Wails v3 owns the tray icon
// inside the application process, replacing the old external tray binary and
// its unix-socket bridge.
package tray

import (
	_ "embed"
	"log"

	apiPkg "github.com/lugvitc/whats4linux/api"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// trayIcon is the 32x32 PNG frame extracted from the original systray/icon.go
// ICO (the size the old systray used in the notification area). It is a real
// icon, not a generated placeholder.
//
//go:embed icon.png
var trayIcon []byte

const notificationsEvent = "wa:notifications_toggled"

// Tray owns the native tray icon and its menu for the lifetime of the app.
type Tray struct {
	systray *application.SystemTray
	menu    *application.Menu
	notifs  *application.MenuItem
}

// New creates the tray icon and installs the Open / Hide / Notifications /
// Quit menu. It must be called after application.New and before app.Run; Wails
// defers the native icon creation until Run.
func New(app *application.App, window *application.WebviewWindow, api *apiPkg.Api) *Tray {
	systray := app.SystemTray.New()
	systray.SetIcon(trayIcon)
	systray.SetLabel("Whats4Linux")
	systray.SetTooltip("Lantern")

	menu := app.NewMenu()
	menu.Add("Open").OnClick(func(_ *application.Context) {
		window.UnMinimise()
		window.Show()
		window.Focus()
	})
	menu.Add("Hide").OnClick(func(_ *application.Context) {
		window.Hide()
	})

	// The checkbox starts enabled (the store default). ServiceStartup loads
	// persisted settings during Run, so ApplicationStarted re-syncs it below.
	notifs := menu.AddCheckbox("Notifications", api.GetNotificationsEnabled())
	notifs.OnClick(func(ctx *application.Context) {
		enabled := ctx.ClickedMenuItem().Checked()
		if err := api.SetNotificationsEnabled(enabled); err != nil {
			log.Println("tray: failed to set notifications:", err)
		}
		menu.Update()
	})
	menu.AddSeparator()
	menu.Add("Quit").OnClick(func(_ *application.Context) {
		app.Quit()
	})

	systray.SetMenu(menu)

	t := &Tray{
		systray: systray,
		menu:    menu,
		notifs:  notifs,
	}

	// Two-way state sync with Settings: the same event is emitted by
	// Api.SetNotificationsEnabled no matter which surface toggled it. Re-read
	// the authoritative store value instead of trusting the event payload.
	syncNotifications := func() {
		application.InvokeAsync(func() {
			t.notifs.SetChecked(api.GetNotificationsEnabled())
			t.menu.Update()
		})
	}
	app.Event.On(notificationsEvent, func(_ *application.CustomEvent) {
		syncNotifications()
	})
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
		syncNotifications()
	})

	return t
}

// Destroy releases the native tray icon. Called from Options.OnShutdown.
func (t *Tray) Destroy() {
	if t != nil && t.systray != nil {
		t.systray.Destroy()
	}
}
