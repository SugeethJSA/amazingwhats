# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The UI is rendered as HTML/CSS in a WebKitGTK webview via Wails; it ships as a desktop application, not as a website. Its design language is web-based (no GTK/Qt widgets), so the platform record is `web`.

## Users

Cross-platform WhatsApp users who care about privacy and performance, doing everyday one-to-one and group messaging on desktop. The product stays Linux-first in spirit while being designed to feel at home across desktop platforms. (Confirmed in the init interview; consistent with README.md.)

## Product Purpose

Provide a fast, efficient WhatsApp desktop client that connects directly to WhatsApp's multi-device protocol instead of wrapping WhatsApp Web. Success is a lightweight, low-memory, private messaging experience that holds up in long-running sessions.

## Positioning

An unofficial WhatsApp client whose differentiator is architectural: a native Go backend (whatsmeow) owns the protocol, encryption, sync, storage, and media, while a lightweight WebKitGTK-rendered UI handles presentation through Wails RPC. No Electron, no Chromium, no Node.js runtime in the shipped app, no browser automation. All data is stored locally, with no telemetry or analytics — a neighboring wrapper cannot truthfully make the same claims.

## Operating Context

Desktop application shell (Wails v3, GTK4/WebKitGTK6, Taskfile build), in-process system tray integration, XDG base directories, Wayland and X11, and long-running sessions. Frontend surfaces present in the code: phone-pairing login, chat list and chat detail, message search, media lightbox, call overlay, and settings (account, chats, notifications, privacy, advanced, keyboard shortcuts, help/feedback, security notifications). The frontend is React 18 + TypeScript + Vite + Tailwind 4 with Zustand state, react-virtuoso for long histories, and GSAP for motion; the backend exposes strongly typed Wails bindings over SQLite (WAL mode) and a local media cache. Users can customise the UI with custom JS/CSS, a Bezier easing editor, and a colour-scheme editor.

## Capabilities and Constraints

- Confirmed capabilities: 1:1 and group messaging, media send/receive with a local cache, reactions, message edits and revokes, polls, channels/newsletters, communities and linked subgroups, presence, receipts, labels, mute/archive/pin, group administration, profile and status, blocklist and privacy settings, search, and phone pairing.
- Hard constraints: unofficial client, not affiliated with or endorsed by WhatsApp or Meta; direct multi-device protocol via whatsmeow; local-only data; no telemetry or analytics; Linux-first with cross-platform intent; AGPL-3.0 licensed.
- Open product decision (confirmed in interview): keep a lean, focused core as the day-to-day standard while working toward broad feature parity over time. Both are goals, in that priority order.
- Known gaps to preserve honestly: full chat-history sync is marked TODO in README.md; WHATSAPP_API_ANALYSIS.md lists roughly 85+ whatsmeow APIs not yet used.
- Not yet established: a product-specific accessibility standard or required conformance level.

## Brand Commitments

Name: amazingwhats (Wails product name `amazingwhats`). Unofficial-client disclaimer is a standing identity constraint. License: GNU AGPL v3.0. Voice from README.md: "Build native where it matters. Keep the UI lightweight. Respect Linux and its users." Project author/publisher recorded as celestix / lugvitc.

## Evidence on Hand

- README.md: product description, architecture diagram, feature list, and committed screenshots of the chat, settings, and login screens.
- Working implementation: Go backend (`api/`, `internal/`), React frontend (`frontend/src/`), Wails config (`wails.json`), dependency manifests (`go.mod`, `frontend/package.json`), and a frontend test script (`vitest run`).
- WHATSAPP_API_ANALYSIS.md: API-coverage reference (~135 implemented, ~80 indirectly available, ~85+ not implemented).
- Absences future work must not fabricate: no customer list, testimonials, usage metrics, performance benchmarks, pricing, or deployment claims exist in the repository. No DESIGN.md or committed visual-regression goldens exist yet.

## Product Principles

1. Direct protocol, not a web wrapper: the client talks to WhatsApp's multi-device API itself through whatsmeow.
2. Performance is a product feature: native work stays in Go, the UI stays lightweight, and memory use stays low.
3. Privacy by default: data remains local and nothing is tracked or sent home.
4. Lean core first, broad parity over time: protect the speed and reliability of everyday flows while closing feature gaps deliberately.
5. Respect the desktop environment: Linux-first roots, cross-platform reach, and tolerance for long-running sessions.
