import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { useContactStore } from "./useContactStore"
import { isMe } from "../lib/self"
import type { Message, MessageReceiptRow } from "./types"

const MAX_MSGS_PER_CHAT = 200

// whatsmeow receipt type strings. Kept local to the store so glyph logic and
// the reader ledger can agree without importing a React component.
const READ_RECEIPTS = new Set(["read", "reads", "read-self", "read_self", "played"])
const SELF_TYPES = new Set(["read-self", "read_self", "played-self", "played_self"])
const DELIVERED_RECEIPTS = new Set(["delivered", "delivery", "received"])

// Phone-number part of a JID, ignoring device and server suffixes. Readers can
// arrive as phone JIDs or LIDs; dedupe on this part to keep one row per person.
const jidKey = (jid: string) => (jid || "").split("@")[0].split(":")[0]

interface MessageStore {
  messages: Record<string, Message[]>
  activeChatId: string | null
  setActiveChatId: (chatId: string) => void
  setMessages: (chatId: string, messages: Message[]) => void
  addMessage: (chatId: string, message: Message) => void
  prependMessages: (chatId: string, messages: Message[]) => void
  updateMessage: (chatId: string, message: Message) => void
  addReactionToMessage: (chatId: string, messageId: string, emoji: string, senderId: string) => void
  clearMessages: (chatId: string) => void
  trimOldMessages: (chatId: string, keepCount: number) => void
  trimAllChats: () => void
  addPendingMessage: (chatId: string, message: Message) => void
  updatePendingMessageToSent: (chatId: string, tempId: string, message: Message) => void
  updateMessageReceipt: (chatId: string, messageId: string, status: string) => void
  /**
   * Merge a live wa:message_receipt event into per-reader ledgers. Receipts for
   * messages we did not send, and receipts emitted by our own device, are
   * ignored so we can never claim to be our own reader.
   */
  applyReceipt: (
    chatId: string,
    messageIDs: string[],
    status: string,
    senderJID: string,
    myJID: string,
  ) => void
  /** Merge durable rows loaded by the "Message info" panel into the ledgers. */
  setMessageReaders: (chatId: string, messageId: string, rows: MessageReceiptRow[]) => void
}

