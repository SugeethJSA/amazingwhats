import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { GoBackIcon } from "../../assets/svgs/header_icons"
import { InfoIcon } from "../../assets/svgs/chat_info_icons"
import { MenuIcon, SearchIcon } from "../../assets/svgs/chat_icons"
import ConfirmDialog from "@/components/common/ConfirmDialog"
import { AnnouncementAvatar, type AnnouncementIdentity } from "./AnnouncementAvatar"
import { runShortcut } from "../../lib/shortcuts"
import { useChatStore, useChatMuted, useMessageStore, useUIStore } from "../../store"
import { ClearChat } from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"

interface ChatHeaderProps {
  chatName: string
  chatSubtitle?: string
  chatAvatar?: string
  onBack?: () => void
  onInfoClick?: () => void
  onCallClick?: () => void
  isTyping?: boolean
  /** Present only for a community announcement group (exact parent JID match). */
  announcement?: AnnouncementIdentity | null
}

const typingDot = (delay: string) => (
  <span
    className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-green"
    style={{ animationDelay: delay }}
  />
)

/** Simple camera glyph. All glyphs here are local code, never bundled brand assets. */
const VideoCallIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15 8.2V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1.2l5 3.6V4.6l-5 3.6Z" />
  </svg>
)

const ACTION_BUTTON =
  "p-2 rounded-full transition-colors text-light-muted hover:text-light-text hover:bg-black/5 dark:text-dark-muted dark:hover:text-dark-text dark:hover:bg-white/10"

const MENU_ITEM =
  "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left text-sm transition-colors text-light-text hover:bg-black/5 focus-visible:bg-black/5 dark:text-dark-text dark:hover:bg-white/10 dark:focus-visible:bg-white/10"

