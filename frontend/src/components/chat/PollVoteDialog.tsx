import { useEffect, useId, useRef, useState } from "react"
import { SendPollVote } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"

interface PollVoteDialogProps {
  chatId: string
  messageId: string
  question: string
  options: string[]
  onClose: () => void
  onVote?: () => void
}

export function PollVoteDialog({
  chatId,
  messageId,
  question,
  options,
  onClose,
  onVote,
}: PollVoteDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  )
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    firstOptionRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab" || !panelRef.current) return
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("keydown", onKey, true)
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
  }, [])

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const vote = async () => {
    if (selected.size === 0 || sending) return
    setSending(true)
    setError("")
    try {
      const names = Array.from(selected).map(i => options[i])
      await SendPollVote(chatId, messageId, names)
      setDone(true)
      onVote?.()
    } catch (err) {
      console.error("Failed to submit vote:", err)
      setError("Could not submit your vote. Please try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-[360px] max-w-[90vw] rounded-xl bg-white p-4 shadow-xl dark:bg-dark-secondary"
        onClick={event => event.stopPropagation()}
      >
        <h3 id={titleId} className="mb-3 text-lg font-medium text-light-text dark:text-dark-text">
          Vote
        </h3>
        <p className="mb-3 text-sm font-medium text-gray-900 dark:text-gray-100">{question}</p>
        {done ? (
          <p role="status" className="mb-3 text-sm text-green-dark dark:text-green">
            Vote submitted!
          </p>
        ) : (
          <div className="mb-3 flex flex-col gap-2" role="group" aria-label="Poll options">
            {options.map((opt, i) => (
              <button
                key={i}
                ref={i === 0 ? firstOptionRef : undefined}
                type="button"
                onClick={() => toggle(i)}
                aria-pressed={selected.has(i)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  selected.has(i)
                    ? "border-green bg-green/10 text-green-dark dark:text-green"
                    : "border-gray-300 text-gray-900 hover:bg-gray-100 dark:border-dark-border dark:text-gray-100 dark:hover:bg-dark-tertiary"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="mb-2 text-xs text-danger-ink dark:text-danger-soft">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm text-light-muted dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5`}
          >
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              type="button"
              onClick={vote}
              disabled={selected.size === 0 || sending}
              aria-busy={sending}
              className={`rounded-lg bg-green px-4 py-2 text-sm font-medium text-action-ink transition-colors hover:bg-green-hover disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {sending ? "Voting…" : "Vote"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
