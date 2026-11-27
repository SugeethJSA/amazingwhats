import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import clsx from "clsx"
import ConfirmDialog from "../common/ConfirmDialog"
import { useChatStore } from "../../store"
import type { ChatItem } from "../../store/types"

/**
 * Saved/custom chat lists. Lists are a small piece of local app data: they are
 * persisted under a dedicated localStorage key (the same pattern the label
 * names use) and their members are REAL chat IDs resolved against useChatStore
 * on every render. Nothing here is a placeholder — a list with no resolvable
 * chats says so explicitly instead of showing invented rows.
 */
const STORAGE_KEY = "amazingwhats.chatLists"

export interface SavedChatList {
  id: string
  name: string
  chatIds: string[]
  createdAt: number
}

function readLists(): SavedChatList[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is SavedChatList => {
        if (!value || typeof value !== "object") return false
        const item = value as Record<string, unknown>
        return (
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          Array.isArray(item.chatIds) &&
          item.chatIds.every(id => typeof id === "string")
        )
      })
      .map(item => ({
        id: item.id,
        name: item.name,
        chatIds: (item.chatIds as string[]).filter(id => typeof id === "string" && id.length > 0),
        createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
      }))
  } catch {
    return []
  }
}

function writeLists(lists: SavedChatList[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists))
  } catch (err) {
    console.error("Failed to save chat lists:", err)
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const BTN =
  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
const PRIMARY_BTN = clsx(BTN, "bg-green text-action-ink hover:bg-green-dark")
const SECONDARY_BTN = clsx(
  BTN,
  "border border-gray-300 text-light-text hover:bg-gray-100 dark:border-dark-border dark:text-dark-text dark:hover:bg-white/5",
)
const DANGER_BTN = clsx(
  BTN,
  "text-[var(--color-danger-ink)] hover:bg-gray-100 dark:hover:bg-white/5",
)

const CheckBox = ({ checked }: { checked: boolean }) => (
  <span
    className={clsx(
      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
      checked ? "border-green bg-green text-action-ink" : "border-gray-400 dark:border-gray-500",
    )}
    aria-hidden="true"
  >
    {checked && (
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 12 4 4L19 6" />
      </svg>
    )}
  </span>
)

const Chevron = ({ expanded }: { expanded: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={clsx("shrink-0 transition-transform", expanded && "rotate-180")}
    aria-hidden="true"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
)

const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

const initialOf = (name: string) => (name.trim()[0] || "?").toUpperCase()

const useSavedLists = () => {
  const [lists, setLists] = useState<SavedChatList[]>(() => readLists())

  useEffect(() => {
    writeLists(lists)
  }, [lists])

  const update = useCallback((fn: (current: SavedChatList[]) => SavedChatList[]) => {
    setLists(fn)
  }, [])

  return { lists, update }
}

export interface ListsViewProps {
  /** "manage": browse saved lists. "add-to-list": add presetChatIds to a list. */
  mode: "manage" | "add-to-list"
  /** Real chat IDs to add when mode is "add-to-list". */
  presetChatIds?: string[]
  onClose: () => void
  /** Open a real conversation by id, then close this view. */
  onOpenChat: (chatId: string) => void
  /** Called after an add-to-list action with the target name and number added. */
  onApplied?: (listName: string, addedCount: number) => void
}

export function ListsView({ mode, presetChatIds, onClose, onOpenChat, onApplied }: ListsViewProps) {
  const { lists, update } = useSavedLists()
  const isAddMode = mode === "add-to-list"

  const chatIds = useChatStore(state => state.chatIds)
  const chatsById = useChatStore(state => state.chatsById)

  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftSelection, setDraftSelection] = useState<Set<string>>(() => new Set())
  const [chatSearch, setChatSearch] = useState("")
  const [creating, setCreating] = useState(isAddMode)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const allChats = useMemo(
    () => chatIds.map(id => chatsById.get(id)).filter((chat): chat is ChatItem => Boolean(chat)),
    [chatIds, chatsById],
  )

  const presetIds = useMemo(
    () =>
      Array.from(
        new Set((presetChatIds ?? []).filter(id => typeof id === "string" && id.length > 0)),
      ),
    [presetChatIds],
  )
  const presetChats = useMemo(
    () => presetIds.map(id => chatsById.get(id)).filter((chat): chat is ChatItem => Boolean(chat)),
    [presetIds, chatsById],
  )

  const filteredAllChats = useMemo(() => {
    const term = chatSearch.trim().toLowerCase()
    if (!term) return allChats
    return allChats.filter(chat => chat.name.toLowerCase().includes(term))
  }, [allChats, chatSearch])

  const membersFor = useCallback(
    (list: SavedChatList) =>
      list.chatIds.map(id => chatsById.get(id)).filter((chat): chat is ChatItem => Boolean(chat)),
    [chatsById],
  )

  // The modal owns Escape while it is open, but must not swallow Escape that a
  // nested confirmation or a rename field is handling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (confirmDeleteId || renamingId) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose, confirmDeleteId, renamingId])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const toggleDraft = useCallback((chatId: string) => {
    setDraftSelection(prev => {
      const next = new Set(prev)
      if (next.has(chatId)) next.delete(chatId)
      else next.add(chatId)
      return next
    })
  }, [])

  const handleOpenChat = useCallback(
    (chatId: string) => {
      onOpenChat(chatId)
      onClose()
    },
    [onOpenChat, onClose],
  )

  const createList = useCallback(() => {
    const name = draftName.trim()
    if (!name) return
    const ids = isAddMode ? presetIds : Array.from(draftSelection)
    if (ids.length === 0) return
    const list: SavedChatList = {
      id: newId(),
      name,
      chatIds: ids,
      createdAt: Date.now(),
    }
    update(prev => [...prev, list])
    setDraftName("")
    setDraftSelection(new Set())
    setActiveListId(list.id)
    if (isAddMode) {
      onApplied?.(name, ids.length)
      onClose()
    }
  }, [draftName, draftSelection, isAddMode, presetIds, update, onApplied, onClose])

  const addToList = useCallback(
    (list: SavedChatList) => {
      if (presetIds.length === 0) return
      const added = presetIds.filter(id => !list.chatIds.includes(id))
      if (added.length === 0) {
        onApplied?.(list.name, 0)
        onClose()
        return
      }
      update(prev =>
        prev.map(item =>
          item.id === list.id ? { ...item, chatIds: [...item.chatIds, ...added] } : item,
        ),
      )
      onApplied?.(list.name, added.length)
      onClose()
    },
    [presetIds, update, onApplied, onClose],
  )

  const commitRename = useCallback(() => {
    if (!renamingId) return
    const name = renameValue.trim()
    if (name) {
      update(prev => prev.map(item => (item.id === renamingId ? { ...item, name } : item)))
    }
    setRenamingId(null)
    setRenameValue("")
  }, [renamingId, renameValue, update])

  const deleteList = useCallback(() => {
    if (!confirmDeleteId) return
    update(prev => prev.filter(item => item.id !== confirmDeleteId))
    if (activeListId === confirmDeleteId) setActiveListId(null)
    setConfirmDeleteId(null)
  }, [confirmDeleteId, activeListId, update])

  const removeMember = useCallback(
    (listId: string, chatId: string) => {
      update(prev =>
        prev.map(item =>
          item.id === listId
            ? { ...item, chatIds: item.chatIds.filter(id => id !== chatId) }
            : item,
        ),
      )
    },
    [update],
  )

  const deletingName = lists.find(list => list.id === confirmDeleteId)?.name ?? "this list"

  return (
    <>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
        onMouseDown={event => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isAddMode ? "Add chats to a list" : "Chat lists"}
          className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-dark-secondary"
        >
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-white/10">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-light-text dark:text-dark-text">
                {isAddMode ? "Add to a list" : "Lists"}
              </h2>
              <p className="mt-0.5 text-xs leading-snug text-light-muted dark:text-dark-muted">
                {isAddMode
                  ? `Pick a list for ${presetChats.length} selected chat(s). Lists are saved on this device.`
                  : "Group the chats you talk to most. Lists are saved on this device."}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close lists"
              className="shrink-0 rounded-full p-1.5 text-gray-600 transition-colors hover:bg-gray-100 dark:text-dark-muted dark:hover:bg-white/10"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {isAddMode && (
              <>
                <p className="mb-2 text-xs font-medium text-gray-600 dark:text-dark-muted">
                  Selected chats
                </p>
                <div className="mb-5 flex flex-wrap gap-1.5">
                  {presetChats.length === 0 ? (
                    <p className="text-xs text-light-muted dark:text-dark-muted">
                      None of the selected chats are available on this device.
                    </p>
                  ) : (
                    presetChats.map(chat => (
                      <span
                        key={chat.id}
                        className="rounded-full bg-gray-100 px-2 py-1 text-xs text-light-text dark:bg-white/5 dark:text-dark-text"
                      >
                        {chat.name}
                      </span>
                    ))
                  )}
                </div>

                <p className="mb-2 text-xs font-medium text-gray-600 dark:text-dark-muted">
                  Add to an existing list
                </p>
                {lists.length === 0 ? (
                  <p className="mb-5 rounded-lg bg-gray-100 px-3 py-3 text-xs text-light-muted dark:bg-white/5 dark:text-dark-muted">
                    You have no lists yet — create one below.
                  </p>
                ) : (
                  <ul className="mb-5 space-y-1.5">
                    {lists.map(list => {
                      const added = presetIds.filter(id => !list.chatIds.includes(id)).length
                      return (
                        <li
                          key={list.id}
                          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-white/10"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-light-text dark:text-dark-text">
                            {list.name}
                          </span>
                          <span className="text-[11px] text-light-muted dark:text-dark-muted">
                            {list.chatIds.length} chat(s)
                          </span>
                          <button
                            type="button"
                            disabled={added === 0}
                            onClick={() => addToList(list)}
                            className={PRIMARY_BTN}
                          >
                            {added === 0 ? "Already in list" : `Add ${added}`}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}

            {!isAddMode && (
              <>
                <p className="mb-2 text-xs font-medium text-gray-600 dark:text-dark-muted">
                  Your lists
                </p>
                {lists.length === 0 ? (
                  <p className="rounded-lg bg-gray-100 px-3 py-4 text-center text-sm text-light-muted dark:bg-white/5 dark:text-dark-muted">
                    No lists yet. Create one below to collect chats you want together.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {lists.map(list => {
                      const members = membersFor(list)
                      const missing = list.chatIds.length - members.length
                      const expanded = activeListId === list.id
                      return (
                        <li
                          key={list.id}
                          className="rounded-xl border border-gray-200 dark:border-white/10"
                        >
                          <div className="flex items-center gap-1 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setActiveListId(expanded ? null : list.id)}
                              aria-expanded={expanded}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <Chevron expanded={expanded} />
                              <span className="truncate text-sm font-medium text-light-text dark:text-dark-text">
                                {list.name}
                              </span>
                              <span className="shrink-0 text-[11px] text-light-muted dark:text-dark-muted">
                                {members.length} chat(s)
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(list.id)
                                setRenameValue(list.name)
                              }}
                              className={SECONDARY_BTN}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(list.id)}
                              className={DANGER_BTN}
                            >
                              Delete
                            </button>
                          </div>

                          {renamingId === list.id && (
                            <div className="flex gap-2 px-3 pb-2">
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={event => setRenameValue(event.target.value)}
                                onKeyDown={event => {
                                  if (event.key === "Enter") commitRename()
                                  if (event.key === "Escape") setRenamingId(null)
                                }}
                                aria-label={`Rename ${list.name}`}
                                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-2 py-1 text-sm text-light-text dark:border-dark-border dark:text-dark-text"
                              />
                              <button
                                type="button"
                                onClick={commitRename}
                                disabled={!renameValue.trim()}
                                className={PRIMARY_BTN}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingId(null)}
                                className={SECONDARY_BTN}
                              >
                                Cancel
                              </button>
                            </div>
                          )}

                          {expanded && (
                            <div className="border-t border-gray-200 px-3 py-2 dark:border-white/10">
                              {members.length === 0 ? (
                                <p className="text-xs text-light-muted dark:text-dark-muted">
                                  This list is empty. Use “Select chats” in the chat-list menu to
                                  add chats to a list.
                                </p>
                              ) : (
                                <ul className="space-y-1">
                                  {members.map(chat => (
                                    <li
                                      key={chat.id}
                                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-white/5"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => handleOpenChat(chat.id)}
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                      >
                                        <span
                                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-muted text-xs font-semibold text-green-ink"
                                          aria-hidden="true"
                                        >
                                          {initialOf(chat.name)}
                                        </span>
                                        <span className="truncate text-sm text-light-text dark:text-dark-text">
                                          {chat.name}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeMember(list.id, chat.id)}
                                        aria-label={`Remove ${chat.name} from ${list.name}`}
                                        className="shrink-0 text-[11px] text-light-muted transition-colors hover:text-[var(--color-danger-ink)] dark:text-dark-muted"
                                      >
                                        Remove
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {missing > 0 && (
                                <p className="mt-1 text-[11px] text-light-muted dark:text-dark-muted">
                                  {missing} chat(s) saved in this list are no longer on this device
                                  and are hidden.
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {!creating && (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className={clsx(SECONDARY_BTN, "mt-4")}
                  >
                    New list
                  </button>
                )}
              </>
            )}

            {(isAddMode || creating) && (
              <div className="mt-5 border-t border-gray-200 pt-4 dark:border-white/10">
                <p className="mb-2 text-xs font-medium text-gray-600 dark:text-dark-muted">
                  {isAddMode ? "Or create a new list with these chats" : "Create a new list"}
                </p>
                <div className="flex gap-2">
                  <input
                    autoFocus={isAddMode}
                    value={draftName}
                    onChange={event => setDraftName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter") createList()
                      if (event.key === "Escape") setDraftName("")
                    }}
                    placeholder="List name"
                    aria-label="New list name"
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-3 py-1.5 text-sm text-light-text placeholder:text-light-muted dark:border-dark-border dark:text-dark-text dark:placeholder:text-dark-muted"
                  />
                  <button
                    type="button"
                    onClick={createList}
                    disabled={
                      !draftName.trim() ||
                      (isAddMode ? presetIds.length === 0 : draftSelection.size === 0)
                    }
                    className={PRIMARY_BTN}
                  >
                    Create list
                  </button>
                </div>

                {!isAddMode && (
                  <div className="mt-3">
                    <input
                      value={chatSearch}
                      onChange={event => setChatSearch(event.target.value)}
                      placeholder="Find chats to add"
                      aria-label="Find chats to add"
                      className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-1.5 text-sm text-light-text placeholder:text-light-muted dark:border-dark-border dark:text-dark-text dark:placeholder:text-dark-muted"
                    />
                    <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10">
                      {filteredAllChats.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-light-muted dark:text-dark-muted">
                          No chats match your search.
                        </p>
                      ) : (
                        filteredAllChats.map(chat => (
                          <button
                            key={chat.id}
                            type="button"
                            onClick={() => toggleDraft(chat.id)}
                            aria-pressed={draftSelection.has(chat.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-white/5"
                          >
                            <CheckBox checked={draftSelection.has(chat.id)} />
                            <span className="min-w-0 flex-1 truncate text-light-text dark:text-dark-text">
                              {chat.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-light-muted dark:text-dark-muted">
                              {chat.type === "group" ? "Group" : "Contact"}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-light-muted dark:text-dark-muted">
                      {draftSelection.size} chat(s) selected for the new list.
                    </p>
                  </div>
                )}

                {!isAddMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false)
                      setDraftName("")
                      setDraftSelection(new Set())
                      setChatSearch("")
                    }}
                    className={clsx(SECONDARY_BTN, "mt-3")}
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={`Delete “${deletingName}”?`}
        description="The list is removed from this device. The chats themselves are not deleted."
        confirmLabel="Delete list"
        cancelLabel="Keep list"
        tone="danger"
        onConfirm={deleteList}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  )
}

export default ListsView
