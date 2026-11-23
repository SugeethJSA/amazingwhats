import chatMark from "@/assets/images/chat-mark.svg"

export interface WordmarkProps {
  className?: string
  compact?: boolean
  /** Overrides the lockup's text size without fighting the wrapper layout. */
  textClassName?: string
  /** Overrides the mark's size when a call site needs a larger lockup. */
  markClassName?: string
}

/**
 * Shared product wordmark: the bundled chat mark beside "Whats4Linux", with
 * the accent on "4Linux". The whole lockup carries one accessible name; the
 * mark is decorative. `compact` scales it down for dense chrome.
 */
export default function Wordmark({
  className = "",
  compact = false,
  textClassName = "",
  markClassName = "",
}: WordmarkProps) {
  return (
    <span
      role="img"
      aria-label="Whats4Linux"
      className={`inline-flex items-center ${compact ? "gap-1.5" : "gap-2.5"} ${className}`}
    >
      <img
        src={chatMark}
        alt=""
        aria-hidden="true"
        className={`flex-shrink-0 ${
          markClassName || (compact ? "h-5 w-5" : "h-7 w-7")
        }`}
      />
      <span
        aria-hidden="true"
        className={`font-semibold tracking-tight text-light-text dark:text-dark-text ${
          textClassName || (compact ? "text-sm" : "text-lg")
        }`}
      >
        Whats<span className="text-green-ink">4Linux</span>
      </span>
    </span>
  )
}
