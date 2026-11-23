import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import clsx from "clsx"
import { UserAvatar } from "../../assets/svgs/chat_icons"
import { BlockIcon } from "../../assets/svgs/chat_info_icons"
import type { ContactActionKey, UseContactActionsResult } from "../../hooks/useContactActions"

type SheetActions = Pick<
  UseContactActionsResult,
  | "target"
  | "busyAction"
  | "blocked"
  | "profile"
  | "profileBusy"
  | "avatarUrl"
  | "closeContactActions"
  | "startMessage"
  | "voiceCall"
  | "viewProfile"
  | "copyNumber"
  | "toggleBlock"
  | "promote"
  | "demote"
  | "remove"
>

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    {children}
  </svg>
)

const MessageIcon = () => (
  <Icon>
    <path d="M20 11.5a8 8 0 0 1-11.4 7.2L3 20.5l1.8-5.2A8 8 0 1 1 20 11.5Z" />
  </Icon>
)

const CallIcon = () => (
  <Icon>
    <path d="M6.6 3h3l1.5 4-2 1.4a12 12 0 0 0 5.5 5.5l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3Z" />
  </Icon>
)

const ProfileIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Icon>
)

const CopyIcon = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Icon>
)

const PromoteIcon = () => (
  <Icon>
    <path d="M12 20V5m0 0-5 5m5-5 5 5" />
    <path d="M5 20h14" />
  </Icon>
)

const DemoteIcon = () => (
  <Icon>
    <path d="M12 4v15m0 0 5-5m-5 5-5-5" />
    <path d="M5 4h14" />
  </Icon>
)

const RemoveIcon = () => (
  <Icon>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13H7L6 7m4 4v6m4-6v6" />
  </Icon>
)

const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

const ROW_BASE =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"

const rowClass = (tone: "default" | "danger" = "default") =>
  clsx(
    ROW_BASE,
    tone === "danger"
      ? "text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)]"
      : "text-gray-800 dark:text-gray-200",
  )

interface MenuRowProps {
  label: string
  busyLabel: string
  icon: ReactNode
  action: ContactActionKey
  onClick: () => void
  busyAction: ContactActionKey | null
  tone?: "default" | "danger"
}

