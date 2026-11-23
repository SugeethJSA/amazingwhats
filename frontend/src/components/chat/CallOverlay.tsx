import { useEffect, useState, useRef, useCallback } from "react"
import { EventsOn } from "../../lib/wailsRuntime"
import {
  AcceptCall,
  AcceptCallVideo,
  RejectCall,
  EndCall,
  GetCallStats,
  GetProfile,
  GetGroupInfo,
  AddCallParticipant,
  MuteCall,
  StartCallVideo,
  StopCallVideo,
  SetCallVideoEnabled,
  StartCallScreenShare,
  StopCallScreenShare,
  SendVideoFrame,
  SendCallReaction,
  SetCallHandRaised,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { GetCachedAvatar } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import type * as api from "../../../bindings/github.com/lugvitc/whats4linux/api/models.js"
import { useChatStore } from "../../store/useChatStore"
import { formatPhone, phoneFromJID } from "../../lib/utils"

interface CallState {
  callID: string
  peerJID: string
  isVideo: boolean
  isGroup: boolean
  groupJID: string
  status: "calling" | "ringing" | "active"
  contactName: string
  avatarUrl: string
  participants: number
  // Local microphone mute (our own AudioSource) and the REMOTE party's mic
  // state reported by meowcaller's OnMuteState. (CALL-001)
  muted: boolean
  remoteMuted: boolean
}

function parseJID(jid: string): { user: string; server: string } {
  const at = jid.indexOf("@")
  if (at === -1) return { user: jid, server: "s.whatsapp.net" }
  return { user: jid.slice(0, at), server: jid.slice(at + 1) }
}

// --- WebCodecs video helpers (D-ID CALL-002b) --------------------------------
// WebCodecs types are not part of TypeScript's DOM lib, so the runtime
// constructors are accessed through `any` rather than adding a dependency.
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const

function videoIsSupported(): boolean {
  if (typeof window === "undefined") return false
  const w = window as any
  return !!(
    w.VideoEncoder &&
    w.VideoDecoder &&
    w.EncodedVideoChunk &&
    w.MediaStreamTrackProcessor &&
    w.navigator?.mediaDevices?.getUserMedia
  )
}

function displayCaptureIsSupported(): boolean {
  if (typeof window === "undefined") return false
  return !!(window as any).navigator?.mediaDevices?.getDisplayMedia
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(bin)
}

// An Annex-B access unit is a keyframe when any NAL header is an IDR (5) or an
// SPS (7). Both 3-byte (00 00 01) and 4-byte (00 00 00 01) start codes count.
function hasKeyNAL(data: Uint8Array): boolean {
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue
    if (data[i + 2] === 1) {
      const t = data[i + 3] & 0x1f
      if (t === 5 || t === 7) return true
    } else if (data[i + 2] === 0 && i + 4 < data.length && data[i + 3] === 1) {
      const t = data[i + 4] & 0x1f
      if (t === 5 || t === 7) return true
    }
  }
  return false
}

function frameTimestamp(): number {
  // EncodedVideoChunk timestamps are microseconds and must increase.
  return Math.floor(performance.now() * 1000)
}

function drawFrame(canvas: HTMLCanvasElement | null, frame: any, orientation: number): boolean {
  if (!canvas) return false
  const ctx = canvas.getContext("2d")
  if (!ctx) return false
  const iw = frame.displayWidth || frame.codedWidth || 0
  const ih = frame.displayHeight || frame.codedHeight || 0
  if (!iw || !ih) return false
  const rot = ((orientation % 4) + 4) % 4
  const swap = rot === 1 || rot === 3
  const w = swap ? ih : iw
  const h = swap ? iw : ih
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  ctx.save()
  ctx.clearRect(0, 0, w, h)
  ctx.translate(w / 2, h / 2)
  ctx.rotate((rot * Math.PI) / 2)
  ctx.drawImage(frame, -iw / 2, -ih / 2, iw, ih)
  ctx.restore()
  return true
}

