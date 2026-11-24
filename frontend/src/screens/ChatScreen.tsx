import { useEffect, useRef, useCallback, useState, memo } from "react"
import clsx from "clsx"
import {
  GetChatList,
  GetChannelList,
  SubscribeNewsletter,
  UnsubscribeNewsletter,
  SearchNewsletters,
  GetCachedAvatar,
  GetSelfAvatar,
  ToggleChatPin,
  ToggleChatArchive,
  ToggleChatLabel,
  DeleteChat,
  MarkChatAsRead,
  IsChatMuted,
  ToggleChatMute,
  BlockContact,
  UnblockContact,
  GetBlockList,
  GetContactQRLink,
} from "../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import * as api from "../../bindings/github.com/lugvitc/whats4linux/api/models.js"
import { EventsOn } from "../lib/wailsRuntime"
import { useShallow } from "zustand/react/shallow"
import { ChatDetail } from "./ChatDetail"
import { useChatStore, useChatById, useArchivedCount, useUIStore } from "../store"
import { registerShortcut } from "../lib/shortcuts"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"
import { useChatMuted, useMuteStore } from "../store/useMuteStore"
import type { ChatItem } from "../store/types"
import { StatusList, StoryViewer, type StatusGroup } from "../components/chat/Status"
import { CreateGroupDialog } from "../components/chat/CreateGroupDialog"
import { CreateChannelDialog } from "../components/chat/CreateChannelDialog"
import { CommunityList, CommunityHome, CommunitiesWelcome } from "../components/chat/Communities"
import {
  getAvatarColor,
  AVATAR_ICON_COLOR,
  AVATAR_ICON_ON_DARK,
  sanitizeHtml,
  formatChatTimestamp,
} from "../lib/utils"
import { useAppSettingsStore } from "../store/useAppSettingsStore"
import { UserAvatar, NewChatIcon, MenuIcon, MutedBellIcon } from "../assets/svgs/chat_icons"
import { SearchIcon } from "../assets/svgs/settings_icons"
import { GoBackIcon } from "../assets/svgs/header_icons"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../components/common/resizable"
import { MessageSearchScreen } from "./MessageSearchScreen"
import ConfirmDialog from "@/components/common/ConfirmDialog"
import Wordmark from "@/components/common/Wordmark"

/**
 * Tracks a CSS media query. Below the `md` breakpoint the chat shell must not
 * mount the resizable group at all — hiding one sized panel with `hidden`
 * leaves a phantom flex-sized gap — so layout decisions are made in React.
 */
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    setMatches(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}

/**
 * Human-friendly label names saved by MessageMenu, keyed by label id. The
 * backend still speaks in ids, so this map is the only bridge from a typed
 * name to the value ToggleChatLabel expects.
 */
function readSavedLabelNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem("whats4linux.labelNames")
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Real chat-list filters. Everything here reads data that already exists in
 * the stores: unreadCount / pinned / type / community flags on ChatItem and
 * the muted JID set in useMuteStore. There is no favourite flag in the data
 * model, so "Pinned" is the honest (starred) equivalent — never a dead chip.
 */
type ChatListFilter =
  | "all"
  | "unread"
  | "pinned"
  | "groups"
  | "muted"
  | "communities"
  | "contacts"

const FILTER_LABELS: Record<ChatListFilter, string> = {
  all: "All",
  unread: "Unread",
  pinned: "Pinned",
  groups: "Groups",
  muted: "Muted",
  communities: "Communities",
  contacts: "Contacts",
}

const MORE_FILTERS: readonly ChatListFilter[] = ["muted", "communities", "contacts"]

/** Search + archived view + the active chip filter, in one shallow selector. */
const useVisibleChatIds = (
  showArchived: boolean,
  filter: ChatListFilter,
  mutedJids: Set<string>,
) =>
  useChatStore(
    useShallow(state => {
      const term = state.searchTerm.toLowerCase()
      return state.chatIds.filter(id => {
        const chat = state.chatsById.get(id)
        if (!chat) return false
        if (!!chat.archived !== showArchived) return false
        if (term && !chat.name.toLowerCase().includes(term)) return false
        switch (filter) {
          case "unread":
            return (chat.unreadCount ?? 0) > 0
          case "pinned":
            return !!chat.pinned
          case "groups":
            return chat.type === "group"
          case "muted":
            return mutedJids.has(chat.id)
          case "communities":
            return Boolean(chat.isCommunityGroup || chat.isCommunityParent)
          case "contacts":
            return chat.type === "contact" && !chat.isCommunityGroup
          case "all":
          default:
            return true
        }
      })
    }),
  )

/** Counts shown on the Unread / Groups chips for the current archive view. */
const useChatFilterCounts = (showArchived: boolean) =>
  useChatStore(
    useShallow(state => {
      let unread = 0
      let groups = 0
      for (const id of state.chatIds) {
        const chat = state.chatsById.get(id)
        if (!chat || !!chat.archived !== showArchived) continue
        if ((chat.unreadCount ?? 0) > 0) unread++
        if (chat.type === "group") groups++
      }
      return { unread, groups }
    }),
  )

const StarIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M12 2.6l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.56l-5.9 3.21 1.13-6.57L2.45 9.54l6.6-.96L12 2.6z" />
  </svg>
)

const ChevronDownIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
)

const chipClassName = (active: boolean) =>
  clsx(
    "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
    active
      ? "border-transparent bg-green-muted font-medium text-green-ink"
      : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:text-dark-muted dark:hover:bg-white/5",
  )

interface HeaderProps {
  onOpenSettings: () => void
  onNewChat?: () => void
  onSearch?: () => void
  avatar?: string
}

const Header = ({ onOpenSettings, onNewChat, onSearch, avatar }: HeaderProps) => (
  <div className="h-16 bg-light-secondary dark:bg-dark-bg flex items-center justify-between px-4 border-b border-gray-200 dark:border-white/5">
    <Wordmark compact textClassName="text-xl" markClassName="h-6 w-6" />
    <div className="flex items-center gap-1 text-gray-600 dark:text-[#8696a0]">
      <button
        title="Search Messages"
        aria-label="Search messages"
        onClick={onSearch}
        className="hover:bg-gray-100 dark:hover:bg-white/10 p-2 rounded-full"
      >
        <SearchIcon />
      </button>
      <button
        title="New Chat"
        aria-label="New chat"
        onClick={onNewChat}
        className="hover:bg-gray-100 dark:hover:bg-white/10 p-2 rounded-full"
      >
        <NewChatIcon />
      </button>
      <button
        title="Menu"
        aria-label="Open settings menu"
        onClick={onOpenSettings}
        className="hover:bg-gray-100 dark:hover:bg-white/10 p-2 rounded-full"
      >
        <MenuIcon />
      </button>
      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden flex items-center justify-center ml-2">
        {avatar ? <img src={avatar} className="w-full h-full object-cover" /> : <UserAvatar />}
      </div>
    </div>
  </div>
)

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const SearchBar = ({
  value,
  onChange,
  placeholder = "Search or start new chat",
}: SearchBarProps) => (
  <div className="px-3 py-2 bg-light-bg dark:bg-dark-bg">
    <div className="bg-light-tertiary dark:bg-dark-secondary rounded-full flex items-center px-4 py-2">
      <div className="text-gray-600 dark:text-[#8696a0] mr-4">
        <SearchIcon />
      </div>
      <input
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        className="bg-transparent border-none text-sm w-full text-light-text dark:text-dark-text placeholder:text-gray-600 dark:placeholder:text-[#9aa8b0]"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  </div>
)

const PeopleIcon = ({
  size = 24,
  color = AVATAR_ICON_COLOR,
}: {
  size?: number
  color?: string
}) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden>
    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
  </svg>
)

