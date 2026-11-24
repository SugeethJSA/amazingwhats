import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useId,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import clsx from "clsx"
import ConfirmDialog from "@/components/common/ConfirmDialog"
import {
  ReplyIcon,
  CopyIcon,
  ReactIcon,
  EditIcon,
  DeleteIcon,
  MenuArrowIcon,
  ForwardIcon,
  StarIcon,
} from "../../assets/svgs/message_menu_icons"
import {
  ToggleMessageLabel,
  DeleteMedia,
  DownloadMediaToFile,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { useUIStore } from "../../store"

interface MessageMenuProps {
  messageId: string
  chatId: string
  isFromMe: boolean
  isPinned?: boolean
  messageBody?: { directPath?: string; fileEncSHA256?: string }
  onReply?: () => void
  onCopy?: () => void
  onReact?: () => void
  onPin?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onForward?: () => void
  onStar?: () => void
}

type NotificationOptions = {
  tone?: "info" | "success" | "error" | "warning"
  action?: { label: string; onClick: () => void }
  durationMs?: number
}
// The UI store owns the toast contract; this cast keeps the file type-safe
// against the shared signature while the store's options overload lands.
type Notify = (message: string, options?: NotificationOptions) => number

// Label names are a local convenience only — the backend speaks in label IDs.
// Keeping the pairing lets a numeric ID always be recovered by its human name.
const LABEL_NAMES_KEY = "amazingwhats.labelNames"
type LabelNames = Record<string, string>

function readLabelNames(): LabelNames {
  try {
    const raw = localStorage.getItem(LABEL_NAMES_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as LabelNames)
      : {}
  } catch {
    return {}
  }
}

function writeLabelNames(names: LabelNames) {
  try {
    localStorage.setItem(LABEL_NAMES_KEY, JSON.stringify(names))
  } catch {
    // Storage can be disabled; the label itself still applies.
  }
}

// Same pin glyph as the chat list, sized for menu rows.
const PinMenuIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" className="fill-current">
    <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
  </svg>
)

const labelIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" className="fill-current">
    <path d="M17.63 5.84C17.27 5.33 16.67 5 16 5H5C3.9 5 3 5.9 3 7v10c0 1.1.9 2 2 2h11c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z" />
  </svg>
)

const MENU_ITEM_BASE =
  "flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-100 focus-visible:bg-gray-100 dark:hover:bg-dark-tertiary dark:focus-visible:bg-dark-tertiary disabled:cursor-not-allowed disabled:opacity-50"

const menuItemClass = (tone: "default" | "danger" = "default") =>
  clsx(
    MENU_ITEM_BASE,
    tone === "danger"
      ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
      : "text-gray-800 dark:text-gray-200",
  )

