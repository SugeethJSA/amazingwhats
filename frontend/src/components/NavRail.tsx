import type { ReactNode } from "react"
import { useUIStore, type SidebarView } from "../store/useUIStore"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"
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

interface RailItem {
  view: SidebarView
  label: string
  icon: ReactNode
}

const ITEM_BASE =
  "flex h-11 w-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-bg"

/**
 * Persistent WhatsApp-style left rail. Every entry maps to a real destination
 * already in the app; there are deliberately no Calls / Tools placeholders
 * because neither has a view or a backend binding to open.
 */
export function NavRail() {
  const screen = useUIStore(state => state.screen)
  const sidebarView = useUIStore(state => state.sidebarView)
  const setScreen = useUIStore(state => state.setScreen)
  const setSidebarView = useUIStore(state => state.setSidebarView)
  const selfAvatar = useSelfAvatarStore(state => state.selfAvatar)

  const items: RailItem[] = [
    { view: "chats", label: "Chats", icon: <ChatsIcon /> },
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

      {/* Profile opens Settings straight into Account — same event/shortcut
          path App.tsx uses for Ctrl+Alt+P. */}
      <button
        type="button"
        aria-label="Profile and Account"
        title="Profile"
        onClick={() => {
          setScreen("settings")
          window.dispatchEvent(new CustomEvent("wa:open-settings-category", { detail: "account" }))
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
