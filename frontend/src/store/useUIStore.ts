import { create } from "zustand"
import { connectionView, type ConnectionTone } from "../lib/connection"

const STALE_TYPING_MS = 60_000
const STALE_ONLINE_MS = 600_000
/** Bounded ring of real wa:status transitions (no synthetic samples). */
const MAX_CONNECTION_HISTORY = 60

interface TypingState {
  isTyping: boolean
  at: number
  /** Presence media from wa:chat_presence, e.g. "audio" for voice recording. */
  media?: string
  /** JID of the peer who is typing. Never the local user or the group JID. */
  sender?: string
}

interface OnlineState {
  isOnline: boolean
  at: number
}

export type AppScreen = "login" | "chats" | "settings"

/** Sidebar destination backing the persistent left navigation rail. */
export type SidebarView = "chats" | "calls" | "communities" | "channels" | "status"

export type NotificationTone = "info" | "success" | "error" | "warning"

/**
 * Where a notification is surfaced. `status` alerts are durable and live in the
 * health subpane; `transient` ones keep the old auto-dismissing toast behavior.
 * Defaults to `transient`, so existing producers need no changes.
 */
export type NotificationKind = "status" | "transient"

/** One real wa:status transition, recorded only when the status actually changes. */
export interface ConnectionHistoryPoint {
  tone: ConnectionTone
  status: string
  at: number
}

export interface NotificationAction {
  label: string
  onClick: () => void
}

export interface NotificationOptions {
  tone?: NotificationTone
  action?: NotificationAction
  /** When omitted the toast stays until dismissed explicitly. */
  durationMs?: number
  /** Default `transient`. Only `status` alerts are listed in the health pane. */
  kind?: NotificationKind
}

export interface Notification {
  id: number
  message: string
  tone: NotificationTone
  action?: NotificationAction
  durationMs?: number
  kind: NotificationKind
  /** Real creation time, used by the health pane's detail view. */
  createdAt: number
}

/**
 * A notification action ("Open chat" / "Reply") waiting to be consumed by the
 * ChatDetail that owns the target chat.
 *
 * This lives in the store rather than in ChatDetail state because ChatDetail is
 * keyed by `selectedChatId`: when the notification targets the chat that is
 * already open, none of its `[chatId]` effects rerun. A store-held intent gives
 * the mounted instance a change it can react to.
 *
 * Every string here is untrusted payload data. Producers sanitize it before
 * writing; consumers must only use it as display text or as a store/RPC key,
 * never as raw JID/path output.
 */
export interface NotificationReplyIntent {
  /** Monotonic id so two identical, consecutive actions are not collapsed. */
  id: number
  chatJid: string
  messageId?: string
  senderJid?: string
  name?: string
  avatar?: string
  text?: string
}

/**
 * A group the backend just joined, waiting for ChatScreen (which owns the
 * local sidebar view) to switch to the chats view and open the conversation.
 * A monotonic id keeps two consecutive joins to the same group distinct.
 *
 * Every string here is untrusted payload data. Producers sanitize it before
 * writing; consumers must only use it as display text or as a store/RPC key,
 * never as raw JID/path output.
 */
export interface GroupJoinIntent {
  id: number
  chatJid: string
  name?: string
  avatar?: string
}

interface UIStore {
  screen: AppScreen
  setScreen: (screen: AppScreen) => void
  sidebarView: SidebarView
  setSidebarView: (view: SidebarView) => void
  /** Raw wa:status string, shared with the rail's health icon. */
  connectionStatus: string
  setConnectionStatus: (status: string) => void
  /** Real wa:status transitions (bounded, newest last). No synthetic samples. */
  connectionHistory: ConnectionHistoryPoint[]
  /** Health subpane + its alert-detail surface, owned by App/NavRail. */
  healthPanelOpen: boolean
  selectedAlertId: number | null
  /** Passing false also clears the current selection. */
  setHealthPanelOpen: (open: boolean) => void
  setSelectedAlertId: (id: number | null) => void
  /**
   * Category a settings navigation asked for before the lazy SettingsScreen
   * mounted. Consumers read it in their initial state, then clear it on mount.
   */
  settingsCategoryIntent: string | null
  setSettingsCategoryIntent: (category: string | null) => void
  sidebarOpen: boolean
  selfProfileOpen: boolean
  setSelfProfileOpen: (open: boolean) => void
  showEmojiPicker: boolean
  chatInfoOpen: boolean
  typingIndicators: Record<string, TypingState>
  onlineStatus: Record<string, OnlineState>
  notifications: Notification[]
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setShowEmojiPicker: (show: boolean) => void
  setChatInfoOpen: (open: boolean) => void
  setTypingIndicator: (
    chatId: string,
    isTyping: boolean,
    media?: string,
    sender?: string,
    isFromMe?: boolean,
  ) => void
  setOnlineStatus: (userId: string, isOnline: boolean) => void
  /** Backward compatible: `addNotification(message)` still works. */
  addNotification: (message: string, options?: NotificationOptions) => number
  removeNotification: (id: number) => void
  /** Recovery/logout resolves any still-pending connection status alerts. */
  clearStatusNotifications: () => void
  evictStale: () => void
  lightboxSrc: string | null
  lightboxKind: "image" | "video"
  openLightbox: (src: string, kind?: "image" | "video") => void
  closeLightbox: () => void
  /** Message the consumer should jump to once its chat is mounted. */
  focusMessageId: string | null
  setFocusMessageId: (id: string | null) => void
  /** Single shared intent for a notification "Reply" action. */
  pendingNotificationReply: NotificationReplyIntent | null
  setPendingNotificationReply: (intent: Omit<NotificationReplyIntent, "id">) => void
  clearPendingNotificationReply: () => void
  /** Group join waiting for ChatScreen to switch view and open the chat. */
  pendingGroupJoin: GroupJoinIntent | null
  setPendingGroupJoin: (intent: Omit<GroupJoinIntent, "id">) => void
  clearPendingGroupJoin: () => void
}