export function ChatHeader({
  chatName,
  chatSubtitle,
  chatAvatar,
  onBack,
  onInfoClick,
  onCallClick,
  isTyping,
  announcement,
}: ChatHeaderProps) {
  // ChatDetail is keyed by selectedChatId, so this is the conversation the
  // header belongs to. The store is the same source the existing header/call
  // and chat-action handlers use.
  const chatId = useChatStore(state => state.selectedChatId) ?? ""
  const isMuted = useChatMuted(chatId)
  const addNotification = useUIStore(state => state.addNotification)

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  // These entries invoke handlers that are already registered by ChatScreen /
  // ChatDetail (the same actions wired to keyboard shortcuts). No new backend
  // paths, no placeholder callbacks: a missing handler simply does nothing.
  const runAction = (name: "mark-unread" | "chat-info" | "mute-chat") => {
    closeMenu(true)
    runShortcut(name)
  }

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) closeMenu()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onEscape, true)
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onEscape, true)
      cancelAnimationFrame(frame)
    }
  }, [menuOpen])

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === "Home") items[0].focus()
    else if (event.key === "End") items[items.length - 1].focus()
    else if (event.key === "ArrowDown") items[index < 0 ? 0 : (index + 1) % items.length].focus()
    else items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length].focus()
  }

  const confirmClearChat = async () => {
    setConfirmClear(false)
    if (!chatId) return
    try {
      await ClearChat(chatId)
      useMessageStore.getState().clearMessages(chatId)
      addNotification("Messages cleared", { tone: "success", durationMs: 4000 })
    } catch (err) {
      // Never render raw backend errors: they can contain JIDs or paths.
      console.error("Clear chat failed:", err)
      addNotification("Couldn't clear the chat. Please try again.", {
        tone: "error",
        durationMs: 6000,
      })
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-white/5 bg-light-secondary dark:bg-dark-bg">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back to chats"
            className="mr-2 p-1.5 rounded-full transition-colors text-gray-600 dark:text-dark-muted hover:bg-black/5 dark:hover:bg-white/10 md:hidden"
          >
            <GoBackIcon />
          </button>
        )}

        <button
          type="button"
          onClick={onInfoClick}
          aria-label={`Open chat info for ${chatName}`}
          className="flex items-center gap-3 min-w-0 rounded-xl text-left"
        >
          {/* Avatar with presence dot. Announcement groups show the community
              logo stacked with the group's broadcast icon/photo. */}
          <div className="relative shrink-0">
            {announcement ? (
              <AnnouncementAvatar identity={announcement} groupAvatar={chatAvatar} size="sm" />
            ) : (
              <div
                className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #2a3942, #1f2c34)" }}
              >
                {chatAvatar ? (
                  <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
                ) : (
                  <span style={{ fontSize: 16 }}>{chatName.charAt(0).toUpperCase()}</span>
                )}
              </div>
            )}
            {isTyping && (
              <span
                className="presence-dot absolute bottom-0 right-0"
                style={{ borderColor: "var(--header-bg, #f0f2f5)" }}
              />
            )}
          </div>

          {/* Name + status */}
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold truncate text-light-text dark:text-dark-text"
              style={{ letterSpacing: "-0.01em" }}
            >
              {chatName}
            </h2>
            {isTyping ? (
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-green-ink bg-green-muted">
                <span>typing</span>
                {typingDot("0ms")}
                {typingDot("160ms")}
                {typingDot("320ms")}
              </div>
            ) : chatSubtitle ? (
              <div className="text-xs truncate text-gray-600 dark:text-dark-muted">
                {chatSubtitle}
              </div>
            ) : null}
          </div>
        </button>
      </div>

      {/* Header action buttons */}
      <div className="flex items-center gap-1">
        {onCallClick && (
          <button
            onClick={onCallClick}
            className={`${ACTION_BUTTON} text-green-ink`}
            aria-label="Start voice call"
            title="Start voice call"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
            </svg>
          </button>
        )}

        {/* The backend only exposes voice call initiation (MakeCall /
            MakeGroupCall); video is enabled from the call window. This button
            therefore starts that same real call flow, never a stub. */}
        {onCallClick && (
          <button
            onClick={onCallClick}
            className={ACTION_BUTTON}
            aria-label="Start call - video available in the call window"
            title="Start a call - you can turn on video in the call window"
          >
            <VideoCallIcon />
          </button>
        )}

        {/* Opens the existing MessageSearchScreen via the shortcut handler
            ChatScreen registers for the active chat screen. */}
        <button
          type="button"
          onClick={() => runShortcut("search")}
          className={ACTION_BUTTON}
          aria-label="Search messages"
          title="Search messages"
        >
          <SearchIcon />
        </button>

        {/* Info button */}
        <button
          onClick={onInfoClick}
          className={ACTION_BUTTON}
          aria-label="Chat info"
          title="Chat info"
        >
          <InfoIcon />
        </button>

        {/* Kebab: every entry calls an action already implemented elsewhere. */}
        <div className="relative" ref={menuRef} onKeyDown={onMenuKeyDown}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            aria-label="More chat options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            className={ACTION_BUTTON}
          >
            <MenuIcon />
          </button>

          {menuOpen && (
            <div
              id={menuId}
              role="menu"
              aria-label="More chat options"
              className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-gray-100 bg-white p-2 shadow-xl dark:border-dark-border dark:bg-dark-elevated"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => runAction("mark-unread")}
                className={MENU_ITEM}
              >
                Mark as unread
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runAction("chat-info")}
                className={MENU_ITEM}
              >
                Chat info
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => runAction("mute-chat")}
                className={MENU_ITEM}
              >
                {isMuted ? "Unmute chat" : "Mute chat"}
              </button>
              {chatId && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    setConfirmClear(true)
                  }}
                  className={`${MENU_ITEM} mt-1 border-t border-black/[0.06] pt-3 text-danger-ink dark:border-white/[0.08] dark:text-danger-soft`}
                >
                  Clear chat
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this chat?"
        description="All messages in this conversation will be removed. This cannot be undone."
        confirmLabel="Clear chat"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={confirmClearChat}
        onCancel={() => {
          setConfirmClear(false)
          triggerRef.current?.focus()
        }}
      />
    </div>
  )
}
