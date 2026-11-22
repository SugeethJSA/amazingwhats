---
name: desktop-ui-ux
description: Native desktop UX for Wails apps — window lifecycle, keyboard shortcuts, accessibility, responsive layouts, platform conventions, and WebView performance. Use when designing or reviewing desktop UI behaviour rather than writing Go services.
---

# desktop-ui-ux

## Principles

- Native feel: respect platform conventions for menus, tray, dialogs, window controls and keyboard accelerators; Wails global shortcuts follow labelled keys on AZERTY/QWERTZ/Dvorak.
- One window does one job; use multiple windows deliberately. Persist window state (size/position) across restarts.
- Keyboard-first: every action reachable without a mouse, visible focus, no global shortcut that steals typing in inputs.
- Accessibility: semantic HTML, ARIA roles, contrast, reduced motion, screen-reader labels. Test with the platform's native tools.
- Responsive: WebView resize should reflow without IPC storms; batch frontend→Go calls, use events for streaming.
- Performance: keep UI work off the main thread, cache Go-side results, avoid per-item binding calls, profile with `wails3 dev` and browser tooling.

## Platform checks

Windows (WebView2 recovery, DPI/RDP), macOS (Liquid Glass on 26+, template tray icons), Linux (GTK4/WebKitGTK 6, DE-dependent tray). Verify with `wails3 doctor`.

## Gate

Pair with `wails-v3` for API correctness and `golang-pro` for backend work. Verify with frontend build/test plus a manual `wails3 dev` pass covering window, shortcuts, a11y and tray.
