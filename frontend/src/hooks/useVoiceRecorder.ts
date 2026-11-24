import { useCallback, useEffect, useRef, useState } from "react"

/** A finished recording, with the format MediaRecorder actually produced. */
export interface VoiceRecording {
  blob: Blob
  mime: string
  /** Whole seconds elapsed between start() and stop(), as shown in the timer. */
  seconds: number
}

export interface VoiceRecorderStartResult {
  ok: boolean
  /** Curated, static message — never a raw device or OS error string. */
  error: string | null
}

export interface UseVoiceRecorder {
  isRecording: boolean
  seconds: number
  /** Real microphone RMS, 0..1. Stays 0 when level metering is unavailable. */
  level: number
  levelSupported: boolean
  /** MIME MediaRecorder reported at start; "" when the browser did not say. */
  mime: string
  error: string | null
  start: () => Promise<VoiceRecorderStartResult>
  stop: () => Promise<VoiceRecording>
  cancel: () => void
}

// Ogg Opus is this codebase's canonical voice MIME, but WebView2/Chromium
// usually only offers WebM Opus. We ask for the best supported one and report
// what MediaRecorder actually gave us — no relabelling.
const MIME_CANDIDATES = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus"]

const ERR = {
  busy: "A recording is already in progress.",
  noApi: "Voice recording isn't available in this app.",
  noRecorder: "Voice recording isn't supported by this browser.",
  denied: "Microphone access was denied. Allow microphone access and try again.",
  noMic: "Couldn't access the microphone. Please try again.",
  startFailed: "Couldn't start voice recording. Please try again.",
  failed: "Recording failed. Please try again.",
  noActive: "No recording is in progress.",
  cancelled: "Recording cancelled.",
} as const

