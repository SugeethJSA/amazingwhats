import { useEffect } from "react"
import { EventsOn } from "../lib/wailsRuntime"
import { useMessageStore } from "../store/useMessageStore"
import { useUIStore } from "../store/useUIStore"
import { useChatStore } from "../store/useChatStore"
import { useMuteStore } from "../store/useMuteStore"

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
    }
  }, [addNotification])
}
