import { useEffect, useState, useCallback, useRef } from "react"
import { UserAvatar } from "../../assets/svgs/chat_icons"
import { useMediaHubStore } from "../../store/useMediaHubStore"
import {
  Mediaicon,
  BlockIcon,
  ExitGroupIcon,
  MuteIcon,
  DisappearingMessagesIcon,
  ReportIcon,
} from "../../assets/svgs/chat_info_icons"
import {
  GetProfile,
  GetGroupInfo,
  IsChatMuted,
  ToggleChatMute,
  BlockContact,
  UnblockContact,
  LeaveGroup,
  GetBlockList,
  SetDisappearingTimer,
  SetGroupName,
  GetGroupInviteLink,
  ClearChat,
  GetBusinessProfile,
  SetGroupPhoto,
  RemoveGroupParticipants,
  PromoteGroupParticipants,
  DemoteGroupParticipants,
  SetGroupAnnounce,
  SetGroupLocked,
  GetMyJID,
  SetGroupDescription,
  SetGroupMemberAddMode,
  SetGroupJoinApprovalMode,
  GetGroupJoinRequests,
  ApproveGroupJoinRequest,
  RejectGroupJoinRequest,
  LinkGroupToCommunity,
  UnlinkGroupFromCommunity,
  GetCommunityList,
  IsOnWhatsApp,
  AddGroupParticipants,
  FetchContacts,
  GetDisappearingTimer,
  GetUserInfo,
  GetNewsletterInfo,
  NewsletterToggleMute,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import * as api from "../../../bindings/github.com/lugvitc/whats4linux/api/models.js"
import { EventsOn } from "../../lib/wailsRuntime"
import { userPart } from "../../lib/self"
import { GoBackIcon } from "../../assets/svgs/header_icons"
import ToggleButton from "../settings/ToggleButton"
import { useMuteStore } from "../../store/useMuteStore"
import { InviteLinkDialog } from "./InviteLinkDialog"
import type { ContactActionTarget } from "../../hooks/useContactActions"

/**
 * Accessible on/off control for group settings. A real button keeps Enter and
 * Space working, while role="switch" communicates the state to assistive tech.
 * The 44×24px track is the minimum comfortable hit area.
 */
function SettingsSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-green" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  )
}

interface ChatInfoProps {
  chatId: string
  chatName: string
  chatType: "group" | "contact"
  chatAvatar?: string
  isOpen: boolean
  onClose: () => void
  onContactAction?: (target: ContactActionTarget, anchor?: HTMLElement | null) => void
}

