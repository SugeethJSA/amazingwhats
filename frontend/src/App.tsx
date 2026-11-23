import { lazy, Suspense, useEffect, useRef, useState } from "react"
import {
  Login,
  GetCustomCSS,
  GetCustomJS,
  SetWindowFocused,
  RequestHistorySync,
} from "../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { EventsOn, BrowserOpenURL } from "./lib/wailsRuntime"
import QRCode from "qrcode"
import { LoginScreen } from "./screens/LoginScreen"
import { initSelf, resetSelf } from "./lib/self"
import { Lightbox } from "./components/Lightbox"
import { CallOverlay } from "./components/chat/CallOverlay"

import { useUIStore, useMessageStore } from "./store"
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

type ConnectionTone = "online" | "connecting" | "offline"

interface ConnectionView {
  label: string
  tone: ConnectionTone
}

/** Maps raw backend status strings to a short, stable, human-readable cue. */
function connectionView(status: string): ConnectionView {
  if (status === "logged_in" || status === "success") {
    return { label: "Connected", tone: "online" }
  }
  if (status === "reconnecting") {
    return { label: "Reconnecting…", tone: "connecting" }
  }
  if (status === "disconnected" || status.startsWith("error")) {
    return { label: "Disconnected", tone: "offline" }
  }
  return { label: "Connecting…", tone: "connecting" }
}

/**
 * Background history sync is driven by the backend, which emits
 * `wa:history_progress` batches including an explicit failure flag. Retry
 * calls a real backend binding that asks the primary device for more history.
 */
type HistorySyncView =
  { phase: "idle" } | { phase: "syncing"; percent: number } | { phase: "failed" }

function App() {
  const screen = useUIStore(state => state.screen)
  const setScreen = useUIStore(state => state.setScreen)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const loginStartedRef = useRef(false)
  const [status, setStatus] = useState<string>("waiting")
  const [historySync, setHistorySync] = useState<HistorySyncView>({ phase: "idle" })
  const connection = connectionView(status)

  const theme = useAppSettingsStore(state => state.theme)
  const loaded = useAppSettingsStore(state => state.loaded)
  const notifications = useUIStore(state => state.notifications)
  const addNotification = useUIStore(state => state.addNotification)
  const removeNotification = useUIStore(state => state.removeNotification)

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
      if (status === "logged_in" || status === "success") {
        useUIStore.getState().setScreen("chats")
        void initSelf()
        const nid = (window as any).__reconnectNotifId
        if (nid !== undefined) {
          removeNotification(nid)
          delete (window as any).__reconnectNotifId
        }
      } else if (status === "reconnecting") {
        const nid = addNotification("Reconnecting to WhatsApp...", { tone: "warning" })
        // The "logged_in" or "disconnected" events will remove this.
        ;(window as any).__reconnectNotifId = nid
      } else if (status === "disconnected") {
        const nid = (window as any).__reconnectNotifId
        if (nid !== undefined) removeNotification(nid)
        delete (window as any).__reconnectNotifId
        addNotification("Disconnected from WhatsApp", { tone: "error", durationMs: 6000 })
      } else if (status === "logged_out") {
        // The backend confirmed logout (or another device logged us out):
        // drop any reconnect toast and return to the login screen.
        const nid = (window as any).__reconnectNotifId
        if (nid !== undefined) removeNotification(nid)
        delete (window as any).__reconnectNotifId
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

    // Surface backend errors to the user as toast notifications.
    const unsubError = EventsOn("wa:error", (msg: string) => {
      addNotification(sanitizeErrorMessage(msg), { tone: "error", durationMs: 6000 })
    })

    // Identity changes are auto-trusted for WhatsApp-Web parity, but must be
    // visible: use the same toast path as other backend security errors.
    const unsubIdentity = EventsOn("wa:identity_change", (_msg: string) => {
      // Do not render the raw payload: it contains a contact JID.
      addNotification("A contact's security code changed. Verify it in WhatsApp on your phone.", {
        tone: "warning",
        durationMs: 8000,
      })
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
      unsubError()
      unsubIdentity()
      unsubUpdateAvailable()
      unsubUpdateError()
      unsubHistory()
    }
  }, [addNotification, removeNotification])

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
      {/* Global transient toast stack. Bottom-left keeps security/identity
          warnings over the chat-list column, away from the chat header and the
          composer (which live at the top and bottom of the conversation pane).
          z-[45] sits above the persistent chrome (conn-status 40, chat-info
          30/40) but below every modal (z-50 and up) and the call overlay
          (z-[9999]). bottom-20 clears the connection pill and the single-pane
          composer. This mounts outside the screen switch, so the stack also
          works on Settings and login. slice(-3) is a defensive second cap on
          top of the store's own trim. */}
      <div
        className="fixed bottom-20 left-4 z-[45] flex flex-col gap-2"
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        {notifications.slice(-3).map(notification => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            onDismiss={removeNotification}
          />
        ))}
      </div>

      {/* Persistent, unobtrusive connection state for long-running sessions.
          Toasts are the transient layer; this pill is always truthful. */}
      {screen !== "login" && (
        <div
          className={`conn-status conn-status--${connection.tone}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="conn-status-dot" aria-hidden="true" />
          <span>{connection.label}</span>
        </div>
      )}

      <main id="main-content" tabIndex={-1} className="relative">
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
      </main>
      <CallOverlay />
    </div>
  )
}

export default App
