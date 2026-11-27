import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"
import { GetCachedAvatar } from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { useContactStore } from "../../store/useContactStore"
import type { DecodedMessageContent, Message } from "../../store/types"
import { LRUCache } from "../../lib/lruCache"
import { UserAvatar } from "../../assets/svgs/chat_icons"

/**
 * WhatsApp-style push-to-talk player.
 *
 * Waveform policy (D-VOICE-001):
 *  1. If the decoded message carries a real backend waveform (WhatsApp's
 *     `waveform` byte slice, delivered through Wails as a base64 string — the
 *     local TS type mistakenly says number[], so both shapes are accepted),
 *     that is used verbatim.
 *  2. Otherwise a deterministic waveform is *derived* from the decoded audio
 *     buffer via AudioContext.decodeAudioData (RMS per bucket), decoded once
 *     and cached per message id. It is not the sender's original waveform; it
 *     is an honest local derivation from the same audio bytes.
 *
 * Playback, seeking and speed all drive a real HTMLAudioElement:
 * `audio.currentTime` for the slider and `audio.playbackRate` for speed.
 */

const BAR_COUNT = 48
const SPEEDS = [1, 1.5, 2] as const
const MAX_DERIVED_CACHE = 12

// Small module caches: Virtuoso remounts rows constantly, so one decode/avatar
// lookup per identity per session is enough.
const derivedCache = new Map<string, number[]>()
const avatarCache = new LRUCache<string, string | null>(128, 16 * 1024 * 1024, value =>
  value ? value.length : 1,
)

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus-ring)"

