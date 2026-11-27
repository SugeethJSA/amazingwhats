import { create } from "zustand"
import { GetSettings, SaveSettings } from "../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { DEFAULT_EASES, THEME, applyThemeColors } from "../theme.config"
import { cacheTheme, normalizeTheme, readCachedTheme } from "../lib/theme"
import { useEaseStore } from "./useEaseStore"

/**
 * Internal-only key stamped into the persisted settings map after the one-time
 * Enter-is-send default migration has run. It is deliberately NOT part of
 * AppSettings and is never rendered as a user-facing setting or UI toggle.
 * The generic settings map (`{ [key: string]?: any }`) tolerates extra keys,
 * so this rides along in saved snapshots without changing the persisted
 * app-settings schema.
 */
const ENTER_IS_SEND_MIGRATED_KEY = "enterIsSendMigrated"

/** Ensures a failed marker write is logged at most once per session. */
let hasWarnedEnterIsSendMigration = false

interface AppSettingsStore extends AppSettings {
  loaded: boolean

  // Internal migration marker (see ENTER_IS_SEND_MIGRATED_KEY). Not an app
  // setting; kept on the store so it rides along in every saved snapshot and
  // the migration cannot re-run after a user later opts out.
  enterIsSendMigrated: boolean

  loadSettings: () => Promise<void>
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
  updateThemeColor: (group: keyof typeof THEME, label: string, value: string) => Promise<void>
  toggleTheme: () => Promise<void>
}

export interface AppSettings {
  // Theme
  theme: "light" | "dark"
  themeColors: typeof THEME
  eases: typeof DEFAULT_EASES

  // Privacy Settings
  readReceipts: boolean
  blockUnknown: boolean
  disableLinkPreviews: boolean

  // Notifications Settings
  messageNotifications: boolean
  showPreviews: boolean
  showReactionNotifications: boolean
  statusReactions: boolean
  callNotifications: boolean
  incomingCallSounds: boolean
  incomingSounds: boolean
  outgoingSounds: boolean

  // General Settings
  startAtLogin: boolean
  minimizeToTray: boolean
  language: string
  fontSize: string

  // Chats Settings
  spellCheck: boolean
  replaceTextWithEmojis: boolean
  enterIsSend: boolean

  // Integrations
  /** Optional user-supplied GIPHY beta API key. Empty = local GIF files only. */
  giphyApiKey: string

  // Account recovery
  /** Ask the phone for full history on the NEXT pairing, not existing sessions. */
  relinkWithFullHistory: boolean

  // Background mode
  /** Keep the app in the tray and start with no visible window. */
  runInBackground: boolean
}

const defaultSettings: AppSettings = {
  theme: "light",
  themeColors: THEME,
  eases: DEFAULT_EASES,
  readReceipts: true,
  blockUnknown: false,
  disableLinkPreviews: false,

  messageNotifications: true,
  showPreviews: true,
  showReactionNotifications: true,
  statusReactions: true,
  callNotifications: true,
  incomingCallSounds: true,
  incomingSounds: true,
  outgoingSounds: true,

  startAtLogin: false,
  minimizeToTray: true,
  language: "English",
  fontSize: "100% (Default)",

  spellCheck: true,
  replaceTextWithEmojis: true,
  enterIsSend: true,

  giphyApiKey: "",
  relinkWithFullHistory: false,
  runInBackground: false,
}

function extractSettings(state: AppSettingsStore): AppSettings {
  const { loaded, ...settings } = state
  // NOTE: `settings` intentionally still contains the internal
  // `enterIsSendMigrated` marker. SaveSettings accepts a generic
  // `{ [key: string]?: any }` map and tolerates extra keys, and keeping the
  // marker in every saved snapshot is what makes the one-time migration
  // durable across later updateSetting / updateThemeColor / useEaseStore
  // writes. It is not part of AppSettings and is never surfaced in the UI.
  return settings
}

