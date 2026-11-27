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

## Rules

- One worker per D-ID (tight cluster allowed for D-SELECTLIST-001).
- Workers never build, never commit, never touch another worker's files.
- Mother runs the single canonical verifier after each worker report, then the Critic.
- No stubs, no fake data, no dead controls. Unsupported behavior must be honestly labelled.
