import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react"
import clsx from "clsx"
import { useMessageStore, useUIStore } from "../store"
import type { Message } from "../store/types"
import { useLightboxContext } from "../store/lightboxContext"
import {
  DeleteForMe,
  DownloadImageToFile,
  DownloadMedia,
  DownloadMediaToFile,
  GetCachedImage,
  GetMyJID,
  RevokeMessage,
  SendReaction,
  SetMessagePinned,
  StarMessage,
} from "../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { ForwardDialog } from "./chat/ForwardDialog"
import { CloseIcon, DownloadIcon, PhotosIcon } from "../assets/svgs/chat_icons"
import { DeleteIcon, ForwardIcon, ReactIcon, ReplyIcon, StarIcon } from "../assets/svgs/message_menu_icons"
import { DotsIcon } from "../assets/svgs/settings_icons"

const ZOOM_LEVELS = [1, 1.5, 2, 3] as const
const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏", "🔥"] as const
type DisplayKind = "image" | "video"
type Popover = "reaction" | "more" | null
type ConfirmAction = "delete" | "revoke" | null

/* ------------------------------------------------------------------ icons */

// New glyphs not present in the shared inline-SVG sets. All inherit color so
// the dark viewer can drive them from the button's text color.
type GlyphProps = { className?: string }

const ZoomInIcon = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className={className} aria-hidden="true">
    <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l5.25 5.24 1.41-1.41-5.24-5.25A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 2.2v2.3H12.8v1.5h-2.3v2.3H9v-2.3H6.7v-1.5H9V7.2h1.5z" />
  </svg>
)
const ZoomOutIcon = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className={className} aria-hidden="true">
    <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l5.25 5.24 1.41-1.41-5.24-5.25A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM6.7 9.7h7.6v1.5H6.7V9.7z" />
  </svg>
)
const PrevIcon = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" className={className} aria-hidden="true">
    <path d="M15.6 4.4 8 12l7.6 7.6 1.4-1.4L10.8 12l6.2-6.2-1.4-1.4z" />
  </svg>
)
const NextIcon = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" className={className} aria-hidden="true">
    <path d="M8.4 4.4 7 5.8 13.2 12 7 18.2l1.4 1.4L16 12 8.4 4.4z" />
  </svg>
)
const PinIcon = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className={className} aria-hidden="true">
    <path d="M16 2.5v2l-1 1v4.2l3.1 3.1V16H5.9v-3.2L9 9.7V5.5L8 4.5v-2h8zm-5 13.5h2v5.5l-1-1.4-1 1.4V16z" />
  </svg>
)
const GoToMessageIcon = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" className={className} aria-hidden="true">
    <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm8 4v3H9v2h3v3h2v-3h3v-2h-3V7h-2z" />
  </svg>
)
const RevokeIcon = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 5V2L7 7l5 5V9a5 5 0 1 1-5 5H5a7 7 0 1 0 7-9z" />
  </svg>
)

// The shared icon set mostly uses `currentColor`, but a couple of glyphs bake a
// light-theme text color. Force every icon in the dark viewer to pure white
// with a CSS filter so the action bar stays visually consistent.
function ViewerIcon({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={{ filter: "brightness(0) invert(1)" }}>
      {children}
    </span>
  )
}

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-white/15" aria-hidden="true" />
}

interface ActionButtonProps {
  label: string
  title?: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
}

function ActionButton({ label, title, onClick, disabled, pressed, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      disabled={disabled}
      onClick={event => {
        event.stopPropagation()
        onClick()
      }}
      className={clsx(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-35",
        pressed && "bg-white/20 text-white",
      )}
    >
      <ViewerIcon>{children}</ViewerIcon>
    </button>
  )
}

function NavArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next"
  disabled: boolean
  onClick: () => void
}) {
  const label = direction === "prev" ? "Previous attachment" : "Next attachment"
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${direction === "prev" ? "Left arrow" : "Right arrow"})`}
      disabled={disabled}
      onClick={event => {
        event.stopPropagation()
        onClick()
      }}
      className={clsx(
        "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white/90 ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white disabled:cursor-not-allowed disabled:opacity-25",
        direction === "prev" ? "left-3" : "right-3",
      )}
    >
      <ViewerIcon>{direction === "prev" ? <PrevIcon /> : <NextIcon />}</ViewerIcon>
    </button>
  )
}

/* ------------------------------------------------------------------ utils */

function clampPan(point: { x: number; y: number }, zoom: number) {
  if (typeof window === "undefined") return { x: 0, y: 0 }
  const maxX = ((zoom - 1) * window.innerWidth) / 2
  const maxY = ((zoom - 1) * window.innerHeight) / 2
  return {
    x: Math.min(maxX, Math.max(-maxX, point.x)),
    y: Math.min(maxY, Math.max(-maxY, point.y)),
  }
}

function formatViewerTime(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (isNaN(date.getTime())) return iso
  return date.toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  })
}

/* --------------------------------------------------------------- component */

/**
 * Full-screen media viewer. The legacy `openLightbox(src, kind)` path still
 * works (simple viewer, no message actions); MediaContent additionally writes
 * a message context so the rich WhatsApp-style action bar can do real work.
 */
export function Lightbox() {
  const src = useUIStore(s => s.lightboxSrc)
  const kind = useUIStore(s => s.lightboxKind)
  const close = useUIStore(s => s.closeLightbox)
  const addNotification = useUIStore(s => s.addNotification)
  const setFocusMessageId = useUIStore(s => s.setFocusMessageId)
  // `setActiveChatId` lives on the message store (see ForwardDialog/ChatDetail).
  const setActiveChatId = useMessageStore(s => s.setActiveChatId)
  const allMessages = useMessageStore(s => s.messages)
  const ctx = useLightboxContext()

  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const movedRef = useRef(false)

  const [displaySrc, setDisplaySrc] = useState<string | null>(src)
  const [displayKind, setDisplayKind] = useState<DisplayKind>(kind)
  const [zoomIndex, setZoomIndex] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [mediaLoading, setMediaLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [popover, setPopover] = useState<Popover>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [forwardOpen, setForwardOpen] = useState(false)

  const zoom = ZOOM_LEVELS[zoomIndex]
  const hasMessage = Boolean(ctx.messageId && ctx.chatJid)

  const mediaList = useMemo<Message[]>(() => {
    if (!ctx.chatJid) return []
    const list = allMessages[ctx.chatJid] ?? []
    return list.filter(message => Boolean(message.Content?.imageMessage || message.Content?.videoMessage))
  }, [allMessages, ctx.chatJid])

  const currentIndex = ctx.messageId ? mediaList.findIndex(m => m.Info?.ID === ctx.messageId) : -1
  const canPrev = hasMessage && currentIndex > 0
  const canNext = hasMessage && currentIndex >= 0 && currentIndex < mediaList.length - 1

  const viewerName = ctx.isFromMe
    ? "You"
    : ctx.pushName || ctx.senderJid?.split("@")[0] || ""

  const resetView = useCallback(() => {
    setZoomIndex(0)
    setPan({ x: 0, y: 0 })
    dragRef.current = null
    movedRef.current = false
  }, [])

  // Load the neighbouring attachment's bytes and swap the whole message
  // context so caption/sender/actions all follow the visible media.
  const navigate = useCallback(
    async (direction: -1 | 1) => {
      if (!ctx.chatJid || currentIndex < 0) return
      const next = mediaList[currentIndex + direction]
      const id = next?.Info?.ID
      if (!next || !id) return
      const chatJid = next.Info?.Chat || ctx.chatJid
      const isVideo = Boolean(next.Content?.videoMessage)
      const body = next.Content?.imageMessage ?? next.Content?.videoMessage

      setMediaLoading(true)
      setPopover(null)
      setConfirmAction(null)
      try {
        let url = ""
        if (isVideo) {
          url = await DownloadMedia(chatJid, id)
        } else {
          try {
            url = await GetCachedImage(id)
          } catch {
            url = ""
          }
          if (!url) url = await DownloadMedia(chatJid, id)
        }
        if (!url) throw new Error("No media bytes returned")

        setDisplaySrc(url)
        setDisplayKind(isVideo ? "video" : "image")
        resetView()
        useLightboxContext.getState().setLightboxMessage({
          messageId: id,
          chatJid,
          senderJid: next.Info?.Sender ?? null,
          pushName: next.Info?.PushName ?? null,
          timestamp: next.Info?.Timestamp ?? null,
          caption: body?.caption ?? null,
          isFromMe: Boolean(next.Info?.IsFromMe),
          // Star/pin state is not carried on Message.Info; start clean for the
          // newly visible message and let the toggles update it optimistically.
          starred: false,
          pinned: false,
        })
      } catch {
        addNotification("Could not load that attachment", { tone: "error" })
      } finally {
        setMediaLoading(false)
      }
    },
    [ctx.chatJid, currentIndex, mediaList, addNotification, resetView],
  )

  const runAction = useCallback(
    async (fn: () => Promise<void>, success?: string, failure = "Could not complete that action") => {
      setBusy(true)
      setPopover(null)
      try {
        await fn()
        if (success) addNotification(success, { tone: "success" })
      } catch {
        addNotification(failure, { tone: "error" })
      } finally {
        setBusy(false)
      }
    },
    [addNotification],
  )

  const handleDownload = useCallback(() => {
    const id = ctx.messageId
    if (!id) return
    void runAction(
      () => (displayKind === "video" ? DownloadMediaToFile(id) : DownloadImageToFile(id)),
      "Saved to downloads",
      "Download failed",
    )
  }, [ctx.messageId, displayKind, runAction])

  const handleStar = useCallback(() => {
    const id = ctx.messageId
    const jid = ctx.chatJid
    if (!id || !jid) return
    const next = !ctx.starred
    void runAction(
      async () => {
        await StarMessage(jid, id, next)
        useLightboxContext.getState().setLightboxMessage({ starred: next })
      },
      next ? "Message starred" : "Star removed",
      "Could not update star",
    )
  }, [ctx.messageId, ctx.chatJid, ctx.starred, runAction])

  const handlePin = useCallback(() => {
    const id = ctx.messageId
    const jid = ctx.chatJid
    if (!id || !jid) return
    const next = !ctx.pinned
    void runAction(
      async () => {
        await SetMessagePinned(jid, ctx.senderJid ?? "", id, ctx.isFromMe, next)
        useLightboxContext.getState().setLightboxMessage({ pinned: next })
      },
      next ? "Message pinned" : "Message unpinned",
      "Could not update pin",
    )
  }, [ctx.messageId, ctx.chatJid, ctx.senderJid, ctx.isFromMe, ctx.pinned, runAction])

  const handleReact = useCallback(
    (emoji: string) => {
      const id = ctx.messageId
      const jid = ctx.chatJid
      if (!id || !jid) return
      const sender = ctx.senderJid ?? ""
      void runAction(
        async () => {
          await SendReaction(jid, sender, id, emoji)
          const myJid = await GetMyJID().catch(() => "")
          useMessageStore.getState().addReactionToMessage(jid, id, emoji, myJid || sender)
        },
        "Reaction sent",
        "Could not send reaction",
      )
    },
    [ctx.messageId, ctx.chatJid, ctx.senderJid, runAction],
  )

  const handleConfirmDelete = useCallback(() => {
    const id = ctx.messageId
    const jid = ctx.chatJid
    const action = confirmAction
    if (!id || !jid || !action) return
    setConfirmAction(null)
    void runAction(
      async () => {
        if (action === "revoke") await RevokeMessage(jid, id)
        else await DeleteForMe(jid, id)
        close()
      },
      action === "revoke" ? "Message revoked" : "Message deleted for you",
      "Could not delete message",
    )
  }, [ctx.messageId, ctx.chatJid, confirmAction, close, runAction])

  const jumpToMessage = useCallback(() => {
    const id = ctx.messageId
    const jid = ctx.chatJid
    if (!id || !jid) return
    setFocusMessageId(id)
    setActiveChatId(jid)
    close()
  }, [ctx.messageId, ctx.chatJid, setFocusMessageId, setActiveChatId, close])

  const handleReply = useCallback(() => {
    jumpToMessage()
    // No global "set reply target" intent exists, so guide the user after the
    // jump rather than fabricating a reply that was never sent.
    addNotification("Reply to this message from the chat view", { tone: "info" })
  }, [jumpToMessage, addNotification])

  /* ------------------------------------------------------------ open/close */

  useEffect(() => {
    if (src && !wasOpenRef.current) {
      returnFocusRef.current =
        typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null
      wasOpenRef.current = true
      setForwardOpen(false)
      setPopover(null)
      setConfirmAction(null)
    }
    if (!src && wasOpenRef.current) {
      wasOpenRef.current = false
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
    if (src) {
      setDisplaySrc(src)
      setDisplayKind(kind)
      setMediaLoading(false)
      resetView()
      closeRef.current?.focus()
    }
  }, [src, kind, resetView])

  useEffect(() => {
    if (!src) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const inButton = Boolean(target?.closest("button"))

      if (event.key === "Escape") {
        event.preventDefault()
        if (forwardOpen) {
          setForwardOpen(false)
          return
        }
        if (confirmAction) {
          setConfirmAction(null)
          return
        }
        if (popover) {
          setPopover(null)
          return
        }
        close()
        return
      }
      if (event.key === "ArrowLeft") {
        if (canPrev) {
          event.preventDefault()
          void navigate(-1)
        }
        return
      }
      if (event.key === "ArrowRight") {
        if (canNext) {
          event.preventDefault()
          void navigate(1)
        }
        return
      }
      // Let focused buttons handle their own Enter/Space activation.
      if (inButton && (event.key === "Enter" || event.key === " ")) return
      if (event.key === "+" || event.key === "=") {
        setZoomIndex(i => Math.min(i + 1, ZOOM_LEVELS.length - 1))
      } else if (event.key === "-" || event.key === "_") {
        setZoomIndex(i => Math.max(i - 1, 0))
      } else if (event.key === "0") {
        setZoomIndex(0)
        setPan({ x: 0, y: 0 })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [src, close, canPrev, canNext, navigate, forwardOpen, confirmAction, popover])

  /* ---------------------------------------------------------------- gestures */

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (displayKind !== "image" || zoom <= 1) return
    movedRef.current = false
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true
    setPan(clampPan({ x: drag.originX + dx, y: drag.originY + dy }, zoom))
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const onMediaClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    if (displayKind !== "image") return
    setZoomIndex(i => (i === 0 ? 1 : 0))
    setPan({ x: 0, y: 0 })
  }

  if (!src) return null

  const shownSrc = displaySrc ?? src
  const showNav = hasMessage && mediaList.length > 1 && currentIndex >= 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-black/95 text-white backdrop-blur-sm"
      // ForwardDialog portals to document.body at z-50; drop below it only
      // while that dialog is open so it can actually be seen and used.
      style={forwardOpen ? { zIndex: 40 } : undefined}
      onClick={close}
    >
      <h2 id={titleId} className="sr-only">
        {displayKind === "video" ? "Video viewer" : "Image viewer"}
      </h2>

      {/* ------------------------------------------------------------- header */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-4 pb-14 pt-3"
        onClick={event => event.stopPropagation()}
      >
        <div className="pointer-events-auto flex min-w-0 items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white"
          >
            {viewerName ? viewerName.charAt(0).toUpperCase() : <ViewerIcon><PhotosIcon /></ViewerIcon>}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-semibold text-white">{viewerName}</span>
              {ctx.timestamp && (
                <span className="shrink-0 text-xs text-white/60">{formatViewerTime(ctx.timestamp)}</span>
              )}
            </div>
            {ctx.caption && (
              <p className="mt-0.5 line-clamp-2 max-w-md break-words text-xs text-white/75">
                {ctx.caption}
              </p>
            )}
            {showNav && (
              <p className="mt-0.5 text-[11px] text-white/50">
                {currentIndex + 1} of {mediaList.length}
              </p>
            )}
          </div>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1">
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close viewer"
            title="Close (Esc)"
            className={`flex h-9 w-9 items-center justify-center rounded-xl text-white/85 transition-colors hover:bg-white/15 hover:text-white`}
          >
            <ViewerIcon><CloseIcon /></ViewerIcon>
          </button>
        </div>
      </header>

      {/* --------------------------------------------------------------- media */}
      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-14 py-20">
        <div
          onClick={onMediaClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative flex max-h-full max-w-full items-center justify-center"
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)`, touchAction: "none" }}
        >
          {displayKind === "video" ? (
            <video
              src={shownSrc}
              controls
              autoPlay
              controlsList="nofullscreen"
              disablePictureInPicture
              aria-label={ctx.caption || "Attachment video"}
              onClick={event => event.stopPropagation()}
              className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            />
          ) : (
            <img
              src={shownSrc}
              alt={ctx.caption || "Attachment"}
              draggable={false}
              className={clsx(
                "select-none object-contain shadow-2xl",
                zoom > 1 ? "cursor-grab" : "cursor-zoom-in",
              )}
              style={{ maxHeight: `${80 * zoom}vh`, maxWidth: `${90 * zoom}vw` }}
            />
          )}
        </div>

        {showNav && (
          <>
            <NavArrow direction="prev" disabled={!canPrev} onClick={() => void navigate(-1)} />
            <NavArrow direction="next" disabled={!canNext} onClick={() => void navigate(1)} />
          </>
        )}

        {mediaLoading && (
          <div
            role="status"
            aria-label="Loading attachment"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40"
          >
            <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
      </main>

      {/* -------------------------------------------------------- action bar */}
      <div
        className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-4"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl bg-neutral-900/90 p-1.5 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
          {displayKind === "image" && (
            <>
              <ActionButton
                label="Zoom out"
                title="Zoom out (−)"
                onClick={() => setZoomIndex(i => Math.max(i - 1, 0))}
                disabled={zoomIndex === 0}
              >
                <ZoomOutIcon />
              </ActionButton>
              <span
                role="status"
                aria-live="polite"
                className="min-w-11 select-none text-center text-[11px] font-medium tabular-nums text-white/70"
              >
                {Math.round(zoom * 100)}%
              </span>
              <ActionButton
                label="Zoom in"
                title="Zoom in (+)"
                onClick={() => setZoomIndex(i => Math.min(i + 1, ZOOM_LEVELS.length - 1))}
                disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              >
                <ZoomInIcon />
              </ActionButton>
              <Divider />
            </>
          )}

          {hasMessage ? (
            <>
              <ActionButton label="Go to message" title="Go to message" onClick={jumpToMessage}>
                <GoToMessageIcon />
              </ActionButton>
              <ActionButton label="Reply" title="Reply from the chat view" onClick={handleReply}>
                <ReplyIcon />
              </ActionButton>
              <ActionButton label="Download" title="Download" onClick={handleDownload} disabled={busy}>
                <DownloadIcon />
              </ActionButton>
              <ActionButton
                label={ctx.starred ? "Remove star" : "Star message"}
                title={ctx.starred ? "Unstar" : "Star"}
                onClick={handleStar}
                disabled={busy}
                pressed={ctx.starred}
              >
                <StarIcon />
              </ActionButton>
              <ActionButton
                label={ctx.pinned ? "Unpin message" : "Pin message"}
                title={ctx.pinned ? "Unpin" : "Pin"}
                onClick={handlePin}
                disabled={busy}
                pressed={ctx.pinned}
              >
                <PinIcon />
              </ActionButton>
              <ActionButton
                label="React"
                title="React"
                onClick={() => setPopover(p => (p === "reaction" ? null : "reaction"))}
                disabled={busy}
              >
                <ReactIcon />
              </ActionButton>
              <ActionButton label="Forward" title="Forward" onClick={() => setForwardOpen(true)} disabled={busy}>
                <ForwardIcon />
              </ActionButton>
              <ActionButton
                label="More options"
                title="More"
                onClick={() => {
                  setConfirmAction(null)
                  setPopover(p => (p === "more" ? null : "more"))
                }}
                disabled={busy}
              >
                <DotsIcon />
              </ActionButton>
            </>
          ) : (
            <span className="px-3 text-xs text-white/60">Attachment preview</span>
          )}

          <Divider />
          <ActionButton label="Close viewer" title="Close (Esc)" onClick={close}>
            <CloseIcon />
          </ActionButton>
        </div>
      </div>

      {/* ------------------------------------------------------------ popovers */}
      {popover === "reaction" && hasMessage && (
        <div
          role="group"
          aria-label="Choose a reaction"
          onClick={event => event.stopPropagation()}
          className="absolute bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl bg-neutral-900/95 p-2 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
        >
          {QUICK_REACTIONS.map(emoji => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              title={emoji}
              onClick={() => handleReact(emoji)}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-xl transition-transform hover:scale-110 hover:bg-white/10`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {popover === "more" && !confirmAction && hasMessage && (
        <div
          role="menu"
          aria-label="More actions"
          onClick={event => event.stopPropagation()}
          className="absolute bottom-20 right-4 z-30 w-52 overflow-hidden rounded-xl bg-neutral-900/95 py-1 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
        >
          <button
            type="button"
            role="menuitem"
            aria-label="Delete for me"
            title="Delete for me"
            onClick={() => {
              setConfirmAction("delete")
              setPopover(null)
            }}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-white/90 transition-colors hover:bg-white/10`}
          >
            <ViewerIcon><DeleteIcon /></ViewerIcon>
            Delete for me
          </button>
          {ctx.isFromMe && (
            <button
              type="button"
              role="menuitem"
              aria-label="Revoke for everyone"
              title="Revoke for everyone"
              onClick={() => {
                setConfirmAction("revoke")
                setPopover(null)
              }}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-white/90 transition-colors hover:bg-white/10`}
            >
              <ViewerIcon><RevokeIcon /></ViewerIcon>
              Revoke for everyone
            </button>
          )}
        </div>
      )}

      {confirmAction && (
        <div
          role="alertdialog"
          aria-label="Confirm deletion"
          onClick={event => event.stopPropagation()}
          className="absolute bottom-20 left-1/2 z-30 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl bg-neutral-900/95 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
        >
          <p className="text-sm text-white/90">
            {confirmAction === "revoke"
              ? "Revoke this message for everyone?"
              : "Delete this message for you?"}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              aria-label="Cancel"
              title="Cancel"
              onClick={() => setConfirmAction(null)}
              className={`rounded-lg px-3 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white`}
            >
              Cancel
            </button>
            <button
              type="button"
              aria-label={confirmAction === "revoke" ? "Confirm revoke" : "Confirm delete"}
              title={confirmAction === "revoke" ? "Confirm revoke" : "Confirm delete"}
              onClick={handleConfirmDelete}
              disabled={busy}
              className={`rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {confirmAction === "revoke" ? "Revoke" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {forwardOpen && ctx.chatJid && ctx.messageId && (
        <ForwardDialog
          sourceJID={ctx.chatJid}
          messageID={ctx.messageId}
          onClose={() => setForwardOpen(false)}
        />
      )}
    </div>
  )
}
