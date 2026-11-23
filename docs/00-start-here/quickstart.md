---
title: "Quickstart — from a clean machine to a running app"
description: "The exact tool versions and commands this repository uses to install, check, develop, and build the desktop app."
---

# Quickstart

> **In one line:** Install the tools at the versions this repo actually pins, then use the framework CLI and its task recipes to check, run, and build — do not improvise the commands.

## Why this page exists

Most setup guides fail in one of two ways: they list versions that look right but disagree with the repository, or they invent commands that nobody here runs. This page takes every version and command from a checked-in file — the module manifest, the CI workflow, the Taskfiles, or the Wails project config — and says where it came from. If a command is only used by this repo's own verification tooling, that is called out explicitly.

## The idea, in plain words

Think of the toolchain as a workshop with four roles:

- **The engine** is the Go compiler. It builds the desktop program and, because a C-backed database driver is involved, it needs a C compiler alongside it.
- **The toolbelt** is Node and npm. They build the web-style page that ends up inside the window.
- **The foreman** is the `wails3` CLI. It checks the machine, generates the callable bridge, and starts or packages the app.
- **The recipe cards** are the Taskfiles. They are the authoritative list of steps; the foreman reads them so you do not have to remember every flag.

You install the engine and toolbelt once, install the foreman once, then follow the recipes. Everything below is a recipe that already exists in this repository.

## The code, line by line

These excerpts are the sources of truth for the versions and commands that follow.

```go
// go.mod:1-3
module github.com/lugvitc/whats4linux

go 1.27.3
```

```yaml
# .github/workflows/build.yaml:34-45
      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: "1.27.3"

      - name: Install Wails 3
        run: |
          go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
          echo "$HOME/go/bin" >> $GITHUB_PATH

      - name: Verify Wails 3 toolchain
        run: wails3 doctor
```

```yaml
# Taskfile.yml:32-35
  dev:
    summary: Runs the application in development mode
    cmds:
      - wails3 dev -config ./build/config.yml -port {{.VITE_PORT}}
```

```yaml
# build/windows/Taskfile.yml:30-34
    env:
      GOOS: windows
      # mattn/go-sqlite3 requires cgo; CI puts MSYS2 ucrt64 gcc on PATH.
      CGO_ENABLED: 1
      GOARCH: '{{.ARCH | default ARCH}}'
```

| Line | What it does |
|---|---|
| `go.mod:1` | Declares the module path; it explains the `github.com/lugvitc/whats4linux/...` imports in Go files. |
| `go.mod:3` | Pins the Go language/toolchain version: 1.27.3. |
| `build.yaml:37` | CI pins the same Go version, 1.27.3 — the two agree. |
| `build.yaml:41` | Exact install command for the framework CLI at version 3.1.0. |
| `build.yaml:45` | The machine check command, `wails3 doctor`. |
| `Taskfile.yml:35` | The real dev command, including config file and port flags. |
| `Taskfile.yml:14` | The default port is 9245. |
| `build/windows/Taskfile.yml:32` | Explains why a Windows C compiler is needed. |
| `build/windows/Taskfile.yml:33` | Turns CGO on, which activates that requirement. |

## Prerequisites

| Tool | Required version / detail | Source |
|---|---|---|
| Go | 1.27.3 | `go.mod:3`, `.github/workflows/build.yaml:37` |
| Node.js | 20 (the version CI uses) | `.github/workflows/build.yaml:20` |
| npm | Must be on `PATH`; build tasks check for it | `build/Taskfile.yml:19-21` |
| Framework CLI | `wails3` at v3.1.0 | `go.mod:14`, `.github/workflows/build.yaml:41` |
| Windows C compiler | MSYS2 ucrt64 GCC on `PATH` (`CGO_ENABLED: 1`) | `build/windows/Taskfile.yml:32-33` |
| Linux system libraries (CI on Ubuntu 24.04) | `libgtk-4-dev`, `libwebkitgtk-6.0-dev`, `libayatana-appindicator3-dev`, `pkg-config`, `build-essential` | `.github/workflows/build.yaml:9`, `build.yaml:24-32` |

