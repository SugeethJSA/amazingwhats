import { create } from "zustand"

/**
 * Byte-level download state driven exclusively by the backend `download:*`
 * events. Every number here is copied from a real event payload: there are no
 * timers, estimates or fabricated filenames/percentages. The only non-measured
 * value is `-1`, the backend's own "unknown / indeterminate" sentinel, used
 * until a real payload supplies a value.
 */
export interface DownloadProgressEntry {
  phase: "downloading" | "done" | "error"
  downloaded: number
  total: number
  percent: number
  /** Present only when a real `download:done` event reports a cancellation. */
  cancelled?: boolean
}

export interface DownloadProgressPayload {
  downloaded?: number
  total?: number
  percent?: number
}

interface DownloadProgressState {
  /** Keyed by messageId, the only correlation id the backend events carry. */
  entries: Record<string, DownloadProgressEntry>
  start: (messageId: string) => void
  update: (messageId: string, payload: DownloadProgressPayload) => void
  finish: (messageId: string, cancelled?: boolean) => void
  fail: (messageId: string) => void
  clear: (messageId: string) => void
}

const UNKNOWN = -1

function numberOrUnknown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : UNKNOWN
}

/** Keep the backend's -1 sentinel; clamp only genuine percentage values. */
function sanitizePercent(value: unknown): number {
  const raw = numberOrUnknown(value)
  if (raw < 0) return UNKNOWN
  return Math.max(0, Math.min(100, raw))
}

export const useDownloadProgressStore = create<DownloadProgressState>(set => ({
  entries: {},

  /** Begin (or re-begin) a download. All measurements start as unknown. */
  start: messageId =>
    set(state => {
      if (!messageId) return state
      return {
        entries: {
          ...state.entries,
          [messageId]: {
            phase: "downloading",
            downloaded: UNKNOWN,
            total: UNKNOWN,
            percent: UNKNOWN,
          },
        },
      }
    }),

  /**
   * Merge one real `download:progress` payload. A missing active entry (for
   * example a re-download after `done`) is re-initialised with unknown values
   * before the payload is applied — never with guessed ones.
   */
  update: (messageId, payload) =>
    set(state => {
      if (!messageId) return state
      const current = state.entries[messageId]
      // A terminal download is immutable: a late/reordered progress chunk must
      // not resurrect a finished bar. Only `start()` may begin a new download.
      if (current && current.phase !== "downloading") return state
      const base: DownloadProgressEntry =
        current ?? {
          phase: "downloading",
          downloaded: UNKNOWN,
          total: UNKNOWN,
          percent: UNKNOWN,
        }
      const next: DownloadProgressEntry = {
        phase: "downloading",
        downloaded:
          payload.downloaded === undefined
            ? base.downloaded
            : numberOrUnknown(payload.downloaded),
        total: payload.total === undefined ? base.total : numberOrUnknown(payload.total),
        percent:
          payload.percent === undefined ? base.percent : sanitizePercent(payload.percent),
      }
      return { entries: { ...state.entries, [messageId]: next } }
    }),

  finish: (messageId, cancelled) =>
    set(state => {
      const current = state.entries[messageId]
      if (!messageId || current?.phase !== "downloading") return state
      return {
        entries: {
          ...state.entries,
          [messageId]: {
            phase: "done",
            downloaded: current.downloaded,
            total: current.total,
            percent: current.percent,
            ...(cancelled === true ? { cancelled: true } : {}),
          },
        },
      }
    }),

  fail: messageId =>
    set(state => {
      const current = state.entries[messageId]
      if (!messageId || current?.phase !== "downloading") return state
      return {
        entries: {
          ...state.entries,
          [messageId]: {
            phase: "error",
            downloaded: current.downloaded,
            total: current.total,
            percent: current.percent,
          },
        },
      }
    }),

  clear: messageId =>
    set(state => {
      if (!messageId || !state.entries[messageId]) return state
      const entries = { ...state.entries }
      delete entries[messageId]
      return { entries }
    }),
}))