export function CallOverlayContent({ standalone = false }: { standalone?: boolean }) {
  const [activeCall, setActiveCall] = useState<CallState | null>(null)
  const [callDuration, setCallDuration] = useState(0)
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState<api.CallStats | null>(null)
  const [showAddParticipant, setShowAddParticipant] = useState(false)
  const [addSearch, setAddSearch] = useState("")
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  // Video / screen-share state (D-ID CALL-002b). All of it is reset by
  // teardownVideo() on call end so a later call cannot inherit this one's
  // video surfaces or indicators.
  const videoSupported = videoIsSupported()
  const [videoStarted, setVideoStarted] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [pendingUpgrade, setPendingUpgrade] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [remoteHandRaised, setRemoteHandRaised] = useState(false)
  const [screenShareActive, setScreenShareActive] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [reaction, setReaction] = useState<{ emoji: string; id: number } | null>(null)
  const [participantKeys, setParticipantKeys] = useState<string[]>([])
  const [mediaError, setMediaError] = useState<string | null>(null)

  const dragRef = useRef<{
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const statsRef = useRef<NodeJS.Timeout | null>(null)
  // Synchronous mirror of the visible call id. Async contact/profile lookups
  // compare against it before calling setActiveCall so a slow lookup for a call
  // that already ended cannot bring back a ghost overlay.
  const activeCallIDRef = useRef<string | null>(null)
  // Per-call set of participant JIDs we have already counted, so a repeated
  // call:participant_added event cannot inflate the roster count (D-AUD-004h).
  const countedParticipantsRef = useRef<Map<string, Set<string>>>(new Map())
  const chatsById = useChatStore(s => s.chatsById)

  // Media/decoder handles. Kept in refs (not state) so per-frame callbacks can
  // reach them without re-registering Wails event listeners.
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const participantCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map())
  const decoderRef = useRef<any>(null)
  const decoderCallIDRef = useRef<string | null>(null)
  const hasKeyRef = useRef(false)
  const videoReadyRef = useRef(false)
  const orientationRef = useRef(0)
  const participantDecodersRef = useRef<
    Map<string, { decoder: any; hasKey: boolean; orientation: number }>
  >(new Map())
  const encoderRef = useRef<any>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const trackReaderRef = useRef<any>(null)
  const captureTokenRef = useRef(0)
  const forceKeyRef = useRef(false)
  const cameraWasActiveRef = useRef(false)
  const screenEndGuardRef = useRef(false)
  const screenEndHandlerRef = useRef<{ track: MediaStreamTrack; onEnded: () => void } | null>(null)
  const reactionTimerRef = useRef<NodeJS.Timeout | null>(null)
  const teardownRef = useRef<() => void>(() => {})

  // --- capture / decode pipeline -------------------------------------------
  // Plain function declarations are used here (rather than useCallback) so
  // the pump and the ended handler can reference each other safely. They only
  // touch refs and stable setState functions, so capturing them in the event
  // effect below is safe.
  function stopCapture() {
    captureTokenRef.current += 1
    const reader = trackReaderRef.current
    trackReaderRef.current = null
    try {
      reader?.cancel?.()
    } catch {}
    const endHandler = screenEndHandlerRef.current
    screenEndHandlerRef.current = null
    if (endHandler) {
      try {
        endHandler.track.removeEventListener("ended", endHandler.onEnded)
      } catch {}
    }
    const stream = localStreamRef.current
    localStreamRef.current = null
    try {
      stream?.getTracks().forEach(t => t.stop())
    } catch {}
    const encoder = encoderRef.current
    encoderRef.current = null
    try {
      encoder?.close?.()
    } catch {}
    forceKeyRef.current = false
  }

  function teardownVideo() {
    stopCapture()
    try {
      decoderRef.current?.close?.()
    } catch {}
    decoderRef.current = null
    decoderCallIDRef.current = null
    hasKeyRef.current = false
    videoReadyRef.current = false
    orientationRef.current = 0
    participantDecodersRef.current.forEach(entry => {
      try {
        entry.decoder?.close?.()
      } catch {}
    })
    participantDecodersRef.current.clear()
    participantCanvasesRef.current.clear()
    if (reactionTimerRef.current) {
      clearTimeout(reactionTimerRef.current)
      reactionTimerRef.current = null
    }
    cameraWasActiveRef.current = false
    screenEndGuardRef.current = false
    setVideoStarted(false)
    setVideoReady(false)
    setPendingUpgrade(false)
    setCameraOn(false)
    setScreenSharing(false)
    setHandRaised(false)
    setRemoteHandRaised(false)
    setScreenShareActive(false)
    setShowReactions(false)
    setReaction(null)
    setParticipantKeys([])
  }
  teardownRef.current = teardownVideo

  function resetDecoder() {
    const stale = decoderRef.current
    decoderRef.current = null
    decoderCallIDRef.current = null
    hasKeyRef.current = false
    // A reset decoder cannot render anything: drop the stale "ready" flag so
    // the UI does not show a black canvas labelled ready until a new keyframe.
    videoReadyRef.current = false
    setVideoReady(false)
    try {
      stale?.close?.()
    } catch {}
  }

  function ensureDecoder(callID: string) {
    const w = window as any
    if (decoderRef.current && decoderCallIDRef.current === callID) return decoderRef.current
    try {
      decoderRef.current?.close?.()
    } catch {}
    let decoder: any
    decoder = new w.VideoDecoder({
      output: (frame: any) => {
        if (!frame) return
        const drew = drawFrame(videoCanvasRef.current, frame, orientationRef.current)
        try {
          frame.close?.()
        } catch {}
        // Only report "ready" once a frame was actually decoded AND drawn.
        if (drew && !videoReadyRef.current) {
          videoReadyRef.current = true
          setVideoReady(true)
        }
      },
      error: (err: any) => {
        console.error("[VoIP] VideoDecoder error:", err)
        // Reset from inside the callback: a decoder in an error state never
        // emits output, so waiting for a later decode throw is too late.
        if (decoderRef.current === decoder) resetDecoder()
        else {
          try {
            decoder?.close?.()
          } catch {}
        }
      },
    })
    decoder.configure({ codec: "avc1.42E01F", optimizeForLatency: true })
    decoderRef.current = decoder
    decoderCallIDRef.current = callID
    hasKeyRef.current = false
    return decoder
  }

  // Called when the screen-share track ends (browser "Stop sharing" or our
  // own Stop sharing button). Restores the camera if it was active before.
  async function handleScreenEnded(callID: string): Promise<void> {
    // The guard stays held across every await below, so the track "ended"
    // event and the read-loop EOF cannot both run the stop/restore path.
    if (screenEndGuardRef.current) return
    screenEndGuardRef.current = true
    try {
      let stopped = true
      try {
        await StopCallScreenShare(callID)
      } catch (err) {
        console.error("StopCallScreenShare failed:", err)
        stopped = false
      }
      stopCapture()
      // Only report "not sharing" when Go confirmed the stop; on failure the
      // button stays actionable so the user can retry.
      if (stopped) setScreenSharing(false)
      // Only restore the camera when Go confirmed the share stopped. Restoring
      // it while screenSharing is still true would re-create the exact
      // backend/UI divergence this path is meant to prevent.
      if (stopped && cameraWasActiveRef.current && videoIsSupported()) {
        cameraWasActiveRef.current = false
        const ok = await startCapture(callID, "camera")
        if (activeCallIDRef.current === callID) setCameraOn(ok)
      }
    } finally {
      screenEndGuardRef.current = false
    }
  }

  // Starts camera or display capture and encodes it to Annex-B H.264 fed to
  // SendVideoFrame. Returns whether a capture stream was actually established.
  async function startCapture(callID: string, mode: "camera" | "screen"): Promise<boolean> {
    if (!videoIsSupported() || activeCallIDRef.current !== callID) return false
    stopCapture()
    const w = window as any
    const md = w.navigator?.mediaDevices
    if (!md) return false
    let stream: MediaStream
    try {
      stream =
        mode === "screen"
          ? await md.getDisplayMedia({ video: true, audio: false })
          : await md.getUserMedia({
              video: {
                width: { ideal: 1280, max: 1280 },
                height: { ideal: 720, max: 720 },
                frameRate: { ideal: 15, max: 15 },
              },
              audio: false,
            })
    } catch (err) {
      console.error(mode === "screen" ? "getDisplayMedia failed:" : "getUserMedia failed:", err)
      setMediaError(
        mode === "screen"
          ? "Screen capture was cancelled or blocked by the browser."
          : "Camera access was denied or is unavailable.",
      )
      return false
    }
    if (activeCallIDRef.current !== callID) {
      stream.getTracks().forEach(t => t.stop())
      return false
    }
    const track = stream.getVideoTracks()[0]
    if (!track) {
      stream.getTracks().forEach(t => t.stop())
      return false
    }
    const settings: any = typeof track.getSettings === "function" ? track.getSettings() : {}
    const width = Number(settings.width) || 1280
    const height = Number(settings.height) || 720
    const bitrate = Math.min(2000000, Math.max(250000, width * height * 2))
    let encoder: any
    try {
      encoder = new w.VideoEncoder({
        output: (chunk: any) => {
          if (activeCallIDRef.current !== callID || encoderRef.current !== encoder) return
          try {
            const buf = new Uint8Array(chunk.byteLength)
            chunk.copyTo(buf)
            void SendVideoFrame(callID, bytesToBase64(buf)).catch(err =>
              console.error("SendVideoFrame failed:", err),
            )
          } catch (err) {
            console.error("VideoEncoder output failed:", err)
          }
        },
        error: (err: any) => console.error("[VoIP] VideoEncoder error:", err),
      })
      encoder.configure({
        codec: "avc1.42E01F",
        avc: { format: "annexb" },
        width,
        height,
        framerate: 15,
        bitrate,
        latencyMode: "realtime",
      })
    } catch (err) {
      console.error("VideoEncoder configure failed:", err)
      try {
        encoder?.close?.()
      } catch {}
      stream.getTracks().forEach(t => t.stop())
      return false
    }
    encoderRef.current = encoder
    localStreamRef.current = stream
    forceKeyRef.current = true
    // Do not set device orientation here: during a screen-share upgrade the
    // call may not have active video media yet, and the binding correctly
    // rejects the request ("call has no active video media"). Orientation 0
    // is meowcaller's default, so omitting the call is lossless.
    if (mode === "screen") {
      try {
        await StartCallScreenShare(callID, 1)
      } catch (err) {
        console.error("StartCallScreenShare failed:", err)
        setMediaError("Screen sharing needs an active video call. Start video first, then share.")
        // Do not leave a live display capture behind if Go rejected the
        // upgrade: the caller sees false and never commits screenSharing.
        stopCapture()
        return false
      }
    }
    let reader: any
    try {
      const processor = new w.MediaStreamTrackProcessor({ track })
      reader = processor.readable.getReader()
    } catch (err) {
      console.error("MediaStreamTrackProcessor failed:", err)
      stopCapture()
      return false
    }
    trackReaderRef.current = reader
    setMediaError(null)
    const token = captureTokenRef.current
    const pump = async () => {
      try {
        while (captureTokenRef.current === token && encoderRef.current === encoder) {
          const { done, value: frame } = await reader.read()
          if (done) break
          if (frame) {
            const keyFrame = forceKeyRef.current
            forceKeyRef.current = false
            if (encoderRef.current && encoderRef.current.encodeQueueSize < 2) {
              encoderRef.current.encode(frame, { keyFrame })
            }
            try {
              frame.close?.()
            } catch {}
          }
        }
      } catch (err) {
        if (captureTokenRef.current === token) console.error("[VoIP] camera read loop:", err)
      } finally {
        if (
          captureTokenRef.current === token &&
          mode === "screen" &&
          activeCallIDRef.current === callID
        ) {
          handleScreenEnded(callID)
        }
      }
    }
    void pump()

    if (mode === "screen") {
      const onEnded = () => handleScreenEnded(callID)
      track.addEventListener("ended", onEnded)
      screenEndHandlerRef.current = { track, onEnded }
    }
    return true
  }

  const clearCall = useCallback((callID?: string) => {
    // When an id is given, only clear that exact call. No id = explicit clear.
    if (callID && activeCallIDRef.current !== callID) return
    const cleared = activeCallIDRef.current
    activeCallIDRef.current = null
    if (cleared) countedParticipantsRef.current.delete(cleared)
    setActiveCall(null)
    setCallDuration(0)
    // Reset all call-scoped UI state so a later call cannot inherit this
    // call's stats panel or add-participant picker. (critic: MINOR)
    setShowStats(false)
    setStats(null)
    setShowAddParticipant(false)
    setAddSearch("")
    // Tear down every media/decoder resource for this call. teardownRef keeps
    // clearCall's dependency list stable. (D-ID CALL-002b)
    teardownRef.current()
  }, [])

  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // currentTarget is the drag strip; its parent is the card, and the card's
      // parent is the positioned wrapper whose left/top we are moving.
      const card = e.currentTarget.parentElement as HTMLElement | null
      const widget = card?.parentElement as HTMLElement | null
      if (!card || !widget) return
      const rect = widget.getBoundingClientRect()
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        offsetX: position?.x ?? rect.left,
        offsetY: position?.y ?? rect.top,
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [position],
  )

  const onDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const card = e.currentTarget.parentElement as HTMLElement | null
    if (!card) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    // Keep the whole widget on screen, including when the window is narrow.
    const margin = 16
    const maxX = Math.max(margin, window.innerWidth - card.offsetWidth - margin)
    const maxY = Math.max(margin, window.innerHeight - card.offsetHeight - margin)
    setPosition({
      x: Math.min(Math.max(dragRef.current.offsetX + dx, margin), maxX),
      y: Math.min(Math.max(dragRef.current.offsetY + dy, margin), maxY),
    })
  }, [])

  const onDragEnd = useCallback(() => {
    dragRef.current = null
  }, [])

  const resolveContact = async (
    state: {
      peerJID: string
      isGroup: boolean
      groupJID: string
    },
    cb: (name: string, avatar: string, participants: number) => void,
  ) => {
    const u = parseJID(state.peerJID).user
    let name = u
    let avatar = ""
    let participants = 0

    if (state.isGroup) {
      const groupJID = state.groupJID || state.peerJID
      try {
        const info = await GetGroupInfo(groupJID)
        name = info.group_name || u
        participants = info.participant_count
      } catch {}
      try {
        avatar = await GetCachedAvatar(groupJID, false)
      } catch {}
      cb(name, avatar, participants)
      return
    }

    try {
      const profile = await GetProfile(state.peerJID)
      name = profile.full_name || profile.push_name || u
    } catch {}

    try {
      avatar = await GetCachedAvatar(state.peerJID, false)
    } catch {}

    cb(name, avatar, participants)
  }

  useEffect(() => {
    const onCallEvent = (data: any, status: CallState["status"]) => {
      const callID: string = data.callID
      if (!callID) return
      const isGroup = !!data.isGroup
      const groupJID = data.groupJID || ""
      // Keep exactly one visible, controllable call. Blindly overwriting the
      // ref on a second call orphaned the first one: its later call:ended was
      // ignored and its buttons acted on the wrong call. Ignore concurrent
      // call events while one is active instead. (D-AUD-004e)
      if (activeCallIDRef.current && activeCallIDRef.current !== callID) {
        console.log("[VoIP] Ignoring concurrent call while one is active:", callID)
        return
      }
      activeCallIDRef.current = callID
      resolveContact({ peerJID: data.peerJID, isGroup, groupJID }, (name, avatar, participants) => {
        // The profile/avatar/name awaits above can outlive the call. Never
        // resurrect a call that ended or was replaced while they were pending.
        if (activeCallIDRef.current !== callID) return
        setActiveCall({
          callID,
          peerJID: data.peerJID,
          isVideo: data.isVideo,
          isGroup,
          groupJID,
          status,
          contactName: name,
          avatarUrl: avatar,
          participants,
          muted: false,
          remoteMuted: false,
        })
      })
    }

    const onIncoming = (data: any) => {
      console.log("[VoIP] Incoming call:", data)
      onCallEvent(data, "ringing")
    }

    const onOutgoing = (data: any) => {
      console.log("[VoIP] Outgoing call:", data)
      onCallEvent(data, "calling")
    }

    const onAccepted = (data: any) => {
      console.log("[VoIP] Call accepted:", data)
      if (!data?.callID) return
      // Ignore acceptance of a different (stale) call id.
      setActiveCall(prev =>
        prev && prev.callID === data.callID ? { ...prev, status: "active" } : prev,
      )
    }

    const onEnded = (data: any) => {
      console.log("[VoIP] Call ended:", data)
      if (!data?.callID) return
      clearCall(data.callID)
    }

    const onParticipantAdded = (data: { callID?: string; targetJID?: string }) => {
      if (!data?.callID || !data.targetJID) return
      if (data.callID !== activeCallIDRef.current) return
      // Only count a JID once per call, then use the backend's authoritative
      // roster size from CallStats rather than a blind participants + 1.
      // (D-AUD-004h)
      let counted = countedParticipantsRef.current.get(data.callID)
      if (!counted) {
        counted = new Set<string>()
        countedParticipantsRef.current.set(data.callID, counted)
      }
      if (counted.has(data.targetJID)) return
      counted.add(data.targetJID)
      void GetCallStats(data.callID)
        .then(s => {
          if (activeCallIDRef.current !== data.callID) return
          const authoritative = s?.participants ?? 0
          setActiveCall(prev =>
            prev && prev.callID === data.callID
              ? {
                  ...prev,
                  participants: authoritative > 0 ? authoritative : prev.participants,
                }
              : prev,
          )
        })
        .catch(err => console.error("GetCallStats failed:", err))
    }

    // Local mute acknowledgement from MuteCall, and the REMOTE party's mic
    // state from meowcaller's OnMuteState. Both are call-scoped: ignore events
    // for any other (or already ended) call. (CALL-001)
    const onMuteState = (data: { callID?: string; muted?: boolean }) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      setActiveCall(prev =>
        prev && prev.callID === data.callID ? { ...prev, muted: !!data.muted } : prev,
      )
    }

    const onRemoteMute = (data: { callID?: string; muted?: boolean }) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      setActiveCall(prev =>
        prev && prev.callID === data.callID ? { ...prev, remoteMuted: !!data.muted } : prev,
      )
    }

    // --- video / screen-share events (D-ID CALL-002b) -----------------------
    // Every handler is call-scoped: events for any other (or already ended)
    // call are dropped before touching a decoder or a piece of UI state.
    const onVideoFrame = (data: any) => {
      const callID = data?.callID
      if (!callID || callID !== activeCallIDRef.current || !videoSupported) return
      if (typeof data.data !== "string" || !data.data) return
      try {
        const bytes = base64ToBytes(data.data)
        const key = hasKeyNAL(bytes)
        // A decoder cannot start on a delta frame: drop deltas until an SPS or
        // IDR access unit arrives.
        if (!key && !hasKeyRef.current) return
        if (key) hasKeyRef.current = true
        const decoder = ensureDecoder(callID)
        const Chunk = (window as any).EncodedVideoChunk
        decoder.decode(
          new Chunk({ type: key ? "key" : "delta", timestamp: frameTimestamp(), data: bytes }),
        )
      } catch (err) {
        console.error("[VoIP] frame decode failed:", err)
        // A decoder in an error state cannot recover: drop it so the next key
        // frame allocates a fresh one instead of failing on every frame.
        resetDecoder()
      }
    }

    const onVideoOrient = (data: any) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      if (typeof data.orientation === "number") {
        orientationRef.current = ((data.orientation % 4) + 4) % 4
      }
    }

    const onVideoState = (data: any) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      if (typeof data.orientation === "number") {
        orientationRef.current = ((data.orientation % 4) + 4) % 4
      }
      const raw = data.raw
      const on = data.active === true || raw === 1
      const needsAccept = data.upgrade === true || raw === 3 || raw === 11
      setPendingUpgrade(needsAccept && !on)
      if (!on && !needsAccept && videoReadyRef.current) {
        videoReadyRef.current = false
        setVideoReady(false)
      }
    }

    const onVideoKeyframe = (data: any) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      // Next encoded frame from the camera must be a keyframe.
      forceKeyRef.current = true
    }

    const onParticipantVideo = (data: any) => {
      const callID = data?.callID
      if (!callID || callID !== activeCallIDRef.current || !videoSupported) return
      if (typeof data.access_unit !== "string" || !data.access_unit) return
      const key = String(data.participantID ?? data.ssrc ?? "participant")
      try {
        const bytes = base64ToBytes(data.access_unit)
        const isKey = hasKeyNAL(bytes)
        let entry = participantDecodersRef.current.get(key)
        // Wait for a keyframe before allocating a decoder for a new stream.
        if (!entry) {
          if (!isKey) return
          const w = window as any
          const decoder = new w.VideoDecoder({
            output: (frame: any) => {
              if (!frame) return
              drawFrame(
                participantCanvasesRef.current.get(key) ?? null,
                frame,
                entry?.orientation ?? 0,
              )
              try {
                frame.close?.()
              } catch {}
            },
            error: (err: any) => {
              console.error("[VoIP] participant decoder error:", err)
              try {
                participantDecodersRef.current.get(key)?.decoder?.close?.()
              } catch {}
              participantDecodersRef.current.delete(key)
              setParticipantKeys(prev => prev.filter(k => k !== key))
            },
          })
          decoder.configure({ codec: "avc1.42E01F", optimizeForLatency: true })
          entry = { decoder, hasKey: false, orientation: 0 }
          participantDecodersRef.current.set(key, entry)
          setParticipantKeys(prev => (prev.includes(key) ? prev : [...prev, key]))
        }
        if (typeof data.orientation === "number") {
          entry.orientation = ((data.orientation % 4) + 4) % 4
        }
        if (!isKey && !entry.hasKey) return
        if (isKey) entry.hasKey = true
        const Chunk = (window as any).EncodedVideoChunk
        entry.decoder.decode(
          new Chunk({ type: isKey ? "key" : "delta", timestamp: frameTimestamp(), data: bytes }),
        )
      } catch (err) {
        console.error("[VoIP] participant frame decode failed:", err)
      }
    }

    const onReactionEvent = (data: any) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      if (!data.emoji || data.removed) return
      setReaction({ emoji: String(data.emoji), id: Date.now() })
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current)
      reactionTimerRef.current = setTimeout(() => {
        setReaction(null)
        reactionTimerRef.current = null
      }, 2600)
    }

    const onHandRaise = (data: any) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      setRemoteHandRaised(!!data.raised)
    }

    const onScreenShare = (data: any) => {
      if (!data?.callID || data.callID !== activeCallIDRef.current) return
      setScreenShareActive(!!data.active)
    }

    const offIncoming = EventsOn("call:incoming", onIncoming)
    const offOutgoing = EventsOn("call:outgoing", onOutgoing)
    const offAccepted = EventsOn("call:accepted", onAccepted)
    const offEnded = EventsOn("call:ended", onEnded)
    const offParticipantAdded = EventsOn("call:participant_added", onParticipantAdded)
    const offMuteState = EventsOn("call:mute_state", onMuteState)
    const offRemoteMute = EventsOn("call:remote_mute", onRemoteMute)
    const offVideoFrame = EventsOn("call:video_frame", onVideoFrame)
    const offVideoOrient = EventsOn("call:video_orient", onVideoOrient)
    const offVideoState = EventsOn("call:video_state", onVideoState)
    const offVideoKeyframe = EventsOn("call:video_keyframe", onVideoKeyframe)
    const offParticipantVideo = EventsOn("call:participant_video", onParticipantVideo)
    const offReaction = EventsOn("call:reaction", onReactionEvent)
    const offHandRaise = EventsOn("call:hand_raise", onHandRaise)
    const offScreenShare = EventsOn("call:screen_share", onScreenShare)

    return () => {
      offIncoming()
      offOutgoing()
      offAccepted()
      offEnded()
      offParticipantAdded()
      offMuteState()
      offRemoteMute()
      offVideoFrame()
      offVideoOrient()
      offVideoState()
      offVideoKeyframe()
      offParticipantVideo()
      offReaction()
      offHandRaise()
      offScreenShare()
    }
  }, [clearCall])

  // Release cameras/displays and decoders if the overlay is unmounted while a
  // call is still visible (D-ID CALL-002b).
  useEffect(() => {
    return () => teardownRef.current()
  }, [])

  // Call duration timer
  useEffect(() => {
    if (activeCall?.status === "active") {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1)
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
      setCallDuration(0)
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [activeCall?.status])

  // Poll stats every 2s when active
  useEffect(() => {
    if (activeCall && showStats) {
      const poll = async () => {
        try {
          const s = await GetCallStats(activeCall.callID)
          setStats(s)
        } catch {}
      }
      poll()
      statsRef.current = setInterval(poll, 2000)
    } else {
      if (statsRef.current) clearInterval(statsRef.current)
    }
    return () => {
      if (statsRef.current) clearInterval(statsRef.current)
    }
  }, [activeCall?.callID, showStats])

  if (!activeCall) return null

  const handleAccept = async () => {
    const callID = activeCall.callID
    try {
      await AcceptCall(callID)
      if (activeCallIDRef.current !== callID) return
      setActiveCall(prev => (prev && prev.callID === callID ? { ...prev, status: "active" } : prev))
    } catch (err) {
      console.error("Failed to accept call", err)
      clearCall(callID)
    }
  }

  const handleReject = async () => {
    const callID = activeCall.callID
    try {
      await RejectCall(callID)
    } catch (err) {
      console.error("Failed to reject call", err)
    }
    clearCall(callID)
  }

  const handleEnd = async () => {
    const callID = activeCall.callID
    try {
      await EndCall(callID)
    } catch (err) {
      console.error("Failed to end call", err)
    }
    clearCall(callID)
  }

  const handleToggleMute = async () => {
    if (!activeCall) return
    const callID = activeCall.callID
    const next = !activeCall.muted
    try {
      await MuteCall(callID, next)
      // Only commit the optimistic value if this call is still the visible one.
      if (activeCallIDRef.current !== callID) return
      setActiveCall(prev => (prev && prev.callID === callID ? { ...prev, muted: next } : prev))
    } catch (err) {
      console.error("MuteCall failed:", err)
    }
  }

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const candidateContacts = [...chatsById.values()]
    .filter(c => !c.id.endsWith("@g.us"))
    .filter(c => c.id !== activeCall?.peerJID)
    .filter(c => !addSearch || c.name.toLowerCase().includes(addSearch.toLowerCase()))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))

  const handleAddParticipant = async (targetJID: string) => {
    if (!activeCall) return
    try {
      await AddCallParticipant(activeCall.callID, targetJID)
      setShowAddParticipant(false)
    } catch (err) {
      console.error("AddCallParticipant failed:", err)
      setShowAddParticipant(false)
    }
  }

  // --- video control handlers (D-ID CALL-002b) -----------------------------
  const handleStartVideo = async () => {
    // Never start camera capture while a display track owns the encoder.
    if (!activeCall || screenSharing) return
    const callID = activeCall.callID
    try {
      await StartCallVideo(callID)
      if (activeCallIDRef.current !== callID) return
      setVideoStarted(true)
      setPendingUpgrade(false)
      const ok = await startCapture(callID, "camera")
      if (activeCallIDRef.current === callID) setCameraOn(ok)
    } catch (err) {
      console.error("StartCallVideo failed:", err)
    }
  }

  const handleAcceptVideo = async () => {
    // Accepting an upgrade also starts camera capture, so it must respect the
    // same screen-share invariant as handleStartVideo / handleToggleCamera.
    if (!activeCall || screenSharing) return
    const callID = activeCall.callID
    try {
      await AcceptCallVideo(callID)
      if (activeCallIDRef.current !== callID) return
      setPendingUpgrade(false)
      setVideoStarted(true)
      const ok = await startCapture(callID, "camera")
      if (activeCallIDRef.current === callID) setCameraOn(ok)
    } catch (err) {
      console.error("AcceptCallVideo failed:", err)
    }
  }

  const handleStopVideo = async () => {
    if (!activeCall) return
    const callID = activeCall.callID
    if (screenSharing) {
      try {
        await StopCallScreenShare(callID)
      } catch (err) {
        // Do not tear down the rest of the video UI on a backend failure:
        // keeping videoStarted/screenSharing intact leaves "Stop sharing"
        // actionable for a retry instead of stranding the UI in a state where
        // neither the share nor camera button can clear it.
        console.error("StopCallScreenShare failed:", err)
        return
      }
    }
    try {
      await StopCallVideo(callID)
    } catch (err) {
      console.error("StopCallVideo failed:", err)
    }
    if (activeCallIDRef.current !== callID) return
    stopCapture()
    resetDecoder()
    setCameraOn(false)
    setScreenSharing(false)
    setScreenShareActive(false)
    setVideoStarted(false)
    setPendingUpgrade(false)
  }

  const handleToggleCamera = async () => {
    if (!activeCall) return
    const callID = activeCall.callID
    if (cameraOn) {
      stopCapture()
      setCameraOn(false)
      try {
        await SetCallVideoEnabled(callID, false)
      } catch (err) {
        console.error("SetCallVideoEnabled(false) failed:", err)
      }
      return
    }
    const ok = await startCapture(callID, "camera")
    if (!ok || activeCallIDRef.current !== callID) return
    setCameraOn(true)
    try {
      await SetCallVideoEnabled(callID, true)
    } catch (err) {
      console.error("SetCallVideoEnabled(true) failed:", err)
    }
  }

  const handleToggleScreen = async () => {
    if (!activeCall) return
    const callID = activeCall.callID
    if (screenSharing) {
      await handleScreenEnded(callID)
      return
    }
    const wasCameraOn = cameraOn
    if (wasCameraOn) cameraWasActiveRef.current = true
    const ok = await startCapture(callID, "screen")
    if (ok && activeCallIDRef.current === callID) {
      setScreenSharing(true)
      setCameraOn(false)
    } else {
      // Go rejected the share (or capture failed): revert to the camera that
      // was running before, so no capture is silently lost.
      cameraWasActiveRef.current = false
      if (wasCameraOn && activeCallIDRef.current === callID) {
        const restarted = await startCapture(callID, "camera")
        if (activeCallIDRef.current === callID) setCameraOn(restarted)
      }
    }
  }

  const handleSendReaction = (emoji: string) => {
    if (!activeCall) return
    void SendCallReaction(activeCall.callID, emoji).catch(err =>
      console.error("SendCallReaction failed:", err),
    )
    setShowReactions(false)
  }

  const handleToggleHand = async () => {
    if (!activeCall) return
    const callID = activeCall.callID
    const next = !handRaised
    try {
      await SetCallHandRaised(callID, next)
      if (activeCallIDRef.current === callID) setHandRaised(next)
    } catch (err) {
      console.error("SetCallHandRaised failed:", err)
    }
  }

  const displaySupported = videoSupported && displayCaptureIsSupported()

  return (
    <div
      className={
        standalone
          ? "fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-300"
          : "fixed z-[9999] animate-in fade-in duration-300"
      }
      style={
        standalone
          ? undefined
          : position
            ? { left: position.x, top: position.y }
            : { right: "1.5rem", bottom: "1.5rem" }
      }
    >
      <div
        role="dialog"
        aria-label={`Call with ${activeCall.contactName}`}
        className={`${standalone ? "w-full max-w-[400px]" : "w-80 max-w-[calc(100vw_-_2rem)]"} rounded-2xl p-5 shadow-2xl border flex flex-col items-center select-none`}
        style={{
          background: "#121b22",
          borderColor: "rgba(255, 255, 255, 0.08)",
          boxShadow: "0 14px 40px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div
          className={`w-full flex items-center justify-between pb-3 mb-4 border-b border-white/10 text-xs font-medium text-gray-400 cursor-grab active:cursor-grabbing touch-none${standalone ? " hidden" : ""}`}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          title="Drag to move"
        >
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#21c063] animate-pulse" />
          </div>
          <span className="text-xs text-gray-300">
            {activeCall.isGroup
              ? activeCall.isVideo
                ? "Group Video Call"
                : "Group Audio Call"
              : activeCall.isVideo
                ? "Video Call"
                : "Audio Call"}
          </span>
        </div>

        {/* Contact Avatar */}
        <div className="relative mb-3 flex items-center justify-center">
          {activeCall.status !== "active" && (
            <div className="absolute inset-0 rounded-full bg-[#21c063]/20 animate-ping" />
          )}
          {activeCall.avatarUrl ? (
            <img
              src={activeCall.avatarUrl}
              alt=""
              className="w-20 h-20 rounded-full object-cover shadow-xl relative z-10"
              style={{ border: "2px solid rgba(33, 192, 99, 0.4)" }}
            />
          ) : (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-xl relative z-10"
              style={{
                background: "linear-gradient(135deg, #1f2c34, #0b141a)",
                border: "2px solid rgba(33, 192, 99, 0.4)",
              }}
            >
              {activeCall.contactName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Contact Name & Call Status */}
        <div className="flex items-center justify-center gap-2">
          <h3 className="text-base font-semibold text-white tracking-tight mb-0.5">
            {activeCall.contactName}
          </h3>
          {activeCall.remoteMuted && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-gray-400"
              title="Peer microphone is off"
              aria-label="Peer microphone off"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c.98-.14 1.88-.48 2.65-.97l3.08 3.08 1.27-1.27L4.27 3z" />
              </svg>
              Microphone off
            </span>
          )}
        </div>
        {activeCall.isGroup && activeCall.participants > 0 && (
          <p className="text-[11px] text-gray-400 mb-0.5">{activeCall.participants} participants</p>
        )}
        {mediaError && (
          <p role="alert" className="text-[11px] text-amber-400 mb-0.5 text-center px-2">
            {mediaError}
          </p>
        )}
        <p className="text-xs text-emerald-400 font-mono mb-6">
          {activeCall.status === "ringing"
            ? activeCall.isGroup
              ? "Incoming group call..."
              : "Incoming Call..."
            : activeCall.status === "calling"
              ? "Calling..."
              : formatTimer(callDuration)}
        </p>

        {/* Remote video + participant tiles (D-ID CALL-002b) */}
        {!videoSupported && (
          <p
            className="mb-3 text-center text-[10px] text-gray-500"
            title="Video requires WebCodecs"
          >
            Video requires WebCodecs
          </p>
        )}
        {videoSupported &&
          activeCall.status === "active" &&
          (activeCall.isVideo ||
            videoStarted ||
            pendingUpgrade ||
            videoReady ||
            screenSharing ||
            screenShareActive ||
            participantKeys.length > 0) && (
            <div className="w-full mb-3">
              <div
                className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-black"
                style={{ aspectRatio: "16 / 9" }}
              >
                <canvas
                  ref={videoCanvasRef}
                  width={640}
                  height={360}
                  className="h-full w-full object-contain"
                  aria-label="Remote call video"
                />
                {!videoReady && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-gray-400">
                    {pendingUpgrade
                      ? "Video incoming — accept to join"
                      : videoStarted || screenSharing
                        ? "Waiting for peer video…"
                        : "Start video to see your peer"}
                  </div>
                )}
                {screenShareActive && (
                  <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    Screen sharing
                  </span>
                )}
              </div>
              {participantKeys.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-[10px] text-gray-400">Participant video</p>
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {participantKeys.map(key => (
                      <canvas
                        key={key}
                        ref={el => {
                          if (el) participantCanvasesRef.current.set(key, el)
                          else participantCanvasesRef.current.delete(key)
                        }}
                        width={160}
                        height={90}
                        className="h-16 w-28 shrink-0 rounded bg-black"
                        aria-label={`Participant ${key} video`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* Action Buttons */}
        <div className="flex items-center justify-center gap-6 w-full pt-1">
          {activeCall.status === "active" && (
            <button
              onClick={handleToggleMute}
              disabled={activeCall.status !== "active"}
              className={`p-3 rounded-full transition-all duration-150 disabled:opacity-50 ${
                activeCall.muted
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  : "bg-white/10 text-gray-300 hover:bg-white/20"
              }`}
              aria-label={activeCall.muted ? "Unmute microphone" : "Mute microphone"}
              title={activeCall.muted ? "Unmute microphone" : "Mute microphone"}
            >
              {activeCall.muted ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c.98-.14 1.88-.48 2.65-.97l3.08 3.08 1.27-1.27L4.27 3z" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              )}
            </button>
          )}

          {activeCall.status === "active" && (
            <button
              onClick={() => {
                setAddSearch("")
                setShowAddParticipant(true)
              }}
              className="p-3 rounded-full bg-white/10 text-gray-300 hover:bg-white/20 transition-all duration-150"
              aria-label="Add participant to call"
              title="Add participant to call"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 12a3 3 0 100-6 3 3 0 000 6zm0-8a5 5 0 110 10 5 5 0 010-10zm0 11c-2.67 0-8 1.34-8 4v2h11v-2H3v-1c0-1.22 3.5-3 6-3 .9 0 1.74.12 2.48.32-.66-.5-1.25-1.1-1.7-1.78A10.9 10.9 0 009 15zm11 1v-3h-2v3h-3v2h3v3h2v-3h3v-2h-3z" />
              </svg>
            </button>
          )}

          {activeCall.status === "ringing" ? (
            <>
              <button
                onClick={handleReject}
                className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/30 transition-transform hover:scale-105 active:scale-95"
                aria-label="Decline call"
                title="Decline Call"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
                </svg>
              </button>
              <button
                onClick={handleAccept}
                className="w-12 h-12 rounded-full bg-[#21c063] text-white flex items-center justify-center shadow-lg shadow-[#21c063]/40 transition-transform hover:scale-105 active:scale-95 animate-pulse"
                aria-label="Accept call"
                title="Accept Call"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
                </svg>
              </button>
            </>
          ) : (
            <button
              onClick={handleEnd}
              className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/30 transition-transform hover:scale-105 active:scale-95"
              aria-label="End call"
              title="End Call"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
              </svg>
            </button>
          )}
        </div>

        {/* Video / screen-share controls (D-ID CALL-002b). Hidden entirely when
            WebCodecs is unavailable; the short note above explains why. */}
        {activeCall.status === "active" && videoSupported && (
          <div className="w-full mt-3 pt-3 border-t border-white/10">
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {!videoStarted && !pendingUpgrade && (
                <button
                  onClick={handleStartVideo}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/20 transition-colors"
                  aria-label="Start video"
                  title="Start video"
                >
                  Start video
                </button>
              )}
              {pendingUpgrade && !screenSharing && (
                <button
                  onClick={handleAcceptVideo}
                  className="rounded-full bg-[#21c063]/25 px-3 py-1.5 text-[11px] text-emerald-300 hover:bg-[#21c063]/40 transition-colors"
                  aria-label="Accept video"
                  title="Accept video"
                >
                  Accept video
                </button>
              )}
              {videoStarted && (
                <button
                  onClick={handleStopVideo}
                  className="rounded-full bg-red-500/20 px-3 py-1.5 text-[11px] text-red-300 hover:bg-red-500/30 transition-colors"
                  aria-label="Stop video"
                  title="Stop video"
                >
                  Stop video
                </button>
              )}
              {videoStarted && !screenSharing && (
                <button
                  onClick={handleToggleCamera}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/20 transition-colors"
                  aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
                  title={cameraOn ? "Turn camera off" : "Turn camera on"}
                >
                  {cameraOn ? "Camera off" : "Camera on"}
                </button>
              )}
              {videoStarted && displaySupported && (
                <button
                  onClick={handleToggleScreen}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/20 transition-colors"
                  aria-label={screenSharing ? "Stop sharing screen" : "Share screen"}
                  title={screenSharing ? "Stop sharing screen" : "Share screen"}
                >
                  {screenSharing ? "Stop sharing" : "Share screen"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Reactions and hand-raise use call app-data only, so they stay
            available on browsers without WebCodecs. */}
        {activeCall.status === "active" && (
          <div
            className={`w-full flex flex-wrap items-center justify-center gap-1.5 ${
              videoSupported ? "mt-2" : "mt-3 pt-3 border-t border-white/10"
            }`}
          >
            <button
              onClick={() => setShowReactions(v => !v)}
              className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-gray-200 hover:bg-white/20 transition-colors"
              aria-label="Send a reaction"
              aria-expanded={showReactions}
              title="Send a reaction"
            >
              React
            </button>
            <button
              onClick={handleToggleHand}
              className={`rounded-full px-3 py-1.5 text-[11px] transition-colors ${
                handRaised
                  ? "bg-amber-400/25 text-amber-300 hover:bg-amber-400/40"
                  : "bg-white/10 text-gray-200 hover:bg-white/20"
              }`}
              aria-label={handRaised ? "Lower hand" : "Raise hand"}
              aria-pressed={handRaised}
              title={handRaised ? "Lower hand" : "Raise hand"}
            >
              {handRaised ? "Lower hand" : "Raise hand"}
            </button>
          </div>
        )}
        {activeCall.status === "active" && showReactions && (
          <div
            role="group"
            aria-label="Reaction picker"
            className="mt-2 flex justify-center gap-1 rounded-lg bg-black/40 p-1.5"
          >
            {REACTIONS.map(emoji => (
              <button
                key={emoji}
                onClick={() => handleSendReaction(emoji)}
                className="rounded px-1.5 py-1 text-base leading-none hover:bg-white/10 transition-colors"
                aria-label={`Send ${emoji} reaction`}
                title={`Send ${emoji} reaction`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        {(reaction || remoteHandRaised || screenShareActive || participantKeys.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] text-gray-300">
            {reaction && (
              <span key={reaction.id} className="animate-bounce text-lg" role="status">
                {reaction.emoji}
              </span>
            )}
            {remoteHandRaised && (
              <span title="A participant raised their hand">✋ Hand raised</span>
            )}
            {screenShareActive && (
              <span title="A participant is sharing their screen">🖥️ Screen sharing</span>
            )}
            {participantKeys.length > 0 && (
              <span title="Participant video streams available">
                {participantKeys.length} participant video
                {participantKeys.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {/* Call Stats Toggle */}
        {activeCall.status === "active" && (
          <button
            onClick={() => setShowStats(!showStats)}
            className="mt-3 text-xs text-gray-400 hover:text-white transition-colors"
          >
            {showStats ? "Hide Details" : "Show Details"}
          </button>
        )}

        {/* Stats Panel */}
        {showStats && stats && (
          <div className="mt-3 w-full rounded-lg bg-black/30 p-3 text-[11px] font-mono text-gray-400 space-y-1 border border-white/5">
            <div className="flex justify-between">
              <span>Phase</span>
              <span className="text-gray-200 capitalize">{stats.state}</span>
            </div>
            <div className="flex justify-between">
              <span>Duration</span>
              <span className="text-gray-200">{formatTimer(callDuration)}</span>
            </div>
            <div className="flex justify-between">
              <span>Peer</span>
              <span className="text-gray-200 truncate max-w-[140px]" title={stats.peer_jid}>
                {stats.peer_jid.split("@")[0]}
              </span>
            </div>
            {stats.is_group && (
              <div className="flex justify-between">
                <span>Group</span>
                <span className="text-gray-200 truncate max-w-[140px]" title={stats.group_jid}>
                  {stats.group_jid.split("@")[0]}
                </span>
              </div>
            )}
            {stats.is_group && (
              <div className="flex justify-between">
                <span>Participants</span>
                <span className="text-gray-200">{stats.participants}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add participant picker */}
      {showAddParticipant && activeCall && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
          onClick={e => {
            if (e.target === e.currentTarget) setShowAddParticipant(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-to-call-title"
            className="bg-white dark:bg-dark-secondary rounded-2xl w-full max-w-sm mx-4 max-h-[80vh] flex flex-col shadow-xl"
          >
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h2
                id="add-to-call-title"
                className="text-lg font-semibold text-gray-900 dark:text-gray-100"
              >
                Add to call
              </h2>
              <input
                value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                placeholder="Search contacts..."
                autoFocus
                className="mt-2 w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-dark-tertiary text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-600 dark:placeholder:text-[#9aa8b0] outline-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {candidateContacts.length === 0 && (
                <p className="text-center text-gray-400 dark:text-dark-muted text-sm py-8">
                  No contacts found
                </p>
              )}
              {candidateContacts.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => handleAddParticipant(chat.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-sm font-semibold text-gray-700 dark:text-gray-200 shrink-0">
                    {chat.avatar ? (
                      <img
                        src={chat.avatar}
                        className="w-10 h-10 rounded-full object-cover"
                        alt=""
                      />
                    ) : (
                      (chat.name || "?").charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {chat.name}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-[#9aa8b0] truncate">
                      {chat.type === "group" ? "Group" : formatPhone(phoneFromJID(chat.id))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setShowAddParticipant(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-dark-muted hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// The dedicated call window loads the same SPA with ?call_window=1. Render the
// overlay only there so the main window stays free of the call UI. This wrapper
// deliberately has no hooks, so App.tsx can keep mounting <CallOverlay />
// unconditionally without risking a conditional-hook violation.
export function CallOverlay() {
  if (typeof window === "undefined") return null
  if (new URLSearchParams(window.location.search).get("call_window") !== "1") return null
  return <CallOverlayContent />
}
