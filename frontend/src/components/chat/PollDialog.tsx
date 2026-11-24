import { useEffect, useId, useRef, useState } from "react"
import { SendPoll } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"

const MAX_OPTIONS = 12

export function PollDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [question, setQuestion] = useState("")
  const [options, setOptions] = useState<string[]>(["", ""])
  const [multiple, setMultiple] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  )
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Escape in the capture phase so the chat's own Escape handler (which would
  // leave the conversation) never sees the event.
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

  const setOption = (i: number, v: string) =>
    setOptions(prev => prev.map((o, idx) => (idx === i ? v : o)))

  const removeOption = (i: number) =>
    setOptions(prev => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))

  const valid = question.trim() !== "" && options.filter(o => o.trim() !== "").length >= 2

  const send = async () => {
    if (!valid || sending) return
    setSending(true)
    setError("")
    try {
      await SendPoll(
        chatId,
        question.trim(),
        options.map(o => o.trim()).filter(Boolean),
        multiple ? 0 : 1,
      )
      onClose()
    } catch (err) {
      console.error("Failed to send poll:", err)
      setError("Could not send the poll. Please try again.")
      setSending(false)
    }
  }

  const inputCls =
    "w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm outline-none " +
    "placeholder:text-gray-600 dark:placeholder:text-gray-400 " +
    "focus:border-[var(--color-focus-ring)] " +
    "text-light-text dark:text-dark-text"

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
        className="w-[420px] max-w-[90vw] rounded-xl bg-white p-4 shadow-xl dark:bg-dark-secondary"
        onClick={event => event.stopPropagation()}
      >
        <h2 id={titleId} className="mb-3 text-lg font-medium text-light-text dark:text-dark-text">
          Create poll
        </h2>

        <label
          htmlFor="poll-question"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300"
        >
          Question
        </label>
        <input
          id="poll-question"
          autoFocus
          className={inputCls}
          placeholder="Ask a question"
          value={question}
          onChange={event => setQuestion(event.target.value)}
        />

        <div className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <label htmlFor={`poll-option-${i}`} className="sr-only">
                Option {i + 1}
              </label>
              <input
                id={`poll-option-${i}`}
                className={inputCls}
                placeholder={`Option ${i + 1}`}
                value={opt}
                onChange={event => setOption(i, event.target.value)}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOption(i)}
                  aria-label={`Remove option ${i + 1}`}
                  className={`shrink-0 rounded p-1 text-light-muted hover:text-[#b42318] dark:text-dark-muted dark:hover:text-[#fca5a5]`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => setOptions(prev => [...prev, ""])}
            className={`mt-2 rounded text-sm text-[#1b9a58] hover:underline dark:text-[#21c063]`}
          >
            + Add option
          </button>
        )}

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={multiple}
            onChange={event => setMultiple(event.target.checked)}
            className="accent-[#21c063]"
          />
          Allow multiple answers
        </label>

        {error && (
          <p role="alert" className="mt-2 text-xs text-[#b42318] dark:text-[#fca5a5]">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm text-light-muted dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!valid || sending}
            aria-busy={sending}
            className={`rounded-lg bg-[#21c063] px-4 py-2 text-sm font-medium text-[#0a1014] transition-colors hover:bg-[#1ea952] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {sending ? "Sending…" : "Send poll"}
          </button>
        </div>
      </div>
    </div>
  )
}
