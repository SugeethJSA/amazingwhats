import { useEffect } from "react"
import { EventsOn } from "../lib/wailsRuntime"
import { htmlToPlainText, phoneFromJID, sanitizeHtml } from "../lib/utils"
import type { ChatItem } from "../store/types"
import { useMessageStore } from "../store/useMessageStore"
import { useUIStore } from "../store/useUIStore"
import { useChatStore } from "../store/useChatStore"
import { useMuteStore } from "../store/useMuteStore"

interface NotificationChatPayload {
  chatJid?: string
  name?: string
  avatar?: string
}

interface NotificationReplyPayload extends NotificationChatPayload {
  messageId?: string
  senderJid?: string
  text?: string
}

/** Payload of `wa:group_joined`. Every string is untrusted. */
interface GroupJoinedPayload {
  jid?: string
  name?: string
  topic?: string
  /** Groups have no picture in the join event; accept one defensively. */
  picture?: string
  avatar?: string
}

/** Strip markup and control characters from an untrusted display name. */
function safeDisplayName(value: unknown): string {
  if (typeof value !== "string") return ""
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}

/**
 * Backend avatars are data:image URLs or https profile-photo URLs. Anything
 * else (a raw filesystem path or a JID) is dropped so it can never reach an
 * <img src>; the chat row falls back to its generated avatar colour.
 */
function safeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const url = value.trim()
  if (/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/i.test(url)) return url
  if (/^https?:\/\/[^\s"'<>]+$/i.test(url)) return url
  return undefined
}

/** JIDs are store keys / RPC arguments, never display text. Reject paths and whitespace. */
function safeJid(value: unknown): string {
  if (typeof value !== "string") return ""
  const jid = value.trim()
  return jid.length <= 256 && /^[A-Za-z0-9._@-]+@[A-Za-z0-9.-]+$/.test(jid) ? jid : ""
}

/** Message ids are quoted only by id; keep them to a simple, bounded shape. */
function safeId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const id = value.trim()
  return /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : undefined
}

/** Sanitize untrusted notification text, then flatten it for a textarea. */
function notificationText(value: unknown): string {
  if (typeof value !== "string") return ""
  const clean = sanitizeHtml(value)
  if (typeof document === "undefined") return clean.slice(0, 4000)
  return htmlToPlainText(clean).slice(0, 4000)
}

/**
 * Shared handler for both `wa:open_chat` and `wa:notification_reply`.
 * `reply` is supplied only by the latter; state is always read via getState()
 * because these listeners are registered once and must not see stale closures.
 */
function handleNotificationChatOpen(
  payload: NotificationChatPayload | null | undefined,
  reply?: NotificationReplyPayload | null,
) {
  if (!payload || typeof payload !== "object") return

  const ui = useUIStore.getState()
  // Pairing/login has no chat session to open into. Drop the action by design
  // rather than queueing it across a login the user may abandon.
  if (ui.screen === "login") return

  const chatStore = useChatStore.getState()
  const rawJid = typeof payload.chatJid === "string" ? payload.chatJid.trim() : ""
  // An already-loaded chat is trusted by definition; an unknown id must look
  // like a JID (no path separators, no whitespace, bounded length).
  const chatJid = chatStore.getChat(rawJid) ? rawJid : safeJid(rawJid)
  if (!chatJid) return

  if (ui.screen === "settings") ui.setScreen("chats")

  const existing = chatStore.getChat(chatJid)
  const chat: ChatItem = existing ?? {
    id: chatJid,
    name: safeDisplayName(payload.name) || phoneFromJID(chatJid) || chatJid.split("@")[0] || "Chat",
    subtitle: "",
    type: chatJid.endsWith("@g.us") ? "group" : "contact",
    avatar: safeAvatarUrl(payload.avatar),
  }

  chatStore.selectChat(chat)
  chatStore.clearUnreadCount(chatJid)

  if (!reply || typeof reply !== "object") return
  // Store the intent for ChatDetail. It is keyed by selectedChatId, so its
  // [chatId] effects do not rerun when the notification targets the chat that
  // is already open — this field is the change it can observe.
  ui.setPendingNotificationReply({
    chatJid,
    messageId: safeId(reply.messageId),
    senderJid: safeJid(reply.senderJid) || undefined,
    name: safeDisplayName(reply.name) || undefined,
    avatar: safeAvatarUrl(reply.avatar),
    text: notificationText(reply.text),
  })
}

