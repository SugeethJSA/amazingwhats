# Wails v3 architecture

Source: Wails v3 docs (https://v3.wails.io/reference/application/, /concepts/architecture/, /concepts/lifecycle/, /concepts/manager-api/).

## Object model

v2 bundled setup, window config and execution into `wails.Run(&options.App{})`. v3 separates them:

```go
package main

import (
    "log"
    "github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
    app := application.New(application.Options{
        Name:        "My App",
        Description: "A Wails v3 app",
        Services: []application.Service{
            application.NewService(&GreetService{}),
        },
    })

    window := app.Window.NewWithOptions(application.WebviewWindowOptions{
        Title:  "My App",
        Width:  1024,
        Height: 768,
    })
    window.Center()
    window.Show()

    if err := app.Run(); err != nil {
        log.Fatal(err)
    }
}
```

- `application.New(application.Options{...})` creates the app; `app.Run()` starts the loop.
- `app.RegisterService(...)` can add services after creation (needed when a service wants the `*application.App` injected).
- `app.Quit()` shuts down gracefully; `app.OnShutdown(func(){...})` registers cleanup.

## Managers (on `*application.App`)

| Manager | Purpose |
|---|---|
| `app.Window` | create/find windows (`New`, `NewWithOptions`, `GetByName`, `GetAll`, `Current`) |
| `app.Menu` / `app.NewMenu()` | native menus |
| `app.Dialog` | native message/file/save/folder dialogs |
| `app.Event` | typed custom + application events |
| `app.Clipboard` | text clipboard |
| `app.Screen` | display information |
| `app.SystemTray` | notification-area icon + menu |
| `app.Browser` | open URLs/files in default app |
| `app.Env` | environment information |
| `app.ContextMenu` | right-click menus |
| `app.KeyBinding` | global keyboard shortcuts |
| `app.Logger` | `*slog.Logger` |

## Runtime shift

v2 context-bound runtime calls become methods on the owning object:

| v2 | v3 |
|---|---|
| `runtime.WindowSetTitle(ctx, "x")` | `s.app.Window.Current().SetTitle("x")` |
| `runtime.EventsEmit(ctx, "e", d)` | `s.app.Event.Emit("e", d)` |
| `runtime.LogInfo(ctx, "m")` | `s.app.Logger.Info("m")` |

## Platform options

`application.Options` has `Windows`, `Mac`, `Linux` sub-options (e.g. WebView2 feature flags, `DisableQuitOnLastWindowClosed`, macOS activation policy). Use `RawMessageHandler` only after profiling proves bindings are a bottleneck.

## Lifecycle notes

- Services start in registration order; `ServiceStartup` errors abort startup.
- Services shut down in reverse order; `ServiceShutdown` errors are logged, not fatal.
- Application shutdown is registered via `app.OnShutdown`, not an event constant.