function MenuRow({
  label,
  busyLabel,
  icon,
  action,
  onClick,
  busyAction,
  tone = "default",
}: MenuRowProps) {
  const isBusy = busyAction === action
  return (
    <button
      type="button"
      role="menuitem"
      disabled={busyAction !== null}
      aria-busy={isBusy || undefined}
      onClick={onClick}
      className={rowClass(tone)}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{isBusy ? busyLabel : label}</span>
      {isBusy && (
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
    </button>
  )
}

/**
 * Portalled contact-actions popup. Positioned from the trigger rect measured by
 * the hook, dismissed on outside click/scroll, and trapped for keyboard focus.
 * Escape is consumed in the capture phase so the conversation's global handler
 * cannot also close the Group Info panel underneath.
 */
export function ContactActionSheet({
  target,
  busyAction,
  blocked,
  profile,
  profileBusy,
  avatarUrl,
  closeContactActions,
  startMessage,
  voiceCall,
  viewProfile,
  copyNumber,
  toggleBlock,
  promote,
  demote,
  remove,
}: SheetActions) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; origin: string } | null>(
    null,
  )
  const menuId = useId()
  const open = target !== null
  const displayName = target ? target.displayName.replace(/^~\s*/, "") || "Contact" : ""

  useLayoutEffect(() => {
    if (!open || !target?.anchor || !sheetRef.current) {
      setPosition(null)
      return
    }
    const rect = sheetRef.current.getBoundingClientRect()
    const anchor = target.anchor
    const gap = 6
    const openUp = window.innerHeight - anchor.bottom < rect.height && anchor.top > rect.height
    let top = openUp ? anchor.top - rect.height - gap : anchor.bottom + gap
    let left = anchor.right - rect.width
    left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))
    top = Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))
    setPosition({ top, left, origin: openUp ? "bottom right" : "top right" })
  }, [open, target?.anchor, profile, profileBusy])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => {
      sheetRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        // Stop ChatDetail's window-level Escape from closing Group Info too.
        event.stopPropagation()
        closeContactActions()
        return
      }
      if (event.key !== "Tab") return
      const focusables = Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (!sheetRef.current?.contains(active)) {
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
  }, [open, closeContactActions])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(event.target as Node)) {
        closeContactActions()
      }
    }
    // Dismiss with the transcript/list, but never when the sheet's own profile
    // preview is scrolled.
    const onScroll = (event: Event) => {
      if (sheetRef.current?.contains(event.target as Node)) return
      closeContactActions()
    }
    document.addEventListener("mousedown", onMouseDown)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [open, closeContactActions])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const items = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    )
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === "Home") items[0].focus()
    else if (event.key === "End") items[items.length - 1].focus()
    else if (event.key === "ArrowDown") items[(index + 1) % items.length].focus()
    else items[(index - 1 + items.length) % items.length].focus()
  }

  if (!open || !target) return null

  return createPortal(
    <div
      ref={sheetRef}
      className="fixed z-[200] max-h-[min(30rem,calc(100vh-16px))] w-72 overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-2 text-gray-800 shadow-[0_10px_30px_rgba(0,0,0,0.15)] dark:border-white/[0.08] dark:bg-dark-secondary dark:text-gray-200"
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? "visible" : "hidden",
        transformOrigin: position?.origin,
        animation: "menuFadeIn 0.15s ease-out",
      }}
    >
      <div className="flex items-center gap-3 px-2 pb-2 pt-1">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-dark-muted [&_svg]:h-6 [&_svg]:w-6">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserAvatar />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{displayName}</p>
          {target.phone && (
            <p dir="ltr" className="truncate text-xs text-gray-600 dark:text-dark-muted">
              {target.phone}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close contact actions"
          onClick={closeContactActions}
          className="rounded-full p-1.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
        >
          <CloseIcon />
        </button>
      </div>

      {profile && (
        <section
          aria-label="Profile preview"
          className="mx-1 mb-2 rounded-lg bg-light-secondary px-3 py-2 text-xs dark:bg-dark-tertiary"
        >
          <p className="truncate font-semibold text-gray-900 dark:text-gray-100">{profile.name}</p>
          {profile.phone && (
            <p dir="ltr" className="mt-0.5 truncate text-gray-600 dark:text-dark-muted">
              {profile.phone}
            </p>
          )}
          {profile.about && (
            <p className="mt-1 break-words text-gray-700 dark:text-gray-300">“{profile.about}”</p>
          )}
          {profile.verifiedName && (
            <p className="mt-1 truncate text-gray-700 dark:text-gray-300">{profile.verifiedName}</p>
          )}
          {typeof profile.devices === "number" && (
            <p className="mt-1 text-gray-600 dark:text-dark-muted">
              {profile.devices} device{profile.devices === 1 ? "" : "s"}
            </p>
          )}
        </section>
      )}
      {profileBusy && (
        <p role="status" className="px-4 pb-1 text-xs text-gray-600 dark:text-dark-muted">
          Loading profile…
        </p>
      )}

      <div
        id={menuId}
        role="menu"
        aria-label="Contact actions"
        aria-busy={busyAction !== null}
        onKeyDown={onMenuKeyDown}
      >
        <MenuRow
          label="Message"
          busyLabel="Opening chat…"
          icon={<MessageIcon />}
          action="message"
          onClick={() => void startMessage()}
          busyAction={busyAction}
        />
        <MenuRow
          label="Voice call"
          busyLabel="Calling…"
          icon={<CallIcon />}
          action="voice"
          onClick={() => void voiceCall()}
          busyAction={busyAction}
        />
        <MenuRow
          label={profile ? "Refresh profile" : "View profile"}
          busyLabel="Loading profile…"
          icon={<ProfileIcon />}
          action="profile"
          onClick={() => void viewProfile()}
          busyAction={busyAction}
        />
        <MenuRow
          label="Copy number"
          busyLabel="Copying…"
          icon={<CopyIcon />}
          action="copy"
          onClick={() => void copyNumber()}
          busyAction={busyAction}
        />
        <div className="my-1 border-t border-black/[0.06] dark:border-white/[0.08]" />
        <MenuRow
          label={blocked ? "Unblock" : "Block"}
          busyLabel="Updating…"
          icon={<BlockIcon />}
          action="block"
          onClick={() => void toggleBlock()}
          busyAction={busyAction}
          tone="danger"
        />

        {target.canManage && (
          <>
            <div className="my-1 border-t border-black/[0.06] dark:border-white/[0.08]" />
            <MenuRow
              label={target.participantIsAdmin ? "Demote" : "Promote"}
              busyLabel={target.participantIsAdmin ? "Demoting…" : "Promoting…"}
              icon={target.participantIsAdmin ? <DemoteIcon /> : <PromoteIcon />}
              action={target.participantIsAdmin ? "demote" : "promote"}
              onClick={() => void (target.participantIsAdmin ? demote() : promote())}
              busyAction={busyAction}
            />
            {!target.participantIsAdmin && (
              <MenuRow
                label="Remove from group"
                busyLabel="Removing…"
                icon={<RemoveIcon />}
                action="remove"
                onClick={() => void remove()}
                busyAction={busyAction}
                tone="danger"
              />
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
