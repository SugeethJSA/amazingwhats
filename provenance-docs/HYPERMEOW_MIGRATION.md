# HyperMeow + meowcaller main migration (MIG-001)

## Decision (2026-11-23)

User approved: migrate from upstream `go.mau.fi/whatsmeow` to
`github.com/polymorfa/hypermeow`, and upgrade `github.com/purpshell/meowcaller`
from `v0.0.0-20260811012811-27a3c6b18657` (11 Aug 2026) to
`v0.0.0-20260906234207-c48c3e2a243c` (main, 6 Sep 2026).

## Research basis

- HyperMeow main `6e3f26d` (21 Nov 2026) is **newer** than upstream whatsmeow
  `19d6135` (16 Nov 2026) and regularly merges upstream fixes. It is not stale.
- Both libraries expose identical call primitives (`call.go`, `types/call.go`,
  `types/events/call.go`). Video, screen share, group calls, waiting rooms and
  call links live in **meowcaller**, not whatsmeow.
- HyperMeow adds a public `RawNodeHandler` hook — a supported alternative to
  meowcaller's `reflect`+`unsafe` hook into whatsmeow's private `nodeHandlers`.
- Empirical preflight in a throwaway git worktree:
  - current stack: `go test github.com/purpshell/meowcaller` PASS
  - meowcaller main + HyperMeow latest: `go test github.com/purpshell/meowcaller` PASS
  - full app import rewrite + both upgrades: `go build ./api/... ./internal/...` and
    `go test ./api/... ./internal/...` PASS after removing one proto case
    (`GetPaymentDetailsMessage`) absent from HyperMeow's generated waE2E.
  - A `replace go.mau.fi/whatsmeow => ...` shortcut does **not** work; import paths
    must be rewritten because HyperMeow subpackages use their own module path.

## Changes

- All Go imports `go.mau.fi/whatsmeow*` -> `github.com/polymorfa/hypermeow*`.
- `internal/store/special.go`: drop the `GetPaymentDetailsMessage` rendering case
  (HyperMeow proto does not generate that field).
- `go.mod`: require HyperMeow `v0.0.0-20261121205317-6e3f26d9b53f` and meowcaller
  `v0.0.0-20260906234207-c48c3e2a243c`; drop the old whatsmeow requirement;
  `go mod tidy` to regenerate `go.sum`.

## Constraints

- `api/api.go` had substantial uncommitted reconnect-loop work from another
  session; only its import string was changed, all other bytes preserved.
- No push. Local commit only.
- Gate: `tools/verify_central.ps1 -Clean -Wails3`, then council-chairman audit,
  then mother commits.

## Caveats

- HyperMeow's proto lacks `PaymentDetailsMessage`; that message type will fall
  through to the generic renderer instead of the dedicated "Payment details" line.
- HyperMeow is a smaller, single-maintainer project (78 stars vs 7923 upstream).
- Runtime WhatsApp behaviour (signaling, group calls, video) still requires a
  live smoke test; only compile/test evidence exists here.