export const useMessageStore = create<MessageStore>()(
  immer((set, get) => ({
    messages: {},
    activeChatId: null,

    setActiveChatId: chatId => {
      const prevChatId = get().activeChatId

      set(state => {
        if (prevChatId && prevChatId !== chatId) {
          // keep only last 10 messages of previous chat (for quick switching)
          if (state.messages[prevChatId]) {
            state.messages[prevChatId] = state.messages[prevChatId].slice(-10)
          }

          // dispose contact name cache for old chat context
          useContactStore.getState().disposeCache()
        }
        state.activeChatId = chatId
        // Cap all other chats to prevent unbounded growth across session
        for (const cid of Object.keys(state.messages)) {
          if (cid !== chatId && state.messages[cid].length > MAX_MSGS_PER_CHAT) {
            state.messages[cid] = state.messages[cid].slice(-MAX_MSGS_PER_CHAT)
          }
        }
      })
    },

    setMessages: (chatId, messages) =>
      set(state => {
        state.messages[chatId] = messages
      }),

    addMessage: (chatId, message) =>
      set(state => {
        if (!state.messages[chatId]) state.messages[chatId] = []
        state.messages[chatId].push(message)
        if (state.messages[chatId].length > MAX_MSGS_PER_CHAT) {
          state.messages[chatId] = state.messages[chatId].slice(-MAX_MSGS_PER_CHAT)
        }
      }),

    prependMessages: (chatId, messages) =>
      set(state => {
        const existing = state.messages[chatId] || []
        state.messages[chatId] = [...messages, ...existing]
        if (state.messages[chatId].length > MAX_MSGS_PER_CHAT) {
          state.messages[chatId] = state.messages[chatId].slice(-MAX_MSGS_PER_CHAT)
        }
      }),

    updateMessage: (chatId, message) =>
      set(state => {
        if (!state.messages[chatId]) state.messages[chatId] = []

        const idx = state.messages[chatId].findIndex(m => m.Info?.ID === message.Info?.ID)

        if (idx >= 0) {
          state.messages[chatId][idx] = message
        } else {
          state.messages[chatId].push(message)
          if (state.messages[chatId].length > MAX_MSGS_PER_CHAT) {
            state.messages[chatId] = state.messages[chatId].slice(-MAX_MSGS_PER_CHAT)
          }
        }
      }),

    // Optimistically set/clear a sender's reaction on a message (empty emoji
    // removes it). One reaction per sender.
    addReactionToMessage: (chatId, messageId, emoji, senderId) =>
      set(state => {
        const msgs = state.messages[chatId]
        if (!msgs) return
        const idx = msgs.findIndex(m => m.Info?.ID === messageId)
        if (idx < 0) return
        const msg = msgs[idx]
        // Dedupe by the phone-number part so an optimistic reaction replaces a
        // previously-synced one from the same person (which carries a full JID).
        const uid = (s: string) => (s || "").split("@")[0].split(":")[0]
        const target = uid(senderId)
        const others = (msg.reactions || []).filter(r => uid(r.sender_id) !== target)
        msg.reactions = emoji
          ? [...others, { id: 0, message_id: messageId, sender_id: senderId, emoji }]
          : others
      }),

    trimOldMessages: (chatId, keepCount) =>
      set(state => {
        if (state.messages[chatId] && state.messages[chatId].length > keepCount) {
          state.messages[chatId] = state.messages[chatId].slice(-keepCount)
        }
      }),

    trimAllChats: () =>
      set(state => {
        for (const cid of Object.keys(state.messages)) {
          if (state.messages[cid].length > MAX_MSGS_PER_CHAT) {
            state.messages[cid] = state.messages[cid].slice(-MAX_MSGS_PER_CHAT)
          }
        }
      }),

    clearMessages: chatId =>
      set(state => {
        delete state.messages[chatId]
      }),

    addPendingMessage: (chatId, message) =>
      set(state => {
        if (!state.messages[chatId]) state.messages[chatId] = []
        state.messages[chatId].push(message)
        if (state.messages[chatId].length > MAX_MSGS_PER_CHAT) {
          state.messages[chatId] = state.messages[chatId].slice(-MAX_MSGS_PER_CHAT)
        }
      }),

    updatePendingMessageToSent: (chatId, tempId, message) =>
      set(state => {
        if (!state.messages[chatId]) return

        const idx = state.messages[chatId].findIndex(m => m.tempId === tempId)

        if (idx >= 0) {
          state.messages[chatId][idx] = message
        } else {
          // Fallback: If tempId not found, use updateMessage logic
          const existingIdx = state.messages[chatId].findIndex(m => m.Info?.ID === message.Info?.ID)
          if (existingIdx >= 0) {
            state.messages[chatId][existingIdx] = message
          } else {
            state.messages[chatId].push(message)
            if (state.messages[chatId].length > MAX_MSGS_PER_CHAT) {
              state.messages[chatId] = state.messages[chatId].slice(-MAX_MSGS_PER_CHAT)
            }
          }
        }
      }),

    // Legacy single-status path, kept for compatibility with any caller that
    // still uses it. The event bridge below uses applyReceipt instead.
    updateMessageReceipt: (chatId, messageId, status) =>
      set(state => {
        const msgs = state.messages[chatId]
        if (!msgs) return
        const idx = msgs.findIndex(m => m.Info?.ID === messageId)
        if (idx < 0) return
        msgs[idx] = { ...msgs[idx], receiptStatus: status }
      }),

    applyReceipt: (chatId, messageIDs, status, senderJID, myJID) =>
      set(state => {
        const msgs = state.messages[chatId]
        if (!msgs || !Array.isArray(messageIDs) || messageIDs.length === 0) return
        const sender = typeof senderJID === "string" ? senderJID : ""
        const mine = typeof myJID === "string" ? myJID : ""
        // A read ack from our own phone is a second-device sync, not a reader.
        const fromSelf =
          !!sender &&
          ((!!mine && (sender === mine || jidKey(sender) === jidKey(mine))) || isMe(sender))
        if (fromSelf) return

        const normalized = (status || "").toLowerCase()
        // Self-categories mean "our other device", never another reader — skip
        // regardless of which JID form the backend attached to the receipt.
        if (SELF_TYPES.has(normalized)) return
        const isRead = READ_RECEIPTS.has(normalized)
        const isDelivered = DELIVERED_RECEIPTS.has(normalized)
        if (!isRead && !isDelivered) return

        for (const id of messageIDs) {
          if (!id) continue
          const idx = msgs.findIndex(m => m?.Info?.ID === id)
          if (idx < 0) continue
          const msg = msgs[idx]
          // Only messages we sent can have readers.
          if (!msg?.Info?.IsFromMe) continue

          if (isRead) {
            if (sender) {
              if (!msg.readBy) msg.readBy = []
              if (!msg.readBy.some(j => jidKey(j) === jidKey(sender))) msg.readBy.push(sender)
            }
            msg.receiptStatus = "read"
          } else {
            if (sender) {
              if (!msg.deliveredTo) msg.deliveredTo = []
              if (!msg.deliveredTo.some(j => jidKey(j) === jidKey(sender))) {
                msg.deliveredTo.push(sender)
              }
            }
            // A later delivery ack must not drag a read message back to gray.
            if (!READ_RECEIPTS.has((msg.receiptStatus ?? "").toLowerCase())) {
              msg.receiptStatus = "delivered"
            }
          }
        }
      }),

    setMessageReaders: (chatId, messageId, rows) =>
      set(state => {
        const msgs = state.messages[chatId]
        if (!msgs || !Array.isArray(rows)) return
        const idx = msgs.findIndex(m => m?.Info?.ID === messageId)
        if (idx < 0) return
        const msg = msgs[idx]
        if (!msg?.Info?.IsFromMe) return

        for (const row of rows) {
          if (!row?.jid || isMe(row.jid)) continue
          const type = (row.status || "").toLowerCase()
          if (SELF_TYPES.has(type)) continue
          if (READ_RECEIPTS.has(type)) {
            if (!msg.readBy) msg.readBy = []
            if (!msg.readBy.some(j => jidKey(j) === jidKey(row.jid))) msg.readBy.push(row.jid)
          } else if (DELIVERED_RECEIPTS.has(type)) {
            if (!msg.deliveredTo) msg.deliveredTo = []
            if (!msg.deliveredTo.some(j => jidKey(j) === jidKey(row.jid))) {
              msg.deliveredTo.push(row.jid)
            }
          }
        }
      }),
  })),
)
