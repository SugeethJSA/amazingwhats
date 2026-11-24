import { useState, useEffect, useRef, useCallback } from "react"
import {
  GetCachedImage,
  GetCachedImages,
  DownloadMedia,
  GetVideoThumbnail,
  GetImageThumbnail,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { useUIStore } from "../../store"
import { useLightboxContext } from "../../store/lightboxContext"
import type { Message, MediaMessageContent } from "../../store/types"
import { LRUCache } from "../../lib/lruCache"

// TODO: fix word wrap for longer words in content

// GIFs (WhatsApp sends them as short muted videos) loop a few times then stop.
const MAX_GIF_LOOPS = 3

// Rendered bounds for chat images/GIF videos. These must match the Tailwind
// classes on the media elements below: min-w-75 (300px), max-w-82.5 (330px),
// max-h-100 (400px).
const MEDIA_MIN_W = 300
const MEDIA_MAX_W = 330
const MEDIA_MAX_H = 400

// Data URLs can be large. Keep enough recently viewed media to avoid flicker
// when Virtuoso remounts nearby rows without retaining every chat image for the
// lifetime of the process.
const imagePathCache = new LRUCache<string, string>(48, 32 * 1024 * 1024, value => value.length)
const videoThumbCache = new LRUCache<string, string>(100, 16 * 1024 * 1024, value => value.length)
const imageThumbCache = new LRUCache<string, string>(100, 8 * 1024 * 1024, value => value.length)
const mediaRequests = new Map<string, Promise<string>>()
const THUMB_MISS = "__miss__"
const PRELOAD_BATCH_LIMIT = 8

// A thumbnail miss is usually transient — the full image may simply not have
// been downloaded yet. Never park it permanently in the LRU: keep a small,
// short-TTL negative map instead so the thumbnail is retried after the image
// lands (D-AUD-003h).
const THUMB_MISS_TTL_MS = 5_000
const MAX_THUMB_MISS = 128
const thumbMissUntil = new Map<string, number>()

function isThumbMiss(id: string): boolean {
  const until = thumbMissUntil.get(id)
  if (until === undefined) return false
  if (Date.now() < until) return true
  thumbMissUntil.delete(id)
  return false
}

function markThumbMiss(id: string) {
  if (!thumbMissUntil.has(id) && thumbMissUntil.size >= MAX_THUMB_MISS) {
    const oldest = thumbMissUntil.keys().next().value
    if (oldest !== undefined) thumbMissUntil.delete(oldest)
  }
  thumbMissUntil.set(id, Date.now() + THUMB_MISS_TTL_MS)
}

function clearThumbMiss(id: string) {
  thumbMissUntil.delete(id)
}

function loadMediaOnce(key: string, loader: () => Promise<string>): Promise<string> {
  const existing = mediaRequests.get(key)
  if (existing) return existing
  const request = loader().finally(() => {
    if (mediaRequests.get(key) === request) mediaRequests.delete(key)
  })
  mediaRequests.set(key, request)
  return request
}

// Batch preloading: coalesce nearby on-screen images into capped GetCachedImages
// calls, and let handleDownload wait for the in-flight batch instead of issuing
// a duplicate single-image IPC request.
const pendingPreload = new Set<string>()
const preloadWaiters = new Map<string, { promise: Promise<void>; resolve: () => void }>()
let preloadInFlight = false

function waiterFor(id: string): Promise<void> {
  const existing = preloadWaiters.get(id)
  if (existing) return existing.promise
  let resolve = () => {}
  const promise = new Promise<void>(r => {
    resolve = r
  })
  preloadWaiters.set(id, { promise, resolve })
  return promise
}

function resolveWaiter(id: string) {
  const waiter = preloadWaiters.get(id)
  if (!waiter) return
  waiter.resolve()
  preloadWaiters.delete(id)
}

type PreloadMessage = {
  Info?: { ID?: string }
  Content?: { imageMessage?: unknown; stickerMessage?: unknown }
}

export function imageMediaIDs(messages: PreloadMessage[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (!message.Content?.imageMessage && !message.Content?.stickerMessage) continue
    const id = message.Info?.ID
    if (id && !id.startsWith("temp-")) ids.push(id)
  }
  return ids
}

export function visibleImageIDs(messages: PreloadMessage[], limit = PRELOAD_BATCH_LIMIT): string[] {
  const ids = imageMediaIDs(messages)
  return ids.length <= limit ? ids : ids.slice(-limit)
}

export function preloadImages(ids: string[]) {
  if (ids.length === 0) return
  for (const id of ids) {
    if (!id || imagePathCache.has(id)) continue
    pendingPreload.add(id)
    waiterFor(id)
  }
  pumpPreload()
}

function pumpPreload() {
  if (preloadInFlight) return
  const batch: string[] = []
  for (const id of pendingPreload) {
    if (imagePathCache.has(id)) {
      pendingPreload.delete(id)
      resolveWaiter(id)
      continue
    }
    batch.push(id)
    pendingPreload.delete(id)
    if (batch.length >= PRELOAD_BATCH_LIMIT) break
  }
  if (batch.length === 0) return

  preloadInFlight = true
  void GetCachedImages(batch)
    .then(map => {
      for (const [id, dataUrl] of Object.entries(map)) {
        if (dataUrl) {
          imagePathCache.set(id, dataUrl)
          clearThumbMiss(id) // full image is now cached; retry its thumbnail if needed
        }
      }
    })
    .catch(() => {})
    .finally(() => {
      for (const id of batch) resolveWaiter(id)
      preloadInFlight = false
      pumpPreload()
    })
}

// Fallback box for GIF videos whose dimensions were never stored (rows synced
// before dimension extraction existed). A fixed square with object-cover is
// deterministic: the placeholder and the loaded video occupy the same box, so
// the row height never changes.
const GIF_FALLBACK_BOX = { width: 256, height: 256 }
const IMAGE_FALLBACK_BOX = { width: 300, height: 256 }

// Computes the exact box CSS gives the loaded media from its intrinsic
// dimensions (stored by the backend in message_media), so the placeholder can
// reserve identical space up front. Without this the row height changes when
// the pixels arrive, which makes Virtuoso re-anchor and the list visibly
// jump while scrolling.
export function mediaBox(w?: number, h?: number): { width: number; height: number } | null {
  if (!w || !h || w <= 0 || h <= 0) return null
  const scale = Math.min(MEDIA_MAX_W / w, MEDIA_MAX_H / h, 1)
  let width = w * scale
  let height = h * scale
  if (width < MEDIA_MIN_W) {
    // Mirrors CSS min-width resolution: widen to the minimum, scale height by
    // the same factor, clamp to max height (object-cover crops the overflow).
    height = Math.min(MEDIA_MAX_H, (height * MEDIA_MIN_W) / width)
    width = MEDIA_MIN_W
  }
  return { width: Math.round(width), height: Math.round(height) }
}

interface MediaContentProps {
  message: Message
  type: "image" | "video" | "sticker" | "audio" | "document"
  chatId: string
  isGif?: boolean
  sentMediaCache?: React.MutableRefObject<Map<string, string>>
  onImageClick?: (src: string) => void
  onDownload?: () => void
}

export function MediaContent({
  message,
  type,
  chatId,
  isGif,
  sentMediaCache,
  onImageClick,
  onDownload,
}: MediaContentProps) {
  // Seed from the module caches so a remounted row paints its final content
  // immediately instead of placeholder-then-swap.
  const [mediaSrc, setMediaSrc] = useState<string | null>(
    () => imagePathCache.get(message.Info.ID) ?? null,
  )
  const [loading, setLoading] = useState(false)
  const [showDownloadButton, setShowDownloadButton] = useState(false)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(
    () => videoThumbCache.get(message.Info.ID) ?? null,
  )
  const [imageThumbnailSrc, setImageThumbnailSrc] = useState<string | null>(() => {
    const cached = imageThumbCache.get(message.Info.ID)
    return cached && cached !== THUMB_MISS ? cached : null
  })
  const loadingRef = useRef(false)
  const mountedRef = useRef(true)
  const gifLoopsRef = useRef(0)
  const placeholderRef = useRef<HTMLDivElement | null>(null)
  const openLightbox = useUIStore(s => s.openLightbox)

  // Publish the message context before the legacy byte-only lightbox opens, so
  // the viewer can show sender/caption and offer real message actions.
  const openViewer = (src: string, kind: "image" | "video", message: Message, chatId: string) => {
    const info = message.Info
    const body = message.Content?.imageMessage ?? message.Content?.videoMessage
    useLightboxContext.getState().setLightboxMessage({
      messageId: info?.ID || null,
      chatJid: chatId || info?.Chat || null,
      senderJid: info?.Sender || null,
      pushName: info?.PushName || null,
      timestamp: info?.Timestamp || null,
      caption: body?.caption || null,
      isFromMe: Boolean(info?.IsFromMe),
      starred: false,
      pinned: false,
    })
    openLightbox(src, kind)
  }

  const handleDownloadRef = useRef<(() => Promise<string | null>) | null>(null)

  // Reserve the final layout box before the media loads. Only images and GIF
  // videos swap a placeholder for an inline element, so only they can shift.
  const messageBody = message.Content?.[`${type}Message`] as MediaMessageContent | undefined
  // GIFs sent as raw .gif files carry mimetype image/gif — the decrypted
  // bytes are a GIF image (playable in <img>), not a video file.
  const isRawGif = type === "video" && isGif && messageBody?.mimetype === "image/gif"
  const reservedBox =
    type === "image" || (type === "video" && isGif)
      ? (mediaBox(messageBody?.width, messageBody?.height) ??
        (type === "image" ? IMAGE_FALLBACK_BOX : GIF_FALLBACK_BOX))
      : null

  const handleDownload = useCallback(async (): Promise<string | null> => {
    if (type === "image" || type === "sticker") {
      const cached = imagePathCache.get(message.Info.ID)
      if (cached) {
        if (mountedRef.current) setMediaSrc(cached)
        return cached
      }
      // A batch preload may already be in flight for this row — wait for it
      // so we don't issue a duplicate single-image IPC request.
      const pending = preloadWaiters.get(message.Info.ID)?.promise
      if (pending) await pending
      const afterBatch = imagePathCache.get(message.Info.ID)
      if (afterBatch) {
        if (mountedRef.current) setMediaSrc(afterBatch)
        return afterBatch
      }
    }
    if (loadingRef.current) return null
    loadingRef.current = true
    setLoading(true)
    try {
      const dataUrl =
        type === "image" || type === "sticker"
          ? await loadMediaOnce(`image:${message.Info.ID}`, () => GetCachedImage(message.Info.ID))
          : await loadMediaOnce(`media:${chatId}:${message.Info.ID}`, () =>
              DownloadMedia(chatId, message.Info.ID),
            )
      if (dataUrl) {
        if (type === "image" || type === "sticker" || isGif) {
          imagePathCache.set(message.Info.ID, dataUrl)
          clearThumbMiss(message.Info.ID)
        }
        if (mountedRef.current) setMediaSrc(dataUrl)
        return dataUrl
      }
      return null
    } catch {
      // Keep the download affordance available for a retry.
      return null
    } finally {
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [type, chatId, isGif, message.Info.ID])

  useEffect(() => {
    handleDownloadRef.current = handleDownload
  }, [handleDownload])

  // Regular videos play full-screen in the lightbox (keeps the chat thumbnail).
  // The downloaded data URL is cached in a ref so reopening doesn't re-download.
  const videoDataRef = useRef<string>("")
  const openVideo = async () => {
    if (videoDataRef.current) {
      openViewer(videoDataRef.current, "video", message, chatId)
      return
    }
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const dataUrl = await loadMediaOnce(`media:${chatId}:${message.Info.ID}`, () =>
        DownloadMedia(chatId, message.Info.ID),
      )
      videoDataRef.current = dataUrl
      openViewer(dataUrl, "video", message, chatId)
    } catch {
    } finally {
      loadingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const messageBody = message.Content?.[`${type}Message`] as MediaMessageContent | undefined

    if (messageBody?._tempImage) {
      setMediaSrc(messageBody._tempImage)
      return
    }
    if (messageBody?._tempFile) {
      const blobUrl = URL.createObjectURL(messageBody._tempFile)
      setMediaSrc(blobUrl)
      return
    }
    if (sentMediaCache?.current.has(message.Info.ID)) {
      setMediaSrc(sentMediaCache.current.get(message.Info.ID)!)
      return
    }
  }, [message.Content, message.Info.ID, sentMediaCache, type])

  // Auto-download image/sticker media once it's visible on screen — covers both
  // "already visible when the chat opens" and "scrolled into view". Debounced so
  // rows blazed past during a fast scroll don't fetch. Thumbnails share the same
  // observer so off-screen rows don't hit SQLite on every remount.
  useEffect(() => {
    const autoLoads = type === "image" || type === "sticker" || (type === "video" && isGif)
    const id = message.Info.ID
    const wantsThumb =
      type === "image" &&
      !mediaSrc &&
      !imageThumbnailSrc &&
      !id.startsWith("temp-") &&
      !imageThumbCache.has(id) &&
      !isThumbMiss(id)
    if (mediaSrc || (!autoLoads && !wantsThumb)) return
    const el = placeholderRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => {
            if (
              type === "image" &&
              !id.startsWith("temp-") &&
              !imageThumbCache.has(id) &&
              !isThumbMiss(id) &&
              !imagePathCache.has(id)
            ) {
              void loadMediaOnce(`thumb:${id}`, async () => {
                try {
                  const url = await GetImageThumbnail(id)
                  if (url) imageThumbCache.set(id, url)
                  else markThumbMiss(id)
                  return url
                } catch {
                  markThumbMiss(id)
                  return ""
                }
              }).then(url => {
                if (url && mountedRef.current) setImageThumbnailSrc(url)
              })
            }
            if (autoLoads) void handleDownloadRef.current?.()
          }, 200)
        } else if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      },
      { rootMargin: "150px", threshold: 0.01 },
    )
    obs.observe(el)
    return () => {
      obs.disconnect()
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSrc, type, isGif, message.Info.ID, imageThumbnailSrc])

  // Fetch the embedded preview for regular videos so the list shows a thumbnail
  // + play button without downloading the whole video. (GIFs auto-play instead.)
  useEffect(() => {
    if (type !== "video" || isGif || mediaSrc || thumbnailSrc) return
    let cancelled = false
    GetVideoThumbnail(message.Info.ID)
      .then(url => {
        if (!url) return
        videoThumbCache.set(message.Info.ID, url)
        if (!cancelled) setThumbnailSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [type, isGif, mediaSrc, thumbnailSrc, message.Info.ID])

  useEffect(() => {
    // Cleanup blob URLs when component unmounts or mediaSrc changes
    return () => {
      if (mediaSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(mediaSrc)
      }
    }
  }, [mediaSrc])

  // Accessible names for the tappable image/GIF previews. Prefer the sender's
  // display name; otherwise use a neutral "attachment" label. Never fabricate
  // a name from a raw JID/ID.
  const mediaSender = message.Info.PushName?.trim()
  const mediaNoun = type === "sticker" ? "sticker" : isRawGif ? "GIF" : "image"
  const mediaOpenLabel = mediaSender
    ? `Open ${mediaNoun} from ${mediaSender}`
    : `Open ${mediaNoun} attachment`

  if (mediaSrc) {
    if (type === "image" || type === "sticker") {
      return (
        <div
          className="relative inline-block"
          onMouseEnter={() => type === "image" && setShowDownloadButton(true)}
          onMouseLeave={() => type === "image" && setShowDownloadButton(false)}
        >
          <button
            type="button"
            aria-label={mediaOpenLabel}
            // The button owns the reserved box so the image fills exactly the
            // same placeholder-sized area as before -> zero layout shift.
            className="block p-0 border-0 bg-transparent rounded-lg overflow-hidden cursor-pointer"
            style={type === "image" ? (reservedBox ?? undefined) : undefined}
            onClick={() => {
              onImageClick?.(mediaSrc)
              openViewer(mediaSrc, "image", message, chatId)
            }}
          >
            <img
              src={mediaSrc}
              className={
                type === "image"
                  ? "block w-full h-full min-w-75 max-w-82.5 max-h-100 object-cover rounded-lg"
                  : "object-contain w-48.75 h-48.75"
              }
              decoding="async"
              alt=""
            />
          </button>
          {type === "image" && showDownloadButton && onDownload && (
            <button
              onClick={e => {
                e.stopPropagation()
                onDownload()
              }}
              className="absolute top-2 right-2 p-2 bg-black/70 hover:bg-black/90 rounded-full text-white transition-colors"
              title="Download image"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
              </svg>
            </button>
          )}
        </div>
      )
    }
    if (type === "video" && isRawGif) {
      return (
        <button
          type="button"
          aria-label={mediaOpenLabel}
          // Button owns the reserved box; image fills it, so the click target
          // and rendered size stay identical to the previous <img>.
          className="block p-0 border-0 bg-transparent rounded-lg overflow-hidden cursor-pointer"
          style={reservedBox ?? GIF_FALLBACK_BOX}
          onClick={() => {
            onImageClick?.(mediaSrc)
            openViewer(mediaSrc, "image", message, chatId)
          }}
        >
          <img
            src={mediaSrc}
            className="block w-full h-full min-w-75 max-w-82.5 max-h-100 object-cover rounded-lg"
            decoding="async"
            alt=""
          />
        </button>
      )
    }
    if (type === "video")
      return isGif ? (
        <video
          src={mediaSrc}
          autoPlay
          muted
          playsInline
          onEnded={e => {
            if (gifLoopsRef.current < MAX_GIF_LOOPS - 1) {
              gifLoopsRef.current += 1
              const v = e.currentTarget
              v.currentTime = 0
              void v.play().catch(() => {})
            }
          }}
          onClick={e => {
            // Replay from the start when clicked, even after it has stopped.
            const v = e.currentTarget
            gifLoopsRef.current = 0
            v.currentTime = 0
            void v.play().catch(() => {})
          }}
          className="block min-w-75 max-w-82.5 max-h-100 rounded-lg cursor-pointer object-cover"
          style={reservedBox ?? GIF_FALLBACK_BOX}
        />
      ) : (
        <video src={mediaSrc} controls className="block w-64 h-64 rounded-lg object-cover" />
      )
    if (type === "audio") {
      if (messageBody?.ptt) {
        // Voice notes must actually play (D-AUD-003b): the old static mic button
        // and fake progress bar were dead controls. Keep the mic as a decorative
        // icon and hand playback to the browser's native audio controls.
        return (
          <div className="flex items-center gap-2 w-75 h-14 rounded-lg bg-gray-200 dark:bg-gray-800 px-3">
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              className="shrink-0 text-gray-600 dark:text-gray-300 fill-current"
              aria-hidden="true"
            >
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            <audio src={mediaSrc} controls preload="metadata" className="flex-1 min-w-0 h-10" />
          </div>
        )
      }
      return <audio src={mediaSrc} controls className="w-75 h-14" />
    }
  }

  // Lightweight image thumbnail: shown while the full image is still on disk,
  // clicking it loads the full-resolution data URL.
  if (type === "image" && imageThumbnailSrc) {
    return (
      <div
        ref={placeholderRef}
        className="relative w-64 h-64 bg-gray-200 dark:bg-gray-800 rounded-lg flex items-center justify-center overflow-hidden"
        style={reservedBox ?? IMAGE_FALLBACK_BOX}
        onMouseEnter={() => setShowDownloadButton(true)}
        onMouseLeave={() => setShowDownloadButton(false)}
      >
        <img
          src={imageThumbnailSrc}
          className="w-full h-full object-cover rounded-lg cursor-pointer"
          decoding="async"
          alt="media"
          onClick={() => void handleDownload()}
        />
        {loading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          </div>
        )}
        {showDownloadButton && onDownload && !loading && (
          <button
            onClick={e => {
              e.stopPropagation()
              void handleDownload().then(url => {
                if (url) onDownload()
              })
            }}
            className="absolute top-2 right-2 p-2 bg-black/70 hover:bg-black/90 rounded-full text-white transition-colors"
            title="Download image"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  // Video placeholder: show the embedded thumbnail (if any) with a play button
  // so it's clearly a video, and only download the full file on click.
  if (type === "video") {
    return (
      <div
        ref={placeholderRef}
        onClick={isRawGif ? () => void handleDownload() : openVideo}
        className="relative w-64 h-64 rounded-lg overflow-hidden bg-gray-300 dark:bg-gray-800 flex items-center justify-center cursor-pointer bg-cover bg-center"
        // GIFs auto-swap this placeholder for the inline <video>, so it must
        // already occupy the video's final box when dimensions are known.
        style={{
          ...(isGif ? (reservedBox ?? GIF_FALLBACK_BOX) : null),
          ...(thumbnailSrc ? { backgroundImage: `url(${thumbnailSrc})` } : null),
        }}
      >
        {loading ? (
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
        ) : isRawGif ? (
          <button
            onClick={e => {
              e.stopPropagation()
              void handleDownload()
            }}
            className="bg-black/50 p-2 rounded-full text-white hover:bg-black/70"
            title="Download GIF"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </button>
        ) : (
          <div className="bg-black/55 rounded-full p-3">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        )}
      </div>
    )
  }

  if (type === "audio") {
    return (
      <div
        ref={placeholderRef}
        className="w-75 h-14 rounded-lg bg-gray-200 dark:bg-gray-800 flex items-center justify-center"
      >
        {loading ? (
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500" />
        ) : (
          <button
            onClick={() => void handleDownload()}
            className="bg-black/50 p-2 rounded-full text-white hover:bg-black/70"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      ref={placeholderRef}
      // Stickers always render at a fixed 195px square (w-48.75 above), so
      // reserve exactly that; images get their computed final box when the
      // backend knows the dimensions. Both avoid a resize on load.
      className={`${
        type === "sticker" ? "w-48.75 h-48.75" : "w-64 h-64"
      } bg-gray-200 dark:bg-gray-800 rounded-lg flex items-center justify-center`}
      style={reservedBox ?? undefined}
    >
      {loading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      ) : (
        <button
          onClick={() => void handleDownload()}
          className="bg-black/50 p-3 rounded-full text-white hover:bg-black/70"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
        </button>
      )}
    </div>
  )
}
