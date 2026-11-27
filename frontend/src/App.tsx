import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import {
  Login,
  GetCustomCSS,
  GetCustomJS,
  SetWindowFocused,
  RequestHistorySync,
} from "../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { EventsOn, BrowserOpenURL } from "./lib/wailsRuntime"
import QRCode from "qrcode"
import { LoginScreen } from "./screens/LoginScreen"
import { initSelf, resetSelf } from "./lib/self"
import { Lightbox } from "./components/Lightbox"
import { NavRail } from "./components/NavRail"
import {
  HealthPanel,
  HEALTH_TOGGLE_ID,
  TONE_CLASS,
  TONE_GLYPH,
  TONE_LABEL,
} from "./components/HealthPanel"
import { MediaHub } from "./components/chat/MediaHub"
import { CallOverlay } from "./components/chat/CallOverlay"
import { DownloadProgress } from "./components/chat/DownloadProgress"

import { useUIStore, useMessageStore } from "./store"
import { useDownloadProgressStore } from "./store/useDownloadProgressStore"
import type { Notification } from "./store/useUIStore"
import { useAppSettingsStore } from "./store/useAppSettingsStore"
import { applyThemeClass } from "./lib/theme"
import { useWailsEvents } from "./hooks/useWailsEvents"
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts"
import { registerShortcut } from "./lib/shortcuts"

// Both screens pull in the GSAP/CustomEase chunk (Settings via its ease
// editors, chats via ChatDetail's scroll button). Neither is needed on the
// login screen, so keep that chunk out of the startup bundle.
const ChatListScreen = lazy(() =>
  import("./screens/ChatScreen").then(module => ({ default: module.ChatListScreen })),
)
const SettingsScreen = lazy(() =>
  import("./screens/SettingsScreen").then(module => ({ default: module.SettingsScreen })),
)

