import { useEffect, useId, useRef, useState } from "react"
import clsx from "clsx"
import { useUIStore } from "../store"

const ZOOM_LEVELS = [1, 1.5, 2] as const
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black"

// Full-screen image viewer. Escape closes; +/= zooms in, - zooms out, 0 resets,
// and Enter toggles zoom (the keyboard equivalent of clicking the image).
export function Lightbox() {
  const src = useUIStore(s => s.lightboxSrc)
  const kind = useUIStore(s => s.lightboxKind)
  const close = useUIStore(s => s.closeLightbox)
  const [zoomIndex, setZoomIndex] = useState(0)

  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  )
  const zoom = ZOOM_LEVELS[zoomIndex]

  useEffect(() => {
    if (!src) return
    setZoomIndex(0)
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
        return
      }
      // Let buttons handle their own Enter/Space activation.
      if (
        (event.key === "Enter" || event.key === " ") &&
        (event.target as HTMLElement)?.closest("button")
      ) {
        return
      }
      if (event.key === "+" || event.key === "=" || event.key === "Enter") {
        event.preventDefault()
        setZoomIndex(i => Math.min(i + 1, ZOOM_LEVELS.length - 1))
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault()
        setZoomIndex(i => Math.max(i - 1, 0))
      } else if (event.key === "0") {
        event.preventDefault()
        setZoomIndex(0)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
  }, [src, close])

  if (!src) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-auto bg-black/90"
      onClick={close}
    >
      <h2 id={titleId} className="sr-only">
        {kind === "video" ? "Video viewer" : "Image viewer"}
      </h2>
      <div className="absolute right-4 top-3 flex items-center gap-2">
        {kind === "image" && (
          <>
            <button
              type="button"
              onClick={event => {
                event.stopPropagation()
                setZoomIndex(i => Math.max(i - 1, 0))
              }}
              aria-label="Zoom out"
              disabled={zoomIndex === 0}
              className={`rounded-lg px-2 py-1 text-lg leading-none text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
            >
              −
            </button>
            <span
              className="min-w-12 text-center text-xs text-white/70"
              role="status"
              aria-live="polite"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={event => {
                event.stopPropagation()
                setZoomIndex(i => Math.min(i + 1, ZOOM_LEVELS.length - 1))
              }}
              aria-label="Zoom in"
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              className={`rounded-lg px-2 py-1 text-lg leading-none text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
            >
              +
            </button>
          </>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="Close viewer"
          className={`rounded-lg px-2 py-1 text-2xl leading-none text-white/80 transition-colors hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
        >
          ×
        </button>
      </div>
      {kind === "video" ? (
        <video
          src={src}
          controls
          autoPlay
          controlsList="nofullscreen"
          disablePictureInPicture
          aria-label="Attachment video"
          onClick={event => event.stopPropagation()}
          className="h-[95vh] w-[95vw] cursor-default object-contain"
        />
      ) : (
        <img
          src={src}
          alt="Attachment"
          onClick={event => {
            event.stopPropagation()
            setZoomIndex(i => (i === 0 ? 1 : 0))
          }}
          className={clsx(
            "select-none object-contain",
            zoom > 1 ? "cursor-zoom-out" : "cursor-zoom-in",
          )}
          style={{ maxHeight: `${92 * zoom}vh`, maxWidth: `${92 * zoom}vw` }}
        />
      )}
    </div>
  )
}
