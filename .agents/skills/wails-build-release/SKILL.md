---
name: wails-build-release
description: Wails v3 packaging, cross-platform builds, Windows installers/MSIX, macOS bundles, Linux packaging, code signing, updater and CI release pipelines. Use when preparing a Wails app for distribution.
---

# wails-build-release

## Pipeline

1. `wails3 doctor` — clean environment.
2. `wails3 generate bindings` — bindings current.
3. `go build ./...`, `go test ./...`, frontend build/test.
4. `wails3 build` (Taskfile-driven; v3.1 adds YAML/Wake options).
5. Package per platform: Windows installer/MSIX + signing/UAC config, macOS bundle/notarisation, Linux AppImage/DEB/RPM.
6. Optionally wire the in-app updater: signed manifest, cryptographic verification, atomic swap; GitHub Release assets must be the app binaries, not installer packages.
7. CI: pin `wails3@v3.1.0`, Go 1.26+/1.27, run doctor + bindings check before build; attach `wails3 doctor` output to failures.

## Wails v3 specifics

- Separate CLI (`wails3`) and module path (`github.com/wailsapp/wails/v3`) from v2.
- Mobile builds are experimental; desktop is the stable contract.
- CGO apps (SQLite) need a C compiler on Windows; verify with a real build, not just `go build`.
- Never commit secrets/signing keys; use CI secret stores.

Full references: https://v3.wails.io/guides/build/ , /guides/installers/ , /reference/update-manifest/ .
