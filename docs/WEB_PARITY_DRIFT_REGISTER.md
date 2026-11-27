# Web Parity Drift Register — amazingwhats

Source of truth for the current WhatsApp-Windows parity swarm. A row is only `FIXED` after the mother's verifier gate is GREEN and the Critic audit is PASS.

| D-ID | Expectation | Owner files | Status |
|---|---|---|---|
| D-TAGS-001 | Group chat history shows each participant's member tag/role (e.g. admin) where WhatsApp does. | `frontend/src/components/chat/MessageItem.tsx`, `frontend/src/screens/ChatDetail.tsx` (read-only allowed: `api/group.go`) | FIXED |
| D-TIMER-001 | Privacy settings can read and display the current account-level default disappearing timer; no false "Off" claim. | `api/privacy.go`, `api/groups_ext.go`, `frontend/src/screens/settingscreens/PrivacySettingsScreen.tsx` | UPSTREAM-BLOCKED (no HyperMeow getter; honest UI) |
| D-CALLNOTIF-001 | Windows receives call notifications with working Accept/Decline actions; calling settings show real state, not "Unavailable". | `api/calls.go`, `internal/notify/*` | FIXED |
| D-STATUSREACT-001 | Notifications are raised for reactions/likes on the user's own status; Status settings reflect real support. | `api/status.go`, `api/api.go`, `frontend/src/components/chat/Status.tsx`, `frontend/src/screens/settingscreens/NotificationsSettingsScreen.tsx` | FIXED |
| D-COVER-001 | The business cover photo set on the account loads and displays in the self-profile drawer. | `api/business.go`, `frontend/src/components/SelfProfileDrawer.tsx` | FIXED |
| D-QUICKREPLY-001 | Quick replies can be created, listed and inserted into the composer from the three-dots menu/composer. | new `api/quick_replies.go`, `frontend/src/components/chat/ChatInput.tsx` | FIXED |
| D-STARRED-001 | A starred-messages view lists starred messages across chats and opens the originating chat. | new frontend component, `frontend/src/components/NavRail.tsx` | FIXED |
| D-SELECTLIST-001 | Chat-list three-dots "Select chats" enters a real multi-select mode; "Lists" opens a real lists view. | `frontend/src/screens/ChatScreen.tsx`, `frontend/src/components/chat/ChatListMenu.tsx`, new list component | FIXED |
| D-BACKFILLUI-001 | "Asking your phone for older messages..." ends visibly and shows progress while running. | `frontend/src/screens/ChatDetail.tsx` | FIXED |
| D-HEADERAV-001 | Chat-list header must not duplicate the self profile photo next to the three-dots icon; the rail already shows it. | `frontend/src/screens/ChatScreen.tsx` | FIXED |
| D-UPDATER-001 | Installed Windows app's self-updater must actually install a published release end-to-end. | `cmd/run.go`, `.github/workflows/rolling-release.yaml`, `.github/workflows/release.yaml`, new `api/updater_diagnostics.go` | FIXED |
| D-GROUPINFO-001 | Group info drawer matches the WhatsApp reference structure: header, avatar, subject, member count, participants with admin/tag markers, description, media, settings and related actions. | `frontend/src/components/chat/ChatInfo.tsx` | FIXED |
| D-PINNED-001 | A pinned-message subheader appears below the chat header on the chat body pane, showing the pinned message and jumping to it when clicked. | `frontend/src/screens/ChatDetail.tsx`, `frontend/src/components/chat/MessageList.tsx`, new component if needed | FIXED |
| D-VOICE-001 | Voice messages render like WhatsApp: play/pause, waveform progress slider with duration, playback speed toggle, sender avatar, quoted-message preview and timestamp. | `frontend/src/components/chat/MediaContent.tsx`, new component under `frontend/src/components/chat/` | FIXED |

## HyperMeow source verification (pinned `v0.0.0-20261121205317-6e3f26d9b53f`)

Checked directly against the module source (`%USERPROFILE%\go\pkg\mod\github.com\polymorfa\hypermeow@...`, 239 Go files), not worker reports:

- **D-TIMER-001, UPSTREAM-BLOCKED confirmed.** `privacysettings.go:118` has only `SetDefaultDisappearingTimer`; `types.PrivacySettings` (`types/user.go:250-261`) has no timer field; no appstate action or handled `disappearing_mode` notification exists; `IsOnWhatsApp` (`user.go:186`) requests `disappearing_mode` but `types.IsOnWhatsAppResponse` (`types/user.go:178-189`) discards it. There is no exported generic IQ sender (`sendIQ` takes the unexported `infoQuery` type), so a clean read is impossible. A real write-only binding (`SetDisappearingTimerDefault`, generated `api.ts:1014`) does exist but is intentionally not shown as a value picker.
- **D-STARRED-001.** `events.Star` (`types/events/appstate.go:62-71`) fields match usage; `waSyncAction.StarAction.GetStarred()` exists (`proto/waSyncAction/WAWebProtobufSyncAction.pb.go:8646`); star patches live in `WAPatchRegularHigh` (`appstate/keys.go:31`). `GetAppStateVersion`/`FetchAppState` signatures match. The version-gated bootstrap is correct because `api/api.go:223-231` already full-syncs `regular_high` on connect.
- **D-QUICKREPLY-001.** `appstate.BuildQuickReply(id, shortcut, message, keywords, count, associatedLabelIDs...)` and `BuildQuickReplyDelete(id)` exist (`appstate/encode.go:249,259`) and both write `WAPatchRegular`, matching the app's bootstrap collection. `SendAppState` is exported (`appstate.go:640`).
- **D-COVER-001.** `GetProfilePictureInfo(ctx, jid, *GetProfilePictureParams)` sends `ExistingID` as the `id` attribute (`user.go:742-760`); `types.ProfilePictureInfo` exposes `ID`/`URL`/`Type`. The exact-ID match guard is sound.
- **D-STATUSREACT-001.** No dedicated status-reaction event exists; `events.Message.Message` is `*waE2E.Message` (`types/events/events.go:362-364`) and reactions arrive via `GetReactionMessage()`, as the app assumes.
- **D-CALLNOTIF-001.** HyperMeow has no `AcceptCall` (only `RejectCall`, `call.go:106`), but the app answers via its `meowcaller` call object (`api/calls.go:456 Call.Answer()`, `:921 Call.Reject()`), so notification actions are genuinely wired; `WireRejectCall` correctly uses HyperMeow's `RejectCall` for the wire path.
- **D-VOICE-001.** `waE2E.AudioMessage.Waveform` is a real `[]byte` field (`proto/waE2E/WAWebProtobufsE2E.pb.go:16763`); the player accepts the base64 string shape Wails produces and a numeric array.

## Rules

- One worker per D-ID (tight cluster allowed for D-SELECTLIST-001).
- Workers never build, never commit, never touch another worker's files.
- Mother runs the single canonical verifier after each worker report, then the Critic.
- No stubs, no fake data, no dead controls. Unsupported behavior must be honestly labelled.
