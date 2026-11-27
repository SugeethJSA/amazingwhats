import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import {
  GetCachedAvatar,
  GetMessageReceipts,
} from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { useContactStore } from "../../store/useContactStore"
import { useMessageStore } from "../../store/useMessageStore"
import { isMe } from "../../lib/self"
import { formatPhone, phoneFromJID } from "../../lib/utils"
import { UserAvatar } from "../../assets/svgs/chat_icons"
import type { MessageReceiptRow } from "../../store/types"

// whatsmeow receipt types that mean "the recipient actually saw it".
const READ_TYPES = new Set(["read", "reads", "read-self", "read_self", "played"])
// Statuses describing our own second device, never another person.
const SELF_TYPES = new Set(["read-self", "read_self", "played-self", "played_self"])

const jidKey = (jid: string) => (jid || "").split("@")[0].split(":")[0]

/**
 * The generated binding uses the Go JSON tags (reader_jid / receipt_type /
 * timestamp). Accept camelCase too so a regenerated binding with different
 * casing can never silently drop every reader. Nothing here invents a reader:
 * a row without a JID is discarded.
 */
export function normalizeReceipts(raw: unknown): MessageReceiptRow[] {
  if (!Array.isArray(raw)) return []
  const out: MessageReceiptRow[] = []
  for (const item of raw) {
    if (typeof item === "string") {
      if (item) out.push({ jid: item, status: "read" })
      continue
    }
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const jid =
      (typeof row.reader_jid === "string" && row.reader_jid) ||
      (typeof row.readerJID === "string" && row.readerJID) ||
      (typeof row.jid === "string" && row.jid) ||
      (typeof row.sender === "string" && row.sender) ||
      ""
    if (!jid) continue
    const status =
      (typeof row.receipt_type === "string" && row.receipt_type) ||
      (typeof row.receiptType === "string" && row.receiptType) ||
      (typeof row.status === "string" && row.status) ||
      ""
    const rawTime = row.timestamp ?? row.time ?? row.read_at ?? row.readAt
    const numeric = typeof rawTime === "number" ? rawTime : Number(rawTime)
    const timestamp = Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
    out.push({ jid, status, timestamp })
  }
  return out
}

// One visible row per person; keep the strongest status they sent.
const statusPriority = (status: string) => {
  const s = (status || "").toLowerCase()
  if (SELF_TYPES.has(s)) return 3
  if (s === "read" || s === "reads") return 2
  if (s === "played") return 1
  return 0
}

export function collapseReceipts(rows: MessageReceiptRow[]): MessageReceiptRow[] {
  const byJid = new Map<string, MessageReceiptRow>()
  for (const row of rows) {
    const key = jidKey(row.jid)
    if (!key) continue
    const existing = byJid.get(key)
    if (!existing || statusPriority(row.status) > statusPriority(existing.status)) {
      byJid.set(key, row)
    }
  }
  return Array.from(byJid.values()).sort(
    (a, b) => statusPriority(b.status) - statusPriority(a.status),
  )
}

function receiptLabel(row: MessageReceiptRow): string {
  const status = (row.status || "").toLowerCase()
  if (SELF_TYPES.has(status) || isMe(row.jid)) return "Your other device"
  if (status === "played") return "Viewed"
  if (READ_TYPES.has(status)) return "Read"
  return "Delivered"
}

