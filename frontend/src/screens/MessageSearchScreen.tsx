import { useState, useEffect, useRef, useCallback } from "react"
import clsx from "clsx"
import {
  SearchMessages,
  GetSearchSuggestions,
} from "../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { useMessageStore, useUIStore } from "../store"
import { htmlToPlainText } from "../lib/utils"
import { GoBackIcon } from "../assets/svgs/header_icons"

interface SearchResult {
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
}

interface MessageSearchScreenProps {
  onClose: () => void
}

interface FilterOption {
  readonly label: string
  readonly value: string
}

// The four everyday filters stay visible; the rest live behind "More filters".
// "Links" was removed: the backend has no link filter and its old value ("")
// silently duplicated "All". Stickers is a real, supported type filter.
const CORE_FILTERS: readonly FilterOption[] = [
  { label: "All", value: "" },
  { label: "Text", value: "text" },
  { label: "Images", value: "image" },
  { label: "Videos", value: "video" },
]

const MORE_FILTERS: readonly FilterOption[] = [
  { label: "Audio", value: "audio" },
  { label: "Documents", value: "document" },
  { label: "Stickers", value: "sticker" },
]

const PAGE_SIZE = 30

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"

/** Never surface a raw binding error to the user. */
function friendlySearchError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : ""
  const text = raw.toLowerCase()
  if (text.includes("offline") || text.includes("connection") || text.includes("network")) {
    return "Search is unavailable right now. Check your connection and try again."
  }
  return "We couldn't load results. Try again in a moment."
}

