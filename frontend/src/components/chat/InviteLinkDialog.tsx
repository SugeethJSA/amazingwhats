import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AcceptGroupInviteLink } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"

interface InviteLinkDialogProps {
  onClose: () => void
}

const INVITE_URL_PREFIX = "https://chat.whatsapp.com/"

function extractInviteCode(input: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith(INVITE_URL_PREFIX)) {
    return trimmed.slice(INVITE_URL_PREFIX.length).split("?")[0].split("/")[0]
  }
  return trimmed
}

export function InviteLinkDialog({ onClose }: InviteLinkDialogProps) {
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState("")
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const titleId = useId()
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  )
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    inputRef.current?.focus()
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

  const handleJoin = async () => {
    const code = extractInviteCode(input)
    if (!code) {
      setError("Please enter a valid invite link or code")
      return
    }
    setBusy(true)
    setError("")
    setSuccess("")
    try {
      await AcceptGroupInviteLink(code)
      setSuccess("Joined successfully!")
      setTimeout(onClose, 1500)
    } catch (err) {
      console.error("Failed to join group:", err)
      // Raw backend strings can contain JIDs; keep the message human.
      setError("Could not join that group. Check the link and try again.")
    } finally {
      setBusy(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault()
      void handleJoin()
    }
  }

  return createPortal(
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
        className="flex flex-col rounded-2xl bg-white p-6 shadow-xl dark:bg-dark-secondary"
        onClick={event => event.stopPropagation()}
      >
        <h2 id={titleId} className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Join Group by Link
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-[#8696a0]">
          Paste a WhatsApp group invite link or code
        </p>
        <label htmlFor="invite-link" className="sr-only">
          Invite link or code
        </label>
        <input
          id="invite-link"
          ref={inputRef}
          value={input}
          onChange={event => {
            setInput(event.target.value)
            setError("")
            setSuccess("")
          }}
          onKeyDown={handleKeyDown}
          placeholder="https://chat.whatsapp.com/... or invite code"
          className={`mb-4 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-600 dark:bg-dark-tertiary dark:text-gray-100 dark:placeholder:text-gray-400`}
        />
        {error && (
          <p role="alert" className="mb-3 text-sm text-[#b42318] dark:text-[#fca5a5]">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="mb-3 text-sm text-[#1b9a58] dark:text-[#21c063]">
            {success}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-tertiary`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleJoin()}
            disabled={busy || !input.trim()}
            aria-busy={busy}
            className={`rounded-lg bg-[#21c063] px-4 py-2 text-sm font-medium text-[#0a1014] transition-colors hover:bg-[#1ea952] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {busy ? "Joining..." : "Join"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