// Monotonic IDs avoid collisions when several toasts are created in one tick.
let nextNotificationId = Date.now()
// Separate from toast ids: identical quick replies must still be distinct.
let nextReplyIntentId = 1
// Consecutive joins to the same group must still produce distinct intents.
let nextGroupJoinIntentId = 1

export const useUIStore = create<UIStore>(set => ({
  screen: "login",
  setScreen: screen => set({ screen }),
  sidebarView: "chats",
  setSidebarView: sidebarView => set({ sidebarView }),
  connectionStatus: "waiting",
  // Seed with the honest initial state; setConnectionStatus appends only on
  // real transitions so the graph never contains fabricated samples.
  connectionHistory: [{ tone: connectionView("waiting").tone, status: "waiting", at: Date.now() }],
  setConnectionStatus: status =>
    set(state => {
      if (state.connectionStatus === status) return {}
      return {
        connectionStatus: status,
        connectionHistory: [
          ...state.connectionHistory,
          { tone: connectionView(status).tone, status, at: Date.now() },
        ].slice(-MAX_CONNECTION_HISTORY),
      }
    }),
  healthPanelOpen: false,
  selectedAlertId: null,
  setHealthPanelOpen: healthPanelOpen =>
    set(state => ({ healthPanelOpen, ...(healthPanelOpen ? {} : { selectedAlertId: null }) })),
  setSelectedAlertId: selectedAlertId => set({ selectedAlertId }),
  settingsCategoryIntent: null,
  setSettingsCategoryIntent: settingsCategoryIntent => set({ settingsCategoryIntent }),
  sidebarOpen: true,
  selfProfileOpen: false,
  setSelfProfileOpen: selfProfileOpen => set({ selfProfileOpen }),
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

  pendingNotificationReply: null,
  setPendingNotificationReply: intent =>
    set({ pendingNotificationReply: { ...intent, id: nextReplyIntentId++ } }),
  clearPendingNotificationReply: () => set({ pendingNotificationReply: null }),

  pendingGroupJoin: null,
  setPendingGroupJoin: intent =>
    set({ pendingGroupJoin: { ...intent, id: nextGroupJoinIntentId++ } }),
  clearPendingGroupJoin: () => set({ pendingGroupJoin: null }),

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: open => set({ sidebarOpen: open }),
  setShowEmojiPicker: show => set({ showEmojiPicker: show }),
  setChatInfoOpen: open => set({ chatInfoOpen: open }),

  setTypingIndicator: (chatId, isTyping, media, sender, isFromMe) =>
    set(state => {
      const next = { ...state.typingIndicators }
      // Never show our own echoed chatstate as a peer typing indicator.
      if (isFromMe) {
        delete next[chatId]
        return { typingIndicators: next }
      }
      if (isTyping) {
        next[chatId] = { isTyping: true, at: Date.now(), media, sender }
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
      kind: options.kind ?? "transient",
      createdAt: Date.now(),
      ...(options.action ? { action: options.action } : {}),
      ...(typeof options.durationMs === "number" ? { durationMs: options.durationMs } : {}),
    }
    set(state => {
      // Keep the original 3-toast cap for transient notifications, but give
      // durable status alerts their own bounded ring so an incoming toast can
      // never silently evict an alert that still needs attention. Filtering the
      // combined list preserves chronological order for both surfaces.
      const all = [...state.notifications, notification]
      const statusAlerts = all.filter(n => n.kind === "status").slice(-10)
      const transientToasts = all.filter(n => n.kind === "transient").slice(-3)
      return {
        notifications: all.filter(n => statusAlerts.includes(n) || transientToasts.includes(n)),
      }
    })
    return id
  },

  removeNotification: id =>
    set(state => ({
      notifications: state.notifications.filter(n => n.id !== id),
      ...(state.selectedAlertId === id ? { selectedAlertId: null } : {}),
    })),

  clearStatusNotifications: () =>
    set(state => ({
      notifications: state.notifications.filter(n => n.kind !== "status"),
      selectedAlertId: null,
    })),
}))