/**
 * A group joined on this or another device. The UI shows a first-party toast
 * and opens the group; ChatScreen consumes `pendingGroupJoin` because it owns
 * the sidebar view (Status / Communities / Channels) locally.
 */
function handleGroupJoined(payload: GroupJoinedPayload | null | undefined) {
  if (!payload || typeof payload !== "object") return

  const ui = useUIStore.getState()
  // Pairing/login has no session to open a group into. Drop the event by
  // design rather than queueing it across a login the user may abandon.
  if (ui.screen === "login") return

  const chatStore = useChatStore.getState()
  const rawJid = typeof payload.jid === "string" ? payload.jid.trim() : ""
  // An already-loaded chat is trusted by definition; an unknown id must look
  // like a JID (no path separators, no whitespace, bounded length). The JID is
  // only ever a store key — it is never used as display text.
  const jid = chatStore.getChat(rawJid) ? rawJid : safeJid(rawJid)
  if (!jid) return

  const name = safeDisplayName(payload.name)
  ui.addNotification(name ? `Joined ${name}` : "Joined a group", { tone: "success" })

  if (ui.screen === "settings") ui.setScreen("chats")

  const existing = chatStore.getChat(jid)
  const chat: ChatItem = existing ?? {
    id: jid,
    name: name || "Group",
    subtitle: "",
    type: jid.endsWith("@g.us") ? "group" : "contact",
    avatar: safeAvatarUrl(payload.picture ?? payload.avatar),
  }

  chatStore.selectChat(chat)
  chatStore.clearUnreadCount(jid)
  ui.setPendingGroupJoin({
    chatJid: jid,
    name: name || undefined,
    avatar: chat.avatar,
  })
}

