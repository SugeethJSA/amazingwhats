# HyperMeow integration gap (2026-11-24)

Scoped against HyperMeow `v0.0.0-20261121205317-6e3f26d9b53f` and app HEAD
(after MIG-001, LOGIN-001, CALL-001..003). Source: module cache README/CHANGELOG
and exported symbols; app imports and call sites.

## Already covered (no work needed)

Core upstream-compatible APIs are exercised throughout the app: messaging
(`SendMessage`, `Build*`, `Upload`, `Download`, `MarkRead`), group CRUD,
channels/newsletters, privacy/blocklist/status, polls, calls via meowcaller,
and `AddEventHandler` routing. Automatic HyperMeow benefits already active:
bounded caches, shared HTTP transport, malformed-node hardening, QR rotation
on secret rotation, schema v19/v20 (auto-repaired by LOGIN-001 for upstream DBs).

## Prioritized gaps

| # | Capability | API | Relevance | Effort | Notes |
|---|---|---|---|---|---|
| 1 | Dual-endpoint socket race | `SocketConfig.RaceURLs`, `socket.RaceURLs` | High | S | Opt-in; set before `Connect` in `internal/wa/client.go`. |
| 2 | Connection lifecycle observers | `AddConnectionEventHandler` | High | M | Use as authority signal for reconnect loop; keep generic handler. Delayed events carry cancelled context; do not authorize sends. |
| 3 | `AppStateSyncError` retry | `events.AppStateSyncError` | Med-high | M | Dispatched after sync lock release; feed into existing resync flow. |
| 4 | History-sync policy controls | `ManualHistorySyncDownload`, `Disable*HistorySync*` | Medium | S–M | Verify against app's own history store before flipping flags. |
| 5 | LID correctness (D-AUD-008f) | `GetAltJID`, `GetPNForLID`, `ResolveLID` | Medium | M | Fix group participant canonicalization discarding primary LID. |

Runner-up: `SetGroupDescription` -> `SetGroupTopic` deprecation cleanup.

## Explicitly irrelevant (do not integrate)

- Business app / catalog / Native Flows / phone consent (personal account).
- PostgreSQL batching + validation harness (app is SQLite-only, single user).
- Remote Signal / hosted coexistence / `is_hosted` (opposite of local-store design).
- Guarded send admission (server-side authority; app owns its sends).
- `DisablePostConnectPassiveIQ` (app does not customize login payload).
- Push registration (desktop uses beeep/go-toast/notify).
- Rich bot responses (no renderer).

## Risk note

`RawNodeHandler` is a supported alternative to meowcaller's `reflect`+`unsafe`
hook into whatsmeow's private `nodeHandlers`, but adopting it requires a
meowcaller change (vendor/upstream), not an app-only integration. HyperMeow
deliberately keeps the private map so the existing hack keeps working.
