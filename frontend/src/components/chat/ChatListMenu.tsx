import { useCallback, useEffect, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react"
import clsx from "clsx"
import {
  GetProfile,
  MarkChatAsRead,
} from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { useChatStore, useUIStore } from "../../store"

/**
 * WhatsApp-Desktop-style three-dots menu for the chat list pane.
 *
 * Honesty rule: an item is only enabled when this client actually implements
 * it. Business-only entries appear only after GetProfile("") confirms a
 * business account, and entries with no screen/binding stay disabled with a
 * short explanation instead of pretending to work.
 */
export interface ChatListMenuProps {
  /** Top-left corner, already clamped inside the viewport by the caller. */
  position: { x: number; y: number }
  /** Outside-click dismissal: do not move focus. */
  onDismiss: () => void
  /** Escape / item activation: dismiss and return focus to the trigger. */
  onClose: () => void
  onNewGroup: () => void
  onOpenSettings: () => void
}

type IconProps = { children: ReactNode }

/** Small inline, vendor-neutral line icons (no Meta artwork). */
const Icon = ({ children }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    {children}
  </svg>
)

const BusinessToolsIcon = () => (
  <Icon>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    <path d="M3 12h18" />
  </Icon>
)

const NewGroupIcon = () => (
  <Icon>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20v-1a6 6 0 0 1 11-3.7" />
    <path d="M18 8v6M15 11h6" />
  </Icon>
)

const AdvertiseIcon = () => (
  <Icon>
    <path d="M4 10v4a1 1 0 0 0 1 1h2l8 4V5L7 9H5a1 1 0 0 0-1 1z" />
    <path d="M19 9a4 4 0 0 1 0 6" />
  </Icon>
)

const BroadcastIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="2" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
)

const CatalogueIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M3 10h6M9 15h12" />
  </Icon>
)

const QuickRepliesIcon = () => (
  <Icon>
    <path d="M13 2 5 13h6l-1 9 8-11h-6z" />
  </Icon>
)

const StarredIcon = () => (
  <Icon>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </Icon>
)

const SelectChatsIcon = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="m8 12 3 3 5-6" />
  </Icon>
)

const ListsIcon = () => (
  <Icon>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
)

const MarkAllReadIcon = () => (
  <Icon>
    <path d="m2 13 4 4 8-9" />
    <path d="m10 15 2 2 9-10" />
  </Icon>
)

const AppLockIcon = () => (
  <Icon>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    <path d="M12 14v3" />
  </Icon>
)

const LogoutIcon = () => (
  <Icon>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
    <path d="M15 8l4 4-4 4M9 12h10" />
  </Icon>
)

interface MenuItemSpec {
  id: string
  label: string
  icon: ReactNode
  ariaLabel: string
  disabled?: boolean
  hint?: string
  danger?: boolean
  onSelect?: () => void
}

const ITEM_CLASS =
  "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus-ring)"

