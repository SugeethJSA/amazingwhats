---
name: wails-v3
description: Build, review, debug and migrate Go desktop apps with Wails v3 (stable v3.0.0+, current v3.1.0). Use whenever Wails, wails3, Go desktop/webview apps, generated bindings, services, windows, events, dialogs, menus, system tray, packaging or v2-to-v3 migration comes up. Enforces v3-only APIs and rejects stale wails/v2 patterns.
---

# Wails v3

Wails v3 is a **complete rewrite**, not a version bump. Applications, windows, services and events are explicit objects. The CLI is `wails3` (separate binary/module from v2's `wails`).

## Hard rules

1. **Target v3 only for new work.** `github.com/wailsapp/wails/v2`, `wails.Run(&options.App{...})`, `runtime.*` context calls, `../wailsjs/go/...` imports and `wails build` are wrong for v3 work. Existing v2 code is migration input only.
2. **Verify APIs against the docs before generating code**: https://v3.wails.io/reference/application/ , https://v3.wails.io/reference/window/ , https://v3.wails.io/features/bindings/methods/ , and `pkg.go.dev/github.com/wailsapp/wails/v3@v3.1.0`. This skill's references are an index, not a substitute for the live API.
3. **Go >= 1.26** is required by v3. Prefer current Go 1.26/1.27 patch releases.
4. **Never fabricate success.** If a binding, event, window or build step is unverified, say so and show the command that verifies it.
5. `wails3 generate bindings` after any Go service/method change; generated files go under `frontend/bindings/`, not `frontend/wailsjs/`.
6. Services are singletons shared by all windows: protect shared state with mutexes. Only exported methods are bound.

## Decision order

1. What is the task — new app, port from v2, binding change, native capability, build/packaging, or bug?
2. Load the matching reference below.
3. Check the current project's `go.mod`, `main.go`, `wails.json`/Taskfile and `frontend/` before editing.
4. Make the smallest change; regenerate bindings; run `go build ./...`, `go test ./...`, `wails3 generate bindings`, and the frontend build/test.
5. For migration, follow `references/migration.md` slice-by-slice and never remove a user-visible capability (notably systray) without an explicit decision.

## References

- `references/architecture.md` — application/window/service/event object model, lifecycle, managers.
- `references/services.md` — service registration, DI, `ServiceStartup`/`ServiceShutdown`, testing.
- `references/bindings.md` — generated JS/TS bindings, type mapping, errors, performance.
- `references/windows.md` — window creation/options, multi-window, window events.
- `references/events.md` — `app.Event`, typed events, frontend `@wailsio/runtime`.
- `references/native-apis.md` — dialogs, menu, system tray, clipboard, keyboard, notifications.
- `references/build.md` — Taskfile/wails.yaml, `wails3 build`, cross-platform, installers, signing.
- `references/migration.md` — v2→v3 before/after mapping and ordered migration steps.
- `references/cli.md` — `wails3` commands used in development and CI.
- `references/testing.md` — unit/integration/frontend/E2E testing and verification checklist.

## Quick verification snippet

```powershell
go build ./...
go test ./...
wails3 generate bindings
wails3 doctor
# frontend
pnpm install --frozen-lockfile   # or npm ci
pnpm build && pnpm test -- --run
```

## Companion skills

- `golang-pro` — routes to the installed samber/spf13 Go skills for concurrency, testing, security, performance.
- `desktop-ui-ux` — native desktop UX, keyboard, accessibility, WebView performance.
- `wails-build-release` — packaging, installers, signing, updates.
