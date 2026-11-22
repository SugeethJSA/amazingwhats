# Wails v3 CLI (wails3)

Source: https://v3.wails.io/reference/cli/ , https://v3.wails.io/guides/cli/.

## Install

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
wails3 setup     # experimental setup wizard
wails3 doctor    # environment diagnostics
```

`wails3` and v2's `wails` are separate binaries and can coexist. Go >= 1.26 required.

## Common commands

| Command | Use |
|---|---|
| `wails3 init -n <name> -t <template>` | scaffold a project (vanilla/React/Vue/Svelte templates) |
| `wails3 dev` | dev server + hot reload + binding regeneration |
| `wails3 generate bindings [-ts] [-d out] [-names]` | generate JS/TS bindings |
| `wails3 build` | Taskfile-driven production build |
| `wails3 doctor` | diagnostics to attach to bug reports |
| `wails3 task ...` | run Taskfile tasks (e.g. `ios:run`, `android:run`) |

## CI notes

- Pin the CLI version (`@v3.1.0`), not `@latest`, for reproducible builds.
- Run `wails3 doctor` and `wails3 generate bindings` before build; fail CI if generated bindings are stale.
- Keep Go/toolchain versions pinned (Wails recommends 1.26.10+/1.27.3+ for the `crypto/x509` fix).
