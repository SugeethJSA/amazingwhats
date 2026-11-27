import { useCallback, useEffect, useRef, useState } from "react"
import {
  GetMyBusinessCoverPhoto,
  GetMyBusinessProfile,
  GetMyJID,
  GetProfile,
  GetSelfAvatar,
  GetUserInfo,
  SetPushName,
  SetStatusMessage,
  UpdateMyBusinessProfile,
} from "../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { useUIStore } from "../store"
import { useSelfAvatarStore } from "../store/useSelfAvatarStore"

type SelfProfile = {
  full_name?: string
  push_name?: string
  phno?: string
  jid?: string
  is_business?: boolean
}

type BusinessProfile = {
  is_business?: boolean
  description?: string
  address?: string
  email?: string
  websites?: string[]
  categories?: string[]
  category?: string
  business_hours?: Array<{
    day_of_week?: string
    mode?: string
    open_time?: string
    close_time?: string
  }>
  business_hours_timezone?: string
  cover_photo_id?: string
}

// GetMyBusinessCoverPhoto result. dataUrl is only populated when state is
// "ready" and holds a real, verified cover image; nothing is synthesized.
type BusinessCoverPhoto = {
  state?: string
  dataUrl?: string
  mimeType?: string
}

type BusinessForm = {
  description: string
  address: string
  email: string
  websites: string
}

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-light-muted dark:text-dark-muted"
const ROW = "border-b border-light-tertiary px-5 py-3 dark:border-dark-border"

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : []
}

function hourLine(hour: BusinessProfile["business_hours"] extends Array<infer T> ? T : never): string | null {
  const day = text(hour.day_of_week)
  const mode = text(hour.mode).toLowerCase()
  const open = text(hour.open_time)
  const close = text(hour.close_time)
  const prefix = day ? `${day.charAt(0).toUpperCase()}${day.slice(1)}: ` : ""
  if (mode === "appointment_only") return `${prefix}By appointment only`
  if (mode === "open_24h" || (open === "0" && close === "0")) return `${prefix}Open 24 hours`
  if (open && close) return `${prefix}${open}-${close}`
  return day ? `${day}:` : null
}