export function useVoiceRecorder(): UseVoiceRecorder {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [levelSupported, setLevelSupported] = useState(false)
  const [mime, setMime] = useState("")
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const frameRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const mimeRef = useRef("")
  const lastLevelRef = useRef(0)
  const startingRef = useRef(false)
  const mountedRef = useRef(true)
  const pendingRef = useRef<{
    resolve: (value: VoiceRecording) => void
    reject: (reason: Error) => void
  } | null>(null)

  /** Stop the tracks, meter and timer regardless of why recording ended. */
  const release = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    try {
      sourceRef.current?.disconnect()
    } catch {
      /* already detached */
    }
    try {
      analyserRef.current?.disconnect()
    } catch {
      /* already detached */
    }
    sourceRef.current = null
    analyserRef.current = null
    dataRef.current = null

    const ctx = ctxRef.current
    ctxRef.current = null
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {})

    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach(track => {
      try {
        track.stop()
      } catch {
        /* track already ended */
      }
    })

    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      if (recorder.state !== "inactive") {
        try {
          recorder.stop()
        } catch {
          /* recorder already stopped */
        }
      }
    }

    chunksRef.current = []
    lastLevelRef.current = 0
    if (mountedRef.current) {
      setIsRecording(false)
      setLevel(0)
    }
  }, [])

  const start = useCallback(async (): Promise<VoiceRecorderStartResult> => {
    if (startingRef.current || recorderRef.current) {
      return { ok: false, error: ERR.busy }
    }
    startingRef.current = true
    try {
      if (mountedRef.current) setError(null)

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        if (mountedRef.current) setError(ERR.noApi)
        return { ok: false, error: ERR.noApi }
      }
      if (typeof MediaRecorder === "undefined") {
        if (mountedRef.current) setError(ERR.noRecorder)
        return { ok: false, error: ERR.noRecorder }
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ""
        const message =
          name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError"
            ? ERR.denied
            : ERR.noMic
        if (mountedRef.current) setError(message)
        return { ok: false, error: message }
      }

      // The component may have unmounted while the permission prompt was open.
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => {
          try {
            track.stop()
          } catch {
            /* already ended */
          }
        })
        return { ok: false, error: ERR.cancelled }
      }

      let chosen = ""
      for (const candidate of MIME_CANDIDATES) {
        try {
          if (
            typeof MediaRecorder.isTypeSupported === "function" &&
            MediaRecorder.isTypeSupported(candidate)
          ) {
            chosen = candidate
            break
          }
        } catch {
          /* try the next candidate */
        }
      }

      let recorder: MediaRecorder
      try {
        recorder = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream)
      } catch {
        stream.getTracks().forEach(track => {
          try {
            track.stop()
          } catch {
            /* already ended */
          }
        })
        if (mountedRef.current) setError(ERR.startFailed)
        return { ok: false, error: ERR.startFailed }
      }

      // recorder.mimeType is authoritative: a requested Ogg type can still
      // come back as WebM, and callers must never relabel it.
      const actualMime = recorder.mimeType || chosen || ""
      recorderRef.current = recorder
      streamRef.current = stream
      mimeRef.current = actualMime
      chunksRef.current = []
      startedAtRef.current = Date.now()
      lastLevelRef.current = 0

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
      }
      // Default handlers cover an unexpected stop (device removed, OS revokes
      // the mic). stop() replaces onstop with its own finalizer.
      recorder.onstop = () => {
        const pending = pendingRef.current
        pendingRef.current = null
        release()
        // An OS-level stop with no in-flight stop() call must still surface a
        // failure; otherwise the recording bar vanishes silently.
        if (mountedRef.current && !pending) setError(ERR.failed)
        pending?.reject(new Error(ERR.failed))
      }
      recorder.onerror = () => {
        const pending = pendingRef.current
        pendingRef.current = null
        release()
        if (mountedRef.current) setError(ERR.failed)
        pending?.reject(new Error(ERR.failed))
      }

      let meterReady = false
      try {
        const AudioCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AudioCtor) {
          const ctx = new AudioCtor()
          const source = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 1024
          source.connect(analyser)
          const data = new Uint8Array(new ArrayBuffer(analyser.fftSize))
          ctxRef.current = ctx
          sourceRef.current = source
          analyserRef.current = analyser
          dataRef.current = data
          meterReady = true
          void ctx.resume().catch(() => {})

          const tick = () => {
            const node = analyserRef.current
            const buffer = dataRef.current
            if (!node || !buffer) return
            node.getByteTimeDomainData(buffer)
            let sum = 0
            for (let i = 0; i < buffer.length; i++) {
              const sample = (buffer[i] - 128) / 128
              sum += sample * sample
            }
            // Real RMS from the microphone, scaled into 0..1 for the bars.
            const next = Math.min(1, Math.sqrt(sum / buffer.length) * 4)
            if (Math.abs(next - lastLevelRef.current) > 0.02) {
              lastLevelRef.current = next
              if (mountedRef.current) setLevel(next)
            }
            frameRef.current = requestAnimationFrame(tick)
          }
          frameRef.current = requestAnimationFrame(tick)
        }
      } catch {
        // Metering is optional: clean up only the partial meter, keep the
        // recorder and microphone stream alive.
        try {
          sourceRef.current?.disconnect()
        } catch {
          /* already detached */
        }
        try {
          analyserRef.current?.disconnect()
        } catch {
          /* already detached */
        }
        const partial = ctxRef.current
        sourceRef.current = null
        analyserRef.current = null
        dataRef.current = null
        ctxRef.current = null
        if (partial && partial.state !== "closed") void partial.close().catch(() => {})
        meterReady = false
      }

      timerRef.current = setInterval(() => {
        const elapsed = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))
        if (mountedRef.current) setSeconds(elapsed)
      }, 200)

      if (mountedRef.current) {
        setIsRecording(true)
        setSeconds(0)
        setMime(actualMime)
        setLevelSupported(meterReady)
      }

      try {
        recorder.start()
      } catch {
        const pending = pendingRef.current
        pendingRef.current = null
        release()
        if (mountedRef.current) setError(ERR.startFailed)
        return { ok: false, error: ERR.startFailed }
      }

      return { ok: true, error: null }
    } finally {
      startingRef.current = false
    }
  }, [release])

  const stop = useCallback((): Promise<VoiceRecording> => {
    return new Promise<VoiceRecording>((resolve, reject) => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === "inactive") {
        reject(new Error(ERR.noActive))
        return
      }
      if (pendingRef.current) {
        reject(new Error(ERR.busy))
        return
      }

      pendingRef.current = { resolve, reject }
      const finalize = () => {
        const pending = pendingRef.current
        pendingRef.current = null
        if (!pending) return
        // Read the real MIME before release() clears the refs.
        const actualMime = mimeRef.current || recorder.mimeType || ""
        const blob = new Blob(chunksRef.current, actualMime ? { type: actualMime } : undefined)
        const seconds = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))
        release()
        pending.resolve({ blob, mime: actualMime, seconds })
      }
      recorder.onstop = finalize
      try {
        recorder.stop()
      } catch {
        pendingRef.current = null
        release()
        reject(new Error(ERR.failed))
      }
    })
  }, [release])

  const cancel = useCallback(() => {
    const pending = pendingRef.current
    pendingRef.current = null
    release()
    pending?.reject(new Error(ERR.cancelled))
  }, [release])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const pending = pendingRef.current
      pendingRef.current = null
      release()
      pending?.reject(new Error(ERR.cancelled))
    }
  }, [release])

  return { isRecording, seconds, level, levelSupported, mime, error, start, stop, cancel }
}
