import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import {
  SendMessage,
  FetchMessagesPaged,
  FetchNewsletterHistory,
  GetPinnedMessages,
  SendChatPresence,
  GetGroupInfo,
  GetProfile,
  MarkRead,
  SubscribeContactPresence,
  MakeCall,
  MakeGroupCall,
  StarMessage,
  RequestHistorySync,
} from "../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { addScheduledMessage, startScheduledSender } from "../lib/scheduledMessages"
import * as store from "../../bindings/github.com/lugvitc/amazingwhats/internal/store/models.js"
import { EventsOn } from "../lib/wailsRuntime"
import { useMessageStore, useUIStore, useChatStore } from "../store"
import { useChatById } from "../store/useChatStore"
import { useAppSettingsStore } from "../store/useAppSettingsStore"
import { useContactStore } from "../store/useContactStore"
import { MessageList, type MessageListHandle } from "../components/chat/MessageList"
import { preloadImages, visibleImageIDs } from "../components/chat/MediaContent"
import { ChatHeader } from "../components/chat/ChatHeader"
import { PinnedMessageBanner } from "../components/chat/PinnedMessageBanner"
import { BackfillProgress, type BackfillIndicatorState } from "../components/chat/BackfillProgress"
import { ChatInput } from "../components/chat/ChatInput"
import { ChatInfo } from "../components/chat/ChatInfo"
import { useAnnouncementIdentity } from "../components/chat/AnnouncementAvatar"
import { ForwardDialog } from "../components/chat/ForwardDialog"
import { ContactActionSheet } from "../components/chat/ContactActionSheet"
import { useContactActions } from "../hooks/useContactActions"
import { registerShortcut } from "../lib/shortcuts"
import type { ChatItem, Message } from "../store/types"
import { roleKeysFor, useMemberRoleStore } from "../components/chat/MessageItem"
import type { MemberRole, MemberRoleIndex } from "../components/chat/MessageItem"
import clsx from "clsx"
import { formatPhone, phoneFromJID } from "../lib/utils"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { getEase } from "../store/useEaseStore"

interface ChatDetailProps {
  chatId: string
  chatName: string
  chatAvatar?: string
  onBack?: () => void
}

const PAGE_SIZE = 50

// Structural mirror of the generated api/models.ts NewsletterHistoryEntry.
// Declared here so regenerated bindings never need a hand edit.
type NewsletterHistoryEntry = {
  server_id: number
  message: store.DecodedMessage
}

// Virtuoso needs a stable, large starting index so it can decrement as older
// messages are prepended, keeping the scroll position anchored.
const START_INDEX = 1_000_000

// Stable empty list so the mark-read effect does not re-run on every render.
const EMPTY_MESSAGES: Message[] = []

/**
 * Build the sender-role index from one GetGroupInfo response. Each identity
 * contributes an exact JID key and, only when long enough, a digits fallback
 * key — so a short phone value cannot collide with an unrelated sender.
 * "owner" comes only from group_owner, "admin" only from is_admin; an
 * unconfirmed member gets no entry at all.
 */
function buildParticipantRoles(groupInfo: {
  group_owner?: { jid?: string; phno?: string } | null
  group_participants?: Array<{
    contact?: { jid?: string; phno?: string } | null
    is_admin?: boolean
    action_jid?: string
  }> | null
}): MemberRoleIndex {
  const ownerKeys = new Set(
    [groupInfo.group_owner?.jid, groupInfo.group_owner?.phno].flatMap(value => roleKeysFor(value)),
  )
  const roles: MemberRoleIndex = {}
  for (const participant of groupInfo.group_participants ?? []) {
    const keys = [
      ...roleKeysFor(participant.contact?.jid),
      ...roleKeysFor(participant.contact?.phno),
      ...roleKeysFor(participant.action_jid),
    ]
    if (keys.length === 0) continue
    // Ownership is a fact from group_owner; adminship is a fact from is_admin.
    // Owner wins when a participant is both; nothing else is labelled.
    const role: MemberRole | undefined = keys.some(key => ownerKeys.has(key))
      ? "owner"
      : participant.is_admin
        ? "admin"
        : undefined
    if (!role) continue
    for (const key of keys) roles[key] = role
  }
  return roles
}

type SendPayload = {
  type: string
  text?: string
  base64Data?: string
  mimetype?: string
  fileName?: string
  quotedMessageId?: string
  mentions?: string[]
  /** WhatsApp non-JID @all mention (ContextInfo.nonJIDMentions = 1). */
  mentionAll?: boolean
  gifPlayback?: boolean
  /** Push-to-talk metadata from a real microphone recording. */
  ptt?: boolean
  seconds?: number
  clientTempId?: string
}

interface FailedSend {
  tempId: string
  payload: SendPayload | null
  optimistic: Message
  preview: string
  notificationId: number
}

/** Terminal outcome of a per-chat ON_DEMAND history backfill. */
type BackfillResult = "loaded" | "exhausted" | "failed"

function messagePreview(message: Message): string {
  const content = message.Content
  const text =
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    content?.documentMessage?.fileName ||
    ""
  if (text) return text.replace(/<[^>]*>/g, "").trim()
  if (content?.imageMessage) return "Photo"
  if (content?.videoMessage) return "Video"
  if (content?.audioMessage) return "Audio"
  if (content?.documentMessage) return "Document"
  return "Message"
}

