import { useCallback, useEffect, useRef, useState } from "react"
import {
  BlockContact,
  DemoteGroupParticipants,
  GetBlockList,
  GetCachedAvatar,
  GetContact,
  GetGroupInfo,
  GetMyJID,
  GetProfile,
  GetUserInfo,
  MakeCall,
  PromoteGroupParticipants,
  RemoveGroupParticipants,
  UnblockContact,
} from "../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import type * as types from "../../bindings/go.mau.fi/whatsmeow/types/models.js"
import { useChatStore, useUIStore } from "../store"
import type { ChatItem } from "../store/types"
import { userPart } from "../lib/self"
import { phoneFromJID } from "../lib/utils"

export type ContactActionKey =
  "message" | "voice" | "profile" | "copy" | "block" | "promote" | "demote" | "remove"

/** Viewport-space rect of the control that opened the sheet. */
export interface AnchorRect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface ContactActionTarget {
  /** PN-canonical JID for contact actions (message, call, block, profile). */
  jid: string
  /** Primary participant JID (often an LID) — used ONLY for group admin RPCs. */
  actionJid?: string
  displayName: string
  phone?: string
  avatarUrl?: string
  /** Set when the target was opened from a group, for admin action lookup. */
  groupJid?: string
  participantIsAdmin?: boolean
  /** Viewer is an admin and the target is somebody else. */
  canManage?: boolean
  /** Refreshes Group Info after a successful admin mutation. */
  onGroupChanged?: () => void
  anchor?: AnchorRect
}

export interface ContactProfilePreview {
  name: string
  phone: string
  about?: string
  verifiedName?: string
  devices?: number
}

export interface UseContactActionsResult {
  target: ContactActionTarget | null
  busyAction: ContactActionKey | null
  blocked: boolean
  profile: ContactProfilePreview | null
  profileBusy: boolean
  avatarUrl: string | null
  openContactActions: (target: ContactActionTarget, anchor?: HTMLElement | null) => void
  closeContactActions: () => void
  startMessage: () => Promise<void>
  voiceCall: () => Promise<void>
  viewProfile: () => Promise<void>
  copyNumber: () => Promise<void>
  toggleBlock: () => Promise<void>
  promote: () => Promise<void>
  demote: () => Promise<void>
  remove: () => Promise<void>
}

const cleanName = (value: string) => value.replace(/^~\s*/, "").trim()

const digitsOnly = (value: string) => value.replace(/[^\d+]/g, "")

/** Skip binding calls for empty/placeholder identifiers during resync. */
const hasUsableJid = (value: string | null | undefined): value is string =>
  !!value && value.trim().length > 0 && value.trim() !== "@s.whatsapp.net"

/** Never surface raw backend throttling text to the user. */
const isRateLimitError = (error: unknown): boolean =>
  !!error &&
  /rate-overlimit|status 429/i.test(error instanceof Error ? error.message : String(error))

/**
 * Owns the target and every real contact action behind the popup. Callbacks are
 * referentially stable because MessageItem is memoized and the sheet is mounted
 * once for the whole conversation. Backend error text is logged only; the UI
 * always receives a short, sanitised message.
 */
