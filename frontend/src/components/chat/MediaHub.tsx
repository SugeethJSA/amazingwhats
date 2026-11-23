import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  DeleteForMe,
  DownloadImageToFile,
  DownloadMediaToFile,
  GetMediaHubItems,
  StarMessage,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { useUIStore } from "../../store"
import { useMediaHubStore } from "../../store/useMediaHubStore"
import { ForwardDialog } from "./ForwardDialog"

type HubTab = "media" | "docs" | "links"
type SortMode = "newest" | "oldest" | "name" | "size"

interface HubItem {
  chat_jid: string
  message_id: string
  sender_jid: string
  timestamp: number
  is_from_me: boolean
  media_type: number
  mime_type: string
  file_name: string
  file_size: number
  direct_path: string
  caption: string
  url: string
  title: string
  description: string
  width: number
  height: number
  gif_playback: boolean
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"

function dayLabel(timestamp: number): string {
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return "Earlier"
  const today = new Date()
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const itemStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((start - itemStart) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
}

function timeLabel(timestamp: number): string {
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

function sizeLabel(bytes: number): string {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function extLabel(item: HubItem): string {
  const name = item.file_name || ""
  const ext = name.includes(".") ? name.split(".").pop()?.toUpperCase() : ""
  if (ext) return ext
  if (item.mime_type.includes("pdf")) return "PDF"
  if (item.mime_type.startsWith("image/")) return "IMAGE"
  if (item.mime_type.startsWith("video/")) return "VIDEO"
  return "DOC"
}

export function MediaHub() {
  const open = useMediaHubStore(s => s.open)
  const closeHub = useMediaHubStore(s => s.closeHub)
  const addNotification = useUIStore(s => s.addNotification)

  const [tab, setTab] = useState<HubTab>("media")
  const [items, setItems] = useState<HubItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortMode>("newest")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [forwardFor, setForwardFor] = useState<HubItem | null>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const notify = useCallback(
    (text: string) => addNotification?.(text, { tone: "info" }),
    [addNotification],
  )

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    setSelected(new Set())
    setSearch("")
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    GetMediaHubItems(tab)
      .then((rows: unknown) => {
        if (!cancelled) setItems((rows as HubItem[]) ?? [])
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          // Backend errors can carry paths, URLs or JIDs: never render verbatim.
          notify(`Could not load ${tab}. Please try again.`)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, notify])

  const close = useCallback(() => {
    closeHub()
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
  }, [closeHub])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !forwardFor) {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close, forwardFor])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = q
      ? items.filter(item =>
          [item.file_name, item.caption, item.title, item.description, item.url]
            .some(value => (value || "").toLowerCase().includes(q)),
        )
      : items.slice()
    result.sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.timestamp - b.timestamp
        case "name":
          return (a.file_name || a.title || "").localeCompare(b.file_name || b.title || "")
        case "size":
          return b.file_size - a.file_size
        default:
          return b.timestamp - a.timestamp
      }
    })
    return result
  }, [items, search, sort])

  const groups = useMemo(() => {
    const map = new Map<string, HubItem[]>()
    for (const item of filtered) {
      const label = dayLabel(item.timestamp)
      const list = map.get(label) ?? []
      list.push(item)
      map.set(label, list)
    }
    return Array.from(map.entries())
  }, [filtered])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedItems = items.filter(item => selected.has(item.message_id))

  const runAction = async (
    label: string,
    action: (item: HubItem) => Promise<unknown>,
  ) => {
    if (!selectedItems.length || busy) return
    setBusy(true)
    let failed = 0
    for (const item of selectedItems) {
      try {
        await action(item)
      } catch (err) {
        failed++
        console.error(`[MediaHub] ${label} failed`, err)
      }
    }
    setBusy(false)
    if (failed) {
      notify(`${label} failed for ${failed} item(s)`)
      return
    }
    notify(`${label} done`)
    if (label === "Delete") {
      setItems(prev => prev.filter(item => !selected.has(item.message_id)))
      setSelected(new Set())
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={event => {
        if (event.target === event.currentTarget && !forwardFor) close()
      }}
    >
      <div className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111b21] text-gray-100 shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              Media
            </h2>
            <p className="truncate text-xs text-gray-400">Docs from all chats</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close media hub"
            title="Close"
            className={`rounded-lg px-2 py-1 text-2xl leading-none text-gray-300 hover:bg-white/10 ${FOCUS_RING}`}
          >
            ×
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-5 py-3">
          <div role="tablist" className="flex gap-1 rounded-lg bg-white/5 p-1">
            {(["media", "docs", "links"] as HubTab[]).map(name => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                type="button"
                onClick={() => {
                  setTab(name)
                  setSelected(new Set())
                }}
                className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${tab === name ? "bg-emerald-600/30 text-emerald-200" : "text-gray-400 hover:text-gray-100"} ${FOCUS_RING}`}
              >
                {name}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search media hub"
            className="min-w-32 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none placeholder:text-gray-500 focus:border-emerald-500/50"
          />
          <select
            value={sort}
            onChange={event => setSort(event.target.value as SortMode)}
            aria-label="Sort by"
            title="Sort by"
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
          <button
            type="button"
            onClick={close}
            className={`rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 ${FOCUS_RING}`}
          >
            Cancel
          </button>
        </div>

        <div className="grid grid-cols-[minmax(3fr,1fr)_minmax(2fr,1fr)_minmax(2fr,1fr)] gap-3 border-b border-white/10 px-5 py-2 text-xs font-medium text-gray-400">
          <span>{tab === "docs" ? "Doc" : tab === "links" ? "Link" : "Media"}</span>
          <span>{tab === "links" ? "Caption" : "Caption / name"}</span>
          <span>Sent by</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <p className="py-10 text-center text-sm text-gray-400">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">Nothing here yet.</p>
          ) : (
            groups.map(([label, rows]) => (
              <div key={label} className="mb-3">
                <div className="px-2 py-2 text-sm font-semibold text-gray-300">{label}</div>
                {rows.map(item => (
                  <div
                    key={item.message_id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(item.message_id)}
                      onChange={() => toggle(item.message_id)}
                      aria-label={`Select ${item.file_name || item.title || item.message_id}`}
                      className="h-4 w-4 shrink-0 accent-emerald-500"
                    />
                    <div className="flex min-w-0 flex-[3] items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white/10 text-[10px] font-semibold">
                        {extLabel(item)}
                      </span>
                      <span className="truncate text-sm">
                        {item.file_name || item.title || item.url || "Media"}
                      </span>
                    </div>
                    <div className="min-w-0 flex-[2] truncate text-xs text-gray-400">
                      {item.caption || item.description || sizeLabel(item.file_size) || "No caption"}
                    </div>
                    <div className="min-w-0 flex-[2] truncate text-xs text-gray-400">
                      {item.is_from_me ? "You" : item.sender_jid.split("@")[0]} · {timeLabel(item.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
          {tab === "docs" && !loading && (
            <div className="px-2 py-5">
              <p className="text-sm font-medium text-gray-200">Recent docs only</p>
              <p className="text-xs text-gray-500">
                You can find older docs in your chats or on your phone.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-5 py-3">
          <span className="text-xs text-gray-400">{selected.size} selected</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={!selected.size || busy}
              onClick={() =>
                void runAction("Delete", item => DeleteForMe(item.chat_jid, item.message_id))
              }
              className={`rounded-lg px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40 ${FOCUS_RING}`}
            >
              Delete
            </button>
            <button
              type="button"
              disabled={!selected.size || busy}
              onClick={() =>
                void runAction("Star", item => StarMessage(item.chat_jid, item.message_id, true))
              }
              className={`rounded-lg px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40 ${FOCUS_RING}`}
            >
              Star
            </button>
            <button
              type="button"
              disabled={!selected.size || busy}
              onClick={() =>
                void runAction("Download", item =>
                  item.media_type === 1 || item.media_type === 5
                    ? DownloadImageToFile(item.message_id)
                    : DownloadMediaToFile(item.message_id),
                )
              }
              className={`rounded-lg px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40 ${FOCUS_RING}`}
            >
              Download
            </button>
            <button
              type="button"
              disabled={selected.size !== 1 || busy}
              onClick={() => {
                const first = selectedItems[0]
                if (first) setForwardFor(first)
              }}
              className={`rounded-lg px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40 ${FOCUS_RING}`}
            >
              Forward
            </button>
          </div>
        </div>
      </div>

      {forwardFor && (
        <ForwardDialog
          sourceJID={forwardFor.chat_jid}
          messageID={forwardFor.message_id}
          onClose={() => setForwardFor(null)}
        />
      )}
    </div>
  )
}