const FALLBACK_WAVE = new Array<number>(BAR_COUNT).fill(0.12)

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`
}

/** Go []byte crosses the Wails bridge as a base64 string. */
function decodeBase64Bytes(input: string): number[] {
  try {
    const binary = atob(input)
    const out: number[] = []
    for (let i = 0; i < binary.length; i += 1) out.push(binary.charCodeAt(i))
    return out
  } catch {
    return []
  }
}

function normalize(values: number[]): number[] {
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  if (max <= 0) return values.map(() => 0.12)
  return values.map(v => Math.min(1, Math.max(0, v / max)))
}

/** Average buckets down/up to a fixed number of drawable bars. */
function resample(values: number[], count: number): number[] {
  if (values.length === 0) return new Array<number>(count).fill(0.12)
  if (values.length === count) return normalize(values)
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i * values.length) / count)
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / count))
    let sum = 0
    for (let j = start; j < end; j += 1) sum += values[j] ?? 0
    out.push(sum / (end - start))
  }
  return normalize(out)
}

/** Deterministic RMS-per-bucket waveform from a decoded PCM buffer. */
function deriveWaveform(buffer: AudioBuffer, count: number): number[] {
  const data = buffer.getChannelData(0)
  if (!data.length) return new Array<number>(count).fill(0.12)
  const step = data.length / count
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * step)
    const end = Math.min(data.length, Math.floor((i + 1) * step))
    let sum = 0
    let n = 0
    for (let j = start; j < end; j += 1) {
      const v = data[j]
      sum += v * v
      n += 1
    }
    out.push(n > 0 ? Math.sqrt(sum / n) : 0)
  }
  return normalize(out)
}

function quotedPreviewText(quoted: DecodedMessageContent | null | undefined): string | null {
  if (!quoted) return null
  if (quoted.extendedTextMessage?.text) return quoted.extendedTextMessage.text.replace(/<[^>]*>/g, "")
  if (quoted.conversation) return quoted.conversation.replace(/<[^>]*>/g, "")
  if (quoted.imageMessage) return quoted.imageMessage.caption || "📷 Photo"
  if (quoted.videoMessage) return quoted.videoMessage.caption || "🎥 Video"
  if (quoted.documentMessage) return quoted.documentMessage.fileName || "📄 Document"
  if (quoted.audioMessage) return "🎵 Voice message"
  if (quoted.stickerMessage) return "Sticker"
  return "Message"
}

export function VoiceNotePlayer({ src, message }: { src: string; message: Message }) {
  const audioBody = message.Content?.audioMessage
  const messageId = message.Info.ID
  const isFromMe = !!message.Info.IsFromMe
  const jid = message.Info.Sender || ""

  const audioRef = useRef<HTMLAudioElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(() => {
    const seconds = audioBody?.seconds
    return typeof seconds === "number" && Number.isFinite(seconds) ? seconds : 0
  })
  const [speedIndex, setSpeedIndex] = useState(0)
  const [derived, setDerived] = useState<number[] | null>(() => derivedCache.get(messageId) ?? null)
  const [derivationFailed, setDerivationFailed] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => avatarCache.get(jid) ?? null)

  // Backend waveform wins. Wails delivers Go []byte as a base64 string, but
  // accept a number array too (the local type's declared shape).
  const backendWaveform = useMemo(() => {
    const raw = audioBody?.waveform as unknown as number[] | string | undefined
    if (!raw) return null
    let values: number[] = []
    if (Array.isArray(raw)) values = raw
    else if (typeof raw === "string") values = decodeBase64Bytes(raw)
    if (values.length === 0) return null
    return resample(values, BAR_COUNT)
  }, [audioBody?.waveform])

  // Derive (and cache) a waveform only when the backend gave us none.
  useEffect(() => {
    if (backendWaveform || !src) return
    const cached = derivedCache.get(messageId)
    if (cached) {
      setDerived(cached)
      return
    }
    if (typeof window === "undefined") return
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    let live = true
    let closed = false
    setDerivationFailed(false)
    let ctx: AudioContext | null = null
    const closeCtx = () => {
      if (ctx && !closed) {
        closed = true
        void ctx.close().catch(() => {})
      }
    }
    try {
      ctx = new Ctor()
      void fetch(src)
        .then(response => {
          if (!response.ok) throw new Error("audio fetch failed")
          return response.arrayBuffer()
        })
        .then(buffer => ctx!.decodeAudioData(buffer))
        .then(audioBuffer => {
          const waveform = resample(deriveWaveform(audioBuffer, BAR_COUNT), BAR_COUNT)
          derivedCache.set(messageId, waveform)
          if (derivedCache.size > MAX_DERIVED_CACHE) {
            derivedCache.delete(derivedCache.keys().next().value as string)
          }
          if (live) setDerived(waveform)
        })
        .catch(() => {
          if (live) setDerivationFailed(true)
        })
        .finally(closeCtx)
    } catch {
      closeCtx()
    }
    return () => {
      live = false
      closeCtx()
    }
  }, [src, messageId, backendWaveform])

  // Resolve the author line from the contact store, falling back to PushName.
  const [senderName, setSenderName] = useState(() => {
    if (isFromMe) return "You"
    return useContactStore.getState().contacts[jid]?.name || message.Info.PushName?.trim() || "Voice message"
  })
  useEffect(() => {
    if (isFromMe || !jid) return
    const cached = useContactStore.getState().contacts[jid]?.name
    if (cached) {
      setSenderName(cached)
      return
    }
    let live = true
    void useContactStore
      .getState()
      .getContactName(jid)
      .then(name => {
        if (live && name) setSenderName(name)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [jid, isFromMe])

  useEffect(() => {
    if (!jid) return
    if (avatarCache.has(jid)) {
      setAvatarUrl(avatarCache.get(jid) ?? null)
      return
    }
    let live = true
    void GetCachedAvatar(jid, false)
      .then(url => {
        avatarCache.set(jid, url || null)
        if (live) setAvatarUrl(url || null)
      })
      .catch(() => avatarCache.set(jid, null))
    return () => {
      live = false
    }
  }, [jid])

  const timestamp = useMemo(() => {
    const date = new Date(message.Info.Timestamp)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  }, [message.Info.Timestamp])

  const quotedPreview = useMemo(
    () => quotedPreviewText(audioBody?.contextInfo?.quotedMessage),
    [audioBody?.contextInfo?.quotedMessage],
  )

  const waveform = backendWaveform ?? derived ?? FALLBACK_WAVE

  // Keep the real audio element's rate in sync with the UI toggle.
  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = SPEEDS[speedIndex]
  }, [speedIndex])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  const seekToFraction = useCallback(
    (fraction: number) => {
      const audio = audioRef.current
      if (!audio) return
      const total =
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration
      if (!total || !Number.isFinite(total)) return
      const time = Math.min(total, Math.max(0, fraction * total))
      audio.currentTime = time
      setCurrentTime(time)
    },
    [duration],
  )

  // Redraw whenever the waveform, progress or element size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!width || !height) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const styles = window.getComputedStyle(canvas)
      const accent = styles.getPropertyValue("--color-green").trim() || "#21c063"
      const muted = styles.color || "#888888"
      const playedBars = duration > 0 ? Math.min(BAR_COUNT, (currentTime / duration) * BAR_COUNT) : 0
      const gap = 2
      const barWidth = Math.max(1, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT)
      const mid = height / 2

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const amplitude = waveform[i] ?? 0.12
        const barHeight = Math.max(2, amplitude * (height - 4))
        const x = i * (barWidth + gap)
        const y = mid - barHeight / 2
        const isPlayed = i < playedBars
        ctx.fillStyle = isPlayed ? accent : muted
        ctx.globalAlpha = isPlayed ? 1 : 0.35
        const roundable = ctx as CanvasRenderingContext2D & {
          roundRect?: (x: number, y: number, w: number, h: number, r: number) => void
        }
        if (typeof roundable.roundRect === "function") {
          ctx.beginPath()
          roundable.roundRect(x, y, barWidth, barHeight, Math.min(2, barWidth / 2))
          ctx.fill()
        } else {
          ctx.fillRect(x, y, barWidth, barHeight)
        }
      }
      ctx.globalAlpha = 1
    }
    draw()
    window.addEventListener("resize", draw)
    return () => window.removeEventListener("resize", draw)
  }, [waveform, currentTime, duration])

  const handlePointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    seekToFraction((event.clientX - rect.left) / rect.width)
  }

  const handleSliderKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current
    if (!audio) return
    const total = duration || (Number.isFinite(audio.duration) ? audio.duration : 0)
    const step = event.shiftKey ? 10 : 5
    let time: number | null = null
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        time = audio.currentTime - step
        break
      case "ArrowRight":
      case "ArrowUp":
        time = audio.currentTime + step
        break
      case "Home":
        time = 0
        break
      case "End":
        time = total
        break
      default:
        return
    }
    event.preventDefault()
    audio.currentTime = Math.min(total, Math.max(0, time))
    setCurrentTime(audio.currentTime)
  }

  const speed = SPEEDS[speedIndex]
  const ariaMax = Math.max(1, Math.round(duration))

  return (
    <div className="w-75 max-w-full rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 px-3 py-2.5 select-none">
      {/* Real audio engine — hidden, driven entirely by the controls below. */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={event => {
          const d = event.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onDurationChange={event => {
          const d = event.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
          const audio = audioRef.current
          if (audio) audio.currentTime = 0
        }}
      />

      {/* Author line: avatar, sender name, timestamp. */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-dark-muted [&_svg]:h-4 [&_svg]:w-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserAvatar />
          )}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-light-text dark:text-dark-text">
          {senderName}
        </span>
        {timestamp && (
          <span className="shrink-0 text-[10px] text-light-muted dark:text-dark-muted">{timestamp}</span>
        )}
      </div>

      {/* Quoted-message preview, when the voice note is a reply. */}
      {quotedPreview && (
        <div className="mb-2 truncate rounded border-l-2 border-[var(--color-green)] bg-black/5 px-2 py-1 text-[11px] text-light-muted dark:bg-black/20 dark:text-dark-muted">
          {quotedPreview}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause voice note" : "Play voice note"}
          title={playing ? "Pause" : "Play"}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-green)] text-[var(--color-action-ink)] transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            role="slider"
            tabIndex={0}
            aria-label="Voice note progress. Use arrow keys to seek"
            title={
              backendWaveform
                ? "Voice note waveform"
                : derived
                  ? "Waveform derived from this audio"
                  : derivationFailed
                    ? "Waveform unavailable"
                    : "Waveform loading"
            }
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={ariaMax}
            aria-valuenow={Math.min(ariaMax, Math.round(currentTime))}
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            onPointerDown={event => {
              draggingRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              handlePointer(event)
            }}
            onPointerMove={event => {
              if (draggingRef.current) handlePointer(event)
            }}
            onPointerUp={event => {
              draggingRef.current = false
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={() => {
              draggingRef.current = false
            }}
            onKeyDown={handleSliderKeyDown}
            className={`block h-7 w-full cursor-pointer rounded ${FOCUS_RING}`}
          />
          <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-light-muted dark:text-dark-muted">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSpeedIndex(index => (index + 1) % SPEEDS.length)}
          aria-label={`Playback speed ${speed}×. Activate to change speed`}
          title={`Playback speed ${speed}×`}
          className={`shrink-0 rounded-full border border-black/10 px-1.5 py-0.5 text-[11px] font-semibold text-light-text hover:bg-black/5 dark:border-white/15 dark:text-dark-text dark:hover:bg-white/10 ${FOCUS_RING}`}
        >
          {speed}×
        </button>
      </div>
    </div>
  )
}
