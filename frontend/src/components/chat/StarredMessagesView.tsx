import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import clsx from "clsx"
import { ListStarredMessages } from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { EventsOn } from "../../lib/wailsRuntime"
import { htmlToPlainText } from "../../lib/utils"
import { GoBackIcon } from "../../assets/svgs/header_icons"
import { useChatStore } from "../../store/useChatStore"
import { useMessageStore } from "../../store/useMessageStore"
import { useUIStore } from "../../store/useUIStore"
import type { ChatItem } from "../../store/types"

/**
 * Mirror of the generated `api.StarredMessage` JSON shape. Kept local so the
 * view does not depend on generated binding types being present before the
 * build gate regenerates them (same pattern as quick replies / call log).
 */
interface StarredMessage {
  chat_jid: string
  message_id: string
  sender_jid: string
  timestamp: number
  text: string
  is_from_me: boolean
  has_media: boolean
  media_type: number
  edited: boolean
  forwarded: boolean
  chat_name: string
  starred_at: number
}

interface StarredMessagesViewProps {
  /** Host (ChatScreen list pane) supplies this to close the view. */
  onClose?: () => void
}

const PAGE_SIZE = 50

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"

function StarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45l-5.81 3.05L7.3 14.03 2.6 9.45l6.5-.95L12 2.6z" />
    </svg>
  )
}

function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : ""
  const text = raw.toLowerCase()
  if (text.includes("offline") || text.includes("connection") || text.includes("network")) {
    return "Starred messages are unavailable right now. Check your connection and try again."
  }
  return "We couldn't load starred messages. Try again in a moment."
}

