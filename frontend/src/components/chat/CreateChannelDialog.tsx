import { useEffect, useId, useRef, useState } from "react"
import { CreateNewsletter } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"

interface CreateChannelDialogProps {
  onClose: () => void
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary"

export function CreateChannelDialog({ onClose }: CreateChannelDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Captured during render, before autoFocus moves into the dialog.
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  )
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

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
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  const handleCreate = async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    setError("")
    try {
      await CreateNewsletter(name.trim(), description.trim())
      setSuccess("Channel created.")
    } catch {
      // Never surface raw backend text (it can contain JIDs/internal detail).
      setError("Could not create the channel. Please try again.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-[400px] max-w-[90vw] rounded-2xl bg-white p-6 shadow-xl dark:bg-dark-secondary"
        onClick={event => event.stopPropagation()}
      >
        <h2 id={titleId} className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Create Channel
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-dark-muted">
          Start a new WhatsApp channel.
        </p>

        <label
          htmlFor="channel-name"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300"
        >
          Channel name
        </label>
        <input
          id="channel-name"
          autoFocus
          className="mb-3 w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-600 focus:border-[#21c063] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] dark:placeholder:text-gray-400 dark:focus:border-[#21c063] text-light-text dark:text-dark-text"
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Channel name"
        />
        <label
          htmlFor="channel-description"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300"
        >
          Description (optional)
        </label>
        <textarea
          id="channel-description"
          className="w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-600 focus:border-[#21c063] focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] dark:placeholder:text-gray-400 text-light-text dark:text-dark-text resize-none"
          rows={3}
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="Description (optional)"
        />

        {error && (
          <p role="alert" className="mt-2 text-xs text-[#b42318] dark:text-[#fca5a5]">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="mt-2 text-xs text-[#1b9a58] dark:text-[#21c063]">
            {success}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm text-light-muted dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 ${FOCUS_RING}`}
          >
            {success ? "Close" : "Cancel"}
          </button>
          {!success && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              aria-busy={creating}
              className={`rounded-lg bg-[#21c063] px-4 py-2 text-sm font-medium text-[#0a1014] transition-colors hover:bg-[#1ea952] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
            >
              {creating ? "Creating…" : "Create"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