/** Self-profile preview for the logged-in account, rendered over the chat list. */
export function SelfProfileDrawer() {
  const open = useUIStore(state => state.selfProfileOpen)
  const setOpen = useUIStore(state => state.setSelfProfileOpen)
  const cachedAvatar = useSelfAvatarStore(state => state.selfAvatar)

  const [profile, setProfile] = useState<SelfProfile | null>(null)
  const [avatar, setAvatar] = useState<string>("")
  const [name, setName] = useState("")
  const [about, setAbout] = useState("")
  const [business, setBusiness] = useState<BusinessProfile | null>(null)
  const [cover, setCover] = useState<BusinessCoverPhoto | null>(null)
  const [form, setForm] = useState<BusinessForm>({ description: "", address: "", email: "", websites: "" })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const jid = await GetMyJID()
      const [self, users, biz, selfAvatar, coverPhoto] = await Promise.all([
        GetProfile(""),
        jid ? GetUserInfo([jid]) : Promise.resolve([]),
        GetMyBusinessProfile(),
        GetSelfAvatar(false).catch(() => ""),
        GetMyBusinessCoverPhoto().catch(() => null),
      ])
      setCover(coverPhoto && typeof coverPhoto === "object" ? coverPhoto : null)
      setProfile(self ?? null)
      setAvatar(selfAvatar || cachedAvatar || "")
      setName(text(self?.push_name) || text(self?.full_name))
      setAbout(text(users?.[0]?.status))
      const parsed: BusinessProfile | null = biz && biz.is_business === true ? (biz as BusinessProfile) : null
      setBusiness(parsed)
      setForm({
        description: text(parsed?.description),
        address: text(parsed?.address),
        email: text(parsed?.email),
        websites: list(parsed?.websites).join("\n"),
      })
    } catch {
      setProfile(null)
      setBusiness(null)
      setCover(null)
      // Never surface raw binding errors; the drawer shows a truthful fallback.
    } finally {
      setLoading(false)
    }
  }, [cachedAvatar])

  useEffect(() => {
    if (!open) return
    void load()
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, load, setOpen])

  // Clear the flag only when the drawer actually unmounts (e.g. screen change),
  // so an avatar refresh cannot close it mid-view.
  useEffect(() => () => setOpen(false), [setOpen])

  if (!open) return null

  const displayName = text(profile?.push_name) || text(profile?.full_name) || "Your profile"
  const phone = text(profile?.phno)

  // Only render an image the binding verified as the real cover photo. The
  // cover ID on the profile tells us a cover exists on the phone even when
  // this client cannot download it, which drives the honest fallback hint.
  const coverURL =
    cover?.state === "ready" &&
    typeof cover.dataUrl === "string" &&
    cover.dataUrl.startsWith("data:image/")
      ? cover.dataUrl
      : ""
  const coverOnPhone = Boolean(text(business?.cover_photo_id)) && !coverURL

  const saveName = async () => {
    if (!name.trim() || saving) return
    setSaving("name")
    setMessage(null)
    try {
      await SetPushName(name.trim())
      setProfile(previous => previous ? { ...previous, push_name: name.trim() } : previous)
      setMessage("Name saved")
    } catch {
      setMessage("Couldn't save the name. Try again.")
    } finally {
      setSaving(null)
    }
  }

  const saveAbout = async () => {
    if (saving) return
    setSaving("about")
    setMessage(null)
    try {
      await SetStatusMessage(about)
      setMessage("About saved")
    } catch {
      setMessage("Couldn't save the about text. Try again.")
    } finally {
      setSaving(null)
    }
  }

  const saveBusiness = async () => {
    if (!business || saving) return
    const websites = form.websites
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean)
    if (websites.some(site => !/^https?:\/\//i.test(site))) {
      setMessage("Websites must start with http:// or https://")
      return
    }
    if (websites.length > 2) {
      setMessage("You can add up to two websites.")
      return
    }
    setSaving("business")
    setMessage(null)
    try {
      await UpdateMyBusinessProfile({
        description: form.description.trim(),
        address: form.address.trim(),
        email: form.email.trim(),
        websites,
      })
      setMessage("Business information saved")
      await load()
    } catch {
      setMessage("Couldn't save business information. Try again.")
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-30 bg-black/30"
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your profile"
        className="fixed inset-y-0 left-16 z-40 flex w-[420px] max-w-[calc(100vw-4rem)] flex-col overflow-hidden border-r border-light-border bg-light-bg shadow-2xl dark:border-dark-border dark:bg-dark-bg"
      >
        <div className="flex items-center gap-3 border-b border-light-tertiary px-4 py-3 dark:border-dark-border">
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close profile"
            className="rounded-full p-2 text-light-muted transition-colors hover:bg-black/5 dark:text-dark-muted dark:hover:bg-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <h2 className="text-base font-semibold text-light-text dark:text-dark-text">Profile</h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-5 py-8 text-sm text-light-muted dark:text-dark-muted">Loading profile.</p>
          ) : (
            <>
              {/* Show the real cover only when the binding verified a downloadable
                  image. Otherwise keep the decorative strip and state plainly
                  that the cover lives on the phone; never fabricate one. */}
              {coverURL ? (
                <div className="h-28 bg-light-tertiary dark:bg-dark-tertiary">
                  <img src={coverURL} alt="Business cover photo" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div
                  className="relative h-28 bg-gradient-to-br from-green-deep to-teal"
                  aria-hidden={!coverOnPhone}
                >
                  {coverOnPhone && (
                    <span className="absolute bottom-2 right-5 rounded-full bg-black/30 px-2 py-0.5 text-[11px] text-white">
                      Cover photo set on your phone
                    </span>
                  )}
                </div>
              )}
              <div className="-mt-12 px-5">
                <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-light-bg bg-light-tertiary dark:border-dark-bg dark:bg-dark-tertiary">
                  {avatar ? (
                    <img src={avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-light-muted dark:text-dark-muted">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <h3 className="mt-3 text-xl font-semibold text-light-text dark:text-dark-text">{displayName}</h3>
                {phone && <p className="mt-0.5 text-sm text-light-muted dark:text-dark-muted">{phone}</p>}
                {profile?.is_business && (
                  <span className="mt-2 inline-block rounded-full bg-green-muted px-2 py-0.5 text-xs text-green-ink">
                    Business account
                  </span>
                )}
                {!profile && (
                  <p className="mt-3 text-sm text-light-muted dark:text-dark-muted">
                    Profile details are unavailable right now.
                  </p>
                )}
              </div>

              {message && (
                <p role="status" className="mx-5 mt-4 rounded-lg bg-green-muted px-3 py-2 text-sm text-green-ink">
                  {message}
                </p>
              )}

              <section className="mt-5">
                <h4 className="px-5 pb-2 text-sm font-semibold text-light-text dark:text-dark-text">
                  Your details
                </h4>
                <div className={ROW}>
                  <div className={LABEL}>Name</div>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={name}
                      onChange={event => setName(event.target.value)}
                      aria-label="Your display name"
                      className="min-w-0 flex-1 rounded-lg border border-light-border bg-light-bg px-3 py-2 text-sm text-light-text outline-none dark:border-dark-border dark:bg-dark-secondary dark:text-dark-text"
                    />
                    <button
                      type="button"
                      onClick={() => void saveName()}
                      disabled={saving !== null || !name.trim()}
                      className="rounded-lg bg-green px-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className={ROW}>
                  <div className={LABEL}>About</div>
                  <div className="mt-1 flex gap-2">
                    <input
                      value={about}
                      onChange={event => setAbout(event.target.value)}
                      aria-label="Your about text"
                      placeholder="What's your status?"
                      className="min-w-0 flex-1 rounded-lg border border-light-border bg-light-bg px-3 py-2 text-sm text-light-text outline-none dark:border-dark-border dark:bg-dark-secondary dark:text-dark-text"
                    />
                    <button
                      type="button"
                      onClick={() => void saveAbout()}
                      disabled={saving !== null}
                      className="rounded-lg bg-green px-3 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
                <div className={ROW}>
                  <div className={LABEL}>Phone number</div>
                  <p className="mt-1 text-sm text-light-text dark:text-dark-text">{phone || "Not available"}</p>
                </div>
                <div className={ROW}>
                  <div className={LABEL}>Username</div>
                  <p className="mt-1 text-sm text-light-muted dark:text-dark-muted">
                    Not available in this client
                  </p>
                </div>
              </section>

              {business && (
                <section className="pb-8">
                  <h4 className="px-5 pb-2 pt-5 text-sm font-semibold text-light-text dark:text-dark-text">
                    Business information
                  </h4>
                  <div className={ROW}>
                    <div className={LABEL}>Category</div>
                    <p className="mt-1 text-sm text-light-text dark:text-dark-text">
                      {list(business.categories).join(", ") || "Not set"}
                    </p>
                  </div>
                  <div className={ROW}>
                    <div className={LABEL}>Cover photo</div>
                    <p className="mt-1 text-sm text-light-muted dark:text-dark-muted">
                      {coverURL ? "Shown above" : coverOnPhone ? "Set on your phone" : "Not set"}
                    </p>
                  </div>
                  {business.business_hours && business.business_hours.length > 0 && (
                    <div className={ROW}>
                      <div className={LABEL}>Business hours</div>
                      <div className="mt-1 space-y-0.5 text-sm text-light-text dark:text-dark-text">
                        {business.business_hours.map((hour, index) => {
                          const line = hourLine(hour)
                          return line ? <p key={index}>{line}</p> : null
                        })}
                      </div>
                    </div>
                  )}
                  {([
                    ["Description", "description", 3],
                    ["Address", "address", 2],
                    ["Email", "email", 1],
                    ["Websites (one per line)", "websites", 2],
                  ] as const).map(([label, key, rows]) => (
                    <div className={ROW} key={key}>
                      <label className={LABEL} htmlFor={`profile-business-${key}`}>{label}</label>
                      <textarea
                        id={`profile-business-${key}`}
                        rows={rows}
                        value={form[key]}
                        onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))}
                        className="mt-1 w-full resize-none rounded-lg border border-light-border bg-light-bg px-3 py-2 text-sm text-light-text outline-none dark:border-dark-border dark:bg-dark-secondary dark:text-dark-text"
                      />
                    </div>
                  ))}
                  <div className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => void saveBusiness()}
                      disabled={saving !== null}
                      className="w-full rounded-lg bg-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save business information
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
