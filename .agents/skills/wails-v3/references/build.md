# Wails v3 build & packaging

Source: https://v3.wails.io/guides/build/building/ , /guides/build/customization/ (Taskfile), /reference/wails-yaml-fields/ , /guides/build/cross-platform/ , /guides/build/windows/ , /guides/build/macos/ , /guides/build/linux/ , /guides/installers/ , /guides/build/signing/ , https://wails.io/blog/wails-v3-1-released/.

## Build

```sh
wails3 build              # Taskfile-driven, inspectable build
wails3 build -d           # debug
wails3 doctor             # environment check before builds/issue reports
```

v3 replaced the opaque v2 build with an inspectable **Taskfile**-based system; `wails.json`'s frontend keys become `frontend: { dir, install, build, dev, devServerUrl }`. v3.1 also documents experimental YAML builds (`wails.yaml`) and "Wake" for build/package/sign.

## Cross-platform

Windows (amd64/arm64), macOS (Intel/Apple Silicon), Linux (amd64/arm64). Linux default GTK4 + WebKitGTK 6.0; `-tags gtk3` until v3.1. Mobile (iOS/Android) is experimental and outside the stable desktop contract.

## Packaging / release

Installers per platform, MSIX for Windows, code signing on all platforms, custom URL protocols, file associations, UAC configuration, and the in-app updater (pluggable providers, cryptographic verification, atomic swap). See the guides before generating release pipelines.

## Windows/CGO note

Apps using `mattn/go-sqlite3` need a C compiler on Windows (e.g. MSYS2 `C:\msys64\ucrt64\bin\gcc.exe`) and `CGO_ENABLED=1`. Wails v3.1 documents experimental CGO-free desktop builds; verify toolchain with `wails3 doctor` and a real build.

## Verification gate

`go build ./...`, `go test ./...`, `wails3 generate bindings`, frontend build, `wails3 build`, and `wails3 doctor` output recorded.