export function MessageMenu({
  messageId,
  chatId,
  isFromMe,
  isPinned,
  messageBody,
  onReply,
  onCopy,
  onReact,
  onPin,
  onEdit,
  onDelete,
  onForward,
  onStar,
}: MessageMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{
    top: number
    left: number
    transformOrigin: string
  } | null>(null)
  const [labelOpen, setLabelOpen] = useState(false)
  const [labelId, setLabelId] = useState("")
  const [labelName, setLabelName] = useState("")
  const [labelNames, setLabelNames] = useState<LabelNames>(readLabelNames)
  const [pendingMediaDelete, setPendingMediaDelete] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useUIStore(s => s.addNotification) as unknown as Notify

  const ids = useId()
  const menuId = `${ids}-menu`
  const moreId = `${ids}-more`
  const labelFormId = `${ids}-label-form`
  const labelListId = `${ids}-label-list`

  const closeMenu = (restoreFocus = false) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setIsClosing(true)
    setShowMore(false)
    setLabelOpen(false)
    setLabelId("")
    setLabelName("")
    if (restoreFocus) triggerRef.current?.focus()
    closeTimerRef.current = setTimeout(() => {
      setIsMenuOpen(false)
      setIsClosing(false)
      closeTimerRef.current = null
    }, 150)
  }

  // Destructive actions hand straight to a dialog; skip the fade so the
  // menu's high z-index never sits over the confirmation for a beat.
  const closeMenuNow = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setIsClosing(false)
    setIsMenuOpen(false)
    setShowMore(false)
    setLabelOpen(false)
    setLabelId("")
    setLabelName("")
  }

  const toggleMenu = () => {
    if (isMenuOpen) closeMenu()
    else setIsMenuOpen(true)
  }

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    },
    [],
  )

  useLayoutEffect(() => {
    if (isMenuOpen && menuRef.current && dropdownRef.current) {
      const buttonRect = menuRef.current.getBoundingClientRect()
      const dropdownRect = dropdownRef.current.getBoundingClientRect()
      const viewportHeight = window.innerHeight

      const spaceBelow = viewportHeight - buttonRect.bottom
      const spaceAbove = buttonRect.top
      const height = dropdownRect.height
      const width = dropdownRect.width

      let top = 0
      let left = 0
      let origin = "top right"

      let upward = false
      if (spaceBelow < height && spaceAbove > height) {
        upward = true
      }

      if (isFromMe) {
        left = buttonRect.right - width
      } else {
        left = buttonRect.left
      }

      if (upward) {
        top = buttonRect.top - height - 4
        origin = isFromMe ? "bottom right" : "bottom left"
      } else {
        top = buttonRect.bottom + 4
        origin = isFromMe ? "top right" : "top left"
      }

      // Keep the panel inside the viewport when More expands or the label
      // field opens; otherwise the extra rows would render off-screen.
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      top = Math.max(8, Math.min(top, viewportHeight - height - 8))

      setMenuPosition({ top, left, transformOrigin: origin })
    } else if (!isMenuOpen) {
      setMenuPosition(null)
    }
  }, [isMenuOpen, isFromMe, showMore, labelOpen])

  // Move focus into the menu once it is positioned. Recomputing the position
  // while it is open must not yank focus back to the first item.
  const hasPosition = menuPosition !== null
  useEffect(() => {
    if (!isMenuOpen || !hasPosition) return
    dropdownRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMenuOpen, hasPosition])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        closeMenu()
      }
    }
    const handleScroll = () => closeMenu()

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      window.addEventListener("scroll", handleScroll, true)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      window.removeEventListener("scroll", handleScroll, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMenuOpen])

  // Escape unwinds one layer at a time and always returns focus to the
  // trigger when the menu itself closes.
  useEffect(() => {
    if (!isMenuOpen) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      if (labelOpen) {
        setLabelOpen(false)
        setLabelId("")
        setLabelName("")
        dropdownRef.current?.querySelector<HTMLElement>("[data-label-trigger]")?.focus()
        return
      }
      if (showMore) {
        setShowMore(false)
        return
      }
      closeMenu(true)
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMenuOpen, labelOpen, showMore])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    // Arrow keys belong to the label input and its datalist.
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const items = Array.from(
      dropdownRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    )
    if (!items.length) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === "Home") items[0].focus()
    else if (event.key === "End") items[items.length - 1].focus()
    else if (event.key === "ArrowDown") items[(index + 1) % items.length].focus()
    else items[(index - 1 + items.length) % items.length].focus()
  }

  const handleMenuItemClick = (callback?: () => void) => {
    callback?.()
    closeMenu()
  }

  const confirmMediaDelete = async () => {
    setPendingMediaDelete(false)
    if (!messageBody?.directPath) return
    try {
      await DeleteMedia(messageBody.directPath, "", messageBody.fileEncSHA256 ?? "", "")
      notify("Media removed from the server", { tone: "success", durationMs: 5000 })
    } catch {
      // Raw backend errors can contain paths or tokens — keep them in logs.
      notify("Couldn't remove the media from the server. Please try again.", {
        tone: "error",
        durationMs: 6000,
      })
    }
  }

  const resolveLabelId = (raw: string) => {
    const value = raw.trim()
    if (Object.prototype.hasOwnProperty.call(labelNames, value)) return value
    const match = Object.entries(labelNames).find(
      ([, name]) => name.toLowerCase() === value.toLowerCase(),
    )
    return match ? match[0] : value
  }

  const handleLabel = async () => {
    const raw = labelId.trim()
    if (!raw) return
    // The field accepts a saved human name or a raw ID; only the resolved ID
    // ever crosses the RPC boundary. Storage stays an id -> name JSON map.
    const id = resolveLabelId(raw)
    if (!id) return
    const customName = labelName.trim()
    const displayName = customName || labelNames[id] || (raw === id ? "" : raw)
    try {
      await ToggleMessageLabel(chatId, messageId, id, true)
      if (customName && customName !== labelNames[id]) {
        const next = { ...labelNames, [id]: customName }
        setLabelNames(next)
        writeLabelNames(next)
      }
      notify(displayName ? `Label "${displayName}" applied` : `Label ${id} applied`, {
        tone: "success",
        durationMs: 4000,
      })
    } catch {
      notify("Couldn't apply the label. Please try again.", { tone: "error", durationMs: 6000 })
    }
    setLabelOpen(false)
    setLabelId("")
    setLabelName("")
  }

  return (
    <div className="absolute top-1 right-1 z-10" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        aria-label="Message options"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls={menuId}
        className="rounded-lg p-1 opacity-0 transition-opacity duration-200 hover:bg-black/5 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/10"
      >
        <MenuArrowIcon />
      </button>

      {isMenuOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            id={menuId}
            role="menu"
            aria-label="Message options"
            onKeyDown={handleMenuKeyDown}
            className="fixed z-[9999] max-h-[calc(100vh-16px)] w-60 overflow-y-auto rounded-xl bg-white p-2 shadow-lg dark:bg-dark-secondary"
            style={{
              top: menuPosition?.top ?? 0,
              left: menuPosition?.left ?? 0,
              visibility: menuPosition ? "visible" : "hidden",
              transformOrigin: menuPosition?.transformOrigin,
              animation: isClosing ? "menuFadeOut 0.15s ease-in" : "menuFadeIn 0.15s ease-out",
            }}
          >
            {/* The three everyday actions stay one click away. */}
            <button
              type="button"
              role="menuitem"
              onClick={() => handleMenuItemClick(onReply)}
              className={menuItemClass()}
            >
              <ReplyIcon />
              <span>Reply</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleMenuItemClick(onCopy)}
              className={menuItemClass()}
            >
              <CopyIcon />
              <span>Copy</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => handleMenuItemClick(onReact)}
              className={menuItemClass()}
            >
              <ReactIcon />
              <span>React</span>
            </button>

            <button
              type="button"
              role="menuitem"
              aria-expanded={showMore}
              aria-controls={moreId}
              onClick={() => setShowMore(value => !value)}
              className={clsx(
                menuItemClass(),
                "mt-1 border-t border-black/[0.06] pt-3 dark:border-white/[0.08]",
              )}
            >
              <span
                aria-hidden="true"
                className={clsx("inline-flex transition-transform", showMore && "rotate-180")}
              >
                <MenuArrowIcon />
              </span>
              <span className="flex-1">More</span>
              <span className="text-[11px] opacity-75">
                {showMore ? "Show less" : "All actions"}
              </span>
            </button>

            {showMore && (
              <div id={moreId} role="group" aria-label="More actions">
                {onPin && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleMenuItemClick(onPin)}
                    className={menuItemClass()}
                  >
                    <PinMenuIcon />
                    <span>{isPinned ? "Unpin" : "Pin"}</span>
                  </button>
                )}
                {isFromMe && onEdit && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleMenuItemClick(onEdit)}
                    className={menuItemClass()}
                  >
                    <EditIcon />
                    <span>Edit</span>
                  </button>
                )}
                {onForward && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleMenuItemClick(onForward)}
                    className={menuItemClass()}
                  >
                    <ForwardIcon />
                    <span>Forward</span>
                  </button>
                )}
                {messageBody?.directPath && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      try {
                        // Binding takes the message ID, not the directPath —
                        // the backend looks the media up by ID.
                        await DownloadMediaToFile(messageId)
                      } catch {
                        notify("Couldn't save the media. Please try again.", {
                          tone: "error",
                          durationMs: 6000,
                        })
                      }
                      closeMenu()
                    }}
                    className={menuItemClass()}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                    </svg>
                    <span>Save media to disk</span>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  data-label-trigger
                  aria-expanded={labelOpen}
                  aria-controls={labelFormId}
                  onClick={() => {
                    setLabelOpen(value => !value)
                    setLabelId("")
                    setLabelName("")
                  }}
                  className={menuItemClass()}
                >
                  {labelIcon()}
                  <span>Label</span>
                </button>
                {labelOpen && (
                  <div id={labelFormId} className="px-4 pb-2">
                    <datalist id={labelListId}>
                      {Object.entries(labelNames).map(([id, name]) => (
                        <option key={id} value={name} label={id}>
                          {name}
                        </option>
                      ))}
                    </datalist>
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        list={labelListId}
                        aria-label="Label name or ID"
                        className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-2 py-1 text-xs text-gray-900 outline-none placeholder:text-gray-600 dark:border-dark-border dark:text-gray-100 dark:placeholder:text-gray-400"
                        value={labelId}
                        onChange={event => setLabelId(event.target.value)}
                        placeholder="Label name or ID"
                        onKeyDown={event => {
                          if (event.key === "Enter") void handleLabel()
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void handleLabel()}
                        disabled={!labelId.trim()}
                        className="rounded-lg bg-green px-2 py-1 text-xs font-medium text-action-ink transition-colors hover:bg-green-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                    <input
                      aria-label="Label name (optional)"
                      className="mt-2 w-full rounded-lg border border-gray-300 bg-transparent px-2 py-1 text-xs text-gray-900 outline-none placeholder:text-gray-600 dark:border-dark-border dark:text-gray-100 dark:placeholder:text-gray-400"
                      value={labelName}
                      onChange={event => setLabelName(event.target.value)}
                      placeholder="Name for this label (optional)"
                    />
                    <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
                      Names are saved on this device so you can find the label by name later.
                    </p>
                  </div>
                )}

                {onStar && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleMenuItemClick(onStar)}
                    className={menuItemClass()}
                  >
                    <StarIcon />
                    <span>Star</span>
                  </button>
                )}

                {/* Irreversible actions live behind their own divider and are
                    never fired directly from a menu click. */}
                {(onDelete || messageBody?.directPath) && (
                  <div role="group" aria-label="Irreversible actions">
                    <div className="my-1 border-t border-black/[0.06] dark:border-white/[0.08]" />
                    <div className="px-4 pb-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                      Can't be undone
                    </div>
                    {messageBody?.directPath && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setPendingMediaDelete(true)
                          closeMenuNow()
                        }}
                        className={menuItemClass("danger")}
                      >
                        <DeleteIcon />
                        <span>Delete media from server</span>
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onDelete?.()
                          closeMenuNow()
                        }}
                        className={menuItemClass("danger")}
                      >
                        <DeleteIcon />
                        <span>{isFromMe ? "Delete for everyone" : "Delete for me"}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}

      <ConfirmDialog
        open={pendingMediaDelete}
        title="Delete media from server — this cannot be undone"
        description="The media file will be removed from WhatsApp's servers and will no longer be available to anyone in this chat. The copy on this device is not affected. There is no undo."
        confirmLabel="Delete from server"
        cancelLabel="Keep media"
        tone="danger"
        onConfirm={confirmMediaDelete}
        onCancel={() => {
          setPendingMediaDelete(false)
          triggerRef.current?.focus()
        }}
      />
    </div>
  )
}
