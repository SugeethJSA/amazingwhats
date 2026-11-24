import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ForwardMessage } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { useChatStore } from "../../store/useChatStore"
import { useMessageStore, useUIStore } from "../../store"
import { formatPhone, phoneFromJID } from "../../lib/utils"

interface ForwardDialogProps {
  sourceJID: string
  messageID: string
  onClose: () => void
}

export function ForwardDialog({ sourceJID, messageID, onClose }: ForwardDialogProps) {
  const chatsById = useChatStore(s => s.chatsById)
  const [search, setSearch] = useState("")
  const [forwardingTo, setForwardingTo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const setActiveChatId = useMessageStore(s => s.setActiveChatId)
  const addNotification = useUIStore(s => s.addNotification)

  const titleId = useId()
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  )
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape is mandatory here: previously this dialog could only be dismissed
  // by clicking the backdrop, which left keyboard users stranded.
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

  const handleForward = async (targetJID: string) => {
    if (forwardingTo) return
    setForwardingTo(targetJID)
    try {
      await ForwardMessage(sourceJID, messageID, targetJID)
      setActiveChatId(targetJID)
      onClose()
    } catch (err) {
      console.error("ForwardMessage failed:", err)
      setForwardingTo(null)
      addNotification("Message could not be forwarded. Please try again.", { tone: "error" })
    }
  }

  const chats = [...chatsById.values()]
    .filter(c => c.id !== sourceJID)
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))

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
        className="flex max-h-[80vh] w-96 flex-col rounded-2xl bg-white shadow-xl dark:bg-dark-secondary"
      >
        <div className="border-b border-gray-200 p-4 dark:border-white/10">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Forward message
          </h2>
          <label htmlFor="forward-search" className="sr-only">
            Search chats
          </label>
          <input
            id="forward-search"
            ref={inputRef}
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search chats..."
            className={`mt-2 w-full rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-600 dark:bg-dark-tertiary dark:text-gray-100 dark:placeholder:text-gray-400`}
          />
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {chats.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-600 dark:text-[#8696a0]">
              No chats found
            </p>
          ) : (
            chats.map(chat => (
              <button
                key={chat.id}
                type="button"
                onClick={() => void handleForward(chat.id)}
                disabled={!!forwardingTo}
                aria-busy={forwardingTo === chat.id}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-100 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-dark-tertiary`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-300 text-sm font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                  {chat.avatar ? (
                    <img src={chat.avatar} className="h-10 w-10 rounded-full object-cover" alt="" />
                  ) : (
                    (chat.name || "?").charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {chat.name}
                  </div>
                  <div className="truncate text-xs text-gray-600 dark:text-[#8696a0]">
                    {chat.type === "group" ? "Group" : formatPhone(phoneFromJID(chat.id))}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="flex justify-end border-t border-gray-200 p-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-tertiary`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