/** Accepts values such as "120%" or "100% (Default)" from the settings select. */
export function fontSizeToCss(value: string | undefined): string {
  const match = typeof value === "string" ? value.match(/(\d+(?:\.\d+)?)\s*%/) : null
  return match ? `${match[1]}%` : "100%"
}

function applyFontSize(value: string | undefined): void {
  document.documentElement.style.fontSize = fontSizeToCss(value)
}

export const useAppSettingsStore = create<AppSettingsStore>((set, get) => ({
  ...defaultSettings,
  loaded: false,
  enterIsSendMigrated: false,

  loadSettings: async () => {
    try {
      const saved = await GetSettings()
      const savedMap = (saved ?? {}) as Record<string, unknown>

      const merged = {
        ...defaultSettings,
        ...savedMap,
      }
      merged.theme = normalizeTheme(merged.theme)

      // One-time migration: legacy profiles persisted an explicit
      // `enterIsSend: false` (the old default). Force the new WhatsApp-style
      // behaviour once, stamp the persisted snapshot with an internal marker,
      // and write back the raw saved map so every other value is preserved
      // byte-for-byte. The marker is best-effort: a failed write is logged at
      // most once and never breaks settings load; the corrected in-memory
      // value is kept regardless.
      const needsEnterIsSendMigration = savedMap[ENTER_IS_SEND_MIGRATED_KEY] !== true
      if (needsEnterIsSendMigration) {
        merged.enterIsSend = true

        SaveSettings({
          ...savedMap,
          enterIsSend: true,
          [ENTER_IS_SEND_MIGRATED_KEY]: true,
        }).catch(err => {
          if (!hasWarnedEnterIsSendMigration) {
            hasWarnedEnterIsSendMigration = true
            console.error("Failed to persist Enter-is-send migration marker:", err)
          }
        })
      }

      // Older builds shipped a black light-mode toggle knob (#000000) as the
      // default and persisted it into saved settings. Rewrite that stale
      // default to white so existing installs pick up the readable knob.
      const savedToggleCircle: string | undefined = merged.themeColors?.Button?.["toggle circle"]
      if (savedToggleCircle === "#000000") {
        merged.themeColors = {
          ...merged.themeColors,
          Button: { ...merged.themeColors.Button, "toggle circle": "#ffffff" },
        }
      }

      applyThemeColors(merged.themeColors)
      applyFontSize(merged.fontSize)
      useEaseStore.setState({ eases: merged.eases })
      cacheTheme(merged.theme)

      set({
        ...merged,
        loaded: true,
        // After a successful load the marker is always true: either it was
        // already present in the saved map, or we just stamped and persisted it.
        enterIsSendMigrated: true,
      })
    } catch (err) {
      // fallback to defaults, but keep the locally cached theme so a backend
      // failure does not flip a dark-mode user back to light
      applyThemeColors(defaultSettings.themeColors)
      applyFontSize(defaultSettings.fontSize)
      useEaseStore.setState({ eases: defaultSettings.eases })

      set({ theme: readCachedTheme(), loaded: true })
    }
  },

  updateSetting: async (key, value) => {
    const next = { ...get(), [key]: value } as AppSettingsStore
    if (key === "theme") {
      cacheTheme(next.theme)
    }
    if (key === "fontSize") {
      applyFontSize(next.fontSize)
    }
    set(next)
    // Awaiting matters: callers such as Log out reload the page immediately,
    // and a fire-and-forget save could lose the just-toggled value.
    try {
      await SaveSettings(extractSettings(next))
    } catch (err) {
      console.error("Failed to save setting:", err)
    }
  },

  toggleTheme: async () => {
    const theme = get().theme === "light" ? "dark" : "light"
    await get().updateSetting("theme", theme)
  },

  updateThemeColor: async (group, label, value) => {
    set(state => {
      const next = {
        ...state,
        themeColors: {
          ...state.themeColors,
          [group]: {
            ...state.themeColors[group],
            [label]: value,
          },
        },
      }

      // ⭐ apply to CSS
      applyThemeColors(next.themeColors)

      // ⭐ persist
      SaveSettings(extractSettings(next)).catch(console.error)

      return next
    })
  },
}))