// Memoized ChatAvatar — pastel placeholder when no photo (matches WA).
const MemoizedChatAvatar = memo(
  ({
    avatar,
    type,
    name,
    jid,
    dark,
  }: {
    avatar?: string
    type: "group" | "contact"
    name: string
    jid?: string
    dark?: boolean
  }) => {
    if (avatar) {
      return <img src={avatar} alt={name} className="w-full h-full object-cover" />
    }
    const bg = getAvatarColor(jid || name, dark)
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        {type === "group" ? (
          <PeopleIcon size={26} color={AVATAR_ICON_COLOR} />
        ) : (
          <svg
            viewBox="0 0 48 48"
            className="w-full h-full p-1.5"
            fill={AVATAR_ICON_COLOR}
            aria-hidden
          >
            <path d="M24 23q-1.857 0-3.178-1.322Q19.5 20.357 19.5 18.5t1.322-3.178T24 14t3.178 1.322Q28.5 16.643 28.5 18.5t-1.322 3.178T24 23m-6.75 10q-.928 0-1.59-.66-.66-.662-.66-1.59v-.9q0-.956.492-1.758A3.3 3.3 0 0 1 16.8 26.87a16.7 16.7 0 0 1 3.544-1.308q1.8-.435 3.656-.436 1.856 0 3.656.436T31.2 26.87q.816.422 1.308 1.223T33 29.85v.9q0 .928-.66 1.59-.662.66-1.59.66z" />
          </svg>
        )}
      </div>
    )
  },
)

MemoizedChatAvatar.displayName = "MemoizedChatAvatar"

/**
 * Community stacked avatar: rounded-square community badge behind a
 * circular group photo.
 */
const CommunityStackedAvatar = memo(
  ({
    communityAvatar,
    groupAvatar,
    communityName,
    groupName,
    communityJid,
    dark,
  }: {
    communityAvatar?: string
    groupAvatar?: string
    communityName: string
    groupName: string
    communityJid?: string
    dark?: boolean
  }) => {
    const communityBg = getAvatarColor(communityJid || communityName, dark)
    // Ring matches chat-list surface so the stack punches out cleanly.
    const ring = dark ? "#161717" : "#ffffff"
    const badge = "w-8 h-8"

    return (
      <div className="relative w-12 h-12 shrink-0 mr-4">
        <div
          className={clsx(
            "absolute left-0 top-0 overflow-hidden flex items-center justify-center rounded-[8px]",
            badge,
          )}
          style={{ backgroundColor: communityBg }}
        >
          {communityAvatar ? (
            <img src={communityAvatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <PeopleIcon size={18} color={AVATAR_ICON_COLOR} />
          )}
        </div>
        <div
          className={clsx(
            "absolute right-0 bottom-0 overflow-hidden flex items-center justify-center rounded-full",
            badge,
          )}
          style={{ boxShadow: `0 0 0 2px ${ring}` }}
        >
          {groupAvatar ? (
            <img src={groupAvatar} alt={groupName} className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ backgroundColor: dark ? "#2a3942" : "#111b21" }}
            >
              <PeopleIcon size={16} color={AVATAR_ICON_ON_DARK} />
            </div>
          )}
        </div>
      </div>
    )
  },
)

CommunityStackedAvatar.displayName = "CommunityStackedAvatar"

// Small pin glyph shown on pinned chat rows.
const PinIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" className={clsx("fill-current", className)}>
    <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
  </svg>
)

interface ChatListItemContentProps {
  chat: ChatItem
  muted: boolean
  isSelected: boolean
  onSelect: (chat: ChatItem) => void
  onContextMenu: (e: React.MouseEvent, chat: ChatItem) => void
  onMenuTrigger: (e: React.MouseEvent, chat: ChatItem) => void
  isMenuOpen: boolean
}