// "Reply privately" quotes a message from the group the user is currently in,
// then switches to a 1:1 chat with that sender. The message is staged here and
// consumed by the newly-mounted ChatDetail (keyed by chatId).
let pendingReplyMessage: Message | null = null
const takePendingReply = (): Message | null => {
  const msg = pendingReplyMessage
  pendingReplyMessage = null
  return msg
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// WhatsApp Web's mention picker offers a non-JID "@all" entry in groups.
// It is encoded as ContextInfo.nonJIDMentions = 1, not a MentionedJID.
const MENTION_ALL_CONTACT = {
  jid: "@all",
  raw_jid: "@all",
  phno: "all",
  full_name: "all",
  isAll: true,
}

export function ChatDetail({ chatId, chatName, chatAvatar, onBack }: ChatDetailProps) {
  // Narrow selectors: a presence/typing event (or a new message) in another
  // chat must not re-render this conversation. Action selectors are stable.
  const messages = useMessageStore(s => s.messages[chatId])
  const setMessages = useMessageStore(s => s.setMessages)
  const updateMessage = useMessageStore(s => s.updateMessage)
  const prependMessages = useMessageStore(s => s.prependMessages)
  const setActiveChatId = useMessageStore(s => s.setActiveChatId)
  const addPendingMessage = useMessageStore(s => s.addPendingMessage)
  const updatePendingMessageToSent = useMessageStore(s => s.updatePendingMessageToSent)

  const setTypingIndicator = useUIStore(s => s.setTypingIndicator)
  const showEmojiPicker = useUIStore(s => s.showEmojiPicker)
  const setShowEmojiPicker = useUIStore(s => s.setShowEmojiPicker)
  const chatInfoOpen = useUIStore(s => s.chatInfoOpen)
  const setChatInfoOpen = useUIStore(s => s.setChatInfoOpen)
  const typingIndicator = useUIStore(s => s.typingIndicators[chatId])
  const addNotification = useUIStore(s => s.addNotification)
  const removeNotification = useUIStore(s => s.removeNotification)
  const screen = useUIStore(s => s.screen)
  const focusMessageId = useUIStore(s => s.focusMessageId)
  const setFocusMessageId = useUIStore(s => s.setFocusMessageId)
  const pendingNotificationReply = useUIStore(s => s.pendingNotificationReply)
  const clearPendingNotificationReply = useUIStore(s => s.clearPendingNotificationReply)

  const enterIsSend = useAppSettingsStore(s => s.enterIsSend)
  const currentChat = useChatById(chatId)
  // One sheet for the whole conversation. Every callback from this hook is
  // stable, so memoized message rows never re-render because of it.
  const contactActions = useContactActions()

  const chatMessages = messages ?? EMPTY_MESSAGES
  const [inputText, setInputText] = useState("")
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFileType, setSelectedFileType] = useState<string>("")
  const [sendAsGif, setSendAsGif] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [forwardTarget, setForwardTarget] = useState<string | null>(null)
  const [failedSends, setFailedSends] = useState<FailedSend[]>([])
  const retrySendRef = useRef<(tempId: string) => void>(() => {})
  // Pairs PTT metadata with the currently staged file. A ref (not state) so
  // the send handler reads the value staged in the same tick as the file.
  const voiceMetaRef = useRef<{ ptt: boolean; seconds: number } | null>(null)
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)

  const [mentionableContacts, setMentionableContacts] = useState<any[]>([])
  const [selectedMentions, setSelectedMentions] = useState<any[]>([])
  const [isAnnounceGroup, setIsAnnounceGroup] = useState(false)
  const [canSend, setCanSend] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [backfillPending, setBackfillPending] = useState(false)
  // Null until the first `chunk` arrives: an indeterminate bar with no count
  // is more honest than a fabricated zero. The backend supplies an accumulated
  // stored count, never a total, so no percentage is derived from it.
  const [backfillStored, setBackfillStored] = useState<number | null>(null)
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)
  const [isReady, setIsReady] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX)

  // Single view model for the indicator: live while pending, one brief terminal
  // status afterwards, then idle. This is what guarantees the "Asking..." text
  // is replaced rather than left behind when the backfill finishes.
  const backfillIndicator: BackfillIndicatorState = backfillPending
    ? { kind: "running", stored: backfillStored }
    : backfillResult
      ? { kind: backfillResult }
      : { kind: "idle" }

  // One source of truth for the scroll-to-latest affordance: GSAP, keyboard
  // tab order and visibility all follow it, so a faded-out button cannot stay
  // focusable or clickable.
  const scrollButtonVisible = !isAtBottom && isReady && !loadError

  const messageListRef = useRef<MessageListHandle>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const scrollButtonRef = useRef<HTMLButtonElement>(null)
  const sentMediaCache = useRef<Map<string, string>>(new Map())
  const isComposingRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const loadMorePromiseRef = useRef<Promise<Message[]> | null>(null)
  // Oldest (smallest) server cursor seen for the current newsletter chat.
  const newsletterCursorRef = useRef(0)
  const initialLoadPromiseRef = useRef<Promise<void> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusRequestRef = useRef<string | null>(null)
  // Owns the short-lived terminal status; cleared on chat change/unmount and
  // whenever a new backfill starts so an old timer cannot blank a new run.
  const backfillStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const easeShowRef = useRef(getEase("DropDown", "open"))
  const easeHideRef = useRef(getEase("DropDown", "close"))

  const chatType = currentChat?.type || "contact"
  // Community announcement detection is shared by the header and info panel:
  // parent_jid from GetGroupInfo, then announcement.jid === chatId.
  const announcement = useAnnouncementIdentity(chatId, chatType)
  const isNewsletter = chatId.endsWith("@newsletter")
  const [chatSubtitle, setChatSubtitle] = useState("")
  const [pinnedMessages, setPinnedMessages] = useState<store.PinnedMessage[]>([])

  const loadPinned = useCallback(async () => {
    try {
      const pins = await GetPinnedMessages(chatId)
      setPinnedMessages(pins || [])
    } catch (err) {
      console.error("Failed to load pinned messages:", err)
      setPinnedMessages([])
    }
  }, [chatId])

  useEffect(() => {
    loadPinned()
    const unsub = EventsOn("wa:pinned_update", (data: { chatId: string }) => {
      if (data?.chatId === chatId) loadPinned()
    })
    return unsub
  }, [chatId, loadPinned])

  const pinnedIds = useMemo(() => new Set(pinnedMessages.map(p => p.message_id)), [pinnedMessages])

  useEffect(() => {
    setChatSubtitle("")
    setIsAnnounceGroup(false)
    setCanSend(true)
    const loadMentionableContacts = async () => {
      if (chatType === "group") {
        try {
          const groupInfo = await GetGroupInfo(chatId)

          setIsAnnounceGroup(!!groupInfo.is_group_announce)

          // Keep the group roster (JIDs only, never display text) in the chat
          // store. Message ticks use it to prove that *every* peer has read a
          // group message before showing blue; without it they stay gray.
          const participantJIDs: string[] = []
          for (const p of groupInfo.group_participants ?? []) {
            const contact = (p as any)?.contact
            if (typeof contact?.jid === "string" && contact.jid) {
              participantJIDs.push(contact.jid)
            }
            if (contact?.phno) {
              participantJIDs.push(`${String(contact.phno).replace(/\D/g, "")}@s.whatsapp.net`)
            }
          }
          // Member roles come from the same group-info response: group_owner
          // plus is_admin and each participant's canonical action_jid. Keep a
          // PN/LID-keyed index in the dedicated role cache so message rows can
          // show an honest "Owner"/"Admin" tag without a per-row RPC.
          useChatStore.getState().updateSingleChat(chatId, { participantJIDs })
          useMemberRoleStore.getState().setRoles(chatId, buildParticipantRoles(groupInfo))

          // WhatsApp-style participants line under the group name:
          // "You, Alice, ~ Bob, +91 98765 43210, …"
          const participantLabel = (c: any) =>
            c.full_name ||
            (c.push_name ? `~ ${c.push_name}` : "") ||
            c.short ||
            (c.phno ? formatPhone(c.phno) : "")
          try {
            const self = await GetProfile("")
            const currentUserParticipant = groupInfo.group_participants?.find(
              (p: any) => p.contact && (p.contact.jid === self.jid || p.contact.phno === self.phno),
            )
            const isAdmin = !!currentUserParticipant?.is_admin
            setCanSend(!groupInfo.is_group_announce || isAdmin)
            const others = groupInfo.group_participants
              .map((p: any) => p.contact)
              .filter((c: any) => c && c.phno !== self.phno && c.jid !== self.jid)
            setChatSubtitle(["You", ...others.map(participantLabel).filter(Boolean)].join(", "))
            setMentionableContacts([...others, MENTION_ALL_CONTACT])
          } catch (err) {
            setCanSend(true)
            const contacts = groupInfo.group_participants.map((p: any) => p.contact)
            setChatSubtitle(contacts.map(participantLabel).filter(Boolean).join(", "))
            setMentionableContacts([...contacts, MENTION_ALL_CONTACT])
          }
        } catch (error) {
          console.error("Failed to fetch group info:", error)
          setMentionableContacts([])
        }
      } else {
        setMentionableContacts([])
      }
    }
    loadMentionableContacts()
  }, [chatId, chatType])

  // On failure keep the last known roles rather than replacing them with a
  // guessed empty set.
  const refreshMemberRoles = useCallback(() => {
    GetGroupInfo(chatId)
      .then(info => {
        useMemberRoleStore.getState().setRoles(chatId, buildParticipantRoles(info))
      })
      .catch(() => {})
  }, [chatId])

  // Promote/demote actions from a message sender's contact sheet dispatch a
  // shared event. Refresh the index so sender tags never go stale.
  useEffect(() => {
    if (chatType !== "group") return
    const onGroupChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === chatId) refreshMemberRoles()
    }
    window.addEventListener("wa:contact-action-group-changed", onGroupChanged)
    return () => window.removeEventListener("wa:contact-action-group-changed", onGroupChanged)
  }, [chatId, chatType, refreshMemberRoles])

  // Actions taken from the Group Info panel reload that panel locally instead
  // of dispatching the shared event. Refresh once on close so history tags
  // catch up, without an extra fetch on every opening.
  const wasInfoOpenRef = useRef(false)
  useEffect(() => {
    if (chatType === "group" && wasInfoOpenRef.current && !chatInfoOpen) refreshMemberRoles()
    wasInfoOpenRef.current = chatInfoOpen
  }, [chatInfoOpen, chatType, refreshMemberRoles])

  // useContactActions calls the Group Info panel's local onGroupChanged
  // callback instead of dispatching the shared event, so tags would go stale
  // while that panel stays open. The backend pairs group mutations with a
  // payload-less wa:chat_list_refresh. Listen only while this group's panel is
  // open and debounce, so unrelated refreshes (new messages, polls, ...) can
  // never turn into a stream of GetGroupInfo calls.
  const roleRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (chatType !== "group" || !chatInfoOpen) return
    const unsub = EventsOn("wa:chat_list_refresh", () => {
      if (roleRefreshTimerRef.current) clearTimeout(roleRefreshTimerRef.current)
      roleRefreshTimerRef.current = setTimeout(() => {
        roleRefreshTimerRef.current = null
        refreshMemberRoles()
      }, 600)
    })
    return () => {
      unsub()
      if (roleRefreshTimerRef.current) {
        clearTimeout(roleRefreshTimerRef.current)
        roleRefreshTimerRef.current = null
      }
    }
  }, [chatType, chatInfoOpen, refreshMemberRoles])

  const scrollToBottom = useCallback((instant = false) => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToBottom(instant ? "auto" : "smooth")
    })
  }, [])

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom)
  }, [])

  // Focus the composer as soon as a chat is opened so the user can type
  // immediately (like WhatsApp).
  useEffect(() => {
    textareaRef.current?.focus()
  }, [chatId])

  // ESC: close overlays first (info panel, emoji picker, reply), then leave
  // the chat back to the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (chatInfoOpen) {
        setChatInfoOpen(false)
        return
      }
      if (showEmojiPicker) {
        setShowEmojiPicker(false)
        return
      }
      if (replyingTo) {
        setReplyingTo(null)
        return
      }
      if (onBack) {
        onBack()
      } else {
        useChatStore.getState().selectChat(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [chatInfoOpen, showEmojiPicker, replyingTo, onBack, setChatInfoOpen, setShowEmojiPicker])

  // Pick up a staged quote from "Reply privately" (Alt+R in a group switches
  // to the sender's 1:1 chat with the group message quoted).
  useEffect(() => {
    const pending = takePendingReply()
    if (pending) setReplyingTo(pending)
  }, [chatId])

  // Desktop notification "Reply" actions land in a store-held intent. This
  // component is keyed by selectedChatId, so when the notification targets the
  // chat that is already open none of the [chatId] effects above rerun — the
  // intent is the change this instance observes. No message is sent here: the
  // user reviews the prefilled composer and presses Send.
  useEffect(() => {
    const intent = pendingNotificationReply
    if (!intent) return
    // Leave an intent for a different chat untouched. selectChat() from the
    // event handler mounts the destination ChatDetail, which consumes it.
    if (intent.chatJid !== chatId) return
    const { messageId, senderJid, name, text } = intent
    clearPendingNotificationReply()

    if (messageId) {
      // Backend quote lookup is chat-scoped. For a group, senderJid is just a
      // participant and the id still belongs to this chat. For a 1:1, a sender
      // from a clearly different chat means the id came from elsewhere, so omit
      // the quote instead of staging a reply we cannot resolve. A @lid sender
      // is an alternate identity for the same person, so it does not signal a
      // different source chat.
      const senderSignalsDifferentChat =
        !!senderJid &&
        !chatId.endsWith("@g.us") &&
        !senderJid.endsWith("@lid") &&
        senderJid !== chatId &&
        senderJid.split("@")[0] !== chatId.split("@")[0]
      if (!senderSignalsDifferentChat) {
        setReplyingTo({
          type: 0,
          reply_to_message_id: messageId,
          edited: false,
          forwarded: false,
          reactions: [],
          Info: {
            ID: messageId,
            Timestamp: "",
            IsFromMe: false,
            PushName: name || "",
            Sender: senderJid || "",
            Chat: chatId,
          },
          Content: {},
        })
      }
    }

    setInputText(text ?? "")
    // A settings → chats switch keeps this instance mounted, so the [chatId]
    // focus effect does not fire. Focus the composer explicitly.
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [pendingNotificationReply, chatId, clearPendingNotificationReply])

  // Global keyboard shortcuts that act on the open chat. Registered only while
  // the chats screen is visible (this component stays mounted underneath the
  // settings screen).
  useEffect(() => {
    if (screen !== "chats") return

    const unregs: Array<() => void> = []

    const lastMessage = (): Message | undefined => {
      const msgs = useMessageStore.getState().messages[chatId] || []
      return msgs.length ? msgs[msgs.length - 1] : undefined
    }

    const lastMessageText = (msg?: Message) => {
      return msg?.Content?.conversation || msg?.Content?.extendedTextMessage?.text || ""
    }

    unregs.push(
      registerShortcut("chat-info", () => setChatInfoOpen(true)),
      registerShortcut("emoji-panel", () => setShowEmojiPicker(true)),
      registerShortcut("reply", () => {
        const msg = lastMessage()
        if (!msg || !msg.Content) return
        if (lastMessageText(msg).startsWith("[system]")) return
        setReplyingTo(msg)
      }),
      registerShortcut("forward", () => {
        const msg = lastMessage()
        if (msg?.Info?.ID) setForwardTarget(msg.Info.ID)
      }),
      registerShortcut("star-last", () => {
        const msg = lastMessage()
        if (msg?.Info?.ID) {
          StarMessage(chatId, msg.Info.ID, true).catch(err => console.error("Star failed:", err))
        }
      }),
      // Quote the last own message and edit it in place (WhatsApp Ctrl+ArrowUp).
      registerShortcut("edit-last", () => {
        const msgs = useMessageStore.getState().messages[chatId] || []
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (!m.Info?.IsFromMe) continue
          const text = lastMessageText(m)
          if (!text || text.startsWith("[system]")) continue
          window.dispatchEvent(new CustomEvent("wa:edit-message", { detail: m.Info.ID }))
          break
        }
      }),
      // Group messages only: jump to a 1:1 with the sender, quoting their post.
      registerShortcut("reply-private", () => {
        const msg = lastMessage()
        if (!msg || msg.Info?.IsFromMe) return
        const senderJid = msg.Info?.Sender
        if (!senderJid || senderJid === chatId) return
        const contact = useContactStore.getState().contacts[senderJid]
        pendingReplyMessage = msg
        const chatItem: ChatItem = {
          id: senderJid,
          name:
            contact?.name ||
            msg.Info?.PushName ||
            phoneFromJID(senderJid) ||
            senderJid.split("@")[0],
          subtitle: "",
          type: "contact",
        }
        useChatStore.getState().selectChat(chatItem)
      }),
    )

    return () => unregs.forEach(unreg => unreg())
  }, [screen, chatId, setChatInfoOpen, setShowEmojiPicker])

  const loadInitialMessages = useCallback(
    async (generation: number) => {
      setInitialLoad(true)
      setIsReady(false)
      setLoadError(false)
      const beforeRequest = new Map(
        (useMessageStore.getState().messages[chatId] || []).map(message => [
          message.Info?.ID,
          message,
        ]),
      )
      try {
        const msgs = await FetchMessagesPaged(chatId, PAGE_SIZE, 0, "")
        if (requestGenerationRef.current !== generation) return
        const loadedMsgs = msgs || []

        // Do not let the initial database snapshot overwrite an optimistic or
        // live message that arrived while the request was in flight.
        const current = useMessageStore.getState().messages[chatId] || []
        const currentByID = new Map(current.map(message => [message.Info?.ID, message]))
        const loadedIDs = new Set(loadedMsgs.map(message => message.Info?.ID))
        const merged = loadedMsgs.map(message => {
          const currentMessage = currentByID.get(message.Info?.ID)
          return currentMessage && currentMessage !== beforeRequest.get(message.Info?.ID)
            ? currentMessage
            : message
        })
        for (const message of current) {
          const id = message.Info?.ID
          if (id && !loadedIDs.has(id) && (!beforeRequest.has(id) || message.isPending)) {
            merged.push(message)
          }
        }

        let finalMessages: Message[] = merged
        let more = loadedMsgs.length >= PAGE_SIZE

        if (isNewsletter) {
          // Older channel posts live on WhatsApp's server, not in local SQLite.
          // The server page is newest-first; the store expects oldest-first.
          try {
            const entries: NewsletterHistoryEntry[] =
              (await FetchNewsletterHistory(chatId, PAGE_SIZE, 0)) || []
            if (requestGenerationRef.current !== generation) return
            const serverMsgs: Message[] = entries.map(entry => entry.message).reverse()

            const lowestServerID = entries.reduce(
              (lowest, entry) => Math.min(lowest, entry.server_id),
              Number.POSITIVE_INFINITY,
            )
            if (Number.isFinite(lowestServerID)) {
              newsletterCursorRef.current = lowestServerID
            }

            const byID = new Map<string, Message>()
            const withoutID: Message[] = []
            for (const message of merged) {
              const id = message.Info?.ID
              if (id) byID.set(id, message)
              else withoutID.push(message)
            }
            for (const message of serverMsgs) {
              const id = message.Info?.ID
              if (!id) {
                withoutID.push(message)
                continue
              }
              const existing = byID.get(id)
              if (!existing) {
                byID.set(id, message)
                continue
              }
              // Same ID: prefer the copy with the newer timestamp; on a tie
              // keep the local copy (it may carry optimistic-only state).
              if (
                new Date(message.Info.Timestamp).getTime() >
                new Date(existing.Info.Timestamp).getTime()
              ) {
                byID.set(id, message)
              }
            }
            // A live/optimistic message can land while the server call is in
            // flight; keep it instead of dropping it with the earlier snapshot.
            const liveNow = useMessageStore.getState().messages[chatId] || []
            for (const message of liveNow) {
              const id = message.Info?.ID
              if (id && !byID.has(id) && (!beforeRequest.has(id) || message.isPending)) {
                byID.set(id, message)
              }
            }

            finalMessages = [...byID.values(), ...withoutID].sort((a, b) => {
              const timeDiff =
                new Date(a.Info.Timestamp).getTime() - new Date(b.Info.Timestamp).getTime()
              if (timeDiff !== 0) return timeDiff
              return (a.Info?.ID || "").localeCompare(b.Info?.ID || "")
            })
            more = entries.length >= PAGE_SIZE
          } catch (err) {
            if (requestGenerationRef.current !== generation) return
            console.error("Newsletter history load failed:", err)
            addNotification("Couldn't load channel history", {
              tone: "error",
              durationMs: 5000,
            })
            // Keep the local-only merged list instead of blanking the channel.
            // Disable further paging: the local cursor cannot reach old posts.
            more = false
          }
        }

        setMessages(chatId, finalMessages)
        preloadImages(visibleImageIDs(finalMessages))
        hasMoreRef.current = more
        setHasMore(more)

        requestAnimationFrame(() => {
          if (requestGenerationRef.current !== generation) return
          setIsReady(true)
          setInitialLoad(false)
        })
      } catch (err) {
        if (requestGenerationRef.current !== generation) return
        console.error("Initial load failed:", err)
        setInitialLoad(false)
        setLoadError(true)
        // This is terminal for the attempt: stop the spinner and uncover the
        // panel so the error state and the composer stay reachable.
        setIsReady(true)
      }
    },
    [chatId, isNewsletter, setMessages, addNotification],
  )

  const retryInitialLoad = useCallback(() => {
    const generation = requestGenerationRef.current
    const request = loadInitialMessages(generation)
    initialLoadPromiseRef.current = request
    void request.finally(() => {
      if (initialLoadPromiseRef.current === request) initialLoadPromiseRef.current = null
    })
  }, [loadInitialMessages])

  const loadMoreMessages = useCallback((): Promise<Message[]> => {
    if (loadMorePromiseRef.current) return loadMorePromiseRef.current
    if (!hasMoreRef.current || loadingMoreRef.current) return Promise.resolve([])

    const currentMessages = useMessageStore.getState().messages[chatId] || []
    if (currentMessages.length === 0) return Promise.resolve([])

    const generation = requestGenerationRef.current
    const oldestMessage = currentMessages[0]
    const beforeTimestamp = Math.floor(new Date(oldestMessage.Info.Timestamp).getTime() / 1000)
    loadingMoreRef.current = true
    setIsLoadingMore(true)

    const request = (async (): Promise<Message[]> => {
      try {
        if (isNewsletter) {
          // The local paged query cannot reach posts that only exist on the
          // newsletter server, so page by the server cursor instead.
          const entries: NewsletterHistoryEntry[] =
            (await FetchNewsletterHistory(chatId, PAGE_SIZE, newsletterCursorRef.current)) || []
          if (requestGenerationRef.current !== generation) return []

          const serverMsgs: Message[] = entries.map(entry => entry.message).reverse()
          const knownIDs = new Set(
            (useMessageStore.getState().messages[chatId] || []).map(m => m.Info?.ID),
          )
          const newMsgs = serverMsgs.filter(message => {
            const id = message.Info?.ID
            return !!id && !knownIDs.has(id)
          })

          const lowestServerID = entries.reduce(
            (lowest, entry) => Math.min(lowest, entry.server_id),
            Number.POSITIVE_INFINITY,
          )
          if (Number.isFinite(lowestServerID)) {
            newsletterCursorRef.current = lowestServerID
          }

          if (newMsgs.length > 0) {
            // Keep firstItemIndex and the prepended data in the same request
            // generation; a response from an abandoned chat cannot move this list.
            setFirstItemIndex(prev => prev - newMsgs.length)
            prependMessages(chatId, newMsgs)
          }
          // Use the deduped count: a duplicate-only page (e.g. an inclusive
          // server cursor) must not keep paging forever.
          const more = newMsgs.length >= PAGE_SIZE
          hasMoreRef.current = more
          setHasMore(more)
          return newMsgs
        }

        const msgs =
          (await FetchMessagesPaged(chatId, PAGE_SIZE, beforeTimestamp, oldestMessage.Info.ID)) ||
          []
        if (requestGenerationRef.current !== generation) return []

        if (msgs.length > 0) {
          // Keep firstItemIndex and the prepended data in the same request
          // generation; a response from an abandoned chat cannot move this list.
          setFirstItemIndex(prev => prev - msgs.length)
          prependMessages(chatId, msgs)
        }
        const more = msgs.length >= PAGE_SIZE
        hasMoreRef.current = more
        setHasMore(more)
        return msgs
      } catch (err) {
        if (requestGenerationRef.current === generation) {
          if (isNewsletter) {
            console.error("Newsletter history load more failed:", err)
            addNotification("Couldn't load older channel posts", { tone: "error" })
            return []
          }
          console.error("Load more failed:", err)
        }
        return []
      }
    })()

    loadMorePromiseRef.current = request
    void request.finally(() => {
      if (loadMorePromiseRef.current === request) loadMorePromiseRef.current = null
      if (requestGenerationRef.current === generation) {
        loadingMoreRef.current = false
        setIsLoadingMore(false)
      }
    })
    return request
  }, [chatId, isNewsletter, prependMessages, addNotification])

  // End the live indicator and leave one brief, honest status. Centralised so
  // both backend `done` events and a failed RequestHistorySync call behave the
  // same way — neither can leave stale "Asking..." text behind.
  const showBackfillResult = useCallback((result: BackfillResult) => {
    setBackfillPending(false)
    if (backfillStatusTimerRef.current) clearTimeout(backfillStatusTimerRef.current)
    setBackfillResult(result)
    backfillStatusTimerRef.current = setTimeout(() => {
      backfillStatusTimerRef.current = null
      setBackfillResult(null)
    }, 2600)
  }, [])

  // Per-chat backfill events are separate from the global startup sync strip.
  // `stored` is an accumulated count from the backend, never a total: the
  // indicator stays indeterminate and reports the count honestly.
  useEffect(() => {
    const unsub = EventsOn(
      "wa:history_backfill",
      (data: {
        chatJID?: string
        sessionID?: string
        phase?: string
        stored?: number
        exhausted?: boolean
        failed?: boolean
        done?: boolean
      }) => {
        if (data?.chatJID !== chatId) return

        const stored =
          typeof data.stored === "number" && Number.isFinite(data.stored) && data.stored >= 0
            ? data.stored
            : null
        const isDone = data.phase === "done" || data.done === true

        if (isDone) {
          // Terminal phase: stop the live indicator first, then show exactly
          // one honest status for a moment. Never leave "Asking..." on screen.
          showBackfillResult(data.failed ? "failed" : data.exhausted ? "exhausted" : "loaded")

          if (data.exhausted) {
            hasMoreRef.current = false
            setHasMore(false)
            return
          }
          if (data.failed) {
            addNotification("Couldn't load older messages from your phone. Try again.", {
              tone: "error",
            })
            return
          }
          // Normal completion/timeout: any rows that arrived are in the local
          // DB now, so pull them into the open list once more.
          void loadMoreMessages()
          return
        }

        if (data.phase === "started") {
          // A fresh run supersedes any stale terminal status and its timer.
          if (backfillStatusTimerRef.current) {
            clearTimeout(backfillStatusTimerRef.current)
            backfillStatusTimerRef.current = null
          }
          setBackfillResult(null)
          setBackfillStored(null)
          setBackfillPending(true)
          return
        }

        if (data.phase === "chunk") {
          setBackfillPending(true)
          // Guard against out-of-order chunks: the count only ever climbs.
          if (stored !== null) setBackfillStored(prev => Math.max(prev ?? 0, stored))
          // New older rows are in the local DB now; pull them into the open list.
          hasMoreRef.current = true
          setHasMore(true)
          void loadMoreMessages()
        }
      },
    )
    return () => unsub()
  }, [chatId, loadMoreMessages, addNotification, showBackfillResult])

  const requestOlderFromPhone = useCallback(async () => {
    if (backfillPending) return
    // A fresh click owns the top slot: clear any lingering terminal status.
    if (backfillStatusTimerRef.current) {
      clearTimeout(backfillStatusTimerRef.current)
      backfillStatusTimerRef.current = null
    }
    setBackfillResult(null)
    setBackfillStored(null)
    setBackfillPending(true)
    try {
      await RequestHistorySync(chatId, 50)
    } catch {
      showBackfillResult("failed")
      addNotification("Couldn't ask your phone for older messages. Try again.", { tone: "error" })
    }
  }, [chatId, backfillPending, addNotification, showBackfillResult])

  const handleQuotedClick = useCallback(
    async (messageId: string) => {
      const generation = requestGenerationRef.current
      if (initialLoadPromiseRef.current) await initialLoadPromiseRef.current
      if (requestGenerationRef.current !== generation) return
      let found = useMessageStore
        .getState()
        .messages[chatId]?.some(message => message.Info?.ID === messageId)

      // Pins and replies can point beyond the initial page. Load contiguous
      // older pages until the target is present or history is exhausted.
      while (!found && hasMoreRef.current && requestGenerationRef.current === generation) {
        const page = await loadMoreMessages()
        if (requestGenerationRef.current !== generation || page.length === 0) return
        found = page.some(message => message.Info?.ID === messageId)
      }
      if (!found || requestGenerationRef.current !== generation) return

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (requestGenerationRef.current !== generation) return
          if (!messageListRef.current?.scrollToMessage(messageId)) return
          setHighlightedMessageId(messageId)
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
          highlightTimerRef.current = setTimeout(() => {
            setHighlightedMessageId(null)
            highlightTimerRef.current = null
          }, 500)
        })
      })
    },
    [chatId, loadMoreMessages],
  )

  // Read receipts are only meaningful for persisted messages. An optimistic
  // bubble carries a temp-<ts>-<rand> ID that is not (yet) a database row;
  // sending it to MarkRead makes the backend resolve it and log a "no rows"
  // pair on every call. Keep the local payload for pending messages until the
  // wa:new_message reconciliation replaces the temp ID with the real one.
  // Our own messages are excluded too: acking them would mark *our* messages
  // as read by us and paint false blue ticks. Keying on the set of real IDs
  // (not the chatMessages array identity) also stops a burst of receipt /
  // presence updates from re-sending the same read receipts repeatedly.
  const readReceiptIds = useMemo(() => {
    const ids = chatMessages
      .filter((m: Message) => !m?.Info?.IsFromMe)
      .map((m: Message) => m?.Info?.ID)
      .filter((id): id is string => !!id && !id.startsWith("temp-"))
    return Array.from(new Set(ids))
  }, [chatMessages])
  const readReceiptKey = readReceiptIds.join("\u0000")

  useEffect(() => {
    if (!isAtBottom || readReceiptIds.length === 0) return
    MarkRead(chatId, readReceiptIds, "read-msg").catch(err => {
      console.error("Failed to mark messages as read:", err)
    })
    // readReceiptIds is rebuilt whenever chatMessages changes; the joined key
    // is the real dependency so object-only updates don't re-issue receipts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAtBottom, chatId, readReceiptKey])

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setInputText(newValue)
    if (selectedMentions.length > 0) {
      setSelectedMentions(prev =>
        prev.filter(mention => {
          let name = mention.full_name
          if (!name) {
            if (mention.push_name) {
              name = `~ ${mention.push_name}`
            } else {
              name = mention.short || mention.phno
            }
          }
          return newValue.includes(`@${name}`)
        }),
      )
    }

    if (!isComposingRef.current) {
      isComposingRef.current = true
      // Only notify the network. The peer indicator in the store is driven
      // exclusively by wa:chat_presence events, so our own typing can never
      // be mistaken for someone else typing.
      SendChatPresence(chatId, "composing", "").catch(() => {})
    }

    if (typingTimeout) clearTimeout(typingTimeout)
    const timeout = setTimeout(() => {
      isComposingRef.current = false
      SendChatPresence(chatId, "paused", "").catch(() => {})
    }, 1500)
    setTypingTimeout(timeout)
  }

  // A failed optimistic send must not linger as a pending bubble. Remove the
  // phantom bubble, keep an explicit failed record with a short human error and
  // a Retry action (through the shared notification contract), and show the
  // failed message inline next to the composer.
  const markSendFailed = useCallback(
    (tempId: string, payload: SendPayload | null, optimistic: Message) => {
      setMessages(
        chatId,
        (useMessageStore.getState().messages[chatId] || []).filter(m => m.tempId !== tempId),
      )
      const notificationId = addNotification("Message not sent", {
        tone: "error",
        ...(payload
          ? { action: { label: "Retry", onClick: () => retrySendRef.current(tempId) } }
          : {}),
      })
      setFailedSends(prev => [
        ...prev,
        { tempId, payload, optimistic, preview: messagePreview(optimistic), notificationId },
      ])
    },
    [chatId, setMessages, addNotification],
  )

  const transmit = useCallback(
    async (tempId: string, payload: SendPayload, optimistic: Message) => {
      try {
        await SendMessage(chatId, payload)
      } catch (err) {
        console.error("Failed to send:", err)
        markSendFailed(tempId, payload, optimistic)
      }
    },
    [chatId, markSendFailed],
  )

  const retrySend = useCallback(
    (tempId: string) => {
      const failed = failedSends.find(f => f.tempId === tempId)
      if (!failed?.payload) return
      removeNotification(failed.notificationId)
      setFailedSends(prev => prev.filter(f => f.tempId !== tempId))
      // Drop the failed optimistic bubble before re-adding it as pending.
      setMessages(
        chatId,
        (useMessageStore.getState().messages[chatId] || []).filter(m => m.tempId !== tempId),
      )
      const newTempId = `temp-${Date.now()}-${Math.random()}`
      const newPayload: SendPayload = { ...failed.payload, clientTempId: newTempId }
      const newOptimistic: Message = {
        ...failed.optimistic,
        tempId: newTempId,
        isPending: true,
        receiptStatus: undefined,
        Info: { ...failed.optimistic.Info, ID: newTempId },
      }
      addPendingMessage(chatId, newOptimistic)
      void transmit(newTempId, newPayload, newOptimistic)
    },
    [failedSends, removeNotification, setMessages, chatId, addPendingMessage, transmit],
  )
  retrySendRef.current = retrySend

  const dismissFailedSend = useCallback(
    (tempId: string) => {
      const failed = failedSends.find(f => f.tempId === tempId)
      if (failed) removeNotification(failed.notificationId)
      setFailedSends(prev => prev.filter(f => f.tempId !== tempId))
      setMessages(
        chatId,
        (useMessageStore.getState().messages[chatId] || []).filter(m => m.tempId !== tempId),
      )
    },
    [failedSends, removeNotification, setMessages, chatId],
  )

  // Scheduled messages use the same SendMessage binding; the ticker runs for
  // the lifetime of the page and dispatches items whose time has arrived.
  useEffect(() => {
    startScheduledSender((chat, payload) => SendMessage(chat, payload as never))
  }, [])

  const handleScheduleMessage = (sendAt: number) => {
    const text = inputText.trim()
    if (!text || pastedImage || selectedFile) return
    let processedText = text
    const mentionsToSend: string[] = []
    let mentionAll = false
    const sorted = [...selectedMentions].sort((a, b) => {
      const name = (m: any) => m.full_name || (m.push_name ? `~ ${m.push_name}` : m.short || m.phno)
      return name(b).length - name(a).length
    })
    for (const mention of sorted) {
      let name = mention.full_name
      if (!name) name = mention.push_name ? `~ ${mention.push_name}` : mention.short || mention.phno
      const token = `@${name}`
      if (processedText.includes(token)) {
        // @all is a non-JID mention: keep the literal token and set the flag.
        if (mention.jid === "@all") {
          mentionAll = true
        } else {
          processedText = processedText.replaceAll(token, `@${mention.jid.split("@")[0]}`)
          mentionsToSend.push(mention.jid)
        }
      }
    }
    addScheduledMessage(
      chatId,
      {
        type: "text",
        text: processedText,
        quotedMessageId: replyingTo?.Info.ID,
        mentions: mentionsToSend,
        mentionAll: mentionAll || undefined,
        clientTempId: `sched-${Date.now()}`,
      },
      sendAt,
    )
    setInputText("")
    setReplyingTo(null)
    setSelectedMentions([])
  }

  const handleSendMessage = async () => {
    if (!inputText.trim() && !pastedImage && !selectedFile) return

    const textToSend = inputText
    const imageToSend = pastedImage
    const fileToSend = selectedFile
    const fileTypeToSend = selectedFileType
    const voiceMeta = voiceMetaRef.current
    const quotedMessageId = replyingTo?.Info.ID

    // Generate a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}-${Math.random()}`

    // Create pending message
    const pendingMessage: any = {
      tempId,
      isPending: true,
      Info: {
        ID: tempId,
        IsFromMe: true,
        Timestamp: new Date().toISOString(),
        PushName: "You",
        Sender: "",
      },
      Content: {},
    }

    // Set content based on message type
    if (imageToSend) {
      pendingMessage.Content = {
        imageMessage: {
          caption: textToSend || "",
          mimetype: "image/png",
          _tempImage: imageToSend,
        },
      }
    } else if (fileToSend) {
      if (fileTypeToSend === "image") {
        pendingMessage.Content = {
          imageMessage: {
            caption: textToSend || "",
            mimetype: fileToSend.type,
            _tempFile: fileToSend,
          },
        }
      } else if (fileTypeToSend === "video" || fileTypeToSend === "gif") {
        const asGif = fileTypeToSend === "gif" || sendAsGif
        pendingMessage.Content = {
          videoMessage: {
            caption: textToSend || "",
            mimetype: fileToSend.type,
            gifPlayback: asGif,
            _tempFile: fileToSend,
          },
        }
      } else if (fileTypeToSend === "audio") {
        pendingMessage.Content = {
          audioMessage: {
            mimetype: fileToSend.type,
            _tempFile: fileToSend,
            ...(voiceMeta ? { ptt: true, seconds: voiceMeta.seconds } : {}),
          },
        }
      } else {
        pendingMessage.Content = {
          documentMessage: {
            caption: textToSend || "",
            fileName: fileToSend.name,
            mimetype: fileToSend.type,
          },
        }
      }
    } else {
      pendingMessage.Content = {
        conversation: textToSend,
      }
    }

    // Add quoted message if replying
    if (quotedMessageId && replyingTo) {
      const contextInfo = {
        quotedMessage: replyingTo.Content,
        participant: replyingTo.Info.Sender,
        stanzaId: replyingTo.Info.ID,
      }

      if (pendingMessage.Content.conversation) {
        pendingMessage.Content = {
          extendedTextMessage: {
            text: pendingMessage.Content.conversation,
            contextInfo,
          },
        }
        delete pendingMessage.Content.conversation
      } else if (pendingMessage.Content.imageMessage) {
        pendingMessage.Content.imageMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.videoMessage) {
        pendingMessage.Content.videoMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.audioMessage) {
        pendingMessage.Content.audioMessage.contextInfo = contextInfo
      } else if (pendingMessage.Content.documentMessage) {
        pendingMessage.Content.documentMessage.contextInfo = contextInfo
      }
    }

    // Add pending message to store immediately
    addPendingMessage(chatId, pendingMessage)

    // Clear input
    setInputText("")
    setPastedImage(null)
    setSelectedFile(null)
    voiceMetaRef.current = null
    setReplyingTo(null)
    setSelectedMentions([])

    // Virtuoso follows appended messages when already at the bottom. When the
    // sender is reading older history, explicitly take them to their new post.
    if (!isAtBottom) scrollToBottom(false)

    let processedText = textToSend
    const mentionsToSend: string[] = []
    let mentionAll = false
    if (selectedMentions.length > 0) {
      const sortedMentions = [...selectedMentions].sort((a, b) => {
        let nameA = a.full_name
        if (!nameA) nameA = a.push_name ? `~ ${a.push_name}` : a.short || a.phno

        let nameB = b.full_name
        if (!nameB) nameB = b.push_name ? `~ ${b.push_name}` : b.short || b.phno

        return nameB.length - nameA.length
      })

      for (const mention of sortedMentions) {
        let name = mention.full_name
        if (!name) {
          if (mention.push_name) {
            name = `~ ${mention.push_name}`
          } else {
            name = mention.short || mention.phno
          }
        }
        const mentionText = `@${name}`

        if (processedText.includes(mentionText)) {
          // @all is a non-JID mention: WhatsApp Web encodes it as
          // ContextInfo.nonJIDMentions = 1, never as a MentionedJID.
          if (mention.jid === "@all") {
            mentionAll = true
          } else {
            const userPart = mention.jid.split("@")[0]
            const replacement = `@${userPart}`

            processedText = processedText.replaceAll(mentionText, replacement)

            mentionsToSend.push(mention.jid)
          }
        }
      }
    }

    let payload: SendPayload | null = null
    try {
      if (imageToSend) {
        payload = {
          type: "image",
          clientTempId: tempId,
          base64Data: imageToSend.split(",")[1],
          mimetype: imageToSend.match(/^data:([^;,]+)/)?.[1] || "image/png",
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
          mentionAll: mentionAll || undefined,
        }
      } else if (fileToSend) {
        const dataURL = await blobToDataURL(fileToSend)
        const asGif = fileTypeToSend === "gif" || (fileTypeToSend === "video" && sendAsGif)
        const common = {
          clientTempId: tempId,
          base64Data: dataURL.split(",")[1],
          mimetype: fileToSend.type || "application/octet-stream",
          fileName: fileToSend.name,
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
          mentionAll: mentionAll || undefined,
        }
        // The backend has distinct image/video/audio/document branches. Sending
        // every File as "video" made PDFs and other documents arrive as video.
        if (fileTypeToSend === "image") {
          payload = { type: "image", ...common }
        } else if (fileTypeToSend === "video" || fileTypeToSend === "gif") {
          payload = { type: "video", ...common, gifPlayback: asGif }
        } else if (fileTypeToSend === "audio") {
          payload = {
            type: "audio",
            ...common,
            ...(voiceMeta ? { ptt: true, seconds: voiceMeta.seconds } : {}),
          }
        } else {
          payload = { type: "document", ...common }
        }
      } else {
        payload = {
          type: "text",
          clientTempId: tempId,
          text: processedText,
          quotedMessageId,
          mentions: mentionsToSend,
          mentionAll: mentionAll || undefined,
        }
      }
    } catch (err) {
      console.error("Failed to prepare message:", err)
    }

    if (payload) {
      await transmit(tempId, payload, pendingMessage)
    } else {
      markSendFailed(tempId, null, pendingMessage)
    }
  }

  // A finished recording enters the same file pipeline as a picked audio file;
  // only the PTT metadata differs. The File already carries the real MIME.
  const handleVoiceRecord = (file: File, seconds: number, _mime: string) => {
    voiceMetaRef.current = { ptt: true, seconds }
    // A staged voice note is the sole outgoing content: clear anything that
    // could win the send branch (text, pasted image, reply, scheduled draft).
    setPastedImage(null)
    setInputText("")
    setReplyingTo(null)
    setSelectedFile(file)
    setSelectedFileType("audio")
    setSendAsGif(false)
  }

  // Single staging path for every File that enters the composer (disk pickers,
  // pasted/dropped GIFs, and GIPHY downloads). Exact image/gif becomes a
  // gifPlayback message in handleSendMessage; no send code is duplicated.
  const stageSelectedFile = (file: File) => {
    voiceMetaRef.current = null
    setSelectedFile(file)
    setSendAsGif(false)
    const generalType = file.type.split("/")[0]
    setSelectedFileType(
      file.type.toLowerCase() === "image/gif"
        ? "gif"
        : generalType === "image" || generalType === "video" || generalType === "audio"
          ? generalType
          : "document",
    )
  }

  useEffect(() => {
    const generation = ++requestGenerationRef.current
    loadingMoreRef.current = false
    loadMorePromiseRef.current = null
    hasMoreRef.current = true
    newsletterCursorRef.current = 0
    setFirstItemIndex(START_INDEX)
    setHasMore(true)
    setIsLoadingMore(false)
    setIsAtBottom(true)
    // Backfill status is per-chat: never let one conversation's indicator or
    // brief result bleed into the next one.
    setBackfillPending(false)
    setBackfillStored(null)
    setBackfillResult(null)
    if (backfillStatusTimerRef.current) {
      clearTimeout(backfillStatusTimerRef.current)
      backfillStatusTimerRef.current = null
    }
    setActiveChatId(chatId)
    const initialRequest = loadInitialMessages(generation)
    initialLoadPromiseRef.current = initialRequest
    void initialRequest.finally(() => {
      if (initialLoadPromiseRef.current === initialRequest) initialLoadPromiseRef.current = null
    })
    return () => {
      if (requestGenerationRef.current === generation) requestGenerationRef.current++
      loadingMoreRef.current = false
      loadMorePromiseRef.current = null
      initialLoadPromiseRef.current = null
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      if (backfillStatusTimerRef.current) {
        clearTimeout(backfillStatusTimerRef.current)
        backfillStatusTimerRef.current = null
      }
    }
  }, [chatId, loadInitialMessages, setActiveChatId])

  // A search result sets a shared focus request, then switches to this chat.
  // Take it immediately so no other conversation can consume it, then reuse
  // the quote-click path to wait for history, paginate if needed, scroll and
  // highlight the target.
  useEffect(() => {
    if (!focusMessageId) return
    const target = focusMessageId
    const generation = requestGenerationRef.current
    focusRequestRef.current = target
    setFocusMessageId?.(null)

    void (async () => {
      await handleQuotedClick(target)
      // The generation check also covers unmount/chat change: a stale request
      // can never scroll or highlight in a conversation it wasn't meant for.
      if (requestGenerationRef.current !== generation) return
      if (focusRequestRef.current === target) focusRequestRef.current = null
    })()
  }, [focusMessageId, handleQuotedClick, setFocusMessageId])

  // On chat change or unmount, drop a request this instance still owns so a
  // stale message id can never highlight something in the next conversation.
  useEffect(() => {
    return () => {
      const owned = focusRequestRef.current
      focusRequestRef.current = null
      if (!owned) return
      const current = useUIStore.getState()
      if (current.focusMessageId === owned) {
        current.setFocusMessageId?.(null)
      }
    }
  }, [chatId])

  useEffect(() => {
    // New messages from events still use the old Message format for real-time updates
    // They will be compatible due to the Info and Content structure
    const unsub = EventsOn(
      "wa:new_message",
      (data: { chatId: string; message: Message; clientTempId?: string }) => {
        if (data?.chatId === chatId && data.message?.Info?.ID) {
          // Use getState to avoid depending on messages array and causing re-subscriptions
          const currentMessages = useMessageStore.getState().messages[chatId] || []
          const hasPendingMessage = currentMessages.some(m => m.isPending)

          if (hasPendingMessage && data.message.Info?.IsFromMe && data.clientTempId) {
            const pendingMessages = currentMessages.filter(m => m.isPending)
            const pending = pendingMessages.find(m => m.tempId === data.clientTempId)
            if (pending && pending.tempId) {
              for (const body of ["imageMessage", "videoMessage", "audioMessage"] as const) {
                const transient =
                  pending.Content?.[body]?._tempImage || pending.Content?.[body]?._tempFile
                if (transient && data.message.Content?.[body]) {
                  const content = data.message.Content[body]
                  if (transient instanceof File) content._tempFile = transient
                  else content._tempImage = transient
                }
              }
              updatePendingMessageToSent(data.chatId, pending.tempId, data.message)
            } else {
              updateMessage(data.chatId, data.message)
            }
          } else {
            updateMessage(data.chatId, data.message)
          }
        }
      },
    )

    return () => unsub()
  }, [chatId, updateMessage, updatePendingMessageToSent])

  // Durable in-chat info lines (e.g. a contact's security-code change) arrive
  // on their own event so they never increment unread counts or raise a toast.
  useEffect(() => {
    const unsub = EventsOn("wa:info_message", (data: { chatId: string; message: Message }) => {
      if (data?.chatId === chatId && data.message?.Info?.ID) {
        updateMessage(data.chatId, data.message)
      }
    })
    return () => unsub()
  }, [chatId, updateMessage])

  // Subscribe to contact presence + listen for typing indicators
  useEffect(() => {
    if (!chatId || chatType !== "contact") return

    SubscribeContactPresence(chatId).catch(() => {})
    // wa:chat_presence is handled once, globally, in useWailsEvents. It now
    // carries sender/isFromMe so it can drive the store for every chat without
    // a second, contact-only listener here.

    const unsubOnline = EventsOn("wa:presence", (data: { jid: string; unavailable: boolean }) => {
      if (data?.jid === chatId || data?.jid.split("@")[0] === chatId.split("@")[0]) {
        useUIStore.getState().setOnlineStatus(data.jid, !data.unavailable)
      }
    })

    return () => {
      unsubOnline()
      useUIStore.getState().setTypingIndicator(chatId, false)
    }
  }, [chatId, chatType])

  useGSAP(
    () => {
      const button = scrollButtonRef.current
      if (!button) return

      const targetAlpha = scrollButtonVisible ? 1 : 0

      // Reduced motion: snap to the final state in the same frame. aria-hidden,
      // tabIndex and visibility all derive from scrollButtonVisible (autoAlpha
      // owns the inline visibility), so the control leaves the tab order and the
      // a11y tree together. No opacity tween is started at all.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.killTweensOf(button)
        gsap.set(button, { autoAlpha: targetAlpha })
        return
      }

      // autoAlpha fades opacity and flips visibility at the right end of the
      // tween, so the button can't be instantly hidden while still fading.
      gsap.to(button, {
        autoAlpha: targetAlpha,
        duration: 0.3,
        ease: scrollButtonVisible ? easeShowRef.current : easeHideRef.current,
        overwrite: "auto",
      })
    },
    { dependencies: [scrollButtonVisible], revertOnUpdate: false },
  )

  return (
    <div className="flex h-full min-w-0">
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader
          chatName={chatName}
          chatSubtitle={chatSubtitle}
          chatAvatar={chatAvatar}
          announcement={announcement}
          onBack={onBack}
          onInfoClick={() => setChatInfoOpen(!chatInfoOpen)}
          onCallClick={() => {
            if (!chatId) return
            // Outbound call bindings are promises: swallow no error. Surface a
            // static, user-visible toast through the existing notification
            // path (never render raw backend text, which can contain JIDs).
            // (D-AUD-004i)
            const showCallError = (err: unknown) => {
              console.error("Failed to start call:", err)
              const { addNotification, removeNotification } = useUIStore.getState()
              const nid = addNotification("Could not start the call. Please try again.")
              setTimeout(() => removeNotification(nid), 6000)
            }
            if (chatId.endsWith("@g.us")) {
              MakeGroupCall(chatId).catch(showCallError)
            } else {
              MakeCall(chatId).catch(showCallError)
            }
          }}
          isTyping={typingIndicator?.isTyping ?? false}
        />

        {/* Pinned-messages subheader: real pins for this chat only, with the
            sender name and a short preview. Activates the existing quote-jump
            path (paginate -> scrollToMessage -> 500ms highlight). */}
        <PinnedMessageBanner
          key={chatId}
          chatId={chatId}
          pins={pinnedMessages}
          onJump={handleQuotedClick}
        />

        <div className="flex-1 relative overflow-hidden">
          {/* Static chat wallpaper: painted once behind the list instead of
              scrolling (and repainting) with it — big scroll-perf win. */}
          <div className="chat-wallpaper absolute inset-0 pointer-events-none z-0" />
          {(initialLoad || !isReady) && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-chat-wallpaper dark:bg-dark-bg z-50"
              role="status"
              aria-label="Loading messages"
            >
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
            </div>
          )}

          {loadError && isReady && !initialLoad && (
            <div
              role="alert"
              className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-chat-wallpaper px-6 text-center dark:bg-dark-bg"
            >
              <svg
                viewBox="0 0 24 24"
                width="28"
                height="28"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
                className="shrink-0 text-muted-subtle dark:text-dark-muted"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.5h.01" />
              </svg>
              <div>
                <p className="text-base font-semibold text-light-text dark:text-dark-text">
                  Couldn't load messages
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-subtle dark:text-dark-muted">
                  We couldn't load this conversation. Check your connection and try again.
                </p>
              </div>
              <button
                type="button"
                onClick={retryInitialLoad}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-light-text hover:bg-gray-50 dark:border-white/10 dark:bg-dark-secondary dark:text-dark-text dark:hover:bg-white/5"
              >
                Retry
              </button>
            </div>
          )}

          <button
            ref={scrollButtonRef}
            type="button"
            onClick={() => scrollToBottom(false)}
            aria-label="Scroll to latest message"
            aria-hidden={!scrollButtonVisible}
            tabIndex={scrollButtonVisible ? 0 : -1}
            className={clsx(
              // Initial hidden state; GSAP autoAlpha takes over visibility.
              "invisible absolute bottom-4 right-8 bg-white dark:bg-received-bubble-dark-bg p-2 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 z-100 hover:bg-gray-100 dark:hover:bg-hover-icons",
              !scrollButtonVisible && "pointer-events-none",
            )}
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              className="fill-current text-gray-600 dark:text-dark-muted"
            >
              <path d="M12 16.17L4.83 9L3.41 10.41L12 19L20.59 10.41L19.17 9L12 16.17Z" />
            </svg>
          </button>

          <div className={clsx("relative z-10 h-full", (!isReady || initialLoad) && "invisible")}>
            {/* Existing per-chat trigger, unchanged apart from yielding the
                top slot to the brief terminal status so they never overlap. */}
            {!isNewsletter && isReady && !hasMore && !backfillPending && !backfillResult && (
              <button
                type="button"
                onClick={() => void requestOlderFromPhone()}
                className="absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-gray-200 backdrop-blur transition-colors hover:bg-black/80"
                aria-label="Load older messages from your phone"
                title="Load older messages from your phone"
              >
                Load older from phone
              </button>
            )}
            <BackfillProgress state={backfillIndicator} />
            <MessageList
              key={`${chatId}:${isReady ? "ready" : "loading"}`}
              ref={messageListRef}
              chatId={chatId}
              messages={chatMessages}
              firstItemIndex={firstItemIndex}
              sentMediaCache={sentMediaCache}
              onReply={setReplyingTo}
              onQuotedClick={handleQuotedClick}
              onContactAction={contactActions.openContactActions}
              onLoadMore={() => void loadMoreMessages()}
              onAtBottomChange={handleAtBottomChange}
              pinnedIds={pinnedIds}
              isLoading={isLoadingMore}
              hasMore={isReady && hasMore}
              highlightedMessageId={highlightedMessageId}
              isAnnounceGroup={isAnnounceGroup}
              typing={
                typingIndicator?.isTyping
                  ? {
                      // The typing peer, never the chat (group subject) name.
                      jid: typingIndicator.sender || chatId,
                      media: typingIndicator.media,
                    }
                  : null
              }
            />
          </div>
        </div>
        {/* Explicit failed-send state: the optimistic bubble is no longer left
            pending forever. Retry and dismiss stay available next to the
            composer even after the notification times out. */}
        {failedSends.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="mx-3 mb-2 rounded-xl border border-danger/30 bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)]"
          >
            <p className="px-3 pt-2 text-xs font-semibold">
              Not sent ({failedSends.length}). Retry or dismiss each message.
            </p>
            <ul className="max-h-24 overflow-y-auto px-1 pb-1">
              {failedSends.map(f => (
                <li key={f.tempId} className="flex items-center gap-2 rounded-lg px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm" title={f.preview}>
                    {f.preview}
                  </span>
                  <button
                    type="button"
                    onClick={() => retrySend(f.tempId)}
                    className="shrink-0 rounded-lg border border-danger/40 px-2 py-1 text-xs font-semibold hover:bg-danger/10"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissFailedSend(f.tempId)}
                    aria-label={`Dismiss unsent message: ${f.preview}`}
                    className="shrink-0 rounded p-1 hover:bg-danger/10"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ChatInput
          chatId={chatId}
          disabled={!canSend}
          inputText={inputText}
          pastedImage={pastedImage}
          selectedFile={selectedFile}
          selectedFileType={selectedFileType}
          showEmojiPicker={showEmojiPicker}
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          emojiPickerRef={emojiPickerRef}
          emojiButtonRef={emojiButtonRef}
          replyingTo={replyingTo}
          mentionableContacts={mentionableContacts}
          onInputChange={handleInputChange}
          onKeyDown={e => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
            // "Enter is send" controls the plain Enter key. With it off, Enter
            // inserts a newline and Ctrl/Cmd+Enter sends.
            if (enterIsSend || e.ctrlKey || e.metaKey) {
              e.preventDefault()
              void handleSendMessage()
            }
          }}
          onPaste={async e => {
            // Chromium exposes pasted images synchronously via DataTransfer.
            const items = e.clipboardData?.items
            for (const item of items || []) {
              if (item.type.indexOf("image") !== -1) {
                const file = item.getAsFile()
                if (file) {
                  e.preventDefault()
                  setPastedImage(await blobToDataURL(file))
                  return
                }
              }
            }

            // WebKitGTK (Wails on Linux) does not put system-clipboard images
            // into DataTransfer, so fall back to the async Clipboard API.
            if (!navigator.clipboard?.read) return
            try {
              const clipboardItems = await navigator.clipboard.read()
              for (const clipboardItem of clipboardItems) {
                const imageType = clipboardItem.types.find(t => t.startsWith("image/"))
                if (imageType) {
                  const blob = await clipboardItem.getType(imageType)
                  setPastedImage(await blobToDataURL(blob))
                  return
                }
              }
            } catch (err) {
              console.error("Clipboard image read failed:", err)
            }
          }}
          onSendMessage={handleSendMessage}
          onVoiceRecord={handleVoiceRecord}
          onFileSelect={e => {
            const file = e.target.files?.[0]
            if (file) stageSelectedFile(file)
          }}
          onGifSelect={stageSelectedFile}
          onRemoveFile={() => {
            voiceMetaRef.current = null
            setSelectedFile(null)
            setPastedImage(null)
            setSendAsGif(false)
          }}
          sendAsGif={sendAsGif}
          onToggleSendAsGif={() => setSendAsGif(v => !v)}
          onEmojiClick={emoji => {
            setInputText(prev => prev + emoji)
            setShowEmojiPicker(false)
          }}
          onToggleEmojiPicker={() => setShowEmojiPicker(!showEmojiPicker)}
          onCancelReply={() => setReplyingTo(null)}
          onMentionAdd={contact => setSelectedMentions(prev => [...prev, contact])}
          selectedMentions={selectedMentions}
          onScheduleMessage={handleScheduleMessage}
        />
      </div>

      <ChatInfo
        chatId={chatId}
        chatName={chatName}
        chatType={chatType}
        chatAvatar={chatAvatar}
        announcement={announcement}
        isOpen={chatInfoOpen}
        onClose={() => setChatInfoOpen(false)}
        onContactAction={contactActions.openContactActions}
      />

      <ContactActionSheet {...contactActions} />

      {forwardTarget && (
        <ForwardDialog
          sourceJID={chatId}
          messageID={forwardTarget}
          onClose={() => setForwardTarget(null)}
        />
      )}
    </div>
  )
}
