import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  FetchMessagesPaged,
  GetCachedImage,
  DownloadMedia,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import * as store from "../../../bindings/github.com/lugvitc/whats4linux/internal/store/models.js"
import { useContactStore } from "../../store/useContactStore"
import { sanitizeHtml } from "../../lib/utils"

const STATUS_JID = "status@broadcast"
const STORY_MS = 5000

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
const LIST_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21c063]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary"

export interface StatusGroup {
  sender: string
  name: string
  items: store.DecodedMessage[]
}

function last<T>(a: T[]): T {
  return a[a.length - 1]
}

// List of people who have recent status updates. Clicking one opens the viewer.
export function StatusList({ onOpen }: { onOpen: (g: StatusGroup) => void }) {
  const [groups, setGroups] = useState<StatusGroup[]>([])
  const [loading, setLoading] = useState(true)
  const getContactName = useContactStore(s => s.getContactName)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const msgs = ((await FetchMessagesPaged(STATUS_JID, 300, 0, "")) ||
        []) as store.DecodedMessage[]
      const bySender = new Map<string, store.DecodedMessage[]>()
      for (const m of msgs) {
        const s = m.Info?.Sender
        if (!s) continue
        if (!bySender.has(s)) bySender.set(s, [])
        bySender.get(s)!.push(m)
      }
      const result: StatusGroup[] = []
      for (const [sender, items] of bySender) {
        items.sort((a, b) => a.Info.Timestamp.localeCompare(b.Info.Timestamp))
        let name = sender.split("@")[0].split(":")[0]
        try {
          name = (await getContactName(sender)) || name
        } catch {
          /* keep number */
        }
        result.push({ sender, name, items })
      }
      result.sort((a, b) =>
        last(b.items).Info.Timestamp.localeCompare(last(a.items).Info.Timestamp),
      )
      if (!cancelled) {
        setGroups(result)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [getContactName])

  if (loading)
    return (
      <div className="p-6 text-center text-sm text-gray-700 dark:text-gray-200" role="status">
        Loading status…
      </div>
    )
  if (groups.length === 0)
    return (
      <div className="p-6 text-center text-sm text-gray-700 dark:text-gray-200">
        No recent status updates
      </div>
    )

  return (
    <div>
      {groups.map(g => (
        <button
          key={g.sender}
          type="button"
          onClick={() => onOpen(g)}
          aria-label={`View ${g.name}'s status, ${g.items.length} update${g.items.length > 1 ? "s" : ""}`}
          className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-gray-100 dark:hover:bg-dark-tertiary ${LIST_FOCUS_RING}`}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-green-500 text-lg font-medium text-green-700 dark:text-green-400">
            {g.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{g.name}</div>
            <div className="text-xs text-gray-600 dark:text-[#8696a0]">
              {g.items.length} update{g.items.length > 1 ? "s" : ""}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

// Full-screen story viewer: progress bars, auto-advance, tap/keyboard nav,
// and explicit pause/stop controls for the auto-advancing progress.
export function StoryViewer({ group, onClose }: { group: StatusGroup; onClose: () => void }) {
  const [idx, setIdx] = useState(0)
  const [mediaSrc, setMediaSrc] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [stopped, setStopped] = useState(false)

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  )

  const item = group.items[idx]
  const content = (item?.Content || {}) as any
  const kind: "image" | "video" | "text" = content.imageMessage
    ? "image"
    : content.videoMessage
      ? "video"
      : "text"
  const caption =
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ""

  const next = useCallback(() => {
    setIdx(i => {
      if (i < group.items.length - 1) return i + 1
      onClose()
      return i
    })
  }, [group.items.length, onClose])
  const prev = useCallback(() => setIdx(i => (i > 0 ? i - 1 : i)), [])

  // Load media for the current item.
  useEffect(() => {
    setMediaSrc(null)
    if (!item || kind === "text") return
    let cancelled = false
    ;(async () => {
      let src = ""
      if (kind === "image") src = (await GetCachedImage(item.Info.ID).catch(() => "")) || ""
      if (!src) src = (await DownloadMedia(STATUS_JID, item.Info.ID).catch(() => "")) || ""
      if (!cancelled) setMediaSrc(src || null)
    })()
    return () => {
      cancelled = true
    }
  }, [item, kind])

  useEffect(() => {
    closeRef.current?.focus()
    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
  }, [])

  // Auto-advance (videos advance on their own end). Suspended while paused or
  // stopped so the progress bar never runs ahead of what the user is reading.
  useEffect(() => {
    if (kind === "video" || paused || stopped) return
    const timer = setTimeout(next, STORY_MS)
    return () => clearTimeout(timer)
  }, [idx, kind, paused, stopped, next])

  // Keyboard nav and pause control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        next()
      } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        prev()
      } else if (event.key === " " && !(event.target as HTMLElement)?.closest("button")) {
        event.preventDefault()
        setPaused(p => !p)
      } else if (event.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [next, prev, onClose])

  const isAdvancing = !paused && !stopped && kind !== "video"

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[9999] flex flex-col bg-black text-white"
    >
      <h2 id={titleId} className="sr-only">
        {group.name}'s status
      </h2>
      <div className="flex gap-1 p-2" role="group" aria-label="Status progress">
        {group.items.map((_, i) => (
          <div key={i} className="h-0.5 flex-1 overflow-hidden rounded bg-white/30">
            {i < idx ? (
              <div className="h-full w-full bg-white" />
            ) : i === idx && kind !== "video" ? (
              <div
                key={`${idx}-${isAdvancing}`}
                className="story-active-bar h-full bg-white"
                style={{
                  animationDuration: `${STORY_MS}ms`,
                  animationPlayState: isAdvancing ? "running" : "paused",
                }}
              />
            ) : i === idx ? (
              <div className="h-full w-full bg-white/70" />
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 pb-2">
        <div className="font-medium">{group.name}</div>
        <div className="flex items-center gap-1">
          {kind !== "video" && !stopped && (
            <button
              type="button"
              onClick={() => setPaused(p => !p)}
              aria-label={paused ? "Resume status" : "Pause status"}
              className={`rounded-lg px-2 py-1 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          {!stopped ? (
            <button
              type="button"
              onClick={() => {
                setStopped(true)
                setPaused(false)
              }}
              aria-label="Stop auto-advancing status"
              className={`rounded-lg px-2 py-1 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setStopped(false)
                setPaused(false)
              }}
              aria-label="Resume auto-advancing status"
              className={`rounded-lg px-2 py-1 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
            >
              Play
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close status viewer"
            className={`rounded-lg px-2 py-1 text-2xl leading-none text-white/80 transition-colors hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
          >
            ×
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <button
          type="button"
          onClick={prev}
          className={`absolute left-0 top-0 z-10 h-full w-1/3 ${FOCUS_RING}`}
          aria-label="Previous status"
        />
        <button
          type="button"
          onClick={next}
          className={`absolute right-0 top-0 z-10 h-full w-1/3 ${FOCUS_RING}`}
          aria-label="Next status"
        />

        {kind === "text" && (
          <div
            className="max-w-lg px-8 text-center text-2xl leading-relaxed text-white [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(caption) }}
          />
        )}
        {kind === "image" &&
          (mediaSrc ? (
            <img src={mediaSrc} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <Spinner />
          ))}
        {kind === "video" &&
          (mediaSrc ? (
            <video
              src={mediaSrc}
              autoPlay
              onEnded={next}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <Spinner />
          ))}

        {kind !== "text" && caption && (
          <div
            className="pointer-events-none absolute bottom-6 left-0 right-0 px-8 text-center text-white [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(caption) }}
          />
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div
      className="h-8 w-8 animate-spin rounded-full border-b-2 border-white"
      role="status"
      aria-label="Loading media"
    />
  )
}
