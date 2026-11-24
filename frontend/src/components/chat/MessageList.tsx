import { forwardRef, useImperativeHandle, useRef, memo, useMemo, useEffect, useState } from "react"
import { Virtuoso, type VirtuosoHandle, type Components } from "react-virtuoso"
import type { Message } from "../../store/types"
import { dayKey, formatDateSeparator, getAvatarColor } from "../../lib/utils"
import { GetCachedAvatar } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { MessageItem } from "./MessageItem"
import type { ContactActionTarget } from "../../hooks/useContactActions"

const TAG = "date"
type DateSeparatorEntry = { __t: typeof TAG; label: string; key: string }
type RowItem = Message | DateSeparatorEntry

function isSep(r: RowItem): r is DateSeparatorEntry {
  return r != null && (r as DateSeparatorEntry).__t === TAG
}

interface MessageListProps {
  chatId: string
  messages: Message[]
  // Virtuoso anchor for prepending older messages without a scroll jump: it
  // decreases by the number of messages prepended (see ChatDetail).
  firstItemIndex: number
  sentMediaCache: React.MutableRefObject<Map<string, string>>
  onReply?: (message: Message) => void
  onQuotedClick?: (messageId: string) => void
  onContactAction?: (target: ContactActionTarget, anchor?: HTMLElement | null) => void
  onLoadMore?: () => void
  onAtBottomChange?: (atBottom: boolean) => void
  pinnedIds?: Set<string>
  isLoading?: boolean
  hasMore?: boolean
  highlightedMessageId?: string | null
  isAnnounceGroup?: boolean
  /** Active peer typing indicator, rendered as a bubble at the end of the list. */
  typing?: { name: string; jid: string; media?: string } | null
}

export interface MessageListHandle {
  scrollToBottom: (behavior?: "auto" | "smooth") => void
  scrollToMessage: (messageId: string) => boolean
}

const MemoizedMessageItem = memo(MessageItem)

// Mount rows well before they enter the viewport so row mount work (media
// placeholders, contact lookups) happens off-screen instead of mid-scroll.
const OVERSCAN = { top: 800, bottom: 800 }

interface ListContext {
  isLoading?: boolean
  typing?: { name: string; jid: string; media?: string } | null
}

// Components must be stable module-level references: an inline object/arrow
// recreated per render makes Virtuoso remount them on every parent re-render
// (which happens mid-scroll via atBottomStateChange), causing visible hitches.
const ListHeader: Components<Message, ListContext>["Header"] = ({ context }) =>
  context?.isLoading ? (
    <div className="flex justify-center py-4">
      <div className="animate-spin h-5 w-5 border-2 border-green-500 rounded-full border-t-transparent" />
    </div>
  ) : null