export function MessageSearchScreen({ onClose }: MessageSearchScreenProps) {
  const [query, setQuery] = useState("")
  const [mediaFilter, setMediaFilter] = useState("")
  const [senderFilter, setSenderFilter] = useState("")
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const setActiveChatId = useMessageStore(s => s.setActiveChatId)
  const setFocusMessageId = useUIStore(s => s.setFocusMessageId)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suggestionRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const doSearch = useCallback(
    async (q: string, filter: string, sender: string, off: number, append: boolean) => {
      if (!q.trim()) {
        setResults([])
        setHasMore(true)
        setOffset(0)
        return
      }
      setLoading(true)
      setError("")
      try {
        const res = await SearchMessages({
          query: q.trim(),
          type: filter,
          sender_jid: sender || undefined,
          limit: PAGE_SIZE,
          offset: off,
        })
        const items: SearchResult[] = res ?? []
        setResults(prev => (append ? [...prev, ...items] : items))
        setHasMore(items.length >= PAGE_SIZE)
        setOffset(off + items.length)
      } catch (e: unknown) {
        setError(friendlySearchError(e))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setOffset(0)
      doSearch(query, mediaFilter, senderFilter, 0, false)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, mediaFilter, senderFilter, doSearch])

  useEffect(() => {
    if (suggestionRef.current) clearTimeout(suggestionRef.current)
    if (!query.trim() || query.length < 2) {
      setSuggestions([])
      return
    }
    suggestionRef.current = setTimeout(async () => {
      try {
        const res = await GetSearchSuggestions(query.trim(), 5)
        setSuggestions(res || [])
      } catch {
        setSuggestions([])
      }
    }, 200)
    return () => {
      if (suggestionRef.current) clearTimeout(suggestionRef.current)
    }
  }, [query])

  const handleLoadMore = () => {
    doSearch(query, mediaFilter, senderFilter, offset, true)
  }

  const retrySearch = () => {
    doSearch(query, mediaFilter, senderFilter, 0, false)
  }

  const handleResultClick = (r: SearchResult) => {
    // Ask the target conversation to jump to this message before handing over
    // the active chat and closing the search pane.
    setFocusMessageId?.(r.message_id)
    setActiveChatId(r.chat_jid)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }

  const renderFilterButton = (f: FilterOption) => (
    <button
      key={f.label}
      type="button"
      onClick={() => setMediaFilter(f.value)}
      aria-pressed={mediaFilter === f.value}
      className={clsx(
        "rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors shrink-0",
        focusRing,
        mediaFilter === f.value
          ? "bg-green text-action-ink font-medium"
          : "bg-gray-100 dark:bg-dark-secondary text-muted-subtle dark:text-dark-muted hover:bg-gray-200 dark:hover:bg-dark-surface-mid",
      )}
    >
      {f.label}
    </button>
  )

  return (
    <div className="flex flex-col h-full bg-white dark:bg-dark-bg" onKeyDown={handleKeyDown}>
      <div
        role="search"
        aria-label="Message search"
        className="relative flex items-center p-3 border-b border-gray-200 dark:border-white/5 gap-2"
      >
        <button
          onClick={onClose}
          className={clsx("p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full", focusRing)}
          aria-label="Back"
        >
          <GoBackIcon />
        </button>
        <label htmlFor="message-search-query" className="sr-only">
          Search messages
        </label>
        <div className="flex-1 bg-light-tertiary dark:bg-dark-secondary rounded-full flex items-center px-4 py-2">
          <input
            ref={inputRef}
            id="message-search-query"
            type="search"
            placeholder="Search messages..."
            className={clsx(
              "bg-transparent border-none outline-none text-sm w-full text-light-text dark:text-dark-text placeholder-muted-subtle dark:placeholder-dark-muted",
              focusRing,
            )}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {suggestions.length > 0 && (
          <div
            aria-label="Search suggestions"
            className="absolute top-full left-3 right-3 z-10 mt-1 bg-white dark:bg-dark-secondary border border-gray-200 dark:border-dark-border rounded-lg shadow-lg overflow-hidden"
          >
            {suggestions.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuery(s)
                  setSuggestions([])
                }}
                className={clsx(
                  "w-full px-4 py-2 text-left text-sm text-light-text dark:text-dark-text hover:bg-gray-100 dark:hover:bg-white/5",
                  focusRing,
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        role="group"
        aria-label="Filter results by type"
        className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-white/5"
      >
        {CORE_FILTERS.map(renderFilterButton)}
        <button
          type="button"
          onClick={() => setShowMoreFilters(v => !v)}
          aria-expanded={showMoreFilters}
          aria-controls="more-message-filters"
          className={clsx(
            "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm whitespace-nowrap transition-colors shrink-0",
            focusRing,
            showMoreFilters
              ? "bg-gray-200 dark:bg-dark-elevated text-light-text dark:text-dark-text font-medium"
              : "text-muted-subtle dark:text-dark-muted hover:bg-gray-100 dark:hover:bg-white/5",
          )}
        >
          More filters
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={clsx("transition-transform", showMoreFilters && "rotate-180")}
            aria-hidden="true"
          >
            <path d="m2.5 4.5 3.5 3.5 3.5-3.5" />
          </svg>
        </button>
        {showMoreFilters && (
          <div id="more-message-filters" className="w-full flex flex-wrap gap-1.5 pt-1.5">
            {MORE_FILTERS.map(renderFilterButton)}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-b border-gray-200 dark:border-white/5">
        <label htmlFor="sender-filter" className="sr-only">
          Filter by sender
        </label>
        <input
          id="sender-filter"
          type="text"
          placeholder="Filter by sender..."
          className={clsx(
            "w-full px-3 py-1.5 rounded-lg outline-none bg-light-tertiary dark:bg-dark-secondary text-sm text-light-text dark:text-dark-text placeholder-muted-subtle dark:placeholder-dark-muted",
            focusRing,
          )}
          value={senderFilter}
          onChange={e => setSenderFilter(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {!loading && !error && query && (
          <p role="status" aria-live="polite" className="sr-only">
            {results.length === 0
              ? "No messages found."
              : `${results.length} message${results.length === 1 ? "" : "s"} found.`}
          </p>
        )}

        {error && (
          <div role="alert" className="p-4 text-center">
            <p className="text-sm text-danger-strong dark:text-danger">{error}</p>
            <button
              type="button"
              onClick={retrySearch}
              className={clsx(
                "mt-2 text-sm font-medium text-green-ink-muted dark:text-green hover:underline",
                focusRing,
              )}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && query && results.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <p className="text-sm font-medium text-light-text dark:text-dark-text">
              No messages found
            </p>
            <p className="mt-1 text-sm text-muted-subtle dark:text-dark-muted">
              Try a different word or remove a filter.
            </p>
          </div>
        )}
        {!query && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <p className="text-sm font-medium text-light-text dark:text-dark-text">
              Search your messages
            </p>
            <p className="mt-1 text-sm text-muted-subtle dark:text-dark-muted">
              Type at least two characters to find a message.
            </p>
          </div>
        )}

        {results.map(r => (
          <button
            key={r.message_id}
            type="button"
            onClick={() => handleResultClick(r)}
            className={clsx(
              "w-full flex flex-col items-start px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-white/5 border-b border-gray-100 dark:border-white/5",
              focusRing,
            )}
          >
            <div className="flex items-center gap-2 w-full">
              <span className="text-sm font-medium text-light-text dark:text-dark-text truncate flex-1">
                {r.chat_name || r.chat_jid.split("@")[0]}
              </span>
              <span className="text-xs text-muted-subtle dark:text-dark-muted shrink-0">
                {new Date(r.timestamp * 1000).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 w-full mt-0.5">
              <span className="text-xs text-muted-subtle dark:text-dark-muted shrink-0">
                {r.is_from_me ? "You" : r.sender_jid.split("@")[0]}
              </span>
              <span className="text-sm text-light-text dark:text-dark-text truncate">
                {htmlToPlainText(r.text) ||
                  (r.media_type === 1 ? "[Image]" : r.media_type === 2 ? "[Audio]" : "[Media]")}
              </span>
            </div>
            {r.edited && (
              <span className="text-xs text-muted-subtle dark:text-dark-muted italic mt-0.5">
                Edited
              </span>
            )}
          </button>
        ))}

        {loading && (
          <div role="status" aria-live="polite" className="flex justify-center py-4">
            <div
              className="animate-spin rounded-full h-6 w-6 border-b-2 border-green"
              aria-hidden="true"
            />
            <span className="sr-only">Searching messages…</span>
          </div>
        )}

        {hasMore && !loading && results.length > 0 && (
          <button
            type="button"
            onClick={handleLoadMore}
            className={clsx(
              "w-full py-3 text-sm font-medium text-green-ink-muted dark:text-green hover:bg-gray-50 dark:hover:bg-white/5",
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
