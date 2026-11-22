# v2 → v3 migration

Source: https://v3.wails.io/migration/v2-to-v3/ (complete guide with before/after examples). Migration is a real port; budget 1-4h for a typical app, more for large apps with many bindings.

## Breaking changes map

| Concern | v2 | v3 |
|---|---|---|
| Bootstrap | `wails.Run(&options.App{...})` | `app := application.New(application.Options{...})`, `app.Window.NewWithOptions(...)`, `app.Run()` |
| Bindings | `Bind: []interface{}{app}`, `ctx` field + `startup(ctx)` | `Services: []application.Service{ application.NewService(&Svc{}) }`, `ServiceStartup(ctx, opts)` |
| Runtime | `runtime.WindowSetTitle(ctx, ...)`, `runtime.EventsEmit(ctx, ...)` | `window.SetTitle(...)`, `app.Event.Emit(...)` |
| Events | `runtime.EventsOn(ctx, name, func(...interface{}))` | `app.Event.On(name, func(*application.CustomEvent))`, returns unsubscribe |
| Frontend imports | `../wailsjs/go/main/App` | `./bindings/<app>/<service>` |
| Frontend events | `../wailsjs/runtime/runtime` `EventsOn/EventsEmit` | `@wailsio/runtime` `Events.On/.Emit` |
| Config | flat `wails.json` | `frontend: { dir, install, build, dev, devServerUrl }` (plus Taskfile/wails.yaml) |
| Dialogs | `runtime.OpenFileDialog(ctx, ...)` | `app.Dialog.OpenFile().SetTitle(...).PromptForSingleSelection()` |
| Menus | `menu.NewMenu()`, `runtime.Quit(ctx)` | `app.NewMenu()`, `menu.Add("Quit").OnClick(...)`, `app.Quit()` |
| Systray | not available | `app.SystemTray.New()`, `SetIcon`, `SetLabel`, `SetMenu`, `AttachWindow` |

## Ordered slices (one D each in a swarm)

1. `go get github.com/wailsapp/wails/v3@v3.1.0`; keep `go.mod` tidy; verify Go >= 1.26.
2. Port `main.go`: app creation, window, `app.Run()`, embedded assets via `application.AssetFileServerFS(assets)`.
3. Convert bound `App` struct into services; replace `ctx` with explicit `app`/dependency injection.
4. Replace runtime calls with manager methods.
5. Regenerate bindings (`wails3 generate bindings -ts`) and update frontend imports.
6. Port events (Go + `@wailsio/runtime`).
7. Replace any v2 systray helper with `app.SystemTray` — preserve every tray action; never silently drop one.
8. Port build config (Taskfile/wails.yaml), scripts and CI (`wails3 build`, `wails3 doctor`).
9. Frontend build/test, Go build/vet/test, smoke test window, menu, dialogs, tray.

## Common failure modes

- Bindings not found → regenerate; check `frontend/bindings`.
- `ctx` errors → store `*application.App` on the service.
- Window methods missing → use `app.Window.Current()`.
- Events not firing → names must match exactly on both sides.
- Systray "works" but icon missing → check icon size/format; on Linux DE support varies, degrade gracefully.
