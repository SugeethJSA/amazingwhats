---
title: "Junior-docs: start here"
description: "A reading order for learning this desktop app from source, from vocabulary and setup through architecture, components, integration, operations, and reference."
---

# Junior-docs: start here

> **In one line:** This is the map: read the two starter pages first, then follow the sections in order, and check every explanation against the source file it points to.

## Why this page exists

The repository is a desktop app with two halves that are easy to confuse: a compiled program that talks to WhatsApp and a web-style page that the user sees. The code is large, and much of it is protocol and sync machinery. Without a reading order, a newcomer either stares at the entry point and cannot find the UI, or jumps into a long event handler and cannot find where events come from.

This page gives you that order. It also tells you which pages are ready now and which are planned, so a missing link is a schedule fact, not a broken promise.

## The idea, in plain words

Treat these docs like a museum floor plan. The entrance has two rooms: one teaches you the words on the signs, the other teaches you how to open the building. Past the entrance are themed wings — how the app is put together, what each part does, how the halves agree on messages, how it is built and kept safe, and finally a list of known rough edges. You can wander, but the arrows run in one direction: names first, then setup, then the big picture, then the details.

```mermaid
flowchart TD
    A[Vocabulary] --> B[Quickstart]
    B --> C[Architecture]
    C --> D[Components]
    D --> E[Integration contracts]
    E --> F[Operations]
    F --> G[Reference]
```

## The code, line by line

The two-halves idea is visible in four lines. The frontend directory is declared in the project config, its built output is baked into the binary, the Go service is registered with the framework, and the frontend imports generated functions to call it.

```json
// wails.json:2-5
{
  "name": "whats4linux",
  "frontend": {
    "dir": "frontend",
```

```go
// main.go:12-13
//go:embed all:frontend/dist
var assets embed.FS
```

```go
// cmd/run.go:92-93
api := apiPkg.New(app, window)
app.RegisterService(application.NewService(api))
```

```ts
// frontend/src/App.tsx:2
import { Login, GetCustomCSS, GetCustomJS, SetWindowFocused } from "../bindings/github.com/lugvitc/whats4linux/api/api.js"
```

| Line | What it does |
|---|---|
| `wails.json:4` | Names `frontend/` as the web half of the app. |
| `main.go:12` | Embeds the built frontend output into the executable. |
| `main.go:13` | Holds those assets as a file system passed into the command layer. |
| `cmd/run.go:92` | Builds the Go service that owns the app's long-lived work. |
| `cmd/run.go:93` | Registers it so its methods become callable from the page. |
| `App.tsx:2` | Imports those generated call functions from `frontend/bindings/`. |

## Reading order

| Step | Page | Status | What you get |
|---|---|---|---|
| 1 | [Vocabulary](00-start-here/vocabulary.md) | Ready | Every term defined before use, with a file:line pointer. |
| 2 | [Quickstart](00-start-here/quickstart.md) | Ready | Exact tool versions and commands from this repo. |
| 3 | Architecture | Planned (DOC-002) | System map, Data flow, Decisions. |
| 4 | Components | Planned (DOC-003, DOC-004) | Backend bootstrap, Message pipeline, Database, Frontend app, State and events, Chat UI. |
| 5 | Integration | Planned (DOC-005) | Wails bindings, Events, Payload shapes. |
| 6 | Operations | Planned (DOC-006) | Build and run, Configuration, Security and privacy. |
| 7 | Reference | Planned (DOC-006) | Known issues, llms.txt. |

> **Planned does not mean missing forever.** The section names above are registered for future documentation work (`docs/DRIFT_REGISTER.md`). They are listed as plain text on purpose — no link is shown until the target file actually exists. Those files are authored in later passes.

### Architecture — planned

- System map (planned, DOC-002, `01-architecture/system-map.md`) — the real boot, service, event, and database graph.
- Data flow (planned, DOC-002, `01-architecture/data-flow.md`) — how a WhatsApp event becomes something on screen.
- Decisions (planned, DOC-002, `01-architecture/decisions.md`) — why the code is shaped this way.

### Components — planned

- Backend bootstrap (planned, DOC-003, `02-components/backend-bootstrap.md`) — `cmd/` and service startup.
- Message pipeline (planned, DOC-003, `02-components/message-pipeline.md`) — live and history messages.
- Database (planned, DOC-003, `02-components/database.md`) — the Go store.
- Frontend app (planned, DOC-004, `02-components/frontend-app.md`) — `App.tsx` and screens.
- State and events (planned, DOC-004, `02-components/state-and-events.md`) — the frontend stores and event shim.
- Chat UI (planned, DOC-004, `02-components/chat-ui.md`) — the virtualized list and media/call overlays.

### Integration contracts — planned

- Wails bindings (planned, DOC-005, `03-api-integration/wails-bindings.md`) — exported method names and arguments.
- Events (planned, DOC-005, `03-api-integration/events.md`) — every emitted name and its payload.
- Payload shapes (planned, DOC-005, `03-api-integration/payload-shapes.md`) — the exact keys crossing the bridge.

### Operations — planned

- Build and run (planned, DOC-006, `04-operations/build-and-run.md`) — recipes and flags in full.
- Configuration (planned, DOC-006, `04-operations/configuration.md`) — env vars, paths, settings.
- Security and privacy (planned, DOC-006, `04-operations/security-privacy.md`) — credential storage and disclosure rules.

### Reference — planned

- Known issues (planned, DOC-006, `05-reference/known-issues.md`) — honest limitations from the audit register.
- llms.txt (planned, DOC-006, `llms.txt`) — a compact index of the finished docs.

## What can go wrong

> **Do not trust a README promise over a source line.** Project reports describe intent and outcomes; the code describes what actually happens. Every page here is built from checked-in source, and the vocabulary page is the habit-forming step (`00-start-here/vocabulary.md`).

> **Do not start in the middle.** The main event handler is a very long function (`api/api.go:641`). Reading it before the Vocabulary and System map pages makes the event names look arbitrary rather than intentional.

> **Stale v2 assumptions are the most common trap.** This is a v3 codebase: bindings come from `frontend/bindings/` (`frontend/src/App.tsx:2`) and events go through the v3 runtime shim (`frontend/src/lib/wailsRuntime.ts:7`). The integration report records checks that these old patterns are absent (`provenance-docs/INTEGRATION_REPORT.md:8`).

> **A planned section has no link yet.** Planned sections are listed as plain text with their intended path and D-ID. When their pages are authored in later passes, the entries become links; until then, check `docs/DRIFT_REGISTER.md` for the D-ID.

## Where to next

- [Vocabulary](00-start-here/vocabulary.md) — first.
- [Quickstart](00-start-here/quickstart.md) — second.
- Then the first planned wing: System map (planned, DOC-002, `01-architecture/system-map.md`).