// Pure presentational component - memoized to prevent unnecessary re-renders
const ChatListItemContent = memo(
  ({
    chat,
    muted,
    isSelected,
    onSelect,
    onContextMenu,
    onMenuTrigger,
    isMenuOpen,
  }: ChatListItemContentProps) => {
    const theme = useAppSettingsStore(s => s.theme)
    const dark = theme === "dark"
    const isCommunityChat = Boolean(chat.isCommunityGroup && chat.communityJid)
    const communityName = isCommunityChat ? chat.communityName || "Community" : null

    return (
      <div
        className={clsx(
          "group mx-2 my-1 flex w-[calc(100%_-_1rem)] items-center rounded-xl border border-transparent transition-colors duration-150",
          "hover:bg-gray-100/80 dark:hover:bg-white/5",
          // Same selected fill as the sidebar tabs: a signal tint plus a full
          // inset ring (never a one-sided stripe). See .chat-row-selected.
          isSelected && "chat-row-selected bg-green-muted",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(chat)}
          onContextMenu={e => onContextMenu(e, chat)}
          aria-current={isSelected ? "true" : undefined}
          aria-label={`${chat.name}${chat.unreadCount ? `, ${chat.unreadCount} unread` : ""}`}
          className="flex min-w-0 flex-1 items-center px-3 py-3 text-left"
        >
          {isCommunityChat ? (
            <CommunityStackedAvatar
              communityAvatar={chat.communityAvatar}
              groupAvatar={chat.avatar}
              communityName={chat.communityName || ""}
              groupName={chat.name}
              communityJid={chat.communityJid}
              dark={dark}
            />
          ) : (
            <div className="w-12 h-12 rounded-full mr-4 shrink-0 overflow-hidden flex items-center justify-center">
              <MemoizedChatAvatar
                avatar={chat.avatar}
                type={chat.type}
                name={chat.name}
                jid={chat.id}
                dark={dark}
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {communityName && (
              <div className="text-[13px] leading-snug text-gray-600 dark:text-[#8696a0] truncate">
                {communityName}
              </div>
            )}
            <div className="flex justify-between items-baseline mb-1">
              <h3 className="text-light-text dark:text-dark-text font-medium truncate">
                {chat.name}
              </h3>
              <div className="flex items-center gap-1 shrink-0">
                {muted && (
                  <span className="text-gray-600 dark:text-[#8696a0]">
                    <MutedBellIcon />
                  </span>
                )}
                <span
                  className={clsx(
                    "text-xs",
                    chat.unreadCount
                      ? "font-medium text-green-ink"
                      : "text-gray-600 dark:text-dark-muted",
                  )}
                >
                  {formatChatTimestamp(chat.timestamp ?? 0)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="line-clamp-2 min-h-[2.25rem] min-w-0 flex-1 text-sm leading-snug text-gray-600 dark:text-[#8696a0] [&_p]:inline [&_p]:m-0">
                {chat.isFromMe && (
                  <span className="mr-1 text-gray-600 dark:text-[#8696a0]">You: </span>
                )}
                {chat.sender && chat.type === "group" && !chat.isFromMe && (
                  <span className="mr-1">{chat.sender}: </span>
                )}
                <span
                  className="[&_br]:hidden no-formatting"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(chat.subtitle) }}
                />
              </div>
              {chat.pinned && <PinIcon className="shrink-0 text-gray-600 dark:text-[#8696a0]" />}
              {chat.unreadCount ? (
                <span className="shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-green text-action-ink text-xs font-semibold">
                  {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                </span>
              ) : null}
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={e => onMenuTrigger(e, chat)}
          aria-label={`More options for ${chat.name}`}
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          className={clsx(
            "mr-1 flex shrink-0 items-center justify-center rounded-full p-1.5 text-gray-600 transition-colors hover:bg-black/5 dark:text-[#8696a0] dark:hover:bg-white/10",
            "opacity-70 group-hover:opacity-100",
          )}
        >
          <MenuIcon />
        </button>
      </div>
    )
  },
)

ChatListItemContent.displayName = "ChatListItemContent"

interface ChatListItemProps {
  chatId: string
  isSelected: boolean
  onSelect: (chat: ChatItem) => void
  onContextMenu: (e: React.MouseEvent, chat: ChatItem) => void
  onMenuTrigger: (e: React.MouseEvent, chat: ChatItem) => void
  isMenuOpen: boolean
}

// Container component that subscribes to specific chat data
const ChatListItem = memo(
  ({
    chatId,
    isSelected,
    onSelect,
    onContextMenu,
    onMenuTrigger,
    isMenuOpen,
  }: ChatListItemProps) => {
    // This hook only triggers re-render when THIS specific chat changes
    const chat = useChatById(chatId)
    // Boolean selector - only re-renders when THIS chat's muted flag flips
    const muted = useChatMuted(chatId)

    if (!chat) return null

    return (
      <ChatListItemContent
        chat={chat}
        muted={muted}
        isSelected={isSelected}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        onMenuTrigger={onMenuTrigger}
        isMenuOpen={isMenuOpen}
      />
    )
  },
)

ChatListItem.displayName = "ChatListItem"

interface EmptyStateProps {
  hasChats: boolean
  isLoading: boolean
  onRefresh: () => void
  message?: string
}

const EmptyState = ({ hasChats, isLoading, onRefresh, message }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center h-full text-gray-600 dark:text-[#8696a0] p-8">
    <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-green-muted text-green">
      <SearchIcon />
    </div>
    <p className="text-center font-medium">
      {message ??
        (hasChats ? "No chats match your search." : "No chats available. Start a conversation!")}
    </p>
    <button
      onClick={onRefresh}
      disabled={isLoading}
      className="mt-6 px-6 py-2.5 rounded-full text-sm font-semibold bg-green text-action-ink transition-colors hover:bg-green-dark disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isLoading ? "Loading..." : "Refresh Chats"}
    </button>
  </div>
)

function SubscribeChannelDialog({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState("")
  const [error, setError] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<api.ChatElement[]>([])
  const [searching, setSearching] = useState(false)
  const [pendingUnsubscribe, setPendingUnsubscribe] = useState<string | null>(null)

  const handleSubscribe = async (jid?: string) => {
    const target = (jid || input).trim()
    if (!target) return
    setBusy(true)
    setError("")
    setSuccess("")
    try {
      await SubscribeNewsletter(target)
      setSuccess("Subscribed successfully!")
      setTimeout(onClose, 1500)
    } catch {
      // Never surface a raw backend error: it can contain internal identifiers.
      setError(
        "Couldn't subscribe to that channel. Check the channel link or invite code and try again.",
      )
    } finally {
      setBusy(false)
    }
  }

  const confirmUnsubscribe = async () => {
    if (!pendingUnsubscribe) return
    const jid = pendingUnsubscribe
    setPendingUnsubscribe(null)
    setBusy(true)
    setError("")
    try {
      await UnsubscribeNewsletter(jid)
      setSuccess("Unsubscribed!")
    } catch {
      // Never surface a raw backend error: it can contain internal identifiers.
      setError("Couldn't leave that channel. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await SearchNewsletters(searchQuery.trim())
        setSearchResults(results || [])
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={e => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="bg-white dark:bg-dark-secondary rounded-2xl w-full max-w-sm mx-4 max-h-[80vh] flex flex-col p-6 shadow-xl"
          onClick={e => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Subscribe to Channel
          </h2>
          <p className="text-sm text-gray-600 dark:text-dark-muted mb-4">
            Enter a channel link or invite code, or search for channels below.
          </p>
          <input
            autoFocus
            value={input}
            onChange={e => {
              setInput(e.target.value)
              setError("")
              setSuccess("")
            }}
            onKeyDown={e => {
              if (e.key === "Enter") handleSubscribe()
              if (e.key === "Escape") onClose()
            }}
            placeholder="Channel link or invite code"
            className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-dark-tertiary text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-600 dark:placeholder:text-[#9aa8b0] mb-3"
          />

          {/* Search newsletters */}
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search channels..."
            className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-dark-tertiary text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-600 dark:placeholder:text-[#9aa8b0] mb-3"
          />

          {searching && (
            <p className="text-xs text-gray-600 dark:text-[#8696a0] mb-2">Searching...</p>
          )}

          {searchResults.length > 0 && (
            <div className="flex-1 overflow-y-auto max-h-40 mb-3 border border-gray-200 dark:border-dark-border rounded-lg">
              {searchResults.map(ch => (
                <div
                  key={ch.jid}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-light-text dark:text-dark-text truncate">
                      {ch.full_name || ch.push_name || ch.jid}
                    </p>
                    <p className="text-xs text-light-muted dark:text-dark-muted truncate">
                      Public channel
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => handleSubscribe(ch.jid)}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded bg-green text-action-ink transition-colors hover:bg-green-dark disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Subscribe
                    </button>
                    <button
                      onClick={() => setPendingUnsubscribe(ch.jid)}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Unsub
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <p className="mb-3 text-xs text-light-muted dark:text-dark-muted">
              No channels found. Try another search, or paste a channel link above.
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mb-3 rounded-lg bg-danger-tint px-2 py-1 text-sm text-danger-ink"
            >
              {error}
            </p>
          )}
          {success && <p className="mb-3 text-sm text-green-ink">{success}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-dark-muted hover:bg-gray-100 dark:hover:bg-dark-tertiary rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSubscribe()}
              disabled={busy || !input.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-green text-action-ink transition-colors hover:bg-green-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Subscribing..." : "Subscribe"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingUnsubscribe !== null}
        title="Leave this channel?"
        description="You will stop receiving updates from it. You can subscribe again any time."
        confirmLabel="Leave channel"
        cancelLabel="Keep subscribed"
        tone="danger"
        onConfirm={confirmUnsubscribe}
        onCancel={() => setPendingUnsubscribe(null)}
      />
    </>
  )
}

/**
 * Original inline illustration for the no-conversation state: a chat window
 * with a video-call badge. Built from our own shapes — no Meta assets.
 */
const CallingIllustration = () => (
  <svg viewBox="0 0 220 150" className="h-32 w-48" fill="none" aria-hidden="true">
    <rect x="24" y="16" width="148" height="100" rx="14" className="fill-green" />
    <rect x="34" y="26" width="128" height="78" rx="7" className="fill-white dark:fill-[#202c33]" />
    <rect x="44" y="38" width="62" height="9" rx="4.5" className="fill-green-muted" />
    <rect x="44" y="54" width="86" height="7" rx="3.5" className="fill-gray-200 dark:fill-white/10" />
    <rect x="44" y="67" width="72" height="7" rx="3.5" className="fill-gray-200 dark:fill-white/10" />
    <rect x="86" y="82" width="58" height="14" rx="7" className="fill-green" />
    <rect x="16" y="118" width="164" height="8" rx="4" className="fill-gray-200 dark:fill-white/10" />
    <circle cx="178" cy="104" r="25" className="fill-green-muted dark:fill-[#005c4b]" />
    <path
      d="M178 91a6 6 0 0 0-6 6v4a6 6 0 0 0 6 6 22 22 0 0 0 11-3l4 4a3 3 0 0 0 4-4l-4-4a22 22 0 0 0 0-6l4-4a3 3 0 0 0-4-4l-4 4a22 22 0 0 0-11-3z"
      className="fill-green"
    />
  </svg>
)

const DocumentQuickIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h6v2H8v-2z" />
  </svg>
)

const LinkQuickIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M17 9V7a5 5 0 0 0-10 0v2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2zM9 7a3 3 0 0 1 6 0v2H9V7zm4 9.73V19h-2v-2.27a2.5 2.5 0 1 1 2 0z" />
  </svg>
)

interface QuickActionProps {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}

const QuickAction = ({ label, onClick, disabled, children }: QuickActionProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    className="group flex w-20 flex-col items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-light-tertiary text-gray-600 transition-colors group-hover:bg-green-muted dark:bg-dark-secondary dark:text-[#8696a0]">
      {children}
    </span>
    <span className="text-center text-xs leading-tight text-gray-600 dark:text-[#8696a0]">
      {label}
    </span>
  </button>
)

interface WelcomeScreenProps {
  onGoToCalls: () => void
  onSendDocument: () => void
  onInviteFriend: () => void
  isInviting: boolean
}

const WelcomeScreen = ({
  onGoToCalls,
  onSendDocument,
  onInviteFriend,
  isInviting,
}: WelcomeScreenProps) => (
  <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-hidden border-b border-gray-200 px-6 dark:border-white/5">
    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white px-8 py-9 text-center shadow-sm dark:border-white/10 dark:bg-dark-secondary">
      <div className="mb-5 flex justify-center">
        <CallingIllustration />
      </div>
      <h2 className="text-lg font-semibold text-light-text dark:text-dark-text">
        Voice and video calling is now available
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-[#8696a0]">
        You can make and join calls from any chat. Open a conversation to get started.
      </p>
      <button
        type="button"
        onClick={onGoToCalls}
        className="mt-6 rounded-full bg-light-tertiary px-5 py-2 text-sm font-medium text-light-text transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] dark:bg-dark-tertiary dark:text-dark-text dark:hover:bg-white/10"
      >
        Go to Calls
      </button>
    </div>

    {/* Only actions backed by a real flow are shown. There is no add-contact
        dialog and MakeCall needs a JID, so those two are intentionally absent. */}
    <div
      className="mt-8 flex items-start justify-center gap-8"
      role="group"
      aria-label="Quick actions"
    >
      <QuickAction label="Send document" onClick={onSendDocument}>
        <DocumentQuickIcon />
      </QuickAction>
      <QuickAction label="Invite a friend" onClick={onInviteFriend} disabled={isInviting}>
        <LinkQuickIcon />
      </QuickAction>
    </div>

    <p className="mt-8 flex items-center gap-1.5 text-xs text-gray-600 dark:text-[#8696a0]">
      <LockIcon />
      Your personal messages are end-to-end encrypted
    </p>
  </div>
)

interface ChatListScreenProps {
  onOpenSettings: () => void
}

export function ChatListScreen({ onOpenSettings }: ChatListScreenProps) {
  const screen = useUIStore(state => state.screen)
  // Use individual selectors to minimize re-renders
  const selectedChatId = useChatStore(state => state.selectedChatId)
  const selectedChatName = useChatStore(state => state.selectedChatName)
  const selectedChatAvatar = useChatStore(state => state.selectedChatAvatar)
  const searchTerm = useChatStore(state => state.searchTerm)
  const setChats = useChatStore(state => state.setChats)
  const selfAvatar = useSelfAvatarStore(state => state.selfAvatar)
  const setSelfAvatar = useSelfAvatarStore(state => state.setSelfAvatar)
  const selectChat = useChatStore(state => state.selectChat)
  const setSearchTerm = useChatStore(state => state.setSearchTerm)
  const clearUnreadCount = useChatStore(state => state.clearUnreadCount)
  const updateChatLastMessage = useChatStore(state => state.updateChatLastMessage)
  const updateSingleChat = useChatStore(state => state.updateSingleChat)
  const getChat = useChatStore(state => state.getChat)

  const [showArchived, setShowArchived] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showSubscribeChannel, setShowSubscribeChannel] = useState(false)
  const [showCreateChannel, setShowCreateChannel] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [chatFilter, setChatFilter] = useState<ChatListFilter>("all")
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [isInviting, setIsInviting] = useState(false)
  const moreFiltersRef = useRef<HTMLDivElement | null>(null)
  const moreFiltersTriggerRef = useRef<HTMLButtonElement | null>(null)

  // Sidebar view is store-backed so the persistent left rail can drive it.
  // Keep the local names `view` / `setView` so every existing check below stays
  // unchanged.
  const view = useUIStore(state => state.sidebarView)
  const setView = useUIStore(state => state.setSidebarView)

  // Subscribed here as well as used in the selector so muting a chat updates
  // the visible list immediately when the "Muted" filter is active.
  const mutedJids = useMuteStore(state => state.mutedJids)
  // IDs actually rendered: search + archive + the active chip filter. The
  // chips belong to the chats tab; other tabs keep their original list.
  const filteredChatIds = useVisibleChatIds(
    showArchived,
    view === "chats" ? chatFilter : "all",
    mutedJids,
  )
  const filterCounts = useChatFilterCounts(showArchived)
  const addNotification = useUIStore(state => state.addNotification)
  const archivedCount = useArchivedCount()
  const totalChats = useChatStore(state => state.chatIds.length)

  // Keep the latest id list for the keyboard-shortcut handlers (they run from
  // a stable effect, so they must read refs, not stale closures).
  const filteredIdsRef = useRef(filteredChatIds)
  filteredIdsRef.current = filteredChatIds

  const isFetchingRef = useRef(false)
  const mountedRef = useRef(true)
  const initialFetchDoneRef = useRef(false)

  const [selectedCommunity, setSelectedCommunity] = useState<api.CommunitySummary | null>(null)
  // When opening a group from a community home, remember it so Back returns there.
  const [communityReturn, setCommunityReturn] = useState<api.CommunitySummary | null>(null)

  const handleChatSelect = useCallback(
    (chat: ChatItem) => {
      setSelectedCommunity(null)
      setCommunityReturn(null)
      selectChat(chat)
      clearUnreadCount(chat.id)
    },
    [selectChat, clearUnreadCount],
  )

  const handleCommunitySelect = useCallback(
    (community: api.CommunitySummary) => {
      selectChat(null)
      setCommunityReturn(null)
      setSelectedCommunity(community)
    },
    [selectChat],
  )

  const handleOpenGroupFromCommunity = useCallback(
    (jid: string, name: string, avatar?: string) => {
      if (selectedCommunity) {
        setCommunityReturn(selectedCommunity)
      }
      setSelectedCommunity(null)
      const chat: ChatItem = {
        id: jid,
        name,
        subtitle: "",
        type: "group",
        avatar,
      }
      selectChat(chat)
      clearUnreadCount(jid)
    },
    [selectedCommunity, selectChat, clearUnreadCount],
  )

  const handleBack = useCallback(() => {
    selectChat(null)
    // Return to community home if we came from there.
    if (communityReturn) {
      setSelectedCommunity(communityReturn)
      setCommunityReturn(null)
    }
  }, [selectChat, communityReturn])

  // --- Chat-list filter chips ------------------------------------------------
  useEffect(() => {
    if (!moreFiltersOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (!moreFiltersRef.current?.contains(e.target as Node)) setMoreFiltersOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreFiltersOpen(false)
        moreFiltersTriggerRef.current?.focus()
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [moreFiltersOpen])

  useEffect(() => {
    if (!moreFiltersOpen) return
    moreFiltersRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
  }, [moreFiltersOpen])

  const chooseMoreFilter = useCallback((filter: ChatListFilter) => {
    setChatFilter(filter)
    setMoreFiltersOpen(false)
    moreFiltersTriggerRef.current?.focus()
  }, [])

  // --- Welcome-screen actions ------------------------------------------------
  const showToast = useCallback(
    (message: string, tone: "info" | "success" = "info") => {
      addNotification(message, { tone, durationMs: 6000 })
    },
    [addNotification],
  )

  // There is no Calls view or call-picker trigger in this app: MakeCall needs
  // a JID. Steer the user to a conversation instead of rendering a dead button.
  const handleGoToCalls = useCallback(() => {
    showToast("Calls start from a chat — open a conversation to make or join one.")
  }, [showToast])

  // The attach flow lives in ChatDetail and needs an open chat to send to.
  const handleSendDocument = useCallback(() => {
    showToast("Open a chat to attach and send a document.")
  }, [showToast])

  // Reuses the same real binding as Settings → Account → "Get my contact link".
  const handleInviteFriend = useCallback(async () => {
    if (isInviting) return
    setIsInviting(true)
    try {
      const link = await GetContactQRLink(false)
      if (!link || !navigator.clipboard?.writeText) throw new Error("link unavailable")
      await navigator.clipboard.writeText(link)
      showToast("Your contact link was copied — share it with a friend.", "success")
    } catch (err) {
      console.error("Failed to copy contact link:", err)
      showToast("Couldn't copy your contact link. Try again from Settings → Account.")
    } finally {
      setIsInviting(false)
    }
  }, [isInviting, showToast])

  const transformChatElements = useCallback(
    async (chatElements: api.ChatElement[]): Promise<ChatItem[]> => {
      return Promise.all(
        chatElements.map(async c => {
          const isGroup = c.jid?.endsWith("@g.us") || false
          const avatar = c.avatar_url || ""
          // Sender is already resolved to a display name by the backend
          // (contact name for group senders, "You" for own messages).
          const senderName = c.is_from_me ? "You" : isGroup ? c.sender || "" : ""

          return {
            id: c.jid || "",
            name: c.full_name || c.push_name || c.short || c.phno || "Unknown",
            subtitle: (c.latest_message || "")
              .replace(/^\[call\].*?missed.*/, "📞 Missed call")
              .replace(/^\[call\].*/, "📞 Call")
              .replace(/^\[system\]/, ""),
            type: isGroup ? "group" : "contact",
            timestamp: c.LatestTS,
            avatar: avatar,
            sender: senderName || "",
            isFromMe: c.is_from_me || false,
            pinned: c.pinned || false,
            archived: c.archived || false,
            communityJid: c.parent_jid || undefined,
            communityName: c.parent_name || undefined,
            isCommunityGroup: Boolean(c.is_community_group && c.parent_jid),
            isCommunityParent: Boolean(c.is_community_parent),
          }
        }),
      )
    },
    [],
  )

  const loadAvatars = useCallback(
    async (chatItems: ChatItem[]) => {
      // Group avatars + community parent avatars for stacked logos.
      const jobs: Array<{ chatId: string; jid: string; field: "avatar" | "communityAvatar" }> = []
      for (const chat of chatItems) {
        if (!chat.avatar) {
          jobs.push({ chatId: chat.id, jid: chat.id, field: "avatar" })
        }
        if (chat.isCommunityGroup && chat.communityJid && !chat.communityAvatar) {
          jobs.push({ chatId: chat.id, jid: chat.communityJid, field: "communityAvatar" })
        }
      }

      if (jobs.length === 0) return

      const CONCURRENCY = 5
      let index = 0

      const worker = async () => {
        while (index < jobs.length) {
          const job = jobs[index++]

          try {
            const avatarURL = await GetCachedAvatar(job.jid, false)
            if (avatarURL && mountedRef.current) {
              useChatStore.getState().updateSingleChat(job.chatId, { [job.field]: avatarURL })
            }
          } catch (err) {
            console.error("Avatar load failed:", job.jid, err)
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    },
    [updateSingleChat],
  )

  const loadSelfAvatar = useCallback(async () => {
    try {
      const avatarURL = await GetSelfAvatar(false)

      if (!mountedRef.current) {
        console.log("Component unmounted, aborting self avatar set")
        return
      }

      setSelfAvatar(avatarURL)
    } catch (err) {
      console.error("Failed to load self avatar:", err)
    }
  }, [setSelfAvatar])

  type ChatMenuState = { x: number; y: number; chat: ChatItem }

  const [chatMenu, setChatMenu] = useState<ChatMenuState | null>(null)
  const chatMenuRef = useRef<HTMLDivElement | null>(null)
  const chatMenuTriggerRef = useRef<HTMLElement | null>(null)

  const openChatMenu = useCallback(
    (x: number, y: number, chat: ChatItem, trigger: HTMLElement | null) => {
      chatMenuTriggerRef.current = trigger
      setChatMenu({ x, y, chat })
    },
    [],
  )

  // Outside clicks and action choices simply dismiss the menu.
  const dismissChatMenu = useCallback(() => {
    setChatMenu(null)
    chatMenuTriggerRef.current = null
  }, [])

  // Keyboard dismissal returns focus to whatever opened the menu.
  const closeChatMenu = useCallback(() => {
    const trigger = chatMenuTriggerRef.current
    dismissChatMenu()
    if (trigger?.isConnected) trigger.focus()
  }, [dismissChatMenu])

  const handleChatContextMenu = useCallback(
    (e: React.MouseEvent, chat: ChatItem) => {
      e.preventDefault()
      openChatMenu(e.clientX, e.clientY, chat, (e.currentTarget as HTMLElement) ?? null)
    },
    [openChatMenu],
  )

  // Keyboard-accessible path: a labelled options button on every chat row.
  const handleChatMenuTrigger = useCallback(
    (e: React.MouseEvent, chat: ChatItem) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      openChatMenu(
        Math.min(rect.left, window.innerWidth - 208),
        rect.bottom + 4,
        chat,
        e.currentTarget as HTMLElement,
      )
    },
    [openChatMenu],
  )

  // Put focus on the first item when the menu opens so arrow keys work at once.
  useEffect(() => {
    if (!chatMenu) return
    chatMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [chatMenu])

  const handleChatMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!chatMenu) return
      const items = Array.from(
        chatMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      )
      if (items.length === 0) return
      const current = items.indexOf(document.activeElement as HTMLElement)
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          items[(current + 1) % items.length]?.focus()
          break
        case "ArrowUp":
          e.preventDefault()
          items[(current - 1 + items.length) % items.length]?.focus()
          break
        case "Home":
          e.preventDefault()
          items[0]?.focus()
          break
        case "End":
          e.preventDefault()
          items[items.length - 1]?.focus()
          break
        case "Escape":
          e.preventDefault()
          e.stopPropagation()
          closeChatMenu()
          break
      }
    },
    [chatMenu, closeChatMenu],
  )

  // Dismiss the chat context menu on any click outside it.
  useEffect(() => {
    if (!chatMenu) return
    document.addEventListener("click", dismissChatMenu)
    return () => document.removeEventListener("click", dismissChatMenu)
  }, [chatMenu, dismissChatMenu])

  const handleTogglePin = useCallback(async () => {
    if (!chatMenu) return
    const { chat } = chatMenu
    closeChatMenu()
    const store = useChatStore.getState()
    // Optimistic: flip locally and re-sort; backend refresh confirms.
    store.updateSingleChat(chat.id, { pinned: !chat.pinned })
    store.resortChats()
    try {
      await ToggleChatPin(chat.id, !chat.pinned)
    } catch (err) {
      console.error("Failed to toggle chat pin:", err)
      store.updateSingleChat(chat.id, { pinned: chat.pinned })
      store.resortChats()
    }
  }, [chatMenu, closeChatMenu])

  // Leave the archived view automatically when the last chat is unarchived,
  // and when switching to Channels/Status tabs.
  useEffect(() => {
    if (showArchived && archivedCount === 0) setShowArchived(false)
  }, [showArchived, archivedCount])
  useEffect(() => {
    if (view !== "chats") setShowArchived(false)
  }, [view])

  // ESC leaves the archived view (and closes the context menu). When a chat
  // is open, ChatDetail's own ESC handler takes precedence — skip here so a
  // single press doesn't trigger both.
  useEffect(() => {
    if (!showArchived && !chatMenu && !selectedCommunity) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (chatMenu) {
        closeChatMenu()
        return
      }
      if (useChatStore.getState().selectedChatId) return
      if (selectedCommunity) {
        setSelectedCommunity(null)
        return
      }
      setShowArchived(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [showArchived, chatMenu, selectedCommunity, closeChatMenu])

  const handleToggleArchive = useCallback(async () => {
    if (!chatMenu) return
    const { chat } = chatMenu
    closeChatMenu()
    const store = useChatStore.getState()
    store.updateSingleChat(chat.id, { archived: !chat.archived })
    try {
      await ToggleChatArchive(chat.id, !chat.archived)
    } catch (err) {
      console.error("Failed to toggle chat archive:", err)
      store.updateSingleChat(chat.id, { archived: chat.archived })
    }
  }, [chatMenu, closeChatMenu])

  const [pendingDeleteChat, setPendingDeleteChat] = useState<ChatItem | null>(null)

  const handleDeleteChat = useCallback(() => {
    if (!chatMenu) return
    const { chat } = chatMenu
    closeChatMenu()
    setPendingDeleteChat(chat)
  }, [chatMenu, closeChatMenu])

  const confirmDeleteChat = useCallback(async () => {
    const chat = pendingDeleteChat
    setPendingDeleteChat(null)
    if (!chat) return
    const store = useChatStore.getState()
    try {
      await DeleteChat(chat.id)
      store.removeChat(chat.id)
    } catch (err) {
      console.error("Failed to delete chat:", err)
    }
  }, [pendingDeleteChat])

  const handleMarkAsRead = useCallback(async () => {
    if (!chatMenu) return
    const { chat } = chatMenu
    closeChatMenu()
    try {
      await MarkChatAsRead(chat.id, true)
      useChatStore.getState().clearUnreadCount(chat.id)
    } catch (err) {
      console.error("Failed to mark chat as read:", err)
    }
  }, [chatMenu, closeChatMenu])

  // Global keyboard shortcuts that operate on the chat list / active chat.
  // Registered only while the chats screen is the visible one (the component
  // stays mounted underneath the settings screen).
  useEffect(() => {
    if (screen !== "chats") return

    const unregs: Array<() => void> = []

    const openChatById = (chatId: string | undefined) => {
      if (!chatId) return
      const chat = getChat(chatId)
      if (chat) handleChatSelect(chat)
    }

    const openChatAt = (index: number) => openChatById(filteredIdsRef.current?.[index])

    for (let i = 1; i <= 9; i++) {
      unregs.push(registerShortcut(`open-chat-${i}`, () => openChatAt(i - 1)))
    }

    unregs.push(
      registerShortcut("next-chat", () => {
        const ids = filteredIdsRef.current
        const sel = useChatStore.getState().selectedChatId
        const idx = sel ? ids.indexOf(sel) : -1
        if (idx >= 0 && idx < ids.length - 1) openChatById(ids[idx + 1])
        else if (idx < 0 && ids.length > 0) openChatById(ids[0])
      }),
      registerShortcut("prev-chat", () => {
        const ids = filteredIdsRef.current
        const sel = useChatStore.getState().selectedChatId
        const idx = sel ? ids.indexOf(sel) : -1
        if (idx > 0) openChatById(ids[idx - 1])
        else if (idx < 0 && ids.length > 0) openChatById(ids[ids.length - 1])
      }),
      registerShortcut("search", () => setShowSearch(true)),
      registerShortcut("search-chat", () => setShowSearch(true)),
      registerShortcut("new-chat", () => setShowCreateGroup(true)),
      registerShortcut("new-group", () => setShowCreateGroup(true)),
      // The backend has no unread flag, so this is a local visual mark, same
      // as the in-app unread badge behaviour.
      registerShortcut("mark-unread", () => {
        const id = useChatStore.getState().selectedChatId
        if (id) useChatStore.getState().updateSingleChat(id, { unreadCount: 1 })
      }),
      registerShortcut("mute-chat", () => {
        const id = useChatStore.getState().selectedChatId
        if (!id) return
        IsChatMuted(id)
          .then(muted => ToggleChatMute(id, !muted))
          .catch(err => console.error("Mute toggle failed:", err))
      }),
      registerShortcut("archive-chat", () => {
        const st = useChatStore.getState()
        const id = st.selectedChatId
        const chat = id ? st.getChat(id) : undefined
        if (!id || !chat) return
        const next = !chat.archived
        st.updateSingleChat(id, { archived: next })
        ToggleChatArchive(id, next).catch(() =>
          st.updateSingleChat(id, { archived: chat.archived }),
        )
      }),
      registerShortcut("pin-chat", () => {
        const st = useChatStore.getState()
        const id = st.selectedChatId
        const chat = id ? st.getChat(id) : undefined
        if (!id || !chat) return
        const next = !chat.pinned
        st.updateSingleChat(id, { pinned: next })
        st.resortChats()
        ToggleChatPin(id, next).catch(() => {
          st.updateSingleChat(id, { pinned: chat.pinned })
          st.resortChats()
        })
      }),
      registerShortcut("label-chat", () => {
        const st = useChatStore.getState()
        const id = st.selectedChatId
        const chat = id ? st.getChat(id) : undefined
        if (!chat) return
        openChatMenu(
          Math.round(window.innerWidth / 2) - 100,
          Math.round(window.innerHeight / 2) - 120,
          chat,
          (document.activeElement as HTMLElement) ?? null,
        )
      }),
      registerShortcut("block-chat", () => {
        const st = useChatStore.getState()
        const id = st.selectedChatId
        const chat = id ? st.getChat(id) : undefined
        if (!id || !chat) return
        if (
          chat.id.endsWith("@g.us") ||
          chat.id.endsWith("@broadcast") ||
          chat.id.endsWith("@newsletter")
        ) {
          return
        }
        GetBlockList()
          .then(list => {
            const blocked = (list || []).some(b => b.jid === id)
            return blocked ? UnblockContact(id) : BlockContact(id)
          })
          .catch(err => console.error("Block toggle failed:", err))
      }),
    )

    return () => unregs.forEach(unreg => unreg())
  }, [screen, handleChatSelect, getChat, setShowSearch, setShowCreateGroup, openChatMenu])

  const [chatLabelName, setChatLabelName] = useState("")
  const [chatLabelError, setChatLabelError] = useState("")
  const [storyGroup, setStoryGroup] = useState<StatusGroup | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  // The menu asks for a label *name*; resolve it back to the id the RPC needs.
  // Unknown names get a plain-language error instead of a raw backend failure.
  const applyChatLabel = useCallback(async () => {
    if (!chatMenu || !chatLabelName.trim()) return
    const typed = chatLabelName.trim()
    const names = readSavedLabelNames()
    const id = Object.prototype.hasOwnProperty.call(names, typed)
      ? typed
      : Object.entries(names).find(
          ([, name]) => typeof name === "string" && name.toLowerCase() === typed.toLowerCase(),
        )?.[0]
    if (!id) {
      setChatLabelError(
        `We don't know a label called "${typed}". Name it from a message first, then try again.`,
      )
      return
    }
    setChatLabelError("")
    try {
      await ToggleChatLabel(chatMenu.chat.id, id, true)
      setChatLabelName("")
      closeChatMenu()
    } catch (err) {
      console.error("Failed to label chat:", err)
      setChatLabelError("Couldn't apply that label. Please try again.")
    }
  }, [chatMenu, chatLabelName, closeChatMenu])

  // Each new menu starts with an empty label field and no stale error.
  useEffect(() => {
    if (chatMenu) {
      setChatLabelName("")
      setChatLabelError("")
    }
  }, [chatMenu])

  const fetchChats = useCallback(async () => {
    if (isFetchingRef.current) return
    // Communities / status load their own data.
    if (viewRef.current === "communities" || viewRef.current === "status") return

    isFetchingRef.current = true

    try {
      const chatElements =
        viewRef.current === "channels" ? await GetChannelList() : await GetChatList()

      if (!mountedRef.current) return

      if (!chatElements || !Array.isArray(chatElements)) {
        setChats([])
        return
      }

      const items = await transformChatElements(chatElements)
      setChats(items)
      // Load avatars asynchronously without blocking the UI
      loadAvatars(items)
      loadSelfAvatar()
      initialFetchDoneRef.current = true
    } catch (err) {
      console.error("Error fetching chats:", err)
      setChats([])
    } finally {
      isFetchingRef.current = false
    }
  }, [setChats, transformChatElements])

  // Reload the list (and drop the open chat) when switching Chats/Channels.
  const viewInitRef = useRef(true)
  useEffect(() => {
    if (viewInitRef.current) {
      viewInitRef.current = false
      return
    }
    selectChat(null)
    setSelectedCommunity(null)
    setCommunityReturn(null)
    setStoryGroup(null)
    setShowSearch(false)
    setChats([])
    // Status / communities have their own data paths.
    if (view === "chats" || view === "channels") fetchChats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // Notification "Open" actions call chatStore.selectChat() directly in
  // useWailsEvents.ts, bypassing the sidebar. A status/broadcast JID (or any
  // chat opened while Status is active) must not open in the conversation
  // pane — route it back to the Status tab in the chat-list pane instead.
  useEffect(() => {
    const isBroadcast = !!selectedChatId && selectedChatId.endsWith("@broadcast")
    if (view !== "status" && !isBroadcast) return
    if (selectedChatId) selectChat(null)
    if (view !== "status") setView("status")
  }, [view, selectedChatId, selectChat])

  // A group joined on another device is opened here rather than only in the
  // event handler: ChatScreen owns the sidebar view, and switching views runs
  // the reset effect above, which would otherwise clear the selection. The
  // store intent carries a monotonic id, so even a second join to the chat
  // that is already selected is handled. When the group list has not refreshed
  // yet, a minimal ChatItem keeps the conversation open with its name.
  const pendingGroupJoin = useUIStore(state => state.pendingGroupJoin)
  const clearPendingGroupJoin = useUIStore(state => state.clearPendingGroupJoin)

  useEffect(() => {
    if (!pendingGroupJoin) return
    const jid = pendingGroupJoin.chatJid
    if (!jid) {
      clearPendingGroupJoin()
      return
    }
    if (view !== "chats") {
      // Leave Status / Communities / Channels. Wait for the next render on
      // the chats view to select, because the [view] effect resets selection.
      setShowSearch(false)
      setStoryGroup(null)
      setSelectedCommunity(null)
      setCommunityReturn(null)
      setView("chats")
      return
    }
    const chatStore = useChatStore.getState()
    const existing = chatStore.getChat(jid)
    const chat: ChatItem = existing ?? {
      id: jid,
      name: pendingGroupJoin.name || "Group",
      subtitle: "",
      type: jid.endsWith("@g.us") ? "group" : "contact",
      avatar: pendingGroupJoin.avatar,
    }
    chatStore.selectChat(chat)
    chatStore.clearUnreadCount(jid)
    clearPendingGroupJoin()
  }, [pendingGroupJoin, view, clearPendingGroupJoin])

  useEffect(() => {
    mountedRef.current = true

    // Initial fetch
    const timeout = setTimeout(fetchChats, 100)

    // Listen for new messages - update only the specific chat
    const unsubNewMessage = EventsOn(
      "wa:new_message",
      (data: {
        chatId: string
        messageText: string
        timestamp: number
        sender: string
        reaction?: string
        isFromMe?: boolean
      }) => {
        // Mark an incoming message unread unless it belongs to the chat that's
        // currently open. Read state via getState() to avoid a stale closure.
        if (!data.isFromMe && useChatStore.getState().selectedChatId !== data.chatId) {
          useChatStore.getState().incrementUnreadCount(data.chatId)
        }

        if (!initialFetchDoneRef.current) {
          // If we haven't done initial fetch, do a full fetch
          setTimeout(fetchChats, 500)
          return
        }

        // Check if we already have this chat in our list
        const existingChat = getChat(data.chatId)
        if (existingChat) {
          let previewText = data.messageText
          // Backend sends the raw push name; mirror the chat list's sender
          // resolution ("You" for own messages, name otherwise).
          let senderForUpdate = data.isFromMe ? "You" : data.sender
          if (data.reaction) {
            previewText = `${data.sender} reacted ${data.reaction} to: "${previewText}"`
            senderForUpdate = ""
          }

          // Update only this specific chat - no full re-fetch needed!
          updateChatLastMessage(
            data.chatId,
            previewText,
            data.timestamp,
            senderForUpdate,
            Boolean(data.isFromMe),
          )
        } else {
          // New chat we don't have - need to fetch to get avatar/name
          setTimeout(fetchChats, 500)
        }
      },
    )

    const unsubPictureUpdate = EventsOn("wa:picture_update", async (jid: string) => {
      if (!jid) return

      try {
        const avatarURL = await GetCachedAvatar(jid, true)

        updateSingleChat(jid, { avatar: avatarURL })

        // Read selection from the store at callback time: this listener is
        // registered once, so the render-time `selectedChatId` would be stale.
        if (useChatStore.getState().selectedChatId === jid) {
          const existing = getChat(jid)
          if (existing) {
            selectChat({ ...existing, avatar: avatarURL })
          }
        }
      } catch (err) {
        console.error("Error updating avatar for", jid, err)
      }
    })

    // Fallback: listen for generic updates that require full refresh
    const unsubRefresh = EventsOn("wa:chat_list_refresh", () => {
      setTimeout(fetchChats, 500)
    })

    return () => {
      mountedRef.current = false
      clearTimeout(timeout)
      unsubNewMessage()
      unsubPictureUpdate()
      unsubRefresh()
    }
  }, [fetchChats, getChat, loadSelfAvatar, updateChatLastMessage, updateSingleChat])

  // Below `md` two sized panes cannot coexist: a hidden ResizablePanel still
  // reserves its flex space. Swap one full-width pane on selection instead.
  const isWide = useMediaQuery("(min-width: 768px)")

  const listPane = (
    <div className="flex h-full flex-col border-r border-gray-200 dark:border-dark-tertiary bg-white dark:bg-dark-bg">
      {showSearch ? (
        <MessageSearchScreen onClose={() => setShowSearch(false)} />
      ) : (
        <>
          <Header
            onOpenSettings={onOpenSettings}
            onNewChat={() => setShowCreateGroup(true)}
            onSearch={() => setShowSearch(true)}
            avatar={selfAvatar}
          />
          {view !== "status" && (
            <SearchBar
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={
                view === "communities"
                  ? "Search communities"
                  : view === "channels"
                    ? "Search channels"
                    : "Search or start new chat"
              }
            />
          )}

          {view === "chats" && (
            <div
              className="flex items-center gap-2 overflow-x-auto px-3 pb-2"
              role="group"
              aria-label="Filter chats"
            >
              <button
                type="button"
                aria-pressed={chatFilter === "all"}
                onClick={() => setChatFilter("all")}
                className={chipClassName(chatFilter === "all")}
              >
                All
              </button>
              <button
                type="button"
                aria-pressed={chatFilter === "unread"}
                onClick={() => setChatFilter("unread")}
                className={chipClassName(chatFilter === "unread")}
              >
                Unread{filterCounts.unread > 0 ? ` ${filterCounts.unread}` : ""}
              </button>
              <button
                type="button"
                aria-pressed={chatFilter === "pinned"}
                title="Pinned (starred) chats"
                onClick={() => setChatFilter("pinned")}
                className={clsx(chipClassName(chatFilter === "pinned"), "flex items-center gap-1")}
              >
                <StarIcon />
                Pinned
              </button>
              <button
                type="button"
                aria-pressed={chatFilter === "groups"}
                onClick={() => setChatFilter("groups")}
                className={chipClassName(chatFilter === "groups")}
              >
                Groups{filterCounts.groups > 0 ? ` ${filterCounts.groups}` : ""}
              </button>

              <div ref={moreFiltersRef} className="relative shrink-0">
                <button
                  ref={moreFiltersTriggerRef}
                  type="button"
                  aria-label="More filters"
                  aria-haspopup="menu"
                  aria-expanded={moreFiltersOpen}
                  onClick={() => setMoreFiltersOpen(open => !open)}
                  className={clsx(
                    "flex h-7 w-8 items-center justify-center rounded-full border transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                    MORE_FILTERS.includes(chatFilter)
                      ? "border-transparent bg-green-muted text-green-ink"
                      : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-dark-border dark:text-dark-muted dark:hover:bg-white/5",
                  )}
                >
                  <ChevronDownIcon />
                </button>
                {moreFiltersOpen && (
                  <div
                    role="menu"
                    aria-label="More chat filters"
                    className="absolute left-0 top-9 z-40 min-w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-dark-secondary"
                  >
                    {MORE_FILTERS.map(filter => (
                      <button
                        key={filter}
                        type="button"
                        role="menuitemradio"
                        aria-checked={chatFilter === filter}
                        onClick={() => chooseMoreFilter(filter)}
                        className={clsx(
                          "flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:bg-gray-100 dark:focus-visible:bg-white/5",
                          "text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5",
                        )}
                      >
                        {FILTER_LABELS[filter]}
                        {chatFilter === filter && <span aria-hidden="true">✓</span>}
                      </button>
                    ))}
                    <div className="my-1 border-t border-gray-200 dark:border-white/10" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => chooseMoreFilter("all")}
                      className="flex w-full px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5 dark:focus-visible:bg-white/5"
                    >
                      All chats
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {view === "channels" && (
            <div className="mx-3 mt-2 flex gap-2">
              <button
                onClick={() => setShowSubscribeChannel(true)}
                className="flex-1 px-4 py-2 bg-green text-action-ink rounded-lg text-sm font-medium transition-colors hover:bg-green-dark"
              >
                Subscribe
              </button>
              <button
                onClick={() => setShowCreateChannel(true)}
                className="flex-1 px-4 py-2 bg-white dark:bg-dark-tertiary border border-gray-300 dark:border-dark-border text-light-text dark:text-dark-text rounded-lg text-sm font-medium hover:bg-gray-100 dark:hover:bg-dark-secondary transition-colors"
              >
                Create
              </button>
            </div>
          )}

          {/* Archived entry (main view) / archived header (archived view) */}
          {!showArchived && view === "chats" && archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(true)}
              className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-[#1a1a1a]"
            >
              <span className="flex w-12 justify-center text-green-ink">
                <svg viewBox="0 0 24 24" width="20" height="20" className="fill-current">
                  <path d="M20.54 5.23 19.15 3.55A1.5 1.5 0 0 0 18 3H6a1.5 1.5 0 0 0-1.16.55L3.46 5.23A2 2 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5a2 2 0 0 0-.46-1.27ZM6.24 5h11.52l.81.97H5.44ZM5 19V8h14v11Zm8-5.5V11h-2v2.5H8.5L12 17l3.5-3.5Z" />
                </svg>
              </span>
              <span className="flex-1 font-medium text-light-text dark:text-dark-text">
                Archived
              </span>
              <span className="text-xs text-gray-600 dark:text-[#8696a0]">{archivedCount}</span>
            </button>
          )}
          {showArchived && (
            <div className="flex items-center gap-4 border-b border-gray-200 dark:border-white/5 px-4 py-3">
              <button
                onClick={() => setShowArchived(false)}
                className="text-gray-600 dark:text-[#8696a0] hover:text-gray-900 dark:hover:text-white"
                aria-label="Back to chats"
              >
                <GoBackIcon />
              </button>
              <span className="font-medium text-light-text dark:text-dark-text">Archived</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {view === "status" ? (
              <StatusList onOpen={setStoryGroup} />
            ) : view === "communities" ? (
              <CommunityList
                searchTerm={searchTerm}
                selectedJid={selectedCommunity?.jid ?? null}
                onSelect={handleCommunitySelect}
              />
            ) : filteredChatIds.length === 0 ? (
              <EmptyState
                hasChats={totalChats > 0}
                isLoading={isFetchingRef.current}
                onRefresh={fetchChats}
                message={
                  chatFilter === "all"
                    ? undefined
                    : `No chats match the ${FILTER_LABELS[chatFilter].toLowerCase()} filter.`
                }
              />
            ) : (
              filteredChatIds.map(chatId => (
                <ChatListItem
                  key={chatId}
                  chatId={chatId}
                  isSelected={selectedChatId === chatId}
                  onSelect={handleChatSelect}
                  onContextMenu={handleChatContextMenu}
                  onMenuTrigger={handleChatMenuTrigger}
                  isMenuOpen={chatMenu?.chat.id === chatId}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  )

  // The right pane is a conversation surface only. Status lives entirely in
  // the list pane (and its viewer is a portalled dialog), so even a stale or
  // externally selected chat must never put status content here.
  const showConversation =
    !!selectedChatId && view !== "status" && !selectedChatId.endsWith("@broadcast")

  const detailPane = (
    <div
      className={clsx(
        "relative flex h-full flex-col",
        selectedCommunity ? "bg-light-secondary dark:bg-dark-bg" : "bg-[#efeae2] dark:bg-dark-bg",
      )}
    >
      {showConversation ? (
        <ChatDetail
          key={selectedChatId}
          chatId={selectedChatId}
          chatName={selectedChatName}
          chatAvatar={selectedChatAvatar}
          onBack={handleBack}
        />
      ) : selectedCommunity ? (
        <CommunityHome
          communityJid={selectedCommunity.jid}
          communityName={selectedCommunity.name}
          communityAvatar={selectedCommunity.avatar_url}
          onBack={() => setSelectedCommunity(null)}
          onOpenGroup={handleOpenGroupFromCommunity}
        />
      ) : view === "communities" ? (
        <CommunitiesWelcome />
      ) : (
        <WelcomeScreen
          onGoToCalls={handleGoToCalls}
          onSendDocument={handleSendDocument}
          onInviteFriend={handleInviteFriend}
          isInviting={isInviting}
        />
      )}
    </div>
  )

  return (
    <div className="flex h-screen bg-light-secondary dark:bg-dark-bg overflow-hidden">
      {chatMenu && (
        <div
          ref={chatMenuRef}
          className="fixed z-50 min-w-36 rounded-lg border border-gray-200 dark:border-dark-border bg-white py-1 shadow-lg dark:border-white/10 dark:bg-dark-secondary"
          style={{ top: chatMenu.y, left: chatMenu.x }}
          onKeyDown={handleChatMenuKeyDown}
        >
          <div role="menu" aria-label={`Actions for ${chatMenu.chat.name}`}>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={handleTogglePin}
              className="w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5"
            >
              {chatMenu.chat.pinned ? "Unpin chat" : "Pin chat"}
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={handleToggleArchive}
              className="w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5"
            >
              {chatMenu.chat.archived ? "Unarchive chat" : "Archive chat"}
            </button>
            {(chatMenu.chat.unreadCount ?? 0) > 0 && (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={handleMarkAsRead}
                className="w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-white/5"
              >
                Mark as read
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={handleDeleteChat}
              className="w-full px-4 py-2 text-left text-sm text-[var(--color-danger-ink)] hover:bg-gray-100 dark:hover:bg-white/5"
            >
              Delete chat
            </button>
          </div>
          <div className="border-t border-gray-200 dark:border-dark-border" />
          <div className="px-4 py-2">
            <div className="flex gap-1">
              <input
                className="min-w-0 flex-1 rounded border border-gray-300 dark:border-dark-border bg-transparent px-2 py-1 text-xs text-light-text dark:text-dark-text placeholder:text-light-muted dark:placeholder:text-dark-muted"
                value={chatLabelName}
                onChange={e => {
                  setChatLabelName(e.target.value)
                  setChatLabelError("")
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") void applyChatLabel()
                }}
                placeholder="Label name"
                aria-label="Label name"
                onClick={e => e.stopPropagation()}
              />
              <button
                type="button"
                onClick={e => {
                  // Keep the menu open so an unknown-name error stays visible.
                  e.stopPropagation()
                  void applyChatLabel()
                }}
                disabled={!chatLabelName.trim()}
                className="rounded bg-green px-2 py-1 text-xs font-medium text-action-ink transition-colors hover:bg-green-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Label
              </button>
            </div>
            {chatLabelError ? (
              <p
                role="alert"
                className="mt-1 rounded-lg bg-danger-tint px-2 py-1 text-[11px] text-danger-ink"
              >
                {chatLabelError}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-light-muted dark:text-dark-muted">
                Use a name you saved from a message.
              </p>
            )}
          </div>
        </div>
      )}
      {isWide ? (
        <ResizablePanelGroup className="h-full">
          {/* react-resizable-panels v4: a NUMBER means pixels, an explicit "px"
              string means pixels, and a bare/"%" string means a percentage.
              The old bare numbers ({30}/{25}/{55}) were read as 30px/25px/55px,
              so maxSize capped the list at 55px (~5% of a wide WebView) and it
              was always crushed. Use px strings for real pixel constraints and
              let the detail pane auto-fill the remainder (min 45% keeps it
              usable on narrow windows). The md swap below still owns <768px. */}
          <ResizablePanel defaultSize="340px" minSize="300px" maxSize="520px">
            {listPane}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel minSize="45%">{detailPane}</ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="h-full w-full min-w-0">
          {selectedChatId || selectedCommunity ? detailPane : listPane}
        </div>
      )}
      {storyGroup && <StoryViewer group={storyGroup} onClose={() => setStoryGroup(null)} />}
      {showCreateGroup && <CreateGroupDialog onClose={() => setShowCreateGroup(false)} />}
      {showSubscribeChannel && (
        <SubscribeChannelDialog onClose={() => setShowSubscribeChannel(false)} />
      )}
      {showCreateChannel && <CreateChannelDialog onClose={() => setShowCreateChannel(false)} />}

      <ConfirmDialog
        open={pendingDeleteChat !== null}
        title={`Delete chat with ${pendingDeleteChat?.name || "this contact"}?`}
        description="This removes the chat and its local message history from this device. It cannot be undone; the conversation on the other device is unaffected."
        confirmLabel="Delete chat"
        cancelLabel="Keep chat"
        tone="danger"
        onConfirm={confirmDeleteChat}
        onCancel={() => setPendingDeleteChat(null)}
      />
    </div>
  )
}