export function useContactActions(): UseContactActionsResult {
  const [target, setTarget] = useState<ContactActionTarget | null>(null)
  const [busyAction, setBusyAction] = useState<ContactActionKey | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [profile, setProfile] = useState<ContactProfilePreview | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  const addNotification = useUIStore(s => s.addNotification)
  const targetRef = useRef<ContactActionTarget | null>(null)
  const resolvedJidRef = useRef("")
  const blockedRef = useRef(false)
  const openSeqRef = useRef(0)
  const busyRef = useRef(false)

  useEffect(
    () => () => {
      openSeqRef.current += 1
    },
    [],
  )

  const closeContactActions = useCallback(() => {
    openSeqRef.current += 1
    targetRef.current = null
    resolvedJidRef.current = ""
    blockedRef.current = false
    busyRef.current = false
    setTarget(null)
    setBusyAction(null)
    setBlocked(false)
    setProfile(null)
    setProfileBusy(false)
    setAvatarUrl(null)
  }, [])

  const reportError = useCallback(
    (message: string, error?: unknown) => {
      // 429s are already served as benign cached/empty results by the backend.
      // If one still reaches here, stay silent rather than toast raw text.
      if (isRateLimitError(error)) return
      if (error !== undefined) console.error(message, error)
      addNotification(message, { tone: "error", durationMs: 6000 })
    },
    [addNotification],
  )

  const openContactActions = useCallback(
    (next: ContactActionTarget, anchor?: HTMLElement | null) => {
      const seq = ++openSeqRef.current
      const rect = anchor?.getBoundingClientRect()
      const anchorRect: AnchorRect | undefined = rect
        ? {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }
        : undefined

      const initial: ContactActionTarget = { ...next, anchor: anchorRect }
      targetRef.current = initial
      resolvedJidRef.current = next.jid
      blockedRef.current = false
      setTarget(initial)
      setBlocked(false)
      setProfile(null)
      setProfileBusy(false)
      setAvatarUrl(next.avatarUrl || null)

      void (async () => {
        let jid = next.jid
        let phone = next.phone || ""
        let name = next.displayName
        let patch: Partial<ContactActionTarget> = {}

        // A group message sender can be an LID. Resolve the PN-canonical JID
        // once so every contact action addresses the same identity.
        // Empty/placeholder JIDs are skipped: expected during resync.
        if (hasUsableJid(next.jid)) {
          try {
            const contact = await GetContact(next.jid as unknown as types.JID)
            if (seq !== openSeqRef.current) return
            if (contact?.jid) {
              jid = contact.jid
              resolvedJidRef.current = jid
            }
            if (contact) {
              if (!phone) phone = contact.phno || ""
              if (!name || name === phoneFromJID(next.jid) || name.startsWith("~")) {
                name =
                  contact.full_name || (contact.push_name ? `~ ${contact.push_name}` : name) || name
              }
              patch = {
                jid,
                phone: phone || undefined,
                displayName: cleanName(name) || next.displayName,
              }
            }
          } catch (error) {
            if (!isRateLimitError(error)) console.error("Contact lookup failed:", error)
          }
        }

        // Message-sender opens carry no admin metadata. Look it up from the
        // group so Promote/Demote/Remove only appear when they are real.
        if (next.groupJid && next.canManage === undefined) {
          const [info, myJid] = await Promise.all([
            GetGroupInfo(next.groupJid).catch(() => null),
            GetMyJID().catch(() => ""),
          ])
          if (seq !== openSeqRef.current) return
          const participants: any[] = info?.group_participants ?? []
          const senderPart = userPart(next.jid)
          const participant = participants.find(
            (p: any) =>
              p?.action_jid === next.jid ||
              p?.contact?.jid === next.jid ||
              (!!phone && p?.contact?.phno === phone) ||
              (!!senderPart && userPart(p?.action_jid || "") === senderPart) ||
              (!!senderPart && userPart(p?.contact?.jid || "") === senderPart),
          )
          const mePart = userPart(myJid)
          const me = participants.find(
            (p: any) =>
              !!mePart &&
              userPart(p?.contact?.jid || p?.action_jid || "") === mePart &&
              !!p?.is_admin,
          )
          const targetPart = userPart(participant?.contact?.jid || participant?.action_jid || "")
          patch = {
            ...patch,
            actionJid: participant?.action_jid || participant?.contact?.jid || undefined,
            participantIsAdmin: !!participant?.is_admin,
            canManage: !!me && !!participant && !!targetPart && targetPart !== mePart,
            onGroupChanged: undefined,
          }
        }

        if (Object.keys(patch).length > 0 && targetRef.current) {
          // Keep the ref in step with state: the stable action callbacks read
          // the ref, so admin capability and action_jid must land in both.
          const merged = { ...targetRef.current, ...patch }
          targetRef.current = merged
          setTarget(merged)
        }

        const list = await GetBlockList().catch(() => [])
        if (seq !== openSeqRef.current) return
        const isBlocked = !!list?.some(
          (b: any) => b.jid === jid || userPart(b.jid) === userPart(jid),
        )
        blockedRef.current = isBlocked
        setBlocked(isBlocked)

        if (!next.avatarUrl) {
          const url = await GetCachedAvatar(jid, false).catch(() => "")
          if (seq !== openSeqRef.current) return
          setAvatarUrl(url || null)
        }
      })()
    },
    [],
  )

  const runAction = useCallback(async (key: ContactActionKey, work: () => Promise<void>) => {
    if (busyRef.current || !targetRef.current) return
    busyRef.current = true
    setBusyAction(key)
    try {
      await work()
    } finally {
      busyRef.current = false
      setBusyAction(null)
    }
  }, [])

  const startMessage = useCallback(async () => {
    const target = targetRef.current
    if (!target) return
    await runAction("message", async () => {
      try {
        const contact = hasUsableJid(target.jid)
          ? await GetContact(target.jid as unknown as types.JID).catch(() => null)
          : null
        const jid = contact?.jid || resolvedJidRef.current || target.jid
        const state = useChatStore.getState()
        const existing = state.getChat(jid)
        const name =
          existing?.name ||
          contact?.full_name ||
          (contact?.push_name ? `~ ${contact.push_name}` : "") ||
          cleanName(target.displayName) ||
          phoneFromJID(jid) ||
          jid
        const chat: ChatItem = {
          id: jid,
          name,
          subtitle: "",
          type: "contact",
          avatar: existing?.avatar || contact?.avatar_url || undefined,
        }
        state.selectChat(chat)
        useUIStore.getState().setChatInfoOpen(false)
        closeContactActions()
      } catch (error) {
        reportError("Couldn't open the chat. Please try again.", error)
      }
    })
  }, [closeContactActions, reportError, runAction])

  const voiceCall = useCallback(async () => {
    const target = targetRef.current
    if (!target) return
    await runAction("voice", async () => {
      try {
        const contact = hasUsableJid(target.jid)
          ? await GetContact(target.jid as unknown as types.JID).catch(() => null)
          : null
        const jid = contact?.jid || resolvedJidRef.current || target.jid
        await MakeCall(jid)
        closeContactActions()
      } catch (error) {
        reportError("Couldn't start the call. Please try again.", error)
      }
    })
  }, [closeContactActions, reportError, runAction])

  const viewProfile = useCallback(async () => {
    const target = targetRef.current
    if (!target) return
    const seq = openSeqRef.current
    await runAction("profile", async () => {
      const jid = resolvedJidRef.current || target.jid
      setProfileBusy(true)
      try {
        const query = digitsOnly(target.phone || phoneFromJID(jid)) || jid
        // One batched lookup per profile open; the backend dedupes/caches
        // repeated JIDs so a burst of opens cannot trigger a 429.
        const [contact, infos] = await Promise.all([
          hasUsableJid(jid) ? GetProfile(jid).catch(() => null) : null,
          hasUsableJid(query) ? GetUserInfo([query]).catch(() => []) : [],
        ])
        if (seq !== openSeqRef.current) return
        const info = infos?.[0]
        setProfile({
          name: contact?.full_name || cleanName(target.displayName) || info?.jid || jid,
          phone: contact?.phno || target.phone || "",
          about: info?.status,
          verifiedName: info?.verified_name,
          devices: info?.devices?.length,
        })
      } catch (error) {
        reportError("Couldn't load the profile. Please try again.", error)
      } finally {
        setProfileBusy(false)
      }
    })
  }, [reportError, runAction])

  const copyNumber = useCallback(async () => {
    const target = targetRef.current
    if (!target) return
    await runAction("copy", async () => {
      try {
        const contact = hasUsableJid(target.jid)
          ? await GetContact(target.jid as unknown as types.JID).catch(() => null)
          : null
        const number = digitsOnly(
          contact?.phno || target.phone || phoneFromJID(resolvedJidRef.current || target.jid) || "",
        )
        if (!number) {
          addNotification("No phone number is available for this contact.", {
            tone: "warning",
            durationMs: 4000,
          })
          return
        }
        await navigator.clipboard.writeText(number)
        addNotification("Number copied", { tone: "success", durationMs: 3000 })
        closeContactActions()
      } catch (error) {
        reportError("Couldn't copy the number. Please try again.", error)
      }
    })
  }, [addNotification, closeContactActions, reportError, runAction])

  const toggleBlock = useCallback(async () => {
    if (!targetRef.current) return
    await runAction("block", async () => {
      const jid = resolvedJidRef.current || targetRef.current?.jid
      if (!jid) return
      const wasBlocked = blockedRef.current
      try {
        if (wasBlocked) await UnblockContact(jid)
        else await BlockContact(jid)
        blockedRef.current = !wasBlocked
        setBlocked(!wasBlocked)
        addNotification(wasBlocked ? "Contact unblocked" : "Contact blocked", {
          tone: "success",
          durationMs: 4000,
        })
      } catch (error) {
        reportError(
          wasBlocked
            ? "Couldn't unblock this contact. Please try again."
            : "Couldn't block this contact. Please try again.",
          error,
        )
      }
    })
  }, [addNotification, reportError, runAction])

  const runGroupAction = useCallback(
    async (
      key: "promote" | "demote" | "remove",
      call: (groupJid: string, participantJid: string) => Promise<void>,
      successMessage: string,
      failureMessage: string,
    ) => {
      const target = targetRef.current
      if (!target?.groupJid || !target.canManage) return
      // Admin RPCs must use action_jid (often an LID), never the PN used for
      // contact actions.
      const actionJid = target.actionJid || target.jid
      await runAction(key, async () => {
        try {
          await call(target.groupJid!, actionJid)
          if (target.onGroupChanged) {
            target.onGroupChanged()
          } else {
            // Message-sender opens have no local reload callback. Let an open
            // Group Info panel refresh itself through the shared event.
            window.dispatchEvent(
              new CustomEvent("wa:contact-action-group-changed", { detail: target.groupJid }),
            )
          }
          addNotification(successMessage, { tone: "success", durationMs: 4000 })
          closeContactActions()
        } catch (error) {
          reportError(failureMessage, error)
        }
      })
    },
    [addNotification, closeContactActions, reportError, runAction],
  )

  const promote = useCallback(
    async () =>
      runGroupAction(
        "promote",
        // The binding takes a list; a click always targets one participant.
        async (groupId, jid) => {
          await PromoteGroupParticipants(groupId, [jid])
        },
        "Member promoted to admin",
        "Couldn't promote this member. Please try again.",
      ),
    [runGroupAction],
  )

  const demote = useCallback(
    async () =>
      runGroupAction(
        "demote",
        async (groupId, jid) => {
          await DemoteGroupParticipants(groupId, [jid])
        },
        "Admin rights removed",
        "Couldn't demote this admin. Please try again.",
      ),
    [runGroupAction],
  )

  const remove = useCallback(async () => {
    const target = targetRef.current
    if (!target?.groupJid || !target.canManage) return
    const label = cleanName(target.displayName) || "this member"
    // Matches the existing inline Remove button's confirmation step.
    if (!window.confirm(`Remove ${label} from the group?`)) return
    await runGroupAction(
      "remove",
      async (groupId, jid) => {
        await RemoveGroupParticipants(groupId, [jid])
      },
      "Member removed from the group",
      "Couldn't remove this member. Please try again.",
    )
  }, [runGroupAction])

  return {
    target,
    busyAction,
    blocked,
    profile,
    profileBusy,
    avatarUrl,
    openContactActions,
    closeContactActions,
    startMessage,
    voiceCall,
    viewProfile,
    copyNumber,
    toggleBlock,
    promote,
    demote,
    remove,
  }
}
