# Wails v3 testing

Source: https://v3.wails.io/guides/testing/ , /guides/e2e-testing/ , /contributing/testing-ci/.

## Go unit tests

Services are plain Go structs: test them directly with `go test ./...`, mock dependencies (sqlmock, interfaces), and test `ServiceStartup`/`ServiceShutdown` lifecycle without launching a GUI. Run with race detector in CI: `go test -race ./...`.

## Frontend tests

Run the project's framework tests (Vitest/Jest) and TypeScript build. Verify generated bindings are imported from `frontend/bindings/`, never `wailsjs/`, and that event names match Go exactly.

## Integration / E2E

`wails3 dev` for manual verification: window opens, bindings resolve, events fire, menus/dialogs/tray work. For automated E2E see the Wails MCP service guide (LLM control) and E2E testing guide.

## Migration verification checklist

- App starts without errors; `wails3 doctor` clean.
- All bindings resolve and regenerate; no stale v2 imports.
- Events sent and received; window open/close; menus, dialogs, system tray.
- `go build ./...`, `go test ./...`, `wails3 generate bindings`, frontend build/test, `wails3 build`.
- No user-visible capability silently dropped (especially systray actions).

## Swarm verifier convention

Mother's central script runs these serially and writes full log + exit file; workers never run builds.