// Small avatar next to the typing bubble. Uses the same cached-avatar binding
// as message rows, with a coloured initial fallback when no avatar exists.
function TypingAvatar({ jid, name }: { jid: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setSrc(null)
    GetCachedAvatar(jid, false)
      .then(url => {
        if (alive) setSrc(url || null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [jid])
  if (src) {
    return <img src={src} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
  }
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
      style={{ background: getAvatarColor(jid) }}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase() || "?"}
    </div>
  )
}

// Footer scrolls with the list (Virtuoso keeps it in view when already at the
// bottom), so the typing bubble sits directly under the last message.
const ListFooter: Components<Message, ListContext>["Footer"] = ({ context }) => {
  const typing = context?.typing
  if (!typing) return <div className="h-2" />
  const label = typing.media === "audio" ? "recording a voice message" : "typing"
  return (
    <div className="flex items-end gap-2 px-2 pb-2 pt-1" role="status" aria-live="polite">
      <TypingAvatar jid={typing.jid} name={typing.name} />
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-white px-3 py-2 shadow-sm dark:bg-dark-secondary">
        <div className="flex items-center gap-1" aria-hidden="true">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-500 dark:bg-gray-300" style={{ animationDelay: "0ms" }} />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-500 dark:bg-gray-300" style={{ animationDelay: "160ms" }} />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-500 dark:bg-gray-300" style={{ animationDelay: "320ms" }} />
        </div>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {typing.name} {label}
        </span>
      </div>
    </div>
  )
}

const listComponents: Components<Message, ListContext> = {
  Header: ListHeader,
  Footer: ListFooter,
}

// WhatsApp-style floating day pill. Rendered inside a message row (rather than
// as its own Virtuoso row) so the row index stays 1:1 with messages[] — see
// the local-index conversion in itemContent below.
const DateSeparator = memo(function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-2 select-none">
      <span className="rounded-full bg-white/80 dark:bg-white/10 px-3 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 shadow-sm">
        {label}
      </span>
    </div>
  )
})
DateSeparator.displayName = "DateSeparator"

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  {
    chatId,
    messages,
    firstItemIndex,
    sentMediaCache,
    onReply,
    onQuotedClick,
    onContactAction,
    onLoadMore,
    onAtBottomChange,
    pinnedIds,
    isLoading,
    hasMore,
    highlightedMessageId,
    isAnnounceGroup = false,
  typing = null,
  },
  ref,
) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  // Walk the messages once and inject a date-separator entry before the first
  // message of each new day. This is the source of truth for which rows show a
  // pill; the entries are mapped back onto message indices below so Virtuoso
  // still renders exactly one row per message.
  const rows = useMemo<ReadonlyArray<RowItem>>(() => {
    const out: RowItem[] = []
    let prevDay = ""
    for (let i = 0; i < messages.length; i++) {
      const ts = messages[i]?.Info?.Timestamp
      const dk = ts ? dayKey(ts) : ""
      if (dk && dk !== prevDay) {
        prevDay = dk
        out.push({ __t: TAG, label: formatDateSeparator(dk), key: `d_${dk}` })
      }
      out.push(messages[i])
    }
    return out
  }, [messages])

  // Map each message's index in messages[] to the separator that precedes it.
  const separatorsByIndex = useMemo<Map<number, DateSeparatorEntry>>(() => {
    const map = new Map<number, DateSeparatorEntry>()
    let msgIndex = 0
    let pending: DateSeparatorEntry | null = null
    for (const row of rows) {
      if (isSep(row)) {
        pending = row
      } else {
        if (pending) map.set(msgIndex, pending)
        pending = null
        msgIndex++
      }
    }
    return map
  }, [rows])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior: "auto" | "smooth" = "smooth") => {
        virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior })
      },
      scrollToMessage: (messageId: string) => {
        const index = messages.findIndex(m => m.Info.ID === messageId)
        if (index >= 0) {
          virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" })
          return true
        }
        return false
      },
    }),
    [messages],
  )

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="h-full virtuoso-scroller"
      data={messages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={Math.max(0, messages.length - 1)}
      increaseViewportBy={OVERSCAN}
      // Let Virtuoso probe a real message height. A hard-coded 56px estimate is
      // badly wrong for media and preview cards and causes large corrections.
      // Fires when the user scrolls to the very top -> load older messages.
      startReached={() => {
        if (hasMore && !isLoading) onLoadMore?.()
      }}
      atBottomStateChange={atBottom => onAtBottomChange?.(atBottom)}
      // Stick to the bottom for new messages only when already at the bottom.
      // "auto" (instant) rather than "smooth": animated follow fights with
      // fast incoming updates and produces janky rubber-banding.
      followOutput={atBottom => (atBottom ? "auto" : false)}
      computeItemKey={(_index, msg) => msg?.Info?.ID ?? String(_index)}
      context={{ isLoading, typing }}
      components={listComponents}
      itemContent={(_index, msg) => {
        // Virtuoso's index is global (firstItemIndex starts at START_INDEX =
        // 1,000,000), so keep the local-index conversion into messages[] for
        // every lookup — including the new separator/dayKey lookups. Never
        // walk rows with the raw Virtuoso index.
        const prev = messages[_index - firstItemIndex - 1]
        const firstInGroup =
          !prev || prev.Info.IsFromMe !== msg.Info.IsFromMe || prev.Info.Sender !== msg.Info.Sender
        const sep = separatorsByIndex.get(_index - firstItemIndex)
        // No overflow-hidden on the row: hiding one axis forces the other to
        // 'auto', which clips the reaction pills that hang below bubbles.
        // Horizontal overflow is already contained at the panel level.
        return (
          <>
            {sep && <DateSeparator key={sep.key} label={sep.label} />}
            <div data-message-id={msg.Info.ID} className={firstInGroup ? "pt-2 pb-px" : "py-px"}>
              <MemoizedMessageItem
                message={msg}
                chatId={chatId}
                firstInGroup={firstInGroup}
                pinnedIds={pinnedIds}
                sentMediaCache={sentMediaCache}
                onReply={onReply}
                onQuotedClick={onQuotedClick}
                onContactAction={onContactAction}
                highlightedMessageId={highlightedMessageId}
                isAnnounceGroup={isAnnounceGroup}
              />
            </div>
          </>
        )
      }}
    />
  )
})
