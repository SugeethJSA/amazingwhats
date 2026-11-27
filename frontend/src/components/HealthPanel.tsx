import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useUIStore, type ConnectionHistoryPoint, type Notification } from "../store/useUIStore"
import { connectionView } from "../lib/connection"

/** Shared with NavRail so focus can be returned to the exact toggle button. */
export const HEALTH_TOGGLE_ID = "health-panel-toggle"

export const TONE_LABEL: Record<Notification["tone"], string> = {
  info: "Info",
  success: "Success",
  warning: "Warning",
  error: "Error",
}

export const TONE_GLYPH: Record<Notification["tone"], string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✕",
}

export const TONE_CLASS: Record<Notification["tone"], string> = {
  info: "text-[var(--color-link-ink)]",
  success: "text-[var(--color-green-ink)]",
  warning: "text-[var(--color-warning)]",
  error: "text-[var(--color-danger)]",
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * Connection-to-server widget. It plots ONLY real wa:status transitions already
 * recorded in the store (`connectionHistory`), captured from the wa:status events
 * the backend emits. It performs no pings, fetches or other network activity.
 *
 * Investigation result: HyperMeow's keepalive.go sends its own IQ ping but only
 * exposes KeepAliveTimeout{ErrorCount, LastSuccess} / KeepAliveRestored{} — no
 * round-trip milliseconds — and api/api.go does not surface a latency sample.
 * So no millisecond latency is invented; the widget says so explicitly.
 */
function ConnectionHistoryWidget({
  history,
  status,
}: {
  history: ConnectionHistoryPoint[]
  status: string
}) {
  const connection = connectionView(status)
  // Local tick only: recomputes "time since last change" from the already
  // recorded timestamp. No network call and no synthetic latency sample.
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const last = history[history.length - 1]
  const secondsSinceChange = last ? Math.max(0, Math.floor((Date.now() - last.at) / 1000)) : null
  const width = 240
  const height = 48
  const firstAt = history[0]?.at ?? 0
  const latestAt = last?.at ?? firstAt
  const span = Math.max(latestAt - firstAt, 1)
  const yFor = (tone: ConnectionHistoryPoint["tone"]) =>
    tone === "online" ? 8 : tone === "connecting" ? 24 : 40
  // X really is elapsed time between recorded transitions, not a sample index.
  const xFor = (point: ConnectionHistoryPoint) =>
    history.length <= 1 ? 6 : 6 + ((point.at - firstAt) / span) * (width - 12)
  const points = history.map(point => `${xFor(point)},${yFor(point.tone)}`).join(" ")

  const summary = `Connection history: ${history.length} recorded state change${
    history.length === 1 ? "" : "s"
  }. Current state: ${connection.label}. ${
    secondsSinceChange === null
      ? "No changes recorded yet."
      : `Last change ${secondsSinceChange} seconds ago.`
  } No server latency measurement is available.`

  return (
    <section
      aria-label="Connection to server"
      className="rounded-xl border border-light-border bg-light-secondary p-3 dark:border-dark-border dark:bg-dark-tertiary"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-light-muted dark:text-dark-muted">
          Connection history
        </h3>
        <span className="text-[11px] font-medium text-light-muted dark:text-dark-muted">
          last {history.length} state change{history.length === 1 ? "" : "s"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-12 w-full"
        role="img"
        aria-label={summary}
        preserveAspectRatio="none"
      >
        {/* Three honest state lanes: connected / connecting / disconnected. */}
        {[8, 24, 40].map(y => (
          <line
            key={y}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke="currentColor"
            className="text-light-muted/30 dark:text-dark-muted/30"
            strokeWidth={1}
          />
        ))}
        {history.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke={
              connection.tone === "offline"
                ? "var(--color-danger)"
                : connection.tone === "connecting"
                  ? "var(--color-warning)"
                  : "var(--color-green)"
            }
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {last && (
          <circle
            cx={xFor(last)}
            cy={yFor(last.tone)}
            r={3}
            fill={
              connection.tone === "offline"
                ? "var(--color-danger)"
                : connection.tone === "connecting"
                  ? "var(--color-warning)"
                  : "var(--color-green)"
            }
          />
        )}
      </svg>
      <p className="mt-2 text-xs text-light-text dark:text-dark-text">
        Current: <span className="font-semibold">{connection.label}</span> — {connection.detail}
      </p>
      <p className="mt-1 text-[11px] text-light-muted dark:text-dark-muted">
        Latency unavailable (no existing measurement).
      </p>
      <p className="mt-1 text-[11px] text-light-muted dark:text-dark-muted">
        {secondsSinceChange === null
          ? "No connection changes recorded yet."
          : `Time since last state change: ${secondsSinceChange}s (not server latency).`}
      </p>
      <p className="sr-only">{summary}</p>
    </section>
  )
}

function AlertRow({ notification }: { notification: Notification }) {
  const selectedAlertId = useUIStore(state => state.selectedAlertId)
  const setSelectedAlertId = useUIStore(state => state.setSelectedAlertId)
  const removeNotification = useUIStore(state => state.removeNotification)
  const selected = selectedAlertId === notification.id

  return (
    <li
      className={`rounded-xl border p-3 ${
        selected
          ? "border-[var(--color-green)] bg-green-muted"
          : "border-light-border bg-light-bg dark:border-dark-border dark:bg-dark-secondary"
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-current={selected ? "true" : undefined}
          onClick={() => setSelectedAlertId(notification.id)}
        >
          <span
            className={`mr-1.5 text-sm font-bold ${TONE_CLASS[notification.tone]}`}
            aria-hidden="true"
          >
            {TONE_GLYPH[notification.tone]}
          </span>
          <span className="text-[13px] font-medium text-light-text dark:text-dark-text">
            {notification.message}
          </span>
          <span className="mt-1 block text-[11px] text-light-muted dark:text-dark-muted">
            {TONE_LABEL[notification.tone]} · {formatTime(notification.createdAt)}
          </span>
        </button>
        <button
          type="button"
          className="shrink-0 rounded-full px-2 py-1 text-[11px] text-light-muted hover:bg-black/5 dark:text-dark-muted dark:hover:bg-white/10"
          title="Dismiss"
          aria-label={`Dismiss alert: ${notification.message}`}
          onClick={() => removeNotification(notification.id)}
        >
          ✕
        </button>
      </div>
      {notification.action && (
        <button
          type="button"
          className="mt-2 rounded-lg border border-current px-2.5 py-1 text-[11px] font-semibold text-light-text hover:bg-black/5 dark:text-dark-text dark:hover:bg-white/10"
          onClick={() => {
            notification.action?.onClick()
            removeNotification(notification.id)
          }}
        >
          {notification.action.label}
        </button>
      )}
    </li>
  )
}

/**
 * Left-side subpane opened by the rail's health icon. Mirrors the Status and
 * chat-list panes: a fixed-width column next to the rail, header with a close
 * control, and a scrollable list of real status alerts.
 */
export function HealthPanel() {
  const panelRef = useRef<HTMLElement | null>(null)
  const setHealthPanelOpen = useUIStore(state => state.setHealthPanelOpen)
  const connectionStatus = useUIStore(state => state.connectionStatus)
  const connectionHistory = useUIStore(state => state.connectionHistory)
  const notifications = useUIStore(state => state.notifications)
  const statusAlerts = notifications.filter(notification => notification.kind === "status")

  useEffect(() => {
    // Focus the labelled panel on open so screen readers announce it.
    panelRef.current?.focus()
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      setHealthPanelOpen(false)
      document.getElementById(HEALTH_TOGGLE_ID)?.focus()
    }
  }

  return (
    <aside
      ref={panelRef}
      id="health-alerts-pane"
      role="complementary"
      aria-label="Health alerts"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex w-80 shrink-0 flex-col border-r border-light-border bg-light-bg outline-none dark:border-dark-border dark:bg-dark-secondary"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-light-border px-4 py-3 dark:border-dark-border">
        <div>
          <h2 className="text-sm font-semibold text-light-text dark:text-dark-text">Health</h2>
          <p className="text-[11px] text-light-muted dark:text-dark-muted">
            Connection and status alerts
          </p>
        </div>
        <button
          type="button"
          className="rounded-full p-2 text-light-muted hover:bg-black/5 dark:text-dark-muted dark:hover:bg-white/10"
          aria-label="Close health panel"
          title="Close"
          onClick={() => {
            setHealthPanelOpen(false)
            document.getElementById(HEALTH_TOGGLE_ID)?.focus()
          }}
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <ConnectionHistoryWidget history={connectionHistory} status={connectionStatus} />

        <section aria-label="Status alerts">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-light-muted dark:text-dark-muted">
            Status alerts {statusAlerts.length > 0 ? `(${statusAlerts.length})` : ""}
          </h3>
          {statusAlerts.length === 0 ? (
            <p className="rounded-xl border border-light-border bg-light-bg p-3 text-[13px] text-light-muted dark:border-dark-border dark:bg-dark-secondary dark:text-dark-muted">
              No status alerts pending. Connection and background updates look normal.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {statusAlerts.map(notification => (
                <AlertRow key={notification.id} notification={notification} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}
