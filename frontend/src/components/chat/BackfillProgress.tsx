/**
 * Presentational status for a per-chat ON_DEMAND history backfill.
 *
 * The backend reports how many rows it has stored, but never a total, so this
 * component deliberately renders an indeterminate bar plus the honest count —
 * it never invents a percentage. Once the backfill ends it shows one brief,
 * terminal status and then goes idle, so "Asking..." can never linger.
 */
export type BackfillIndicatorState =
  | { kind: "idle" }
  | { kind: "running"; stored: number | null }
  | { kind: "loaded" }
  | { kind: "exhausted" }
  | { kind: "failed" }

type TerminalKind = Exclude<BackfillIndicatorState["kind"], "idle" | "running">

const TERMINAL_COPY: Record<TerminalKind, string> = {
  loaded: "Older messages loaded",
  exhausted: "No more older messages",
  failed: "Couldn't load older messages",
}

function StatusGlyph({ kind }: { kind: TerminalKind }) {
  if (kind === "failed") {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
        className="shrink-0 text-red-300"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5h.01" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-[var(--color-green)]"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export function BackfillProgress({ state }: { state: BackfillIndicatorState }) {
  if (state.kind === "idle") return null

  // Live phase: indeterminate bar on start, honest received count on each
  // chunk. Both cases keep the bar indeterminate because no total is known.
  if (state.kind === "running") {
    const label =
      state.stored === null
        ? "Asking your phone for older messages..."
        : `Messages received: ${state.stored}`
    return (
      <div
        role="status"
        aria-live="polite"
        className="absolute left-1/2 top-2 z-20 w-[17rem] max-w-[90%] -translate-x-1/2 rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-gray-200 shadow-lg backdrop-blur"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-green)] motion-reduce:animate-none"
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Loading older messages from your phone"
          aria-valuetext={
            state.stored === null
              ? "Waiting for your phone"
              : `${state.stored} messages received`
          }
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/15"
        >
          <div className="h-full w-full animate-pulse rounded-full bg-[var(--color-green)] opacity-40 motion-reduce:animate-none" />
        </div>
      </div>
    )
  }

  // Terminal phase: one short, honest status. ChatDetail owns the timer that
  // returns this to "idle" so no stale text survives the next backfill.
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute left-1/2 top-2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-xs text-gray-200 shadow-lg backdrop-blur"
    >
      <StatusGlyph kind={state.kind} />
      <span className="whitespace-nowrap">{TERMINAL_COPY[state.kind]}</span>
    </div>
  )
}

export default BackfillProgress