function formatDate(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return ""
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function mediaLabel(item: StarredMessage): string {
  if (!item.has_media) return ""
  switch (item.media_type) {
    case 1:
      return "[Image]"
    case 2:
      return "[Video]"
    case 3:
      return "[Audio]"
    case 4:
      return "[Document]"
    case 5:
      return "[Sticker]"
    default:
      return "[Media]"
  }
}

/**
 * Real starred-messages view: lists every starred message across chats from
 * the backend app-state mirror and opens the originating conversation on
 * selection. It never shows placeholder rows.
 */
export function StarredMessagesView({ onClose }: StarredMessagesViewProps) {
  const [items, setItems] = useState<StarredMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState("")
  const mountedRef = useRef(true)

  const load = useCallback(
    async (append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError("")
      try {
        const res = await ListStarredMessages(PAGE_SIZE, append ? items.length : 0)
        const rows: StarredMessage[] = Array.isArray(res) ? res : []
        setItems(prev => (append ? [...prev, ...rows] : rows))
        setHasMore(rows.length === PAGE_SIZE)
      } catch (err: unknown) {
        setError(friendlyError(err))
        if (!append) setItems([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [items.length],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    void load(false)
    // First mount only: `load` intentionally changes with items.length so the
    // "Load more" path appends at the right offset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stars can change on the phone or from a message menu while this view is
  // mounted. Refresh from the backend instead of mutating local rows.
  useEffect(() => {
    const reload = () => {
      if (mountedRef.current) void load(false)
    }
    const offBackend = EventsOn("wa:starred_updated", reload)
    window.addEventListener("wa:starred_updated", reload)
    return () => {
      offBackend()
      window.removeEventListener("wa:starred_updated", reload)
    }
  }, [load])

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return items
    return items.filter(item =>
      [item.chat_name, item.chat_jid, item.text, item.sender_jid].some(value =>
        (value || "").toLocaleLowerCase().includes(term),
      ),
    )
  }, [items, query])

  const openMessage = useCallback(
    (item: StarredMessage) => {
      const chatStore = useChatStore.getState()
      const existing = chatStore.getChat(item.chat_jid)
      const fallback: ChatItem = {
        id: item.chat_jid,
        name: item.chat_name || item.chat_jid.split("@")[0] || item.chat_jid,
        subtitle: "",
        type: item.chat_jid.endsWith("@g.us") ? "group" : "contact",
      }
      chatStore.selectChat(existing ?? fallback)
      chatStore.clearUnreadCount(item.chat_jid)
      // Compatibility with the message-search flow: ChatDetail reads the active
      // chat id from this store as well.
      useMessageStore.getState().setActiveChatId(item.chat_jid)
      useUIStore.getState().setFocusMessageId(item.message_id)
      useUIStore.getState().setSidebarView("chats")
      onClose?.()
    },
    [onClose],
  )

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") onClose?.()
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-dark-bg" onKeyDown={handleKeyDown}>
      <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-3 dark:border-white/5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className={clsx("rounded-full p-1.5 hover:bg-gray-100 dark:hover:bg-white/10", focusRing)}
        >
          <GoBackIcon />
        </button>
        <span className="text-green" aria-hidden="true">
          <StarGlyph />
        </span>
        <h2 className="flex-1 text-base font-semibold text-light-text dark:text-dark-text">
          Starred messages
        </h2>
        {!loading && !error && (
          <span className="text-xs text-muted-subtle dark:text-dark-muted" aria-live="polite">
            {filtered.length} {filtered.length === 1 ? "message" : "messages"}
          </span>
        )}
      </div>

      <div className="border-b border-gray-200 px-3 py-2 dark:border-white/5">
        <label htmlFor="starred-filter" className="sr-only">
          Filter starred messages
        </label>
        <input
          id="starred-filter"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Filter by chat or message"
          className={clsx(
            "w-full rounded-lg bg-light-tertiary px-3 py-1.5 text-sm text-light-text outline-none dark:bg-dark-secondary dark:text-dark-text placeholder-muted-subtle dark:placeholder-dark-muted",
            focusRing,
          )}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <p role="status" aria-live="polite" className="sr-only">
          {!loading && !error && filtered.length === 0
            ? "No starred messages."
            : `${filtered.length} starred messages.`}
        </p>

        {error && (
          <div role="alert" className="p-4 text-center">
            <p className="text-sm text-danger-strong dark:text-danger">{error}</p>
            <button
              type="button"
              onClick={() => void load(false)}
              className={clsx(
                "mt-2 text-sm font-medium text-green-ink-muted dark:text-green hover:underline",
                focusRing,
              )}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <span className="text-green" aria-hidden="true">
              <StarGlyph />
            </span>
            <p className="text-sm font-medium text-light-text dark:text-dark-text">
              {items.length === 0 ? "No starred messages yet" : "No matches"}
            </p>
            <p className="text-sm text-muted-subtle dark:text-dark-muted">
              {items.length === 0
                ? "Star a message in any chat and it will appear here."
                : "Try a different filter."}
            </p>
          </div>
        )}

        {filtered.map(item => (
          <button
            key={`${item.chat_jid}:${item.message_id}`}
            type="button"
            onClick={() => openMessage(item)}
            aria-label="Open starred message"
            className={clsx(
              "flex w-full flex-col items-start gap-1 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-100 dark:border-white/5 dark:hover:bg-white/5",
              focusRing,
            )}
          >
            <div className="flex w-full items-center gap-2">
              <span className="text-green" aria-hidden="true">
                <StarGlyph />
              </span>
              <span className="flex-1 truncate text-sm font-medium text-light-text dark:text-dark-text">
                {item.chat_name || item.chat_jid.split("@")[0]}
              </span>
              <span className="shrink-0 text-xs text-muted-subtle dark:text-dark-muted">
                {formatDate(item.timestamp || item.starred_at)}
              </span>
            </div>
            <div className="flex w-full items-center gap-2">
              <span className="shrink-0 text-xs text-muted-subtle dark:text-dark-muted">
                {item.is_from_me ? "You" : (item.sender_jid || "").split("@")[0]}
              </span>
              <span className="truncate text-sm text-light-text dark:text-dark-text">
                {htmlToPlainText(item.text) || mediaLabel(item) || "Open in chat"}
              </span>
            </div>
            {(item.edited || item.forwarded) && (
              <span className="text-xs italic text-muted-subtle dark:text-dark-muted">
                {[item.edited && "Edited", item.forwarded && "Forwarded"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </button>
        ))}

        {loading && (
          <div role="status" aria-live="polite" className="flex justify-center py-4">
            <div
              className="h-6 w-6 animate-spin rounded-full border-b-2 border-green"
              aria-hidden="true"
            />
            <span className="sr-only">Loading starred messages…</span>
          </div>
        )}

        {hasMore && !loading && !loadingMore && !query && (
          <button
            type="button"
            onClick={() => void load(true)}
            className={clsx(
              "w-full py-3 text-sm font-medium text-green-ink-muted hover:bg-gray-50 dark:text-green dark:hover:bg-white/5",
              focusRing,
            )}
          >
            Load more
          </button>
        )}
      </div>
    </div>
  )
}

export default StarredMessagesView