export function ChatListMenu({
  position,
  onDismiss,
  onClose,
  onNewGroup,
  onOpenSettings,
}: ChatListMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [isBusiness, setIsBusiness] = useState(false)

  // Default to personal: hide business items until the profile confirms it.
  useEffect(() => {
    let active = true
    GetProfile("")
      .then(profile => {
        if (active) setIsBusiness(profile?.is_business === true)
      })
      .catch(() => {
        if (active) setIsBusiness(false)
      })
    return () => {
      active = false
    }
  }, [])

  const unreadCount = useChatStore(state => {
    let count = 0
    for (const chat of state.chatsById.values()) {
      if ((chat.unreadCount ?? 0) > 0) count++
    }
    return count
  })

  // Reuse the existing Settings screen navigation. The category intent and
  // window event are forward-compatible with a deeper settings link; today
  // they are harmless (SettingsScreen consumes only "account").
  const openSettings = useCallback(
    (category: string) => {
      useUIStore.getState().setSettingsCategoryIntent(category)
      window.dispatchEvent(new CustomEvent("wa:open-settings-category", { detail: category }))
      onOpenSettings()
    },
    [onOpenSettings],
  )

  const handleMarkAllRead = useCallback(async () => {
    const unread = Array.from(useChatStore.getState().chatsById.values()).filter(
      chat => (chat.unreadCount ?? 0) > 0,
    )
    if (unread.length === 0) return
    const results = await Promise.allSettled(unread.map(chat => MarkChatAsRead(chat.id, true)))
    let failed = 0
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        useChatStore.getState().clearUnreadCount(unread[index].id)
      } else {
        failed++
      }
    })
    useUIStore.getState().addNotification(
      failed > 0 ? `Couldn't mark ${failed} chat(s) as read` : "All chats marked as read",
      { tone: failed > 0 ? "error" : "success" },
    )
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (menuRef.current?.contains(target as Node)) return
      // The trigger handles its own toggle; don't race its click event.
      if (target?.closest?.("[data-chat-list-menu-trigger]")) return
      onDismiss()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [onDismiss])

  // Escape at capture phase stops ChatDetail's own ESC handler from also
  // leaving the active chat while this menu is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  // Focus the first usable item as soon as the menu opens.
  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus()
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? [],
    )
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        items[(current + 1) % items.length]?.focus()
        break
      case "ArrowUp":
        event.preventDefault()
        items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length]?.focus()
        break
      case "Home":
        event.preventDefault()
        items[0]?.focus()
        break
      case "End":
        event.preventDefault()
        items[items.length - 1]?.focus()
        break
    }
  }

  const primary: MenuItemSpec[] = []
  if (isBusiness) {
    primary.push({
      id: "business-tools",
      label: "Business tools",
      icon: <BusinessToolsIcon />,
      ariaLabel: "Business tools — open business settings",
      hint: "Opens Settings",
      onSelect: () => openSettings("business"),
    })
  }
  primary.push({
    id: "new-group",
    label: "New group",
    icon: <NewGroupIcon />,
    ariaLabel: "New group",
    onSelect: onNewGroup,
  })
  if (isBusiness) {
    // Real business account, but this client has no screens for these flows.
    primary.push(
      {
        id: "advertise",
        label: "Advertise",
        icon: <AdvertiseIcon />,
        ariaLabel: "Advertise — not available",
        disabled: true,
        hint: "Advertising campaigns aren't available in this client",
      },
      {
        id: "business-broadcast",
        label: "Business broadcast",
        icon: <BroadcastIcon />,
        ariaLabel: "Business broadcast — not available",
        disabled: true,
        hint: "Business broadcasts aren't available in this client",
      },
      {
        id: "catalogue",
        label: "Catalogue",
        icon: <CatalogueIcon />,
        ariaLabel: "Catalogue — not available",
        disabled: true,
        hint: "Product catalogues aren't available in this client",
      },
    )
  }
  primary.push(
    {
      id: "quick-replies",
      label: "Quick replies",
      icon: <QuickRepliesIcon />,
      ariaLabel: "Quick replies — not available",
      disabled: true,
      hint: "Quick replies aren't available in this client",
    },
    {
      id: "starred-messages",
      label: "Starred messages",
      icon: <StarredIcon />,
      ariaLabel: "Starred messages — not available",
      disabled: true,
      hint: "There's no starred-messages view yet",
    },
    {
      id: "select-chats",
      label: "Select chats",
      icon: <SelectChatsIcon />,
      ariaLabel: "Select chats — not available",
      disabled: true,
      hint: "Chat selection isn't available yet",
    },
    {
      id: "lists",
      label: "Lists",
      icon: <ListsIcon />,
      ariaLabel: "Lists — not available",
      disabled: true,
      hint: "Lists aren't available in this client",
    },
    {
      id: "mark-all-read",
      label: "Mark all as read",
      icon: <MarkAllReadIcon />,
      ariaLabel:
        unreadCount > 0
          ? `Mark all ${unreadCount} unread chats as read`
          : "Mark all as read — nothing unread",
      disabled: unreadCount === 0,
      hint: unreadCount === 0 ? "Everything is already read" : undefined,
      onSelect: () => void handleMarkAllRead(),
    },
  )

  const secondary: MenuItemSpec[] = [
    {
      id: "app-lock",
      label: "App lock",
      icon: <AppLockIcon />,
      ariaLabel: "App lock — not available",
      disabled: true,
      hint: "Not available: this client has no app-lock integration",
    },
    {
      id: "logout",
      label: "Log out",
      icon: <LogoutIcon />,
      ariaLabel: "Log out — open Settings to confirm",
      danger: true,
      hint: "Opens Settings",
      onSelect: () => openSettings("logout"),
    },
  ]

  const renderItem = (item: MenuItemSpec) => (
    <div key={item.id} role="none">
      <button
        type="button"
        role="menuitem"
        aria-label={item.ariaLabel}
        aria-disabled={item.disabled || undefined}
        disabled={item.disabled}
        tabIndex={-1}
        onClick={() => {
          if (item.disabled) return
          onClose()
          item.onSelect?.()
        }}
        className={clsx(
          ITEM_CLASS,
          item.disabled
            ? "cursor-not-allowed text-light-muted dark:text-dark-muted"
            : item.danger
              ? "text-[var(--color-danger-ink)] hover:bg-gray-100 dark:hover:bg-white/5"
              : "text-light-text hover:bg-gray-100 dark:text-dark-text dark:hover:bg-white/5",
        )}
      >
        {item.icon}
        <span>{item.label}</span>
      </button>
      {item.hint && (
        <p className="pb-1.5 pl-[46px] pr-4 text-[11px] leading-snug text-light-muted dark:text-dark-muted">
          {item.hint}
        </p>
      )}
    </div>
  )

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Chat list menu"
      onKeyDown={handleKeyDown}
      className="fixed z-50 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-dark-secondary"
      style={{
        top: position.y,
        left: position.x,
        maxHeight: Math.max(180, window.innerHeight - position.y - 12),
      }}
    >
      <div>{primary.map(renderItem)}</div>
      <div role="separator" className="my-1 border-t border-gray-200 dark:border-white/10" />
      <div>{secondary.map(renderItem)}</div>
    </div>
  )
}

export default ChatListMenu
