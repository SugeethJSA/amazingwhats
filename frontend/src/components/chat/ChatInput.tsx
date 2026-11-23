import React, { lazy, Suspense, useState, useRef, useEffect, useId } from "react"
import { createPortal } from "react-dom"
import clsx from "clsx"
import {
  EmojiIcon,
  AttachIcon,
  SendIcon,
  CloseIcon,
  UserAvatar,
  PhotosIcon,
  DocumentIcon,
  PollIcon,
  ContactIcon,
  LocationIcon,
} from "../../assets/svgs/chat_icons"
import { GetCachedAvatar, SendLocation, PickAttachmentFile } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import type { Message } from "../../store/types"
import { useContactStore } from "../../store/useContactStore"
import { useUIStore } from "../../store"
import { registerShortcut } from "../../lib/shortcuts"
import { sanitizeHtml } from "../../lib/utils"
import { PollDialog } from "./PollDialog"
import { ContactShareDialog } from "./ContactShareDialog"

const EmojiPicker = lazy(() => import("./EmojiPickerLazy"))
interface ChatInputProps {
  chatId: string
  disabled?: boolean
  inputText: string
  pastedImage: string | null
  selectedFile: File | null
  selectedFileType: string
  showEmojiPicker: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  emojiPickerRef: React.RefObject<HTMLDivElement | null>
  emojiButtonRef: React.RefObject<HTMLButtonElement | null>
  replyingTo: Message | null
  mentionableContacts: any[]
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onSendMessage: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveFile: () => void
  onEmojiClick: (emoji: string) => void
  onToggleEmojiPicker: () => void
  onCancelReply: () => void
  onMentionAdd: (contact: any) => void
  selectedMentions: any[]
  /** Send the selected video as an animated GIF (gifPlayback message). */
  sendAsGif?: boolean
  onToggleSendAsGif?: () => void
}

const FILE_TYPE_ICONS = {
  image: "📷",
  video: "🎥",
  audio: "🎵",
  document: "📄",
} as const

