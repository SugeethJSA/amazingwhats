import { useEffect, useState } from "react"
import {
  GetGroupInfo,
  GetCommunityDetails,
} from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { getAvatarColor, AVATAR_ICON_COLOR } from "../../lib/utils"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"

/**
 * Original, hand-drawn megaphone/broadcast glyph. Local code only — no copied
 * brand artwork. Used as the announcement group's own icon when it has no photo.
 */
export function AnnouncementIcon({
  size = 22,
  color = AVATAR_ICON_COLOR,
}: {
  size?: number
  color?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M19 4.2a1 1 0 0 0-1.53-.85L10.5 7.5H5.5A2.5 2.5 0 0 0 3 10v4a2.5 2.5 0 0 0 2.5 2.5h5l6.97 4.15A1 1 0 0 0 19 19.8V4.2z" />
      <path d="M9.4 16.2h3.3l1 3.3a1 1 0 0 1-1 1.3h-2a1 1 0 0 1-1-1.2l.7-3.4z" />
      <path d="M20 9a1 1 0 0 1 2 0v6a1 1 0 0 1-2 0V9z" />
    </svg>
  )
}

/** Small people glyph for the community badge fallback (same idea as Communities.tsx). */
function CommunityPeopleGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm0 2c-3 0-6 1.4-6 4v2h12v-2c0-2.6-3-4-6-4zm8-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-.5 0-1 .1-1.4.2 1.5.9 2.4 2.2 2.4 3.8V19h5v-2c0-2.6-3-4-6-4z" />
    </svg>
  )
}

export interface AnnouncementIdentity {
  /** Parent community JID from GetGroupInfo(jid).parent_jid. */
  parentJid: string
  communityName: string
  communityAvatar: string
  announcementJid: string
  announcementName: string
  announcementAvatar: string
}

/**
 * Reliably identifies a community ANNOUNCEMENT group.
 *
 * GetGroupInfo(jid).parent_jid tells us the group belongs to a community;
 * GetCommunityDetails(parent_jid).announcement.jid must then equal this chat's
 * JID. No name-based guessing is used anywhere.
 */
export function useAnnouncementIdentity(
  chatId: string,
  chatType: "group" | "contact",
  enabled = true,
): AnnouncementIdentity | null {
  const [identity, setIdentity] = useState<AnnouncementIdentity | null>(null)

  useEffect(() => {
    let cancelled = false
    setIdentity(null)
    if (!enabled || !chatId || chatType !== "group" || !chatId.endsWith("@g.us")) return

    ;(async () => {
      try {
        const info = await GetGroupInfo(chatId)
        if (cancelled) return
        const parentJid = info?.parent_jid
        if (!parentJid) return

        const details = await GetCommunityDetails(parentJid)
        if (cancelled) return
        const announcement = details?.announcement
        // Exact JID match only — never infer from a display name.
        if (!announcement?.jid || announcement.jid !== chatId) return

        setIdentity({
          parentJid,
          communityName: details.name || "Community",
          communityAvatar: details.avatar_url || "",
          announcementJid: announcement.jid,
          announcementName: announcement.name || "Announcements",
          announcementAvatar: announcement.avatar_url || "",
        })
      } catch {
        // A failed lookup simply means we cannot prove this is the announcement
        // group; leave the regular group avatar in place.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [chatId, chatType, enabled])

  return identity
}

/**
 * Community logo (rounded-square badge, top-left) stacked behind the group
 * icon (circular, bottom-right). Avatars come from avatar_url when present;
 * otherwise both use the same JID-derived pastel fallback as the chat list.
 */
export function AnnouncementAvatar({
  identity,
  groupAvatar,
  size = "sm",
}: {
  identity: AnnouncementIdentity
  /** Optional chat-list avatar used when details have no announcement photo yet. */
  groupAvatar?: string
  size?: "sm" | "lg"
}) {
  const dark = useAppSettingsStore(s => s.theme) === "dark"
  const container = size === "lg" ? 144 : 40
  const badge = size === "lg" ? 88 : 26
  const group = size === "lg" ? 100 : 28
  const ring = dark ? "#161717" : "#ffffff"

  const communityColor = getAvatarColor(identity.parentJid || identity.communityName, dark)
  const groupColor = getAvatarColor(identity.announcementJid, dark)
  const communityAvatar = identity.communityAvatar
  const announcementAvatar = identity.announcementAvatar || groupAvatar

  return (
    <div
      role="img"
      aria-label={`${identity.communityName} announcement group, ${identity.announcementName}`}
      className="relative shrink-0"
      style={{ width: container, height: container }}
    >
      <div
        className="absolute left-0 top-0 flex items-center justify-center overflow-hidden rounded-[8px]"
        style={{ width: badge, height: badge, backgroundColor: communityColor }}
      >
        {communityAvatar ? (
          <img src={communityAvatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <CommunityPeopleGlyph size={Math.round(badge * 0.55)} color={AVATAR_ICON_COLOR} />
        )}
      </div>
      <div
        className="absolute bottom-0 right-0 flex items-center justify-center overflow-hidden rounded-full"
        style={{
          width: group,
          height: group,
          backgroundColor: groupColor,
          boxShadow: `0 0 0 ${size === "lg" ? 3 : 2}px ${ring}`,
        }}
      >
        {announcementAvatar ? (
          <img src={announcementAvatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <AnnouncementIcon size={Math.round(group * 0.6)} color={AVATAR_ICON_COLOR} />
        )}
      </div>
    </div>
  )
}
