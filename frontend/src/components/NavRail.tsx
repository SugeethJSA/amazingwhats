import type { ReactNode } from "react"
import { useUIStore, type SidebarView } from "../store/useUIStore"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"
import { connectionView } from "../lib/connection"
import { SettingsIcon } from "../assets/svgs/settings_icons"

/* Inline rail glyphs — owned assets only, no Meta artwork. Decorative: every
   control carries its own accessible name via aria-label/title. */
function ChatsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c-5.24 0-9.5 3.84-9.5 8.58 0 2.29 1.02 4.37 2.65 5.92L4 21.5l4.7-1.45c1.03.34 2.14.53 3.3.53 5.24 0 9.5-3.85 9.5-8.58S17.24 2.5 12 2.5z" />
    </svg>
  )
}

/** Original inline phone glyph — no Meta/WhatsApp artwork. */
function CallsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M6.6 3.2a1.6 1.6 0 0 0-1.58 1.34l-.72 4.1a1.6 1.6 0 0 0 .46 1.4l2.1 2.05a13.9 13.9 0 0 0 5.05 5.05l2.05 2.1a1.6 1.6 0 0 0 1.4.46l4.1-.72a1.6 1.6 0 0 0 1.34-1.58v-1.9a1.6 1.6 0 0 0-1.75-1.59l-2.4.27a1.6 1.6 0 0 0-1.36.98l-.42 1.02a10.7 10.7 0 0 1-3.4-3.4l1.02-.42a1.6 1.6 0 0 0 .98-1.36l.27-2.4A1.6 1.6 0 0 0 12.2 4.8h-1.9a1.6 1.6 0 0 0-1.6-1.6H6.6z" />
    </svg>
  )
}

function StatusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <circle cx="11" cy="13" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="18.5" cy="5.5" r="3" fill="var(--color-green)" />
    </svg>
  )
}

function ChannelsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M3 9v6h4l5 4V5L7 9H3zm13.6 3a4.5 4.5 0 0 0-2.35-3.96v7.92A4.5 4.5 0 0 0 16.6 12zM14 3.18v2.06a7 7 0 0 1 0 13.52v2.06a9 9 0 0 0 0-17.64z" />
    </svg>
  )
}

function CommunitiesIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M8 11.2a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2zm8-.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM8 13.2c-2.9 0-8.6 1.5-8.6 4.6V20h9.3v-2.2c0-1.6.6-3 1.6-4.1-.7-.2-1.5-.3-2.3-.3zm8-.2c-.5 0-1.1 0-1.6.1 1.2.9 2 2.2 2 3.7V20h8.2v-2.2c0-3.1-5.7-4.8-8.6-4.8z" />
    </svg>
  )
}

function ProfileGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2zm0 2.1c-3.6 0-8.8 1.8-8.8 5V21h17.6v-1.7c0-3.2-5.2-5-8.8-5z" />
    </svg>
  )
}

/** Original inline star glyph for the starred-messages destination. */
function StarredIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
      <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45l-5.81 3.05L7.3 14.03 2.6 9.45l6.5-.95L12 2.6z" />
    </svg>
  )
}

interface RailItem {
  view: SidebarView
  label: string
  icon: ReactNode
}

const ITEM_BASE =
  "flex h-11 w-11 items-center justify-center rounded-full transition-colors"

/**
 * Persistent WhatsApp-style left rail. Every entry maps to a real destination
 * in the app — Chats, Calls, Status, Channels, Communities and Settings.
 */
