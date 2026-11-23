import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: "danger" | "neutral"
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

/**
 * Shared confirmation dialog. Renders nothing when closed, portals to the body
 * when open, and keeps keyboard focus inside until it is dismissed.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "neutral",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  // Keep the latest callbacks without re-running the focus/escape effect on
  // every parent render (callers commonly pass inline arrow functions).
  const onCancelRef = useRef(onCancel)
  const onConfirmRef = useRef(onConfirm)
  onCancelRef.current = onCancel
  onConfirmRef.current = onConfirm

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== "Tab") return

      const focusables = [cancelRef.current, confirmRef.current].filter(
        (el): el is HTMLButtonElement => el !== null,
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

    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener("keydown", onKeyDown, true)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null

  const isDanger = tone === "danger"

  const handleConfirm = () => {
    void Promise.resolve(onConfirmRef.current()).catch(err => {
      console.error("Confirm action failed:", err)
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancelRef.current()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="animate-slide-up w-full max-w-md rounded-xl border border-black/[0.08] bg-light-bg p-5 text-light-text shadow-[0_10px_30px_rgba(0,0,0,0.15)] dark:border-white/[0.08] dark:bg-dark-secondary dark:text-dark-text"
      >
        <h2 id={titleId} className="text-[18px] font-semibold tracking-tight">
          {title}
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-[14px] leading-relaxed text-light-muted dark:text-dark-muted"
        >
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onCancelRef.current()}
            className="rounded-xl bg-light-secondary px-4 py-2 text-[14px] font-semibold text-light-text transition-colors duration-200 hover:bg-light-tertiary dark:bg-dark-tertiary dark:text-dark-text dark:hover:bg-dark-elevated"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={handleConfirm}
            className={cn(
              "rounded-xl px-4 py-2 text-[14px] font-semibold transition-colors duration-200",
              isDanger
                ? "bg-[var(--color-danger-tint)] text-[var(--color-danger-ink)] hover:brightness-110"
                : "bg-[var(--color-green)] text-[var(--color-action-ink)] hover:bg-[var(--color-green-dark)]",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
