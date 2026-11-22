# Wails v3 windows

Source: https://v3.wails.io/reference/window/ , https://v3.wails.io/features/windows/basics/ , /features/windows/options/ , /features/windows/multiple/ , /features/windows/events/.

## Create

```go
window := app.Window.NewWithOptions(application.WebviewWindowOptions{
    Title:            "Main",
    Width:            1200,
    Height:           800,
    MinWidth:         800,
    MinHeight:        600,
    BackgroundColour: application.NewRGB(255, 255, 255),
    URL:              "http://wails.localhost/",
})
window.Center()
window.Show()
```

`app.Window.New()` uses defaults. `app.Window.GetByName("main")` and `app.Window.GetAll()` manage existing windows; `app.Window.Current()` targets the calling window.

## Multi-window

Windows are first-class objects created/destroyed at runtime. Give each window a distinct name, keep references on the owning service, and choose explicitly which window a method targets. Do not assume "the current window" in background goroutines.

## Options / platform notes

- Application-level Windows options live in `application.Options.Windows` (WebView2 `EnabledFeatures`, `DisabledFeatures`, `AdditionalBrowserArgs`, `WebviewUserDataPath`, `DisableQuitOnLastWindowClosed`).
- Frameless, always-on-top, `Hidden`, `HideOnFocusLost`, `HideOnEscape` are available for tray popups.
- Linux default is GTK4 + WebKitGTK 6.0; legacy GTK3 via `-tags gtk3` until v3.1.

## Window events

Register via the window/event manager (e.g. window close/resize/focus); always unsubscribe when a window is destroyed to avoid leaks. Use `app.Event.OnApplicationEvent(events.Common.ApplicationStarted, ...)` for app-level events and `app.OnShutdown` for shutdown cleanup.

## Verification

`wails3 dev` (window opens, hot reload), `wails3 build`, plus `go test ./...` for any window-management logic.