> **Note on Node:** the repository pins Node 20 in CI (`.github/workflows/build.yaml:20`). There is no other local version pin to copy here, so match 20 to avoid surprises.

> **Note on the Windows C compiler:** the repo states it plainly — "mattn/go-sqlite3 requires cgo; CI puts MSYS2 ucrt64 gcc on PATH" (`build/windows/Taskfile.yml:32`). If you build on Windows without that GCC, the failure comes from the CGO/SQLite step, not from the Go source.

## Commands

Run these from the repository root unless a source line says otherwise.

1. **Install the framework CLI** (once):

   ```sh
   go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
   ```

   Source: `.github/workflows/build.yaml:41`. CI also adds `$HOME/go/bin` to `PATH` on the next line; do the same if `wails3` is not found.

2. **Install frontend dependencies:**

   ```sh
   npm ci
   ```

   `npm ci` is the deterministic install from `package-lock.json` used by this repository's verification tooling (`provenance-docs/BUILD_RUNNER.md:15`, `.agents/skills/wails-v3/SKILL.md:48`). The application's own Taskfile uses `npm install` for the same job (`build/Taskfile.yml:23`, `wails.json:5`); both are real repo commands, but `npm ci` is the repeatable choice for a clean checkout.

3. **Check the toolchain:**

   ```sh
   wails3 doctor
   ```

   Source: `.github/workflows/build.yaml:45`.

4. **Generate the callable bridge after changing exported Go methods:**

   ```sh
   wails3 generate bindings -ts
   ```

   Source: `.github/workflows/build.yaml:49`. The build recipe uses the fuller form with flags from `BUILD_FLAGS` and `-clean=true` (`build/Taskfile.yml:60`).

5. **Develop:**

   ```sh
   wails3 task dev
   ```

   The task runs `wails3 dev -config ./build/config.yml -port 9245` (`Taskfile.yml:32-35`, `Taskfile.yml:14`). The config also defines the build pipeline the dev loop follows — install deps, start the frontend dev server, tidy modules, build, then run (`build/config.yml:30-40`).

6. **Build and run:**

   ```sh
   wails3 task build
   wails3 task run
   wails3 task package
   ```

   These tasks dispatch to the current OS's recipe (`Taskfile.yml:17-30`). CI's explicit production build command is `wails3 build PRODUCTION=true ARCH=amd64` (`.github/workflows/build.yaml:54`), and the production recipe passes `-tags production`, `-trimpath`, and link flags (`build/windows/Taskfile.yml:26`). A successful Linux CI build writes its output to `bin/*` (`.github/workflows/build.yaml:56-60`).

## What can go wrong

> **`wails3` is not found.** The CLI is installed into the Go bin directory. CI explicitly appends `$HOME/go/bin` to `PATH` (`build.yaml:42`); do the same locally.

> **Bindings are stale.** After editing an exported Go method, CI regenerates bindings and then fails if tracked output changed (`.github/workflows/build.yaml:47-50`). The same gate exists as a task named `verify:bindings` (`build/Taskfile.yml:62-67`). Regenerate before committing.

> **A "passing" doctor is not a passing build.** The repository's runner notes that `wails3 doctor` failures are optional/warn-only (`provenance-docs/BUILD_RUNNER.md:15`); the real gate is the build step (`.github/workflows/build.yaml:52-54`).

> **Calling `wails3 dev` directly skips the recipe.** Running the bare command without `-config ./build/config.yml -port 9245` misses the dev pipeline defined in `build/config.yml:30-40`. Prefer the task.

> **npm is missing.** The frontend build task has an explicit precondition that `npm version` succeeds, with the message "npm is required to build the frontend" (`build/Taskfile.yml:19-21`).

> **Manual smoke tests were not part of the recorded verification.** The integration report states that runtime UI checks (tray on GTK4, call audio, notifications) were not executed in that environment (`provenance-docs/INTEGRATION_REPORT.md:30`). A green build does not prove those behaviors on your machine.

## Where to next

- [Vocabulary: every term before first use](vocabulary.md)
- [Landing page and reading order](../index.md)
- Later: [Build and run details](../04-operations/build-and-run.md) and [Configuration](../04-operations/configuration.md)