/** Backend errors can carry paths, URLs or JIDs. Never render them verbatim. */
function sanitizeErrorMessage(value: unknown): string {
  if (typeof value !== "string") return "Something went wrong. Please try again."
  const text = value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[link]")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'<>]+/g, "[path]")
    .replace(/\b\d{5,}@[^\s"'<>]+/g, "[contact]")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return "Something went wrong. Please try again."
  return text.length > 200 ? `${text.slice(0, 197)}…` : text
}

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: Notification
  onDismiss: (id: number) => void
}) {
  useEffect(() => {
    if (notification.durationMs === undefined) return
    const timer = window.setTimeout(
      () => onDismiss(notification.id),
      Math.max(0, notification.durationMs),
    )
    return () => window.clearTimeout(timer)
  }, [notification.id, notification.durationMs, onDismiss])

  const isError = notification.tone === "error"
  const isSuccess = notification.tone === "success"
  const isWarning = notification.tone === "warning"
  const cls = isSuccess
    ? "toast-success"
    : isError
      ? "toast-error"
      : isWarning
        ? "toast-warning"
        : "toast-info"
  const icon = isSuccess ? "✓" : isError ? "✕" : isWarning ? "⚠" : "ℹ"

  return (
    <div
      className={`toast-base ${cls}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      <span aria-hidden="true" style={{ fontSize: 14 }}>
        {icon}
      </span>
      <span className="toast-message">{notification.message}</span>
      {notification.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            notification.action?.onClick()
            onDismiss(notification.id)
          }}
        >
          {notification.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(notification.id)}
        title="Dismiss"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  )
}


/**
 * Background history sync is driven by the backend, which emits
 * `wa:history_progress` batches including an explicit failure flag. Retry
 * calls a real backend binding that asks the primary device for more history.
 */
type HistorySyncView =
  { phase: "idle" } | { phase: "syncing"; percent: number } | { phase: "failed" }

/**
 * Global view of in-flight downloads for triggers that live outside a message
 * bubble (MessageMenu, Lightbox, MediaHub). It subscribes on its own so byte
 * events re-render only this small panel, never the whole App tree. Top-right
 * keeps it clear of the bottom-left toast stack, the connection pill and the
 * top-centre history-sync strip.
 */
function GlobalDownloadsPanel() {
  const entries = useDownloadProgressStore(state => state.entries)
  const active = Object.entries(entries).filter(([, entry]) => entry.phase === "downloading")
  if (active.length === 0) return null

  return (
    <section
      aria-label="Downloads"
      className="fixed right-4 top-16 z-[45] max-h-[40vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-black/5 bg-[var(--color-light-bg)] p-3 text-[var(--color-light-text)] shadow-lg dark:border-white/10 dark:bg-[var(--color-dark-secondary)] dark:text-[var(--color-dark-text)]"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-75">
        Downloads
      </h2>
      <div className="flex flex-col gap-2">
        {active.map(([messageId, entry]) => (
          <div key={messageId}>
            {/* The events carry no filename, so use a neutral label only. */}
            <div className="mb-1 truncate text-[11px] font-medium">Downloading file…</div>
            <DownloadProgress
              downloaded={entry.downloaded}
              total={entry.total}
              percent={entry.percent}
              compact
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function App() {
  const screen = useUIStore(state => state.screen)
  const setScreen = useUIStore(state => state.setScreen)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const loginStartedRef = useRef(false)
  const [status, setStatus] = useState<string>("waiting")
  const [historySync, setHistorySync] = useState<HistorySyncView>({ phase: "idle" })

  const theme = useAppSettingsStore(state => state.theme)
  const loaded = useAppSettingsStore(state => state.loaded)
  const notifications = useUIStore(state => state.notifications)
  const addNotification = useUIStore(state => state.addNotification)
  const removeNotification = useUIStore(state => state.removeNotification)
  const clearStatusNotifications = useUIStore(state => state.clearStatusNotifications)
  const healthPanelOpen = useUIStore(state => state.healthPanelOpen)
  const setHealthPanelOpen = useUIStore(state => state.setHealthPanelOpen)
  const selectedAlertId = useUIStore(state => state.selectedAlertId)
  const setSelectedAlertId = useUIStore(state => state.setSelectedAlertId)

  // Only explicitly tagged connection-status alerts live in the health pane.
  // Every other producer keeps the original transient toast behavior.
  const transientNotifications = notifications.filter(n => n.kind === "transient")
  const selectedAlert =
    notifications.find(n => n.id === selectedAlertId && n.kind === "status") ?? null

  useEffect(() => {
    useAppSettingsStore.getState().loadSettings()
  }, [])

  useEffect(() => {
    if (loaded) {
      applyThemeClass(theme)
    }
  }, [theme, loaded])

  // Open links inside message text in the system browser instead of navigating
  // the app's webview. Links are rendered as <a class="msg-link"> by the backend.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const anchor = target?.closest?.("a.msg-link") as HTMLAnchorElement | null
      if (anchor) {
        e.preventDefault()
        const href = anchor.getAttribute("href")
        if (href) BrowserOpenURL(href).catch(err => console.error("Open URL failed:", err))
      }
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  // Keep the backend informed of window focus so it only notifies when the
  // window is in the background.
  useEffect(() => {
    const onFocus = () =>
      SetWindowFocused(true).catch(err => console.error("SetWindowFocused failed:", err))
    const onBlur = () =>
      SetWindowFocused(false).catch(err => console.error("SetWindowFocused failed:", err))
    window.addEventListener("focus", onFocus)
    window.addEventListener("blur", onBlur)
    SetWindowFocused(document.hasFocus()).catch(err =>
      console.error("SetWindowFocused failed:", err),
    )
    return () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
    }
  }, [])

  useEffect(() => {
    GetCustomCSS()
      .then(css => {
        if (css) {
          const style = document.createElement("style")
          style.id = "custom-css"
          style.innerHTML = css
          document.head.appendChild(style)
        }
      })
      .catch(err => console.error("Failed to load custom CSS:", err))

    GetCustomJS()
      .then(js => {
        if (js) {
          const script = document.createElement("script")
          script.id = "custom-js"
          script.innerHTML = js
          document.body.appendChild(script)
        }
      })
      .catch(err => console.error("Failed to load custom JS:", err))
  }, [])

  useWailsEvents()

  // Dispatch key combinations to whichever component registered the matching
  // shortcut (chat list / chat detail). Registered below: app-level ones.
  useGlobalShortcuts()

  useEffect(() => {
    const openSettings = () => {
      if (useUIStore.getState().screen !== "login") useUIStore.getState().setScreen("settings")
    }
    const openProfile = () => {
      if (useUIStore.getState().screen === "login") return
      useUIStore.getState().setSettingsCategoryIntent("account")
      useUIStore.getState().setScreen("settings")
      window.dispatchEvent(new CustomEvent("wa:open-settings-category", { detail: "account" }))
    }
    const unregSettings = registerShortcut("open-settings", openSettings)
    const unregProfile = registerShortcut("profile-about", openProfile)
    return () => {
      unregSettings()
      unregProfile()
    }
  }, [])

  useEffect(() => {
    const unsubQR = EventsOn("wa:qr", async (qr: string) => {
      if (!canvasRef.current) return
      await QRCode.toCanvas(canvasRef.current, qr, {
        width: 300,
        color: { dark: "#000000", light: "#ffffff" },
      })
    })

    const unsubStatus = EventsOn("wa:status", (status: string) => {
      setStatus(status)
      // The rail's health icon and the panel's history read this; keep in sync.
      useUIStore.getState().setConnectionStatus(status)
      if (status === "logged_in" || status === "success") {
        useUIStore.getState().setScreen("chats")
        void initSelf()
        delete (window as any).__reconnectNotifId
        // Recovery resolves every pending connection-status alert at once.
        clearStatusNotifications()
      } else if (status === "reconnecting") {
        const nid = addNotification("Reconnecting to WhatsApp...", {
          tone: "warning",
          kind: "status",
        })
        // The "logged_in" or "disconnected" events will remove this.
        ;(window as any).__reconnectNotifId = nid
      } else if (status === "disconnected") {
        delete (window as any).__reconnectNotifId
        clearStatusNotifications()
        // Durable alert: it stays in the health pane until recovery or dismiss.
        addNotification("Disconnected from WhatsApp", { tone: "error", kind: "status" })
      } else if (status === "logged_out") {
        // The backend confirmed logout (or another device logged us out):
        // drop connection alerts and return to the login screen.
        delete (window as any).__reconnectNotifId
        clearStatusNotifications()
        setHealthPanelOpen(false)
        resetSelf()
        useUIStore.getState().setScreen("login")
      }
    })

    const unsubDownload = EventsOn("download:complete", (filePath: string) => {
      // The backend emits an absolute filesystem path. Show only the basename
      // so the user's directory layout (and username) never leaks into a toast.
      const name = (typeof filePath === "string" ? filePath : "").split(/[\\/]/).pop()?.trim()
      addNotification(`Downloaded: ${name || "file"}`, { tone: "success", durationMs: 3000 })
    })

    // Real byte-level progress. These events carry no filename and no error
    // text; the store copies only the numbers the backend actually measured.
    // A fresh `start` is issued when a message re-enters the downloading phase
    // (e.g. a second download of the same message), never on every chunk.
    const unsubDownloadProgress = EventsOn(
      "download:progress",
      (data: {
        messageId?: string
        downloaded?: number
        total?: number
        percent?: number
      }) => {
        const messageId = typeof data?.messageId === "string" ? data.messageId : ""
        if (!messageId) return
        // `download:start` is authoritative. A progress chunk for an unknown
        // or already-finished download is ignored rather than starting a
        // phantom bar that could never be cleared.
        const store = useDownloadProgressStore.getState()
        if (store.entries[messageId]?.phase !== "downloading") return
        store.update(messageId, data)
      },
    )
    const unsubDownloadStart = EventsOn(
      "download:start",
      (data: { messageId?: string }) => {
        const messageId = typeof data?.messageId === "string" ? data.messageId : ""
        if (messageId) useDownloadProgressStore.getState().start(messageId)
      },
    )
    const unsubDownloadDone = EventsOn(
      "download:done",
      (data: { messageId?: string; cancelled?: boolean }) => {
        const messageId = typeof data?.messageId === "string" ? data.messageId : ""
        if (!messageId) return
        useDownloadProgressStore.getState().finish(messageId, data.cancelled === true)
      },
    )
    const unsubDownloadError = EventsOn("download:error", (data: { messageId?: string }) => {
      const messageId = typeof data?.messageId === "string" ? data.messageId : ""
      if (!messageId) return
      useDownloadProgressStore.getState().fail(messageId)
    })

    // Surface backend errors to the user as toast notifications.
    const unsubError = EventsOn("wa:error", (msg: string) => {
      addNotification(sanitizeErrorMessage(msg), { tone: "error", durationMs: 6000 })
    })

    // Security-code changes are recorded as an info line in the contact's chat
    // by the backend. They deliberately do not raise a toast or side alert.

    // A reply sent from a Windows notification is confirmed quietly when the
    // app happens to be open; no window is opened for the send itself.
    const unsubReplySent = EventsOn("wa:notification_reply_sent", () => {
      addNotification("Reply sent", { tone: "success", durationMs: 2500 })
    })

    // Background/startup update discovery. The EventsOn shim passes
    // `event.data` straight to the callback, so the payload object arrives here
    // directly. The callback stays synchronous (addNotification is sync), so no
    // floating promise can reject inside the event handler.
    const unsubUpdateAvailable = EventsOn("wa:update_available", (data: { version?: string }) => {
      const version = typeof data?.version === "string" ? data.version.trim() : ""
      addNotification(
        version
          ? `Update v${version} is available — open Settings → Advanced to install.`
          : "An update is available — open Settings → Advanced to install.",
        { tone: "info", durationMs: 10000 },
      )
    })

    // Update failures arrive as a short, user-safe static string from the
    // backend; display it as-is, with a fallback for a malformed payload.
    const unsubUpdateError = EventsOn("wa:update_error", (msg: string) => {
      addNotification(
        typeof msg === "string" && msg.trim() ? msg : "Could not check for updates.",
        { tone: "error", durationMs: 6000 },
      )
    })

    // Register all status listeners before starting login. Existing sessions
    // can complete quickly enough to otherwise lose the "logged_in" event.
    if (!loginStartedRef.current) {
      loginStartedRef.current = true
      // Never render a raw backend error: it can contain proxy URLs with credentials
      // or filesystem paths. Details stay in the backend logs only.
      void Login().catch(() => setStatus("error: Unable to sign in. Please try again."))
    }

    const unsubHistory = EventsOn(
      "wa:history_progress",
      (data: {
        type?: string
        totalConversations?: number
        processedConversations?: number
        totalMessages?: number
        processedMessages?: number
        done?: boolean
        failed?: boolean
        error?: string
      }) => {
        if (!data) return
        // The backend emits an explicit failure flag. Never render its
        // diagnostic string — it can carry paths, URLs or JIDs.
        if (data.failed || typeof data.error === "string") {
          setHistorySync({ phase: "failed" })
          return
        }
        if (data.done) {
          setHistorySync({ phase: "idle" })
          return
        }
        // `type` is the whatsmeow sync type (INITIAL_BOOTSTRAP / FULL / RECENT
        // / ...), not a progress counter. The real counters are the explicit
        // conversation/message fields. Prefer message counts when a message
        // total is available (message-oriented syncs), otherwise use the
        // conversation counts that every history batch carries.
        const hasMessageTotal = typeof data.totalMessages === "number" && data.totalMessages > 0
        const total = hasMessageTotal ? data.totalMessages : data.totalConversations
        const processed = hasMessageTotal
          ? (data.processedMessages ?? 0)
          : (data.processedConversations ?? 0)
        if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return
        const raw = Math.round((Math.min(Math.max(processed, 0), total) / total) * 100)
        const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0
        setHistorySync({ phase: "syncing", percent })
      },
    )

    return () => {
      unsubQR()
      unsubStatus()
      unsubDownload()
      unsubDownloadProgress()
      unsubDownloadStart()
      unsubDownloadDone()
      unsubDownloadError()
      unsubError()
      unsubReplySent()
      unsubUpdateAvailable()
      unsubUpdateError()
      unsubHistory()
    }
  }, [addNotification, clearStatusNotifications, setHealthPanelOpen])

  // Periodically evict stale entries from transient UI caches and cap message stores
  useEffect(() => {
    const id = setInterval(() => {
      useUIStore.getState().evictStale()
      useMessageStore.getState().trimAllChats()
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const retryHistorySync = () => {
    setHistorySync({ phase: "syncing", percent: 0 })
    // An empty chat JID lets the backend pick the most recently active chat.
    // Progress (or an explicit failure event) arrives through wa:history_progress.
    void RequestHistorySync("", 50).catch(() => setHistorySync({ phase: "failed" }))
  }

  // Closing from either pane returns focus to the exact rail toggle that
  // opened it. setHealthPanelOpen(false) also clears selectedAlertId.
  const closeHealthPane = () => {
    setHealthPanelOpen(false)
    document.getElementById(HEALTH_TOGGLE_ID)?.focus()
  }
  const onHealthKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      closeHealthPane()
    }
  }

  return (
    <div className="min-h-screen bg-light-secondary text-light-text dark:bg-dark-bg dark:text-white relative">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Background history sync is a quiet status, not a banner. The label is
          the accessible state; the track is a labelled progressbar. Failure
          uses plain copy and a Retry action — never a raw backend string. */}
      {historySync.phase !== "idle" && (
        <div className="history-sync">
          {historySync.phase === "syncing" ? (
            <>
              <div className="history-sync-row" role="status" aria-live="polite">
                <span className="history-sync-label">Syncing history…</span>
                <span className="history-sync-percent" aria-hidden="true">
                  {historySync.percent}%
                </span>
              </div>
              <div
                className="history-sync-track"
                role="progressbar"
                aria-label="History sync progress"
                aria-valuenow={historySync.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="history-sync-fill" style={{ width: `${historySync.percent}%` }} />
              </div>
            </>
          ) : (
            <div className="history-sync-row" role="status" aria-live="polite">
              <span className="history-sync-label history-sync-label--error">
                History sync didn't finish.
              </span>
              <button type="button" className="history-sync-retry" onClick={retryHistorySync}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}
      <Lightbox />
      <MediaHub />
      <GlobalDownloadsPanel />
      {/* Transient toast stack only. Connection-status alerts are tagged
          `kind: "status"` and now live in the health subpane instead; security/
          identity warnings and all other ordinary confirmations/errors stay
          here. Bottom-left keeps them away from the chat header and composer.
          z-[45] is above persistent chrome but below modals (z-50+) and the
          call overlay (z-[9999]). This mounts outside the screen switch so the
          stack also works on Settings and login. slice(-3) is a defensive
          second cap on top of the store's own trim. */}
      <div
        className="fixed bottom-20 left-4 z-[45] flex flex-col gap-2"
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        {transientNotifications.slice(-3).map(notification => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            onDismiss={removeNotification}
          />
        ))}
      </div>

      <main
        id="main-content"
        tabIndex={-1}
        className={screen !== "login" ? "relative flex h-screen" : "relative"}
      >
        {screen !== "login" && <NavRail />}
        {healthPanelOpen && screen !== "login" && <HealthPanel />}
        <div className="min-w-0 flex-1">
          {screen === "login" && <LoginScreen canvasRef={canvasRef} status={status} />}

          {(screen === "chats" || screen === "settings") && (
            <Suspense
              fallback={
                <div className="p-8 text-[13px] text-light-muted" role="status" aria-live="polite">
                  Loading chats…
                </div>
              }
            >
              <div className={screen === "settings" ? "hidden" : "contents"}>
                <ChatListScreen onOpenSettings={() => setScreen("settings")} />
              </div>
            </Suspense>
          )}

          {screen === "settings" && (
            <Suspense
              fallback={
                <div className="p-8 text-[13px] text-light-muted" role="status" aria-live="polite">
                  Loading settings…
                </div>
              }
            >
              <SettingsScreen onBack={() => setScreen("chats")} />
            </Suspense>
          )}
        </div>
      </main>

      {/* Right-side detail surface for the health subpane. Non-modal, so the
          chat stays usable; z-[45] keeps it below modals (z-50+) and the call
          overlay (z-[9999]). No fabricated content: an empty/stale selection
          shows a neutral hint instead of sample data. */}
      {healthPanelOpen && screen !== "login" && (
        <aside
          role="complementary"
          aria-label="Alert details"
          onKeyDown={onHealthKeyDown}
          className="fixed inset-y-0 right-0 z-[45] flex w-[min(360px,90vw)] flex-col border-l border-light-border bg-light-bg shadow-xl dark:border-dark-border dark:bg-dark-secondary"
          style={{ fontFamily: "Inter, system-ui, sans-serif" }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-light-border px-4 py-3 dark:border-dark-border">
            <h2 className="text-sm font-semibold text-light-text dark:text-dark-text">
              Alert details
            </h2>
            <button
              type="button"
              className="rounded-full p-2 text-light-muted hover:bg-black/5 dark:text-dark-muted dark:hover:bg-white/10"
              aria-label="Close alert details"
              title="Close details"
              onClick={() => setSelectedAlertId(null)}
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 text-[13px] text-light-text dark:text-dark-text">
            {selectedAlert === null ? (
              <p className="text-light-muted dark:text-dark-muted">
                {selectedAlertId === null
                  ? "Select a status alert in the Health panel to see its details."
                  : "This alert is no longer available — it may have been dismissed."}
              </p>
            ) : (
              <>
                <p className="flex items-center gap-2 font-semibold">
                  <span className={TONE_CLASS[selectedAlert.tone]} aria-hidden="true">
                    {TONE_GLYPH[selectedAlert.tone]}
                  </span>
                  {TONE_LABEL[selectedAlert.tone]}
                </p>
                <p className="mt-3 leading-relaxed">{selectedAlert.message}</p>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="font-medium text-light-muted dark:text-dark-muted">Kind</dt>
                  <dd>{TONE_LABEL[selectedAlert.tone]}</dd>
                  <dt className="font-medium text-light-muted dark:text-dark-muted">Received</dt>
                  <dd>{new Date(selectedAlert.createdAt).toLocaleString()}</dd>
                </dl>
                <div className="mt-5 flex flex-col gap-2">
                  {selectedAlert.action && (
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--color-green)] px-3 py-2 text-[12px] font-semibold text-white"
                      onClick={() => {
                        selectedAlert.action?.onClick()
                        removeNotification(selectedAlert.id)
                      }}
                    >
                      {selectedAlert.action.label}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-light-border px-3 py-2 text-[12px] font-medium hover:bg-black/5 dark:border-dark-border dark:hover:bg-white/10"
                    onClick={() => removeNotification(selectedAlert.id)}
                  >
                    Dismiss alert
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-left text-[12px] text-light-muted hover:bg-black/5 dark:text-dark-muted dark:hover:bg-white/10"
                    onClick={() => setSelectedAlertId(null)}
                  >
                    ← Back to alerts
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      )}

      <CallOverlay />
    </div>
  )
}

export default App