function receiptTime(timestamp?: number): string {
  if (!timestamp || timestamp <= 0) return ""
  // The backend stores unix seconds; bindings may surface milliseconds.
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function ReaderRow({ row }: { row: MessageReceiptRow }) {
  const self = isMe(row.jid) || SELF_TYPES.has((row.status || "").toLowerCase())
  const [name, setName] = useState(self ? "You" : "")
  const [avatar, setAvatar] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    if (!self && row.jid) {
      useContactStore
        .getState()
        .getSenderInfo(row.jid)
        .then(({ name: resolved }) => {
          if (live && resolved) setName(resolved)
        })
        .catch(() => {})
    }
    if (row.jid && row.jid !== "me") {
      GetCachedAvatar(row.jid, false)
        .then(url => {
          if (live) setAvatar(url || null)
        })
        .catch(() => {})
    }
    return () => {
      live = false
    }
  }, [row.jid, self])

  // Contacts are named by the contact store. Only when no name exists do we
  // fall back to the JID's local part — never the full JID as display text.
  const displayName =
    name || (self ? "You" : formatPhone(phoneFromJID(row.jid)) || jidKey(row.jid) || "Unknown")
  const time = receiptTime(row.timestamp)

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-dark-tertiary">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-gray-400 [&_svg]:h-5 [&_svg]:w-5">
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserAvatar />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-gray-900 dark:text-gray-100">{displayName}</div>
        <div className="text-[11px] text-gray-600 dark:text-gray-400">
          {receiptLabel(row)}
          {time ? ` · ${time}` : ""}
        </div>
      </div>
    </div>
  )
}

interface ReaderDetailsProps {
  chatId: string
  messageId: string
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * "Message info" popover. Every row comes from durable backend receipts; an
 * empty ledger says so plainly instead of fabricating readers.
 */
export function ReaderDetails({ chatId, messageId, anchorRef, onClose }: ReaderDetailsProps) {
  const [rows, setRows] = useState<MessageReceiptRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setRows(null)
    setFailed(false)
    if (!chatId || !messageId) {
      setRows([])
      return () => {
        live = false
      }
    }
    GetMessageReceipts(chatId, messageId)
      .then(raw => {
        if (!live) return
        const normalized = collapseReceipts(normalizeReceipts(raw))
        setRows(normalized)
        // Feed the durable ledger back into the tick state so a group whose
        // receipts predate this session can show an accurate all-read tick.
        useMessageStore.getState().setMessageReaders(chatId, messageId, normalized)
      })
      .catch(() => {
        // Never surface a raw error (it can contain JIDs or filesystem paths).
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [chatId, messageId])

  useLayoutEffect(() => {
    const pop = popRef.current
    if (!pop) return
    const anchor = anchorRef.current
    const popRect = pop.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const gap = 8

    let top: number
    let left: number
    if (anchor) {
      const rect = anchor.getBoundingClientRect()
      top = rect.bottom + gap
      if (top + popRect.height > vh && rect.top - popRect.height - gap > 0) {
        top = rect.top - popRect.height - gap
      }
      left = rect.right - popRect.width
      if (left + popRect.width > vw) left = vw - popRect.width - gap
      if (left < gap) left = gap
    } else {
      // Anchor can unmount while a row is recycled; keep the panel usable.
      top = Math.max(gap, (vh - popRect.height) / 2)
      left = Math.max(gap, (vw - popRect.width) / 2)
    }
    setPosition({ top, left })
  }, [anchorRef, rows, failed])

  useEffect(() => {
    const popEl = popRef.current
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (popEl?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const handleScroll = () => onClose()

    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("scroll", handleScroll, true)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [anchorRef, onClose])

  const list = rows ?? []
  const header = list.some(row => receiptLabel(row) === "Viewed") ? "Viewed" : "Read by"

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="Message info"
      className="fixed z-9999 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-black/5 bg-white shadow-xl dark:border-white/5 dark:bg-dark-secondary"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 pt-3 pb-2 dark:border-dark-tertiary dark:bg-dark-secondary">
        <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Message info</p>
        {!!list.length && <p className="text-xs text-gray-600 dark:text-gray-400">{header}</p>}
      </div>
      <div className="p-2">
        {failed ? (
          <p className="px-2 py-3 text-sm text-gray-600 dark:text-gray-400">
            Couldn't load receipt information.
          </p>
        ) : rows === null ? (
          <p className="px-2 py-3 text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        ) : list.length === 0 ? (
          <p className="px-2 py-3 text-sm text-gray-600 dark:text-gray-400">
            No receipt information available
          </p>
        ) : (
          list.map(row => <ReaderRow key={`${jidKey(row.jid)}:${row.status}`} row={row} />)
        )}
      </div>
    </div>,
    document.body,
  )
}