export function useWailsEvents() {
  const addNotification = useUIStore(s => s.addNotification)

  useEffect(() => {
    // 1. Message Read / Receipt Events
    const unsubReceipt = EventsOn(
      "wa:message_receipt",
      (data: { chatId: string; status: string; messageIDs?: string[]; messageID?: string }) => {
        if (!data?.chatId || !data?.status) return
        // The backend's events.Receipt carries every acked id in MessageIDs
        // (serialized as a string array). Older emitters sent a single
        // messageID, so keep that path working too.
        const ids = Array.isArray(data.messageIDs)
          ? data.messageIDs
          : data.messageID
            ? [data.messageID]
            : []
        if (ids.length === 0) return
        const { updateMessageReceipt } = useMessageStore.getState()
        for (const id of ids) {
          if (id) updateMessageReceipt(data.chatId, id, data.status)
        }
      },
    )

    // 2. Chat Typing / Presence Events
    const unsubChatPresence = EventsOn(
      "wa:chat_presence",
      (data: { chatId: string; state: string; media?: string }) => {
        if (!data?.chatId) return
        const isTyping = data.state === "composing" || data.state === "recording"
        useUIStore.getState().setTypingIndicator(data.chatId, isTyping)
      },
    )

    // 3. User Online / Offline Presence Events
    const unsubPresence = EventsOn(
      "wa:presence",
      (data: {
        jid?: string
        unavailable?: boolean
        lastSeen?: number
        sender?: string
        status?: string
      }) => {
        // Backend emits { jid, unavailable, lastSeen } from events.Presence;
        // legacy payloads used { sender, status: "available" }.
        const jid = data?.jid || data?.sender
        if (!jid) return
        const isOnline =
          typeof data.unavailable === "boolean" ? !data.unavailable : data.status === "available"
        useUIStore.getState().setOnlineStatus(jid, isOnline)
      },
    )

    // 4. Mute State Updates
    const unsubMuteUpdate = EventsOn(
      "wa:chat_mute_update",
      (data: { chatId: string; muted: boolean }) => {
        if (!data?.chatId) return
        useMuteStore.getState().setMuted(data.chatId, !!data.muted)
      },
    )

    // 5. Poll Vote Events
    const unsubPollVote = EventsOn("wa:poll_vote_submitted", (data: { chatId: string }) => {
      if (data?.chatId) {
        // This event is emitted only for our own vote (SendPollVote) and has
        // no sender field, so the chat-list preview must read "You".
        useChatStore
          .getState()
          .updateChatLastMessage(
            data.chatId,
            "Vote submitted",
            Math.floor(Date.now() / 1000),
            "You",
            true,
          )
      }
    })

    // 6. Newsletter / Channel Activity Events
    const unsubNewsletterJoined = EventsOn("wa:newsletter_joined", (channelId: string) => {
      addNotification(`Joined channel: ${channelId.split("@")[0]}`)
      useChatStore.getState().resortChats()
    })

    const unsubNewsletterLeft = EventsOn("wa:newsletter_left", (channelId: string) => {
      addNotification(`Left channel: ${channelId.split("@")[0]}`)
      useChatStore.getState().resortChats()
    })

    const unsubNewsletterUpdate = EventsOn(
      "wa:newsletter_update",
      (data: { jid?: string; channelId?: string; name?: string }) => {
        // NewsletterLiveUpdate emits only { jid }; older payloads used
        // { channelId }. There is no name in the event, so don't gate on it.
        // If a name is supplied, apply it locally and re-sort. The backend
        // pairs this event with wa:chat_list_refresh so authoritative metadata
        // (including the name) is refreshed too.
        const channelId = data?.jid || data?.channelId
        if (!channelId) return
        if (data?.name) {
          useChatStore.getState().updateSingleChat(channelId, { name: data.name })
        }
        useChatStore.getState().resortChats()
      },
    )

    // 7. Label Events
    const unsubLabelChat = EventsOn(
      "wa:label_chat",
      (data: { jid?: string; labelId?: string; chatId?: string; labeled?: boolean }) => {
        // Backend emits { jid, labelId }; older payloads used { chatId, labeled }.
        const chatId = data?.jid || data?.chatId
        if (!chatId) return
        const labeled = data?.labeled ?? !!data?.labelId
        // Labels stay backend-managed and ChatItem has no label field, so no
        // label state is fabricated here. Touch the labeled chat in place;
        // remote label changes are otherwise reflected via chat_list_refresh.
        if (labeled) useChatStore.getState().updateSingleChat(chatId, {})
      },
    )

    // 8. Desktop notification actions (open chat / quick reply). The backend
    //    emits these from the notification action callback with untrusted
    //    strings, so handleNotificationChatOpen sanitizes every display value.
    const unsubOpenChat = EventsOn("wa:open_chat", (data: NotificationChatPayload) => {
      handleNotificationChatOpen(data)
    })

    const unsubNotificationReply = EventsOn(
      "wa:notification_reply",
      (data: NotificationReplyPayload) => {
        handleNotificationChatOpen(data, data)
      },
    )

    // 9. Group joins (this or another device): toast + open the group. The
    //    backend payload is untrusted, so handleGroupJoined sanitizes it.
    const unsubGroupJoined = EventsOn("wa:group_joined", (data: GroupJoinedPayload) => {
      handleGroupJoined(data)
    })

    return () => {
      unsubReceipt()
      unsubChatPresence()
      unsubPresence()
      unsubMuteUpdate()
      unsubPollVote()
      unsubNewsletterJoined()
      unsubNewsletterLeft()
      unsubNewsletterUpdate()
      unsubLabelChat()
      unsubOpenChat()
      unsubNotificationReply()
      unsubGroupJoined()
    }
  }, [addNotification])
}
