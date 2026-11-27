import { useEffect, useMemo, useState } from "react"
import { GetProfile } from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import type { PinnedMessage } from "../../../bindings/github.com/lugvitc/amazingwhats/internal/store/models.js"
import { useContactStore } from "../../store/useContactStore"
import { formatPhone, phoneFromJID } from "../../lib/utils"

interface PinnedMessageBannerProps {
  chatId: string
  pins: PinnedMessage[]
  onJump: (messageId: string) => void
}

/**
 * The stored pin text is parsed HTML (see MessageStore.InsertMessage). A slim
 * banner wants a single-line plain-text preview, so flatten it safely — no
 * dangerouslySetInnerHTML in this control.
 */
function plainPreview(html: string): string {
  if (!html) return ""
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html")
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim()
  }
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

// A pin stores the sender as info.Sender.String(). Own messages carry our own
// JID/phone, so compare against the real profile rather than guessing from an
// empty value. Phone identities can appear as either a bare number or a JID.
function isSelf(jid: string, selfJid: string, selfPhno: string): boolean {
  if (!jid) return true
  const digits = (value: string) => value.replace(/\D/g, "")
  const jidDigits = digits(jid)
  return (
    jid === selfJid ||
    (!!jidDigits &&
      ((!!selfJid && jidDigits === digits(selfJid)) ||
        (!!selfPhno && jidDigits === digits(selfPhno))))
  )
}

/**
 * WhatsApp-style pinned-message subheader. Sits directly under ChatHeader,
 * above the scrollable list. Everything shown comes from the real
 * GetPinnedMessages binding (message_id / sender_jid / text) plus the contact
 * store — nothing is fabricated. With several pins it shows the most recent
 * one and an honest count (matching the "latest / small count" convention).
 */
export function PinnedMessageBanner({ chatId, pins, onJump }: PinnedMessageBannerProps) {
  // GetPinnedMessages returns pins oldest-first (pinned_at ASC).
  const pinsByNewest = useMemo(
    () => [...pins].sort((a, b) => (b.pinned_at || 0) - (a.pinned_at || 0)),
    [pins],
  )
  const count = pinsByNewest.length
  const target = count > 0 ? pinsByNewest[0] : null

  const getContactName = useContactStore(state => state.getContactName)
  const [selfJid, setSelfJid] = useState("")
  const [selfPhno, setSelfPhno] = useState("")
  const [senderName, setSenderName] = useState("")

  useEffect(() => {
    let alive = true
    GetProfile("")
      .then(profile => {
        if (!alive) return
        setSelfJid(profile?.jid || "")
        setSelfPhno(profile?.phno || "")
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const senderJid = target?.sender_jid || ""
  useEffect(() => {
    let alive = true
    setSenderName("")
    if (!target) return
    if (isSelf(senderJid, selfJid, selfPhno)) {
      setSenderName("You")
      return
    }
    void getContactName(senderJid).then(name => {
      if (!alive) return
      const digits = phoneFromJID(senderJid)
      setSenderName(
        name || (digits ? formatPhone(digits) : senderJid.split("@")[0]) || "Unknown sender",
      )
    })
    return () => {
      alive = false
    }
  }, [target, senderJid, selfJid, selfPhno, getContactName, chatId])

  if (!target) return null

  const preview = plainPreview(target.text || "") || "Pinned message"
  const label =
    count > 1
      ? `Pinned messages, ${count} total. Jump to the latest, from ${senderName}: ${preview}.`
      : `Pinned message from ${senderName}: ${preview}. Activate to jump to it.`

  return (
    <button
      type="button"
      onClick={() => onJump(target.message_id)}
      aria-label={label}
      className="flex w-full items-center gap-2 border-b border-gray-200 bg-light-secondary px-4 py-2 text-left text-sm cursor-pointer hover:bg-gray-100 dark:border-dark-border dark:bg-dark-bg dark:hover:bg-white/5"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        className="shrink-0 fill-current text-green-dark dark:text-green"
        aria-hidden="true"
      >
        <path d="M16 3a1 1 0 0 1 .95 1.31l-.9 2.72 3.42 3.42a1 1 0 0 1-.21 1.57l-3.62 2.07-1.9 4.75a1 1 0 0 1-1.64.33L9 16.07l-4.29 4.3-1.42-1.42 4.3-4.29-3.1-3.1a1 1 0 0 1 .33-1.64l4.75-1.9 2.07-3.62A1 1 0 0 1 12.5 4z" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200">
        <span className="font-semibold text-gray-800 dark:text-gray-100">{senderName}</span>
        <span className="text-muted-subtle dark:text-dark-muted">: {preview}</span>
      </span>
      {count > 1 && (
        <span
          className="shrink-0 rounded-full bg-gray-200/70 px-1.5 py-px text-[11px] font-medium text-gray-600 dark:bg-white/10 dark:text-dark-muted"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  )
}