export function NavRail() {
  const screen = useUIStore(state => state.screen)
  const sidebarView = useUIStore(state => state.sidebarView)
  const setScreen = useUIStore(state => state.setScreen)
  const setSidebarView = useUIStore(state => state.setSidebarView)
  const setSelfProfileOpen = useUIStore(state => state.setSelfProfileOpen)
  const selfAvatar = useSelfAvatarStore(state => state.selfAvatar)
  const connectionStatus = useUIStore(state => state.connectionStatus)
  const connection = connectionView(connectionStatus)

  const items: RailItem[] = [
    { view: "chats", label: "Chats", icon: <ChatsIcon /> },
    { view: "calls", label: "Calls", icon: <CallsIcon /> },
    { view: "status", label: "Status", icon: <StatusIcon /> },
    { view: "channels", label: "Channels", icon: <ChannelsIcon /> },
    { view: "communities", label: "Communities", icon: <CommunitiesIcon /> },
  ]

  const settingsActive = screen === "settings"

  return (
    <nav
      aria-label="Main navigation"
      className="flex h-screen w-16 shrink-0 flex-col items-center border-r border-gray-200 bg-light-secondary py-2 dark:border-dark-border dark:bg-dark-bg"
    >
      <div className="flex w-full flex-1 flex-col items-center gap-1">
        {items.map(item => {
          const active = screen === "chats" && sidebarView === item.view
          return (
            <div className="relative flex w-full justify-center" key={item.view}>
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-green)]"
                />
              )}
              <button
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setScreen("chats")
                  setSidebarView(item.view)
                }}
                className={`${ITEM_BASE} ${
                  active
                    ? "bg-green-muted text-green-ink"
                    : "text-light-muted hover:bg-black/5 hover:text-light-text dark:text-dark-muted dark:hover:bg-white/10 dark:hover:text-dark-text"
                }`}
              >
                {item.icon}
              </button>
            </div>
          )
        })}

        {/* Starred messages is a real destination backed by the
            ListStarredMessages binding. The host list pane listens for this
            same-window event (the same pattern used for settings categories)
            and swaps in the starred view. */}
        <div className="relative flex w-full justify-center">
          <button
            type="button"
            aria-label="Starred messages"
            title="Starred messages"
            onClick={() => {
              setScreen("chats")
              window.dispatchEvent(new CustomEvent("wa:open-starred-messages"))
            }}
            className={`${ITEM_BASE} text-light-muted hover:bg-black/5 hover:text-light-text dark:text-dark-muted dark:hover:bg-white/10 dark:hover:text-dark-text`}
          >
            <StarredIcon />
          </button>
        </div>

        <div className="relative flex w-full justify-center">
          {settingsActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-green)]"
            />
          )}
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            aria-current={settingsActive ? "page" : undefined}
            onClick={() => setScreen("settings")}
            className={`${ITEM_BASE} ${
              settingsActive
                ? "bg-green-muted text-green-ink"
                : "text-light-muted hover:bg-black/5 hover:text-light-text dark:text-dark-muted dark:hover:bg-white/10 dark:hover:text-dark-text"
            }`}
          >
            <SettingsIcon className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Durable connection cue: a dot in the rail; hovering or focusing it
          expands the full human-readable state next to the rail. */}
      <div className="group relative flex w-full justify-center">
        <button
          type="button"
          aria-label={`Connection: ${connection.label}. ${connection.detail}`}
          title={connection.label}
          className={`${ITEM_BASE} h-8 w-8`}
        >
          <span className={`conn-status--${connection.tone}`}>
            <span className="conn-status-dot block" aria-hidden="true" />
          </span>
        </button>
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute bottom-1 left-full z-50 ml-2 hidden w-max max-w-[220px] rounded-lg border border-light-border bg-light-bg px-3 py-2 text-xs shadow-lg group-focus-within:block group-hover:block dark:border-dark-border dark:bg-dark-secondary"
        >
          <span className="block font-semibold text-light-text dark:text-dark-text">
            {connection.label}
          </span>
          <span className="mt-0.5 block text-light-muted dark:text-dark-muted">
            {connection.detail}
          </span>
        </div>
      </div>

      {/* Profile opens the self-profile drawer over the chat list. The
          Ctrl+Alt+P shortcut still opens Settings > Account separately. */}
      <button
        type="button"
        aria-label="Profile and Account"
        title="Profile"
        onClick={() => {
          // Avatar opens the logged-in person's profile over the chat list.
          // If we are in another screen, go back to chats first so the drawer
          // has a visible host pane.
          setScreen("chats")
          setSidebarView("chats")
          setSelfProfileOpen(true)
        }}
        className={`${ITEM_BASE} mb-1 mt-2`}
      >
        <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-light-tertiary text-light-muted dark:bg-dark-tertiary dark:text-dark-muted">
          {selfAvatar ? (
            <img src={selfAvatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <ProfileGlyph />
          )}
        </span>
      </button>
    </nav>
  )
}
