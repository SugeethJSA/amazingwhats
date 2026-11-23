import { create } from "zustand"

const STALE_TYPING_MS = 60_000
const STALE_ONLINE_MS = 600_000

interface TypingState {
  isTyping: boolean
  at: number
}

interface OnlineState {
  isOnline: boolean
  at: number
}

export type AppScreen = "login" | "chats" | "settings"

export type NotificationTone = "info" | "success" | "error" | "warning"

export interface NotificationAction {
  label: string
  onClick: () => void
}

export interface NotificationOptions {
  tone?: NotificationTone
  action?: NotificationAction
  /** When omitted the toast stays until dismissed explicitly. */
  durationMs?: number
}

export interface Notification {
  id: number
  message: string
  tone: NotificationTone
  action?: NotificationAction
  durationMs?: number
}

interface UIStore {
  screen: AppScreen
  setScreen: (screen: AppScreen) => void
  sidebarOpen: boolean
  showEmojiPicker: boolean
  chatInfoOpen: boolean
  typingIndicators: Record<string, TypingState>
  onlineStatus: Record<string, OnlineState>
  notifications: Notification[]
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setShowEmojiPicker: (show: boolean) => void
  setChatInfoOpen: (open: boolean) => void
  setTypingIndicator: (chatId: string, isTyping: boolean) => void
  setOnlineStatus: (userId: string, isOnline: boolean) => void
  /** Backward compatible: `addNotification(message)` still works. */
  addNotification: (message: string, options?: NotificationOptions) => number
  removeNotification: (id: number) => void
  evictStale: () => void
  lightboxSrc: string | null
  lightboxKind: "image" | "video"
  openLightbox: (src: string, kind?: "image" | "video") => void
  closeLightbox: () => void
  /** Message the consumer should jump to once its chat is mounted. */
  focusMessageId: string | null
  setFocusMessageId: (id: string | null) => void
}

// Monotonic IDs avoid collisions when several toasts are created in one tick.
let nextNotificationId = Date.now()

export const useUIStore = create<UIStore>(set => ({
  screen: "login",
  setScreen: screen => set({ screen }),
  sidebarOpen: true,
  showEmojiPicker: false,
  chatInfoOpen: false,
  typingIndicators: {},
  onlineStatus: {},
  notifications: [],

  lightboxSrc: null,
  lightboxKind: "image",
  openLightbox: (src, kind = "image") => set({ lightboxSrc: src, lightboxKind: kind }),
  closeLightbox: () => set({ lightboxSrc: null }),

  focusMessageId: null,
  setFocusMessageId: id => set({ focusMessageId: id }),

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: open => set({ sidebarOpen: open }),
  setShowEmojiPicker: show => set({ showEmojiPicker: show }),
  setChatInfoOpen: open => set({ chatInfoOpen: open }),

  setTypingIndicator: (chatId, isTyping) =>
    set(state => {
      const next = { ...state.typingIndicators }
      if (isTyping) {
        next[chatId] = { isTyping: true, at: Date.now() }
      } else {
        delete next[chatId]
      }
      return { typingIndicators: next }
    }),

  setOnlineStatus: (userId, isOnline) =>
    set(state => {
      const next = { ...state.onlineStatus }
      next[userId] = { isOnline, at: Date.now() }
      return { onlineStatus: next }
    }),

  evictStale: () =>
    set(state => {
      const now = Date.now()
      return {
        typingIndicators: Object.fromEntries(
          Object.entries(state.typingIndicators).filter(([, v]) => now - v.at < STALE_TYPING_MS),
        ),
        onlineStatus: Object.fromEntries(
          Object.entries(state.onlineStatus).filter(([, v]) => now - v.at < STALE_ONLINE_MS),
        ),
      }
    }),

  addNotification: (message, options = {}) => {
    const id = nextNotificationId++
    const notification: Notification = {
      id,
      message,
      tone: options.tone ?? "info",
      ...(options.action ? { action: options.action } : {}),
      ...(typeof options.durationMs === "number" ? { durationMs: options.durationMs } : {}),
    }
    set(state => ({
      notifications: [...state.notifications, notification].slice(-50),
    }))
    return id
  },

  removeNotification: id =>
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
    })),
}))