interface IconButtonProps {
  onClick: () => void
  title: string
  children: React.ReactNode
  ref?: React.RefObject<HTMLButtonElement>
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21c063]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary"

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ onClick, title, children }, ref) => (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={`p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors ${FOCUS_RING}`}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = "IconButton"

interface FilePreviewProps {
  file: File
  fileType: string
  onRemove: () => void
  /** Video/gif files can be sent as an animated GIF (gifPlayback message). */
  gifEnabled?: boolean
  onToggleGif?: () => void
}

const FilePreview = ({ file, fileType, onRemove, gifEnabled, onToggleGif }: FilePreviewProps) => (
  <div className="mb-2 flex items-center gap-2 rounded-xl bg-gray-100 p-2 dark:bg-gray-700">
    <div className="flex-1">
      <div className="flex items-center gap-2">
        {FILE_TYPE_ICONS[fileType as keyof typeof FILE_TYPE_ICONS]}
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{file.name}</span>
        {fileType === "gif" && (
          <span className="rounded bg-[#21c063]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#21c063]">
            GIF
          </span>
        )}
      </div>
      <span className="text-xs text-light-muted dark:text-dark-muted">
        {(file.size / 1024).toFixed(2)} KB
      </span>
    </div>
    {(fileType === "video" || fileType === "gif") && onToggleGif && (
      <button
        type="button"
        onClick={onToggleGif}
        title="Send as an animated GIF (loops instead of playing like a video)"
        aria-label="Send as an animated GIF"
        aria-pressed={!!gifEnabled}
        className={clsx(
          "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
          FOCUS_RING,
          gifEnabled
            ? "border-[#21c063] bg-[#21c063] text-[#0a1014]"
            : "border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600",
        )}
      >
        GIF
      </button>
    )}
    <button
      type="button"
      onClick={onRemove}
      className={`rounded p-1 text-[#b42318] hover:text-[#8a1c13] dark:text-[#fca5a5] ${FOCUS_RING}`}
      title="Remove file"
      aria-label="Remove attached file"
    >
      ×
    </button>
  </div>
)

interface ImagePreviewProps {
  imageSrc: string
  onRemove: () => void
}

const ImagePreview = ({ imageSrc, onRemove }: ImagePreviewProps) => (
  <div className="mb-2 relative inline-block">
    <img src={imageSrc} alt="Pasted" className="max-h-40 rounded-lg" />
    <button
      type="button"
      onClick={onRemove}
      className={clsx(
        "absolute top-1 right-1",
        "bg-[#ef4444] text-white rounded-full",
        "w-6 h-6 flex items-center justify-center",
        "hover:brightness-110 transition-colors",
        FOCUS_RING,
      )}
      title="Remove image"
      aria-label="Remove pasted image"
    >
      ×
    </button>
  </div>
)

export function ChatInput({
  chatId,
  disabled = false,
  inputText,
  pastedImage,
  selectedFile,
  selectedFileType,
  showEmojiPicker,
  textareaRef,
  fileInputRef,
  emojiPickerRef,
  emojiButtonRef,
  replyingTo,
  mentionableContacts,
  onInputChange,
  onKeyDown,
  onPaste,
  onSendMessage,
  onFileSelect,
  onRemoveFile,
  onEmojiClick,
  onToggleEmojiPicker,
  onCancelReply,
  onMentionAdd,
  selectedMentions,
  sendAsGif,
  onToggleSendAsGif,
}: ChatInputProps) {
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([])
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [latInput, setLatInput] = useState("")
  const [lngInput, setLngInput] = useState("")
  const [placeName, setPlaceName] = useState("")
  const [fileAccept, setFileAccept] = useState("image/*,video/*,audio/*,.pdf,.doc,.docx")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [mentionAvatars, setMentionAvatars] = useState<Record<string, string>>({})
  const [loadingAvatars, setLoadingAvatars] = useState<Record<string, boolean>>({})
  const [locationSending, setLocationSending] = useState(false)
  const [locationError, setLocationError] = useState("")

  const addNotification = useUIStore(state => state.addNotification)

  const locationTitleId = useId()
  const locationPanelRef = useRef<HTMLDivElement>(null)
  const locationLatRef = useRef<HTMLInputElement>(null)
  const locationReturnFocusRef = useRef<HTMLElement | null>(null)

  // Alt+A opens/toggles this component's attachment dropdown (the global
  // shortcut handler won't reach here while the user is typing in the box).
  const screen = useUIStore(state => state.screen)
  useEffect(() => {
    if (screen !== "chats") return
    return registerShortcut("attach-menu", () => setAttachMenuOpen(v => !v))
  }, [screen])

  // The attach menu needs its own Escape handler; the chat-level handler would
  // otherwise close the whole conversation while the menu is still open.
  useEffect(() => {
    if (!attachMenuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setAttachMenuOpen(false)
      }
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [attachMenuOpen])

  // Location dialog: focus the first field on open, Escape closes, Tab stays in
  // the dialog, and focus returns to the attachment trigger on close.
  useEffect(() => {
    if (!locationOpen) return
    locationReturnFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    locationLatRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setLocationOpen(false)
        return
      }
      if (event.key !== "Tab" || !locationPanelRef.current) return
      const focusables = Array.from(
        locationPanelRef.current.querySelectorAll<HTMLElement>(
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
      const target = locationReturnFocusRef.current?.isConnected
        ? locationReturnFocusRef.current
        : attachButtonRef.current
      target?.focus()
    }
  }, [locationOpen])

  const avatarCacheRef = useRef<Record<string, string>>({})
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const attachButtonRef = useRef<HTMLButtonElement>(null)

  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  const renderHighlightedText = () => {
    if (!inputText) return null
    if (selectedMentions.length === 0) return inputText

    const mentionNames = selectedMentions.map(m => {
      let name = m.full_name
      if (!name) {
        if (m.push_name) name = `~ ${m.push_name}`
        else name = m.short || m.phno
      }
      return "@" + name
    })
    if (mentionNames.length === 0) return inputText

    const pattern = new RegExp(`(${mentionNames.join("|")})`, "g")
    const parts = inputText.split(pattern)

    return parts.map((part, index) => {
      if (mentionNames.includes(part)) {
        return (
          <span key={index} className="text-green-500">
            {part}
          </span>
        )
      }
      return <span key={index}>{part}</span>
    })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    onInputChange(e)

    // Check for mention trigger
    const mentionMatch = value.match(/@(\w*)$/)
    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase()
      const matches = mentionableContacts
        .map((contact: any) => ({
          contact,
          name: (
            (contact.full_name && contact.full_name) ||
            (contact.push_name && contact.push_name) ||
            contact.short ||
            contact.phno ||
            ""
          ).toLowerCase(),
        }))
        .filter((c: any) => c.name.includes(query))
        .slice(0, 5)

      setMentionSuggestions(matches.map((m: any) => m.contact))
      setShowSuggestions(matches.length > 0)
    } else {
      setShowSuggestions(false)
    }
  }

  const handleSuggestionClick = (contact: any) => {
    let name = contact.full_name
    if (!name) {
      if (contact.push_name) {
        name = `~ ${contact.push_name}`
      } else {
        name = contact.short || contact.phno
      }
    }
    const newText = inputText.replace(/@\w*$/, `@${name} `)
    const fakeEvent = {
      target: { value: newText },
    } as React.ChangeEvent<HTMLTextAreaElement>
    onInputChange(fakeEvent)
    setShowSuggestions(false)
    onMentionAdd(contact)
  }

  const hasContent = inputText.trim() || pastedImage || selectedFile
  const [senderName, setSenderName] = useState<string>("")
  const [senderColor, setSenderColor] = useState<string>("")
  const [loadingSenderName, setLoadingSenderName] = useState<boolean>(false)
  const getContactName = useContactStore(state => state.getContactName)
  const getContactColor = useContactStore(state => state.getContactColor)

  useEffect(() => {
    if (!replyingTo || replyingTo.Info.IsFromMe) {
      setSenderName("")
      setSenderColor("")
      setLoadingSenderName(false)
      return
    }

    const participant = replyingTo.Info.Sender
    if (participant) {
      let mounted = true
      setLoadingSenderName(true)
      getContactName(participant)
        .then((contactName: string) => {
          if (!mounted) return
          if (contactName) setSenderName(contactName)
        })
        .catch(() => {})
        .finally(() => {
          if (!mounted) return
          setLoadingSenderName(false)
        })
      getContactColor(participant)
        .then((color: string) => {
          if (!mounted) return
          if (color) setSenderColor(color)
        })
        .catch(() => {})

      return () => {
        mounted = false
      }
    }
  }, [replyingTo, getContactName, getContactColor])

  useEffect(() => {
    const loadAvatars = async () => {
      const contactsToLoad = mentionSuggestions.filter(
        contact => !(contact.phno in avatarCacheRef.current),
      )

      if (contactsToLoad.length === 0) {
        const cached: Record<string, string> = {}
        for (const contact of mentionSuggestions) {
          cached[contact.phno] = avatarCacheRef.current[contact.phno] || ""
        }
        setMentionAvatars(cached)
        return
      }

      setLoadingAvatars(prev => {
        const next = { ...prev }
        for (const contact of contactsToLoad) {
          next[contact.phno] = true
        }
        return next
      })

      // Load avatars for contacts not in cache
      for (const contact of contactsToLoad) {
        try {
          const userJid = contact.raw_jid
          const avatar = await GetCachedAvatar(userJid, false)
          avatarCacheRef.current[contact.phno] = avatar || ""
        } catch (err) {
          console.error("Failed to load avatar for", contact.phno, err)
          avatarCacheRef.current[contact.phno] = ""
        }
      }

      // Clear loading state
      setLoadingAvatars(prev => {
        const next = { ...prev }
        for (const contact of contactsToLoad) {
          next[contact.phno] = false
        }
        return next
      })

      // Update avatars state from cache
      const updated: Record<string, string> = {}
      for (const contact of mentionSuggestions) {
        updated[contact.phno] = avatarCacheRef.current[contact.phno] || ""
      }
      setMentionAvatars(updated)
    }

    if (mentionSuggestions.length > 0) {
      loadAvatars()
    } else {
      setMentionAvatars({})
    }
  }, [mentionSuggestions])

  const handleEmojiSelect = (emoji: any) => {
    onEmojiClick(emoji.native)
  }

  const renderReplyPreview = () => {
    if (!replyingTo) return null
    const content = replyingTo.Content
    const previewText =
      content?.conversation ||
      content?.extendedTextMessage?.text ||
      (content?.imageMessage ? "📷 Photo" : undefined) ||
      (content?.videoMessage ? "🎥 Video" : undefined) ||
      (content?.audioMessage ? "🎵 Audio" : undefined) ||
      (content?.documentMessage ? "📄 Document" : undefined) ||
      (content?.stickerMessage ? "Sticker" : undefined) ||
      "Message"

    const senderLabel = replyingTo.Info.IsFromMe
      ? "You"
      : senderName || replyingTo.Info.PushName || "Contact"

    return (
      <div className="mb-2 flex items-start gap-2 rounded-md bg-black/5 dark:bg-white/10 p-2 text-xs">
        <div className="flex-1 min-w-0">
          <div
            className="font-semibold flex items-center gap-2"
            style={{ color: replyingTo.Info.IsFromMe ? undefined : senderColor }}
          >
            {loadingSenderName && (
              <span className="w-3 h-3 rounded-full border-2 border-green-600 border-t-transparent animate-spin" />
            )}
            {senderLabel}
          </div>
          <div
            className="line-clamp-2 opacity-80"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewText) }}
          />
        </div>
        <button
          type="button"
          onClick={onCancelReply}
          className={`ml-2 rounded text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white ${FOCUS_RING}`}
          title="Cancel reply"
          aria-label="Cancel reply"
        >
          <CloseIcon />
        </button>
      </div>
    )
  }

  if (disabled) {
    return (
      <div className="mx-3 mb-3 mt-1.5 flex items-center justify-center rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-100/50 dark:bg-gray-800/30 px-4 py-3">
        <span className="text-sm text-light-muted dark:text-dark-muted">
          Only admins can send messages
        </span>
      </div>
    )
  }

  return (
    <div className="relative z-20 mx-3 mb-3 mt-1.5">
      {showEmojiPicker && (
        <div ref={emojiPickerRef} className="absolute bottom-full left-0 z-50 mb-2">
          <Suspense fallback={<div className="p-4 text-sm" role="status">Loading emojis…</div>}>
            <EmojiPicker
              onEmojiSelect={handleEmojiSelect}
              theme="auto"
              previewPosition="none"
              skinTonePosition="search"
            />
          </Suspense>
        </div>
      )}

      {/* Previews (pasted image / attached file / reply) sit in a card above
          the composer pill, like WhatsApp. */}
      {(pastedImage || selectedFile || replyingTo) && (
        <div className="mb-2 rounded-xl border border-gray-200 dark:border-dark-border bg-light-bg p-2 dark:border-transparent dark:bg-dark-secondary">
          {pastedImage && <ImagePreview imageSrc={pastedImage} onRemove={onRemoveFile} />}
          {selectedFile && (
            <FilePreview
              file={selectedFile}
              fileType={selectedFileType}
              onRemove={onRemoveFile}
              gifEnabled={selectedFileType === "gif" || sendAsGif}
              onToggleGif={selectedFileType === "video" ? onToggleSendAsGif : undefined}
            />
          )}
          {renderReplyPreview()}
        </div>
      )}
      {/* Main input row: rounded pill (emoji left, attach right) with the
          send button as a separate circle outside, WhatsApp-style. */}
      <div className="flex items-end gap-2">
        <div className="flex flex-1 items-center rounded-3xl border border-gray-200 bg-white px-2 py-0.5 shadow-sm transition-colors focus-within:border-[#21c063]/70 focus-within:ring-2 focus-within:ring-[#21c063]/20 dark:border-white/10 dark:bg-dark-secondary dark:focus-within:border-[#21c063]/50 dark:focus-within:bg-dark-elevated">
          {/* Emoji Button */}
          <IconButton ref={emojiButtonRef} onClick={onToggleEmojiPicker} title="Emoji">
            <EmojiIcon />
          </IconButton>

          {/* Text Input */}
          <div className="flex-1 bg-transparent rounded-full relative">
            <div
              ref={backdropRef}
              className={clsx(
                "absolute inset-0 w-full p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words pointer-events-none",
                "text-gray-900 dark:text-white",
              )}
              style={{ fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" }}
              aria-hidden="true"
            >
              {renderHighlightedText()}
            </div>
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={handleScroll}
              placeholder="Message"
              aria-label="Message"
              className={clsx(
                "relative z-10 w-full p-2 bg-transparent resize-none outline-none max-h-32",
                "text-transparent caret-green",
                "placeholder:text-gray-600 dark:placeholder:text-gray-400",
                FOCUS_RING,
              )}
              rows={1}
            />
            {/* Mention Suggestions */}
            {showSuggestions && (
              <div
                ref={suggestionsRef}
                role="listbox"
                aria-label="Contact mentions"
                className="absolute bottom-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-40 overflow-y-auto"
              >
                {mentionSuggestions.map(contact => {
                  const avatar = mentionAvatars[contact.phno]
                  const isLoading = loadingAvatars[contact.phno]
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      key={contact.phno}
                      onClick={() => handleSuggestionClick(contact)}
                      className={`w-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center gap-2 text-left ${FOCUS_RING}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden flex items-center justify-center shrink-0">
                        {isLoading ? (
                          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                        ) : avatar ? (
                          <img
                            src={avatar}
                            alt={contact.full_name || contact.push_name || contact.short}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <UserAvatar />
                        )}
                      </div>
                      <span>
                        {contact.full_name || contact.push_name || contact.short || contact.phno}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Attach Button + WhatsApp-style attach menu */}
          <div className="relative">
            <IconButton
              ref={attachButtonRef}
              onClick={() => setAttachMenuOpen(v => !v)}
              title="Attach"
            >
              <AttachIcon />
            </IconButton>
            {attachMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAttachMenuOpen(false)} />
                <div
                  role="menu"
                  aria-label="Attach options"
                  className="absolute bottom-12 right-0 z-50 w-56 rounded-2xl bg-white py-3 shadow-xl dark:bg-dark-elevated border border-gray-100 dark:border-dark-border"
                >
                  {(
                    [
                      {
                        label: "Photos & videos",
                        icon: <PhotosIcon />,
                        color: "text-blue-500",
                        act: () => {
                          setFileAccept("image/*,video/*")
                          setTimeout(() => fileInputRef.current?.click(), 0)
                        },
                      },
                      {
                        label: "Document",
                        icon: <DocumentIcon />,
                        color: "text-[#21c063]",
                        act: async () => {
                          // Use the native GTK picker (no MIME filter) — the
                          // webview input with accept="*/*" offers no
                          // selectable files on some desktops.
                          try {
                            const picked = await PickAttachmentFile()
                            if (!picked?.base64) return
                            const binary = atob(picked.base64)
                            const bytes = new Uint8Array(binary.length)
                            for (let i = 0; i < binary.length; i++) {
                              bytes[i] = binary.charCodeAt(i)
                            }
                            const file = new File([bytes], picked.name, {
                              type: picked.mimetype || "application/octet-stream",
                            })
                            onFileSelect({
                              target: { files: [file] },
                            } as unknown as React.ChangeEvent<HTMLInputElement>)
                          } catch (err) {
                            console.error("Failed to pick file:", err)
                          }
                        },
                      },
                      {
                        label: "Poll",
                        icon: <PollIcon />,
                        color: "text-purple-500",
                        act: () => setPollOpen(true),
                      },
                      {
                        label: "Contact",
                        icon: <ContactIcon />,
                        color: "text-yellow-500",
                        act: () => setContactOpen(true),
                      },
                      {
                        label: "Location",
                        icon: <LocationIcon />,
                        color: "text-red-500",
                        act: () => setLocationOpen(true),
                      },
                    ] as const
                  ).map(item => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAttachMenuOpen(false)
                        item.act()
                      }}
                      className={`w-full px-5 py-2.5 flex items-center gap-4 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/5 ${FOCUS_RING}`}
                    >
                      <span className={clsx("flex items-center justify-center", item.color)}>
                        {item.icon}
                      </span>
                      <span className="text-sm font-medium text-light-text dark:text-dark-text">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileSelect}
            className="hidden"
            accept={fileAccept}
          />
        </div>

        {/* Send Button — separate green circle outside the pill */}
        <button
          type="button"
          onClick={onSendMessage}
          disabled={!hasContent}
          aria-label="Send message"
          className={clsx(
            "mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-200",
            FOCUS_RING,
            hasContent
              ? "bg-[#21c063] hover:scale-105 hover:bg-[#1b9a58] hover:shadow-md active:scale-95"
              : "cursor-not-allowed bg-[#21c063]/40 scale-95 opacity-60",
          )}
        >
          <SendIcon />
        </button>
      </div>

      {pollOpen && <PollDialog chatId={chatId} onClose={() => setPollOpen(false)} />}
      {contactOpen && <ContactShareDialog chatId={chatId} onClose={() => setContactOpen(false)} />}
      {locationOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={event => {
              if (event.target === event.currentTarget) setLocationOpen(false)
            }}
          >
            <div
              ref={locationPanelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={locationTitleId}
              className="w-[360px] max-w-full rounded-xl bg-white p-4 shadow-xl dark:bg-dark-secondary"
              onClick={event => event.stopPropagation()}
            >
              <h2
                id={locationTitleId}
                className="mb-3 text-lg font-medium text-gray-900 dark:text-gray-100"
              >
                Send location
              </h2>
              <p className="mb-3 text-sm text-gray-600 dark:text-[#8696a0]">
                Share your current location or enter coordinates.
              </p>
              <label htmlFor="location-lat" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                Latitude
              </label>
              <input
                id="location-lat"
                ref={locationLatRef}
                inputMode="decimal"
                className="mb-2 w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-600 focus:border-[#21c063] focus-visible:ring-2 focus-visible:ring-[#21c063]/50 dark:placeholder:text-gray-400 dark:focus:border-[#21c063] text-gray-900 dark:text-gray-100"
                placeholder="Latitude (e.g. 37.7749)"
                value={latInput}
                onChange={event => {
                  setLatInput(event.target.value)
                  setLocationError("")
                }}
              />
              <label htmlFor="location-lng" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                Longitude
              </label>
              <input
                id="location-lng"
                inputMode="decimal"
                className="mb-2 w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-600 focus:border-[#21c063] focus-visible:ring-2 focus-visible:ring-[#21c063]/50 dark:placeholder:text-gray-400 dark:focus:border-[#21c063] text-gray-900 dark:text-gray-100"
                placeholder="Longitude (e.g. -122.4194)"
                value={lngInput}
                onChange={event => {
                  setLngInput(event.target.value)
                  setLocationError("")
                }}
              />
              <label htmlFor="location-place" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                Place name (optional)
              </label>
              <input
                id="location-place"
                className="mb-3 w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-gray-600 focus:border-[#21c063] focus-visible:ring-2 focus-visible:ring-[#21c063]/50 dark:placeholder:text-gray-400 dark:focus:border-[#21c063] text-gray-900 dark:text-gray-100"
                placeholder="Place name (optional)"
                value={placeName}
                onChange={event => setPlaceName(event.target.value)}
              />
              {locationError && (
                <p role="alert" className="mb-2 text-xs text-[#b42318] dark:text-[#fca5a5]">
                  {locationError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setLocationOpen(false)}
                  className={`rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5 ${FOCUS_RING}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const lat = parseFloat(latInput)
                    const lng = parseFloat(lngInput)
                    if (isNaN(lat) || isNaN(lng)) {
                      setLocationError("Enter a valid latitude and longitude.")
                      return
                    }
                    setLocationSending(true)
                    setLocationError("")
                    try {
                      await SendLocation(chatId, lat, lng, placeName.trim())
                      setLocationOpen(false)
                    } catch (err) {
                      console.error("Send location failed:", err)
                      setLocationError("Location could not be sent. Please try again.")
                      addNotification("Location could not be sent. Please try again.", {
                        tone: "error",
                      })
                    } finally {
                      setLocationSending(false)
                    }
                  }}
                  disabled={locationSending || isNaN(parseFloat(latInput)) || isNaN(parseFloat(lngInput))}
                  aria-busy={locationSending}
                  className={`rounded-lg bg-[#21c063] px-4 py-2 text-sm font-medium text-[#0a1014] transition-colors hover:bg-[#1ea952] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                  {locationSending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
