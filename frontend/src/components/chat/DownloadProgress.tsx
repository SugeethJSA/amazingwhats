/**
 * Presentational download indicator. Every value shown here comes from a real
 * backend `download:progress` event. When the backend reports an unknown size
 * (total/percent === -1) the component renders an indeterminate spinner and
 * deliberately never invents a percentage.
 */
interface DownloadProgressProps {
  downloaded: number
  total: number
  percent: number
  compact?: boolean
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—"
  if (value < 1024) return `${Math.round(value)} B`
  const units = ["KB", "MB", "GB"]
  let scaled = value / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`
}

export function DownloadProgress({
  downloaded,
  total,
  percent,
  compact = false,
}: DownloadProgressProps) {
  // The backend uses -1 for "unknown". Only a real positive total plus a real
  // percentage makes the bar determinate.
  const determinate = total > 0 && percent >= 0 && Number.isFinite(percent)
  const hasBytes = determinate && Number.isFinite(downloaded) && downloaded >= 0

  return (
    <div
      className={`w-full rounded-lg border border-black/5 bg-[var(--color-light-bg)] text-[var(--color-light-text)] shadow-sm dark:border-white/10 dark:bg-[var(--color-dark-secondary)] dark:text-[var(--color-dark-text)] ${
        compact ? "px-2 py-1.5" : "px-2.5 py-2"
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] font-medium leading-4">
        <span className="flex min-w-0 items-center gap-1.5">
          {!determinate && (
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
            />
          )}
          <span className="truncate">{determinate ? `${percent}%` : "Downloading…"}</span>
        </span>
        {hasBytes && (
          <span
            aria-hidden="true"
            className="shrink-0 text-[var(--color-light-muted)] dark:text-[var(--color-dark-muted)]"
          >
            {formatBytes(downloaded)} / {formatBytes(total)}
          </span>
        )}
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-light-tertiary)] dark:bg-[var(--color-dark-tertiary)]"
        role="progressbar"
        aria-label="Download progress"
        aria-valuenow={determinate ? percent : undefined}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? 100 : undefined}
        aria-valuetext={determinate ? undefined : "Downloading"}
      >
        {determinate ? (
          <div
            className="h-full rounded-full bg-[var(--color-green)] transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-full animate-pulse rounded-full bg-[var(--color-green)] opacity-25 motion-reduce:animate-none" />
        )}
      </div>
    </div>
  )
}

export default DownloadProgress