export function ChatInfo({
  chatId,
  chatName,
  chatType,
  chatAvatar,
  isOpen,
  onClose,
  onContactAction,
}: ChatInfoProps) {
  const [contactInfo, setContactInfo] = useState<api.Contact | null>(null)
  const [groupInfo, setGroupInfo] = useState<api.Group | null>(null)
  const [businessInfo, setBusinessInfo] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAllParticipants, setShowAllParticipants] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [muteBusy, setMuteBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [disappearTimer, setDisappearTimer] = useState(0)
  const [showDisappearPicker, setShowDisappearPicker] = useState(false)
  const [subjectEdit, setSubjectEdit] = useState(false)
  const [subjectDraft, setSubjectDraft] = useState("")
  const [inviteLink, setInviteLink] = useState("")
  const [inviteBusy, setInviteBusy] = useState(false)
  const [showJoinDialog, setShowJoinDialog] = useState(false)
  const [myJid, setMyJid] = useState("")
  const [isAdmin, setIsAdmin] = useState(false)
  const [groupLocked, setGroupLocked] = useState(false)
  const [groupAnnounce, setGroupAnnounce] = useState(false)
  const [participantBusy, setParticipantBusy] = useState<string | null>(null)
  const [topicEdit, setTopicEdit] = useState(false)
  const [topicDraft, setTopicDraft] = useState("")
  const [memberAddMode, setMemberAddMode] = useState("all_member_add")
  const [joinApproval, setJoinApproval] = useState(false)
  const [joinRequests, setJoinRequests] = useState<any[]>([])
  const [showJoinRequests, setShowJoinRequests] = useState(false)
  const [joinReqBusy, setJoinReqBusy] = useState(false)
  const [communities, setCommunities] = useState<any[]>([])
  const [showLinkCommunity, setShowLinkCommunity] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [waCheck, setWaCheck] = useState<{ onWhatsApp: boolean; verifiedName?: string } | null>(
    null,
  )
  const [checkBusy, setCheckBusy] = useState(false)
  const [userInfo, setUserInfo] = useState<{
    jid: string
    status?: string
    picture_id?: string
    devices?: string[]
    verified_name?: string
  } | null>(null)
  const [userInfoBusy, setUserInfoBusy] = useState(false)
  const [linkError, setLinkError] = useState("")
  const [showAddParticipant, setShowAddParticipant] = useState(false)
  const [addSearch, setAddSearch] = useState("")
  const [addResults, setAddResults] = useState<any[]>([])
  const [addBusy, setAddBusy] = useState(false)
  const [newsletterInfo, setNewsletterInfo] = useState<{
    name?: string
    description?: string
    muted?: boolean
  } | null>(null)
  // Seeded from the server-provided ViewerMeta.Mute value, never fabricated.
  const [newsletterMuted, setNewsletterMuted] = useState(false)
  const MAX_VISIBLE = 10

  const DISAPPEAR_OPTIONS = [
    { value: 0, label: "Off" },
    { value: 86400, label: "24 hours" },
    { value: 604800, label: "7 days" },
    { value: 7776000, label: "90 days" },
  ]

  const DISAPPEAR_LABEL: Record<number, string> = {
    0: "Off",
    86400: "24 hours",
    604800: "7 days",
    7776000: "90 days",
  }

  useEffect(() => {
    if (isOpen) {
      setShowAllParticipants(false)
      if (chatType === "contact") {
        GetBlockList()
          .then(list => {
            const isBlocked = list?.some((b: any) => b.jid === chatId) ?? false
            setBlocked(isBlocked)
          })
          .catch(() => {})
      }
    }
  }, [isOpen, chatId, chatType])

  // Load mute state when the panel opens and keep it fresh via runtime events.
  useEffect(() => {
    if (!isOpen || !chatId) return

    let cancelled = false

    IsChatMuted(chatId)
      .then(isMuted => {
        if (cancelled) return
        setMutedState(!!isMuted)
        // Teach the chat-list store lazily so rows show the muted bell.
        useMuteStore.getState().setMuted(chatId, !!isMuted)
      })
      .catch(err => {
        console.error("Failed to load mute state:", err)
      })

    const unsub = EventsOn("wa:chat_mute_update", (data: { chatId: string; muted: boolean }) => {
      if (data?.chatId === chatId) {
        setMutedState(!!data.muted)
      }
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [isOpen, chatId])

  // Load disappearing timer value when panel opens
  useEffect(() => {
    if (!isOpen) return
    GetDisappearingTimer(chatId)
      .then(seconds => {
        setDisappearTimer(seconds)
      })
      .catch(() => {})
  }, [isOpen, chatId])

  // Load newsletter info for newsletter chats
  useEffect(() => {
    if (!isOpen || !chatId.endsWith("@newsletter")) return
    let cancelled = false
    GetNewsletterInfo(chatId)
      .then(info => {
        if (cancelled) return
        setNewsletterInfo(info)
        // The generated bindings may not yet expose the new `muted` field;
        // read it defensively and fall back to unmuted only when it is absent.
        setNewsletterMuted(!!(info as any)?.muted)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isOpen, chatId])

  const handleToggleMute = useCallback(async () => {
    if (muteBusy) return
    const next = !muted

    // Optimistic update (panel + chat-list store), revert on failure.
    setMuteBusy(true)
    setMutedState(next)
    useMuteStore.getState().setMuted(chatId, next)
    try {
      await ToggleChatMute(chatId, next)
    } catch (err) {
      console.error("Failed to toggle chat mute:", err)
      setMutedState(!next)
      useMuteStore.getState().setMuted(chatId, !next)
    } finally {
      setMuteBusy(false)
    }
  }, [chatId, muted, muteBusy])

  const handleDisappearChange = async (seconds: number) => {
    setActionBusy(true)
    try {
      await SetDisappearingTimer(chatId, seconds)
      setDisappearTimer(seconds)
      setShowDisappearPicker(false)
    } catch (e) {
      console.error("Failed to set disappearing timer:", e)
    } finally {
      setActionBusy(false)
    }
  }

  const handleCopyInviteLink = async () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink)
      return
    }
    setInviteBusy(true)
    try {
      const link = await GetGroupInviteLink(chatId)
      setInviteLink(link)
      navigator.clipboard.writeText(link)
    } catch (e) {
      console.error("Failed to get invite link:", e)
    } finally {
      setInviteBusy(false)
    }
  }

  const handleSaveSubject = async () => {
    const name = subjectDraft.trim()
    if (!name) return
    setActionBusy(true)
    try {
      await SetGroupName(chatId, name)
      if (groupInfo) setGroupInfo({ ...groupInfo, group_name: name } as api.Group)
      setSubjectEdit(false)
    } catch (e) {
      console.error("Failed to set group name:", e)
    } finally {
      setActionBusy(false)
    }
  }

  const initialLoadDone = useRef(false)

  const loadInfo = useCallback(async () => {
    setLoading(true)
    try {
      if (chatType === "group") {
        const info = await GetGroupInfo(chatId)
        setGroupInfo(info)
      } else {
        const info = await GetProfile(chatId)
        setContactInfo(info)
        // The backend returns an empty map for missing/non-business/rate-limited
        // profiles, so no per-call try/catch (and no raw binding error) is needed.
        if (chatId) {
          const biz = await GetBusinessProfile(chatId)
          if (biz && Object.keys(biz).length > 0) setBusinessInfo(biz)
        }
      }
    } catch (err) {
      console.error("Failed to load chat info:", err)
    } finally {
      setLoading(false)
      initialLoadDone.current = true
    }
  }, [chatId, chatType])

  useEffect(() => {
    if (isOpen) {
      loadInfo()
    }
  }, [isOpen, loadInfo])

  // Admin actions taken from a sender popup have no local reload callback.
  // Refresh this panel when the hook reports a mutation for this group.
  useEffect(() => {
    if (!isOpen || chatType !== "group") return
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== chatId) return
      loadInfo()
    }
    window.addEventListener("wa:contact-action-group-changed", onChanged)
    return () => window.removeEventListener("wa:contact-action-group-changed", onChanged)
  }, [isOpen, chatType, chatId, loadInfo])

  useEffect(() => {
    GetMyJID()
      // GetMyJID returns only the phone part; keep whatever the backend gives
      // us and compare user parts on both sides below.
      .then(jid => setMyJid(userPart(jid)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!myJid || !groupInfo) return
    const me = groupInfo.group_participants?.find(p => userPart(p.contact.jid) === userPart(myJid))
    setIsAdmin(me?.is_admin ?? false)
  }, [myJid, groupInfo])

  useEffect(() => {
    if (groupInfo) {
      setGroupAnnounce(groupInfo.is_group_announce)
      setGroupLocked(groupInfo.is_group_lock)
      if (groupInfo.member_add_mode) setMemberAddMode(groupInfo.member_add_mode)
      if (groupInfo.join_approval !== undefined) setJoinApproval(groupInfo.join_approval)
    }
  }, [groupInfo])

  // Load communities when opening group info (for link/unlink)
  useEffect(() => {
    if (!isOpen || chatType !== "group") return
    GetCommunityList()
      .then(list => {
        setCommunities(prev => {
          const prevMap = new Map(prev.map(c => [c.jid, c]))
          return list.map(c => ({
            ...c,
            avatar_url: prevMap.get(c.jid)?.avatar_url || c.avatar_url,
          }))
        })
      })
      .catch(() => {})
  }, [isOpen, chatType])

  const handleSaveTopic = async () => {
    const text = topicDraft.trim()
    if (!text) return
    setActionBusy(true)
    try {
      await SetGroupDescription(chatId, text)
      if (groupInfo) setGroupInfo({ ...groupInfo, group_topic: text } as api.Group)
      setTopicEdit(false)
    } catch (e) {
      console.error("Failed to set group topic:", e)
    } finally {
      setActionBusy(false)
    }
  }

  const handleToggleMemberAddMode = async () => {
    const next = memberAddMode === "admin_add" ? "all_member_add" : "admin_add"
    setMemberAddMode(next)
    try {
      await SetGroupMemberAddMode(chatId, next)
    } catch (e) {
      console.error("Failed to set member add mode:", e)
      setMemberAddMode(memberAddMode)
    }
  }

  const handleToggleJoinApproval = async () => {
    const next = !joinApproval
    setJoinApproval(next)
    try {
      await SetGroupJoinApprovalMode(chatId, next)
    } catch (e) {
      console.error("Failed to set join approval:", e)
      setJoinApproval(!next)
    }
  }

  const handleLoadJoinRequests = async () => {
    setJoinReqBusy(true)
    try {
      const reqs = await GetGroupJoinRequests(chatId)
      setJoinRequests(reqs)
      setShowJoinRequests(true)
    } catch (e) {
      console.error("Failed to load join requests:", e)
    } finally {
      setJoinReqBusy(false)
    }
  }

  const handleApproveJoinRequest = async (requesterJID: string) => {
    try {
      await ApproveGroupJoinRequest(chatId, [requesterJID])
      setJoinRequests(prev => prev.filter(r => r.jid !== requesterJID))
      loadInfo()
    } catch (e) {
      console.error("Failed to approve join request:", e)
    }
  }

  const handleRejectJoinRequest = async (requesterJID: string) => {
    try {
      await RejectGroupJoinRequest(chatId, [requesterJID])
      setJoinRequests(prev => prev.filter(r => r.jid !== requesterJID))
    } catch (e) {
      console.error("Failed to reject join request:", e)
    }
  }

  const handleLinkCommunity = async (parentJID: string) => {
    setLinkBusy(true)
    setLinkError("")
    try {
      await LinkGroupToCommunity(parentJID, chatId)
      setShowLinkCommunity(false)
      setGroupInfo(null)
      loadInfo()
      GetCommunityList()
        .then(setCommunities)
        .catch(() => {})
    } catch (e) {
      setLinkError(String(e))
    } finally {
      setLinkBusy(false)
    }
  }

  const handleUnlinkCommunity = async (parentJID: string) => {
    if (!confirm("Unlink this group from its community?")) return
    setLinkBusy(true)
    setLinkError("")
    try {
      await UnlinkGroupFromCommunity(parentJID, chatId)
      setGroupInfo(null)
      loadInfo()
    } catch (e) {
      setLinkError(String(e))
    } finally {
      setLinkBusy(false)
    }
  }

  const participants = groupInfo?.group_participants ?? []
  const sortedParticipants = participants.sort((a, b) => {
    if (a.is_admin && !b.is_admin) return -1
    if (!a.is_admin && b.is_admin) return 1
    return 0
  })
  const visibleParticipants = showAllParticipants
    ? sortedParticipants
    : sortedParticipants.slice(0, MAX_VISIBLE)
  const hasMore = (groupInfo?.participant_count ?? sortedParticipants.length) > MAX_VISIBLE

  if (!isOpen) return null

  return (
    <>
      {/* Below lg the panel floats over the conversation, keeping the chat at a
          usable width. The backdrop also gives narrow windows a clear dismissal
          target. At lg it returns to a normal 400px flex column. */}
      <div
        className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="complementary"
        aria-label={chatType === "group" ? "Group info" : "Contact info"}
        className="fixed inset-y-0 right-0 z-40 flex h-full w-full max-w-[400px] flex-col overflow-hidden border-l border-gray-200 bg-white shadow-xl dark:border-white/5 dark:bg-dark-secondary lg:static lg:z-auto lg:w-[400px] lg:max-w-none lg:shadow-none"
      >
        {/* Header */}
        <div className="flex items-center p-4 bg-light-secondary dark:bg-dark-secondary">
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-dark-tertiary rounded-full transition-colors mr-3"
            aria-label="Close"
          >
            <GoBackIcon />
          </button>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {chatType === "group" ? "Group Info" : "Contact Info"}
          </h2>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
            </div>
          ) : (
            <>
              {/* Profile Section */}
              <div className="bg-light-secondary dark:bg-dark-secondary p-6 flex flex-col items-center">
                <div className="relative w-32 h-32 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold text-4xl overflow-hidden mb-4 group">
                  {chatAvatar ? (
                    <img src={chatAvatar} alt={chatName} className="w-full h-full object-cover" />
                  ) : (
                    <UserAvatar />
                  )}
                  {chatType === "group" && (
                    <>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        id="group-photo-upload"
                        onChange={async e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const reader = new FileReader()
                          reader.onload = async () => {
                            const base64 = reader.result as string
                            try {
                              await SetGroupPhoto(chatId, base64)
                              window.location.reload()
                            } catch (err) {
                              console.error("Failed to set group photo:", err)
                            }
                          }
                          reader.readAsDataURL(file)
                        }}
                      />
                      <label
                        htmlFor="group-photo-upload"
                        className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 cursor-pointer transition-colors rounded-full"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="28"
                          height="28"
                          className="fill-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
                        </svg>
                      </label>
                    </>
                  )}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-1">
                  {chatType === "group"
                    ? groupInfo?.group_name
                    : contactInfo?.full_name || "~ " + contactInfo?.push_name || chatName}
                </h3>
                {chatType === "contact" && contactInfo && (
                  <p className="text-sm text-gray-600 dark:text-dark-muted">{contactInfo.phno}</p>
                )}
                {chatType === "group" && groupInfo && (
                  <p className="text-sm text-gray-600 dark:text-dark-muted">
                    Group · {groupInfo.participant_count} participants
                  </p>
                )}
              </div>

              {/* Group Description */}
              {chatType === "group" && groupInfo?.group_topic && (
                <div className="mx-3 border-y border-gray-200 dark:border-dark-tertiary">
                  <div className="p-4">
                    <p className="text-gray-900 dark:text-dark-text text-md break-words whitespace-pre-wrap">
                      {groupInfo.group_topic}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-dark-muted mt-2">
                      Group created by{" "}
                      {groupInfo.group_owner.full_name ||
                        groupInfo.group_owner.push_name ||
                        groupInfo.group_owner.phno}
                      , on {new Date(groupInfo.group_created_at).toLocaleDateString()} at{" "}
                      {new Date(groupInfo.group_created_at).toLocaleString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              )}

              {/* About Section for Contacts */}
              {chatType === "contact" && contactInfo && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  <div className="p-4">
                    <p className="text-sm text-gray-600 dark:text-dark-muted mb-1">About</p>
                    <p className="text-gray-900 dark:text-gray-100">
                      {(contactInfo as { status?: string }).status || "No about info"}
                    </p>
                  </div>
                </div>
              )}

              {/* User Info from server */}
              {chatType === "contact" && contactInfo && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600 dark:text-dark-muted mb-1">Info</p>
                      {userInfo ? (
                        <p className="text-gray-900 dark:text-gray-100 text-sm">
                          {userInfo.status ? `"${userInfo.status}"` : "No status"}
                          {userInfo.devices?.length
                            ? ` · ${userInfo.devices.length} device${userInfo.devices.length !== 1 ? "s" : ""}`
                            : ""}
                        </p>
                      ) : userInfoBusy ? (
                        <p className="text-sm text-gray-600">Loading…</p>
                      ) : (
                        <p className="text-sm text-gray-600">Unknown</p>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        // Prefer the canonical JID; fall back to the phone.
                        // Never issue a query for an empty/placeholder value.
                        const query = (contactInfo.jid || contactInfo.phno || "").trim()
                        if (!query) {
                          setUserInfo(null)
                          return
                        }
                        setUserInfoBusy(true)
                        try {
                          const results = await GetUserInfo([query])
                          setUserInfo(results?.[0] ?? null)
                        } catch (e) {
                          // 429s are throttled into benign results by the backend;
                          // never log raw rate-limit text from an expected case.
                          if (!/rate-overlimit|status 429/i.test(String(e))) {
                            console.error("GetUserInfo failed:", e)
                          }
                        } finally {
                          setUserInfoBusy(false)
                        }
                      }}
                      disabled={userInfoBusy}
                      className="rounded-lg border border-gray-300 dark:border-dark-border px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-dark-tertiary disabled:opacity-50 text-gray-600 dark:text-dark-muted"
                    >
                      {userInfoBusy ? "Fetching…" : "Fetch"}
                    </button>
                  </div>
                </div>
              )}

              {/* Phone Number for Contacts */}
              {chatType === "contact" && contactInfo && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  <div className="p-4">
                    <p className="text-sm text-gray-600 dark:text-dark-muted mb-1">Phone</p>
                    <p className="text-gray-900 dark:text-gray-100">{contactInfo.phno}</p>
                    <button
                      onClick={async () => {
                        const phone = (contactInfo.phno || "").trim()
                        if (!phone) return
                        setCheckBusy(true)
                        setWaCheck(null)
                        try {
                          const results = await IsOnWhatsApp([phone])
                          if (results && results.length > 0) {
                            setWaCheck({
                              onWhatsApp: results[0].is_on_whatsapp,
                              verifiedName: results[0].verified_name,
                            })
                          }
                        } catch (err) {
                          if (!/rate-overlimit|status 429/i.test(String(err))) {
                            console.error("IsOnWhatsApp check failed:", err)
                          }
                        } finally {
                          setCheckBusy(false)
                        }
                      }}
                      disabled={checkBusy}
                      className="mt-2 rounded-lg border border-gray-300 dark:border-dark-border px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-dark-tertiary disabled:opacity-50 text-gray-600 dark:text-dark-muted"
                    >
                      {checkBusy
                        ? "Checking…"
                        : waCheck
                          ? waCheck.onWhatsApp
                            ? `On WhatsApp${waCheck.verifiedName ? " ✓" : ""}`
                            : "Not on WhatsApp"
                          : "Check WhatsApp"}
                    </button>
                  </div>
                </div>
              )}

              {/* Business Section — every row is backed by a real field the
                  backend returns; absent fields are omitted, never placeholder. */}
              {chatType === "contact" &&
                businessInfo &&
                (() => {
                  const description =
                    typeof businessInfo.description === "string" && businessInfo.description.trim()
                      ? businessInfo.description.trim()
                      : null
                  // The backend returns `websites`, not the old singular `website`.
                  // Only absolute http(s) URLs become links, rendered as plain text.
                  const websites: string[] = Array.isArray(businessInfo.websites)
                    ? businessInfo.websites
                        .filter(
                          (w): w is string =>
                            typeof w === "string" && /^https?:\/\//i.test(w.trim()),
                        )
                        .map(w => w.trim())
                    : []
                  const email =
                    typeof businessInfo.email === "string" && businessInfo.email.trim()
                      ? businessInfo.email.trim()
                      : null
                  const rawCategories: string[] = Array.isArray(businessInfo.categories)
                    ? businessInfo.categories.filter(
                        (c): c is string => typeof c === "string" && Boolean(c.trim()),
                      )
                    : []
                  // Keep older contacts that only expose the singular category.
                  const singleCategory =
                    typeof businessInfo.category === "string" && businessInfo.category.trim()
                      ? businessInfo.category.trim()
                      : null
                  const categories = rawCategories.length ? rawCategories : singleCategory ? [singleCategory] : []
                  const address =
                    typeof businessInfo.address === "string" && businessInfo.address.trim()
                      ? businessInfo.address.trim()
                      : null
                  const hours: {
                    day_of_week?: unknown
                    mode?: unknown
                    open_time?: unknown
                    close_time?: unknown
                  }[] = Array.isArray(businessInfo.business_hours) ? businessInfo.business_hours : []
                  // One human-readable line per day. 24-hour and
                  // appointment-only modes never fabricate clock times.
                  const hourLine = (hour: (typeof hours)[number]): string | null => {
                    const rawDay =
                      typeof hour.day_of_week === "string" ? hour.day_of_week.trim() : ""
                    const day = rawDay ? rawDay.charAt(0).toUpperCase() + rawDay.slice(1) : ""
                    const mode = typeof hour.mode === "string" ? hour.mode.trim().toLowerCase() : ""
                    const open = typeof hour.open_time === "string" ? hour.open_time.trim() : ""
                    const close = typeof hour.close_time === "string" ? hour.close_time.trim() : ""
                    if (mode === "appointment_only") {
                      return day ? `${day}: By appointment only` : "By appointment only"
                    }
                    if (mode === "open_24h" || (open === "0" && close === "0")) {
                      return day ? `${day}: Open 24 hours` : "Open 24 hours"
                    }
                    if (open && close) {
                      const range = `${open}–${close}`
                      return day ? `${day}: ${range}` : range
                    }
                    return day || null
                  }
                  const hourLines = hours.map(hourLine).filter((line): line is string => Boolean(line))
                  const timezone =
                    typeof businessInfo.business_hours_timezone === "string" &&
                    businessInfo.business_hours_timezone.trim()
                      ? businessInfo.business_hours_timezone.trim()
                      : null

                  if (
                    !description &&
                    websites.length === 0 &&
                    !email &&
                    categories.length === 0 &&
                    !address &&
                    hourLines.length === 0 &&
                    !timezone
                  ) {
                    return null
                  }

                  return (
                    <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                      <div className="p-4">
                        <p className="text-sm text-gray-600 dark:text-dark-muted mb-2">Business</p>
                        {description && (
                          <p className="text-sm text-gray-900 dark:text-gray-100 mb-1 break-words">
                            {description}
                          </p>
                        )}
                        {websites.length > 0 && (
                          <div className="mb-1 flex flex-col gap-0.5">
                            {websites.map((url, i) => (
                              <a
                                key={`${url}-${i}`}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block break-all text-sm text-blue-500 hover:underline"
                              >
                                {url}
                              </a>
                            ))}
                          </div>
                        )}
                        {email && (
                          <p className="text-sm text-gray-600 dark:text-dark-muted mb-1">
                            <a href={`mailto:${email}`} className="text-blue-500 hover:underline">
                              {email}
                            </a>
                          </p>
                        )}
                        {categories.length > 0 && (
                          <p className="text-sm text-gray-600 dark:text-dark-muted mb-1">
                            {categories.join(", ")}
                          </p>
                        )}
                        {address && (
                          <p className="text-sm text-gray-600 dark:text-dark-muted break-words">
                            {address}
                          </p>
                        )}
                        {(hourLines.length > 0 || timezone) && (
                          <div className="mt-2">
                            <p className="text-sm text-gray-600 dark:text-dark-muted mb-1">Hours</p>
                            {hourLines.length > 0 && (
                              <ul className="space-y-0.5">
                                {hourLines.map((line, i) => (
                                  <li
                                    key={`${line}-${i}`}
                                    className="text-sm text-gray-900 dark:text-gray-100"
                                  >
                                    {line}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {timezone && (
                              <p className="mt-1 text-xs text-gray-500 dark:text-dark-muted">
                                Timezone: {timezone}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

              {/* Media, links, and docs — opens the combined hub */}
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <button
                  type="button"
                  onClick={useMediaHubStore.getState().openHub}
                  className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                  aria-label="Open media, links and docs"
                >
                  <Mediaicon />
                  <span className="text-gray-900 dark:text-gray-100">Media, links and docs</span>
                </button>
              </div>

              {/* Mute notifications */}
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <button
                  onClick={handleToggleMute}
                  disabled={muteBusy}
                  className="w-full p-4 flex items-center rounded-xl m-2 justify-between hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <MuteIcon />
                    <span className="text-gray-900 dark:text-gray-100">Mute notifications</span>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <ToggleButton isEnabled={muted} onToggle={handleToggleMute} />
                  </div>
                </button>

                {/* Disappearing messages. GetDisappearingTimer only reads group
                  metadata; for 1:1 chats it always returns 0, so a picker would
                  misleadingly show "Off" regardless of the real setting. */}
                {(chatType === "group" || disappearTimer > 0) && (
                  <div className="relative">
                    <button
                      onClick={() => setShowDisappearPicker(!showDisappearPicker)}
                      className="w-full p-4 flex items-center rounded-xl m-2 justify-between hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <DisappearingMessagesIcon />
                        <div className="flex-1 text-left">
                          <p className="text-gray-900 dark:text-gray-100">Disappearing messages</p>
                          <p className="text-sm text-gray-600 dark:text-dark-muted">
                            {DISAPPEAR_LABEL[disappearTimer] || "Off"}
                          </p>
                        </div>
                      </div>
                    </button>
                    {showDisappearPicker && (
                      <div className="mx-4 mb-2 flex flex-col gap-1 rounded-lg border border-gray-200 dark:border-dark-border bg-white p-2 shadow-lg dark:border-white/10 dark:bg-dark-secondary">
                        {DISAPPEAR_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => handleDisappearChange(opt.value)}
                            disabled={actionBusy}
                            className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50 ${
                              disappearTimer === opt.value
                                ? "font-medium text-green"
                                : "text-light-text dark:text-dark-text"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Clear chat */}
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <button
                  onClick={async () => {
                    if (!confirm("Clear all messages in this chat?")) return
                    try {
                      await ClearChat(chatId)
                      window.location.reload()
                    } catch (e) {
                      console.error("Clear chat failed:", e)
                    }
                  }}
                  className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                >
                  <span className="text-gray-900 dark:text-gray-100">Clear messages</span>
                </button>
              </div>

              {/* Group Participants */}
              {chatType === "group" && groupInfo && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  <span className="w-full p-4 flex items-center justify-between transition-colors">
                    <span className="text-gray-900 dark:text-gray-100">
                      {groupInfo.participant_count} members
                    </span>
                  </span>

                  <div className="max-h-96 overflow-y-auto">
                    {visibleParticipants.map((participant: any) => {
                      // Group actions must address the primary JID (often an
                      // LID); contact.jid is the PN-canonical display identity.
                      const actionJid = participant.action_jid || participant.contact.jid
                      const participantName =
                        participant.contact.full_name ||
                        "~ " + participant.contact.push_name ||
                        participant.contact.phno ||
                        participant.contact.jid
                      const openActions = (anchor: HTMLElement) =>
                        onContactAction?.(
                          {
                            jid: participant.contact.jid,
                            actionJid,
                            displayName: participantName,
                            phone: participant.contact.phno,
                            avatarUrl: participant.contact.avatar_url,
                            groupJid: chatId,
                            participantIsAdmin: !!participant.is_admin,
                            canManage:
                              isAdmin && userPart(participant.contact.jid) !== userPart(myJid),
                            onGroupChanged: loadInfo,
                          },
                          anchor,
                        )
                      return (
                        <div
                          key={participant.contact.jid}
                          className="flex items-center gap-3 p-3 rounded-xl m-2 hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                        >
                          <button
                            type="button"
                            onClick={event => openActions(event.currentTarget)}
                            aria-label={`Contact actions for ${participantName}`}
                            className="w-10 h-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-white font-bold overflow-hidden"
                          >
                            {participant.contact.avatar_url ? (
                              <img
                                src={participant.contact.avatar_url}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <UserAvatar />
                            )}
                          </button>

                          <div className="flex-1 min-w-0">
                            <button
                              type="button"
                              onClick={event => openActions(event.currentTarget)}
                              aria-label={`Contact actions for ${participantName}`}
                              className="max-w-full truncate text-left text-gray-900 dark:text-gray-100 font-medium hover:underline underline-offset-2"
                            >
                              {participantName}
                            </button>
                            <p className="text-sm text-gray-600 dark:text-dark-muted">
                              {participant.contact.phno}
                            </p>
                          </div>

                          {participant.is_admin && (
                            <span className="text-xs px-3 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-tint shrink-0">
                              Admin
                            </span>
                          )}

                          {isAdmin && userPart(participant.contact.jid) !== userPart(myJid) && (
                            <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                              {participant.is_admin ? (
                                <button
                                  onClick={async () => {
                                    setParticipantBusy(actionJid)
                                    try {
                                      await DemoteGroupParticipants(chatId, [actionJid])
                                      loadInfo()
                                    } catch (e) {
                                      console.error("Failed to demote:", e)
                                    } finally {
                                      setParticipantBusy(null)
                                    }
                                  }}
                                  disabled={participantBusy === actionJid}
                                  className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 disabled:opacity-50"
                                >
                                  Demote
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={async () => {
                                      setParticipantBusy(actionJid)
                                      try {
                                        await PromoteGroupParticipants(chatId, [actionJid])
                                        loadInfo()
                                      } catch (e) {
                                        console.error("Failed to promote:", e)
                                      } finally {
                                        setParticipantBusy(null)
                                      }
                                    }}
                                    disabled={participantBusy === actionJid}
                                    className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 disabled:opacity-50"
                                  >
                                    Promote
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (
                                        !confirm(
                                          `Remove ${participant.contact.full_name || participant.contact.push_name} from the group?`,
                                        )
                                      )
                                        return
                                      setParticipantBusy(actionJid)
                                      try {
                                        await RemoveGroupParticipants(chatId, [actionJid])
                                        loadInfo()
                                      } catch (e) {
                                        console.error("Failed to remove:", e)
                                      } finally {
                                        setParticipantBusy(null)
                                      }
                                    }}
                                    disabled={participantBusy === actionJid}
                                    className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {hasMore && !showAllParticipants && (
                      <button
                        onClick={() => setShowAllParticipants(true)}
                        className="w-full p-3 text-sm font-medium text-blue-600 dark:text-green hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                      >
                        View all members ({groupInfo.participant_count - MAX_VISIBLE} more)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Add Participants */}
              {chatType === "group" && isAdmin && (
                <div className="border-b border-gray-200 dark:border-dark-tertiary">
                  <button
                    onClick={async () => {
                      setShowAddParticipant(!showAddParticipant)
                      if (!showAddParticipant) {
                        try {
                          const contacts = await FetchContacts()
                          setAddResults(contacts)
                        } catch {
                          /* ignore */
                        }
                      }
                    }}
                    className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                  >
                    <span className="text-gray-900 dark:text-gray-100 font-medium">
                      Add members
                    </span>
                  </button>
                  {showAddParticipant && (
                    <div className="mx-4 mb-3">
                      <input
                        autoFocus
                        className={`w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm placeholder:text-gray-600 dark:placeholder:text-dark-subtle text-light-text dark:text-dark-text mb-2`}
                        value={addSearch}
                        onChange={e => {
                          const q = e.target.value
                          setAddSearch(q)
                          FetchContacts()
                            .then(all => {
                              const filtered = all.filter(
                                (c: any) =>
                                  c.jid &&
                                  !groupInfo?.group_participants?.some(
                                    (p: any) => p.contact.jid === c.jid,
                                  ) &&
                                  (c.full_name || c.push_name || c.phno || "")
                                    .toLowerCase()
                                    .includes(q.toLowerCase()),
                              )
                              setAddResults(filtered)
                            })
                            .catch(() => {})
                        }}
                        placeholder="Search contacts..."
                      />
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-dark-border">
                        {addResults.length === 0 && (
                          <p className="p-3 text-sm text-gray-600 dark:text-dark-muted">
                            No contacts to add
                          </p>
                        )}
                        {addResults.map((c: any) => (
                          <button
                            key={c.jid}
                            onClick={async () => {
                              setAddBusy(true)
                              try {
                                await AddGroupParticipants(chatId, [c.jid])
                                setGroupInfo(null)
                                loadInfo()
                                setShowAddParticipant(false)
                                setAddSearch("")
                              } catch (e) {
                                console.error("Failed to add participant:", e)
                              } finally {
                                setAddBusy(false)
                              }
                            }}
                            disabled={addBusy}
                            className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-dark-tertiary disabled:opacity-50 border-b border-gray-100 dark:border-dark-tertiary last:border-0"
                          >
                            {c.full_name || c.push_name || c.phno || c.jid}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Newsletter Info */}
              {chatId.endsWith("@newsletter") && newsletterInfo && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  <div className="p-4 space-y-3">
                    <p className="text-sm text-gray-600 dark:text-dark-muted mb-1">Channel Info</p>
                    {newsletterInfo.description && (
                      <p className="text-gray-900 dark:text-gray-100 text-sm">
                        {newsletterInfo.description}
                      </p>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await NewsletterToggleMute(chatId, !newsletterMuted)
                          setNewsletterMuted(!newsletterMuted)
                        } catch (e) {
                          console.error("Failed to toggle newsletter mute:", e)
                        }
                      }}
                      className="text-sm text-blue-600 dark:text-green hover:underline"
                    >
                      {newsletterMuted ? "Unmute notifications" : "Mute notifications"}
                    </button>
                  </div>
                </div>
              )}

              {/* Block/Report (for contacts) */}
              {chatType === "contact" && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  <button
                    onClick={async () => {
                      setActionBusy(true)
                      try {
                        if (blocked) {
                          await UnblockContact(chatId)
                        } else {
                          await BlockContact(chatId)
                        }
                        setBlocked(!blocked)
                      } catch (e) {
                        console.error("Block toggle failed:", e)
                      } finally {
                        setActionBusy(false)
                      }
                    }}
                    disabled={actionBusy}
                    className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-red-600 dark:text-red-400 disabled:opacity-50"
                  >
                    <BlockIcon />
                    <span>
                      {blocked ? "Unblock" : "Block"}{" "}
                      {contactInfo?.full_name || contactInfo?.phno || "contact"}
                    </span>
                  </button>
                  <button className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-red-600 dark:text-red-400">
                    <ReportIcon />
                    <span>Report contact</span>
                  </button>
                </div>
              )}

              {/* Group actions */}
              {chatType === "group" && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  {/* Change subject */}
                  {subjectEdit ? (
                    <div className="p-4 flex flex-col gap-2">
                      <input
                        autoFocus
                        className={`w-full rounded-lg border border-gray-300 dark:border-white/10 bg-transparent px-3 py-2 text-sm text-light-text dark:text-dark-text`}
                        value={subjectDraft}
                        onChange={e => setSubjectDraft(e.target.value)}
                        placeholder="Group subject"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setSubjectEdit(false)}
                          className="rounded-md px-3 py-1 text-sm text-light-muted dark:text-dark-muted hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveSubject}
                          disabled={actionBusy || !subjectDraft.trim()}
                          className="rounded-md bg-green px-3 py-1 text-sm font-medium text-action-ink disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setSubjectDraft(groupInfo?.group_name || "")
                        setSubjectEdit(true)
                      }}
                      className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                    >
                      <span className="text-gray-900 dark:text-gray-100">Change subject</span>
                    </button>
                  )}

                  {/* Invite link */}
                  <button
                    onClick={handleCopyInviteLink}
                    disabled={inviteBusy}
                    className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors disabled:opacity-50"
                  >
                    <span className="text-gray-900 dark:text-gray-100">
                      {inviteBusy
                        ? "Loading…"
                        : inviteLink
                          ? "Invite link copied!"
                          : "Get invite link"}
                    </span>
                  </button>

                  {/* Group announce toggle */}
                  <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors">
                    <span className="text-sm text-gray-900 dark:text-gray-100">Send Messages</span>
                    <SettingsSwitch
                      checked={groupAnnounce}
                      disabled={!isAdmin}
                      label="Only admins can send messages"
                      onChange={async () => {
                        const next = !groupAnnounce
                        setGroupAnnounce(next)
                        try {
                          await SetGroupAnnounce(chatId, next)
                        } catch (e) {
                          console.error("Failed to set group announce:", e)
                          setGroupAnnounce(!next)
                        }
                      }}
                    />
                  </div>
                  <p className="px-4 pb-3 -mt-2 text-xs text-gray-600 dark:text-dark-muted">
                    {groupAnnounce
                      ? "Only admins can send messages"
                      : "All participants can send messages"}
                  </p>

                  {/* Group locked toggle */}
                  <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors">
                    <span className="text-sm text-gray-900 dark:text-gray-100">Lock Group</span>
                    <SettingsSwitch
                      checked={groupLocked}
                      disabled={!isAdmin}
                      label="Lock group info to admins"
                      onChange={async () => {
                        const next = !groupLocked
                        setGroupLocked(next)
                        try {
                          await SetGroupLocked(chatId, next)
                        } catch (e) {
                          console.error("Failed to set group lock:", e)
                          setGroupLocked(!next)
                        }
                      }}
                    />
                  </div>
                  <p className="px-4 pb-3 -mt-2 text-xs text-gray-600 dark:text-dark-muted">
                    {groupLocked ? "Group info locked by admins" : "Anyone can edit group info"}
                  </p>

                  {/* Group description / topic — admin only */}
                  {isAdmin && (
                    <>
                      {topicEdit ? (
                        <div className="p-4 flex flex-col gap-2 border-t border-gray-200 dark:border-dark-tertiary">
                          <textarea
                            autoFocus
                            className={`w-full rounded-lg border border-gray-300 dark:border-dark-border bg-transparent px-3 py-2 text-sm text-light-text dark:text-dark-text resize-none`}
                            rows={3}
                            value={topicDraft}
                            onChange={e => setTopicDraft(e.target.value)}
                            placeholder="Group description"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setTopicEdit(false)}
                              className="rounded-md px-3 py-1 text-sm text-light-muted dark:text-dark-muted hover:bg-gray-100 dark:hover:bg-white/5"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSaveTopic}
                              disabled={actionBusy || !topicDraft.trim()}
                              className="rounded-md bg-green px-3 py-1 text-sm font-medium text-action-ink disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setTopicDraft(groupInfo?.group_topic || "")
                            setTopicEdit(true)
                          }}
                          className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors border-t border-gray-200 dark:border-dark-tertiary"
                        >
                          <span className="text-gray-900 dark:text-gray-100">Edit description</span>
                        </button>
                      )}
                    </>
                  )}

                  {/* Member add mode — admin only */}
                  {isAdmin && (
                    <>
                      <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors">
                        <span className="text-sm text-gray-900 dark:text-gray-100">
                          Member Add Mode
                        </span>
                        <SettingsSwitch
                          checked={memberAddMode === "admin_add"}
                          label="Only admins can add members"
                          onChange={handleToggleMemberAddMode}
                        />
                      </div>
                      <p className="px-4 pb-3 -mt-2 text-xs text-gray-600 dark:text-dark-muted">
                        {memberAddMode === "admin_add"
                          ? "Only admins can add members"
                          : "All participants can add members"}
                      </p>
                    </>
                  )}

                  {/* Join approval mode — admin only */}
                  {isAdmin && (
                    <>
                      <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors">
                        <span className="text-sm text-gray-900 dark:text-gray-100">
                          Join Approval
                        </span>
                        <SettingsSwitch
                          checked={joinApproval}
                          label="Require admin approval to join"
                          onChange={handleToggleJoinApproval}
                        />
                      </div>
                      <p className="px-4 pb-3 -mt-2 text-xs text-gray-600 dark:text-dark-muted">
                        {joinApproval
                          ? "Join requests require admin approval"
                          : "Anyone can join freely"}
                      </p>
                    </>
                  )}

                  {/* Join requests — admin only */}
                  {isAdmin && (
                    <div className="border-t border-gray-200 dark:border-dark-tertiary">
                      <button
                        onClick={handleLoadJoinRequests}
                        disabled={joinReqBusy}
                        className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors disabled:opacity-50"
                      >
                        <span className="text-gray-900 dark:text-gray-100">
                          {joinReqBusy ? "Loading…" : `Join Requests (${joinRequests.length})`}
                        </span>
                      </button>
                      {showJoinRequests && joinRequests.length > 0 && (
                        <div className="mx-4 mb-3 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary overflow-hidden">
                          {joinRequests.map(req => (
                            <div
                              key={req.jid}
                              className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-dark-tertiary last:border-0"
                            >
                              <span className="text-sm text-gray-900 dark:text-gray-100 truncate flex-1">
                                {req.requester}
                              </span>
                              <div className="flex gap-2 shrink-0">
                                <button
                                  onClick={() => handleApproveJoinRequest(req.jid)}
                                  className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleRejectJoinRequest(req.jid)}
                                  className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {showJoinRequests && joinRequests.length === 0 && !joinReqBusy && (
                        <p className="px-4 pb-3 text-xs text-gray-600 dark:text-dark-muted">
                          No pending requests
                        </p>
                      )}
                    </div>
                  )}

                  {/* Link / Unlink community — admin only */}
                  {isAdmin && (
                    <div className="border-t border-gray-200 dark:border-dark-tertiary">
                      {groupInfo?.parent_jid ? (
                        <div>
                          <button
                            onClick={() => handleUnlinkCommunity(groupInfo!.parent_jid!)}
                            disabled={linkBusy}
                            className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-orange-600 dark:text-orange-400 disabled:opacity-50"
                          >
                            <span>Unlink from community</span>
                          </button>
                          {linkError && (
                            <p className="px-4 pb-2 text-xs text-red-500">{linkError}</p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <button
                            onClick={() => {
                              setShowLinkCommunity(!showLinkCommunity)
                              if (!showLinkCommunity) {
                                GetCommunityList()
                                  .then(setCommunities)
                                  .catch(() => {})
                              }
                            }}
                            className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                          >
                            <span className="text-gray-900 dark:text-gray-100">
                              Link to community
                            </span>
                          </button>
                          {showLinkCommunity && (
                            <div className="mx-4 mb-3 rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary max-h-40 overflow-y-auto">
                              {communities.length === 0 && (
                                <p className="p-3 text-sm text-gray-600 dark:text-dark-muted">
                                  No communities available
                                </p>
                              )}
                              {communities.map(c => (
                                <button
                                  key={c.jid}
                                  onClick={() => handleLinkCommunity(c.jid)}
                                  disabled={linkBusy}
                                  className="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-dark-tertiary disabled:opacity-50 border-b border-gray-100 dark:border-dark-tertiary last:border-0"
                                >
                                  {c.name || "Community"}
                                </button>
                              ))}
                            </div>
                          )}
                          {linkError && (
                            <p className="px-4 pb-2 text-xs text-red-500">{linkError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Exit group (for groups) */}
              {chatType === "group" && (
                <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                  <button
                    onClick={async () => {
                      setActionBusy(true)
                      try {
                        await LeaveGroup(chatId)
                        window.location.reload()
                      } catch (e) {
                        console.error("Leave group failed:", e)
                      } finally {
                        setActionBusy(false)
                      }
                    }}
                    disabled={actionBusy}
                    className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors text-red-600 dark:text-red-400 disabled:opacity-50"
                  >
                    <ExitGroupIcon />
                    <span>Exit group</span>
                  </button>
                </div>
              )}

              {/* Join Group by Link (always available) */}
              <div className="mx-3 border-b border-gray-200 dark:border-dark-tertiary">
                <button
                  onClick={() => setShowJoinDialog(true)}
                  className="w-full p-4 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-dark-tertiary transition-colors"
                >
                  <span className="text-gray-900 dark:text-gray-100">Join Group by Link</span>
                </button>
              </div>
            </>
          )}
        </div>
        {showJoinDialog && <InviteLinkDialog onClose={() => setShowJoinDialog(false)} />}
      </div>
    </>
  )
}
