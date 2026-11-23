# Junior-docs swarm register

Repo: amazingwhats (Go + React desktop WhatsApp client, Wails v3). Mode: plain-Markdown fallback (no Mintlify pipeline/token in this repo). Model: `opencode/hy4-flash-free`. Verifier: skill `scripts/verify-docs.ps1`, mother only.

| D-ID | Scope | Owned files | Expectation | Status |
|---|---|---|---|---|
| DOC-001 | Landing + vocabulary + quickstart | `docs/index.md`, `docs/00-start-here/vocabulary.md`, `quickstart.md` | every term defined before use; real build/run commands from Taskfile/wails.json; relative links valid | PLANNED |
| DOC-002 | Architecture | `docs/01-architecture/system-map.md`, `data-flow.md`, `decisions.md` | Mermaid diagrams match real boot/service/event/DB graph; no invented components | PLANNED |
| DOC-003 | Go backend walkthrough | `docs/02-components/backend-bootstrap.md`, `message-pipeline.md`, `database.md` | line-by-line faithful excerpts from cmd/, api/, internal/; exact failure paths | PLANNED |
| DOC-004 | Frontend walkthrough | `docs/02-components/frontend-app.md`, `state-and-events.md`, `chat-ui.md` | state ownership, event shim, virtualized list, media/call UI from real sources | PLANNED |
| DOC-005 | Integration contracts | `docs/03-api-integration/wails-bindings.md`, `events.md`, `payload-shapes.md` | exact exported method names/args and event payload keys from bindings + Go emits | PLANNED |
| DOC-006 | Operations + reference | `docs/04-operations/build-and-run.md`, `configuration.md`, `security-privacy.md`, `docs/05-reference/known-issues.md`, `docs/llms.txt` | real commands/env/paths; honest known issues from audit register; no fabricated values | PLANNED |

Gate order: VERIFY (verify-docs.ps1) -> CRITIC (council-chairman) -> COMMIT mother D-by-D. Never batch-authorize.
