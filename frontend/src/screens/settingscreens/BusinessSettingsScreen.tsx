import { useCallback, useEffect, useState } from "react"
import {
  GetMyBusinessProfile,
  UpdateMyBusinessProfile,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"
import { useUIStore } from "../../store/useUIStore"
import {
  ActionButton,
  SettingsCard,
  SettingsSection,
  StatusBanner,
  TextField,
} from "../../components/settings/ui-kit"

// Shared keyboard-focus treatment: 2px outline at 2px offset in the global
// --color-focus-ring token (>=3:1 on both canvases). No component-local ring.
const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-focus-ring)"

const LIMITS = { description: 1024, address: 512, email: 320, website: 2048 } as const

interface BusinessHour {
  day_of_week?: unknown
  mode?: unknown
  open_time?: unknown
  close_time?: unknown
}

/** Only fields this pane actually reads; the backend map has more keys. */
interface BusinessProfile {
  address: string | null
  email: string | null
  description: string | null
  websites: string[]
  categories: string[]
  businessHours: BusinessHour[]
  timezone: string | null
  aeaAccountType: string | null
  isBusiness: boolean
}

interface FormValues {
  description: string
  address: string
  email: string
  websites: string[]
}

interface ProfileUpdate {
  address?: string
  email?: string
  description?: string
  websites?: string[]
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
        .map(v => v.trim())
    : []
}

/**
 * The backend always emits these keys (empty strings/arrays for absent data),
 * so "absent" must be normalized to null/[] before deciding what to render.
 */
function normalizeProfile(raw: { [key: string]?: unknown } | null | undefined): BusinessProfile {
  const categories = asStringList(raw?.categories)
  const singleCategory = asText(raw?.category)
  return {
    address: asText(raw?.address),
    email: asText(raw?.email),
    description: asText(raw?.description),
    websites: asStringList(raw?.websites),
    categories: categories.length ? categories : singleCategory ? [singleCategory] : [],
    businessHours: Array.isArray(raw?.business_hours) ? (raw.business_hours as BusinessHour[]) : [],
    timezone: asText(raw?.business_hours_timezone),
    aeaAccountType: asText(raw?.aea_account_type),
    isBusiness: raw?.is_business === true,
  }
}

function formFromProfile(profile: BusinessProfile): FormValues {
  return {
    description: profile.description ?? "",
    address: profile.address ?? "",
    email: profile.email ?? "",
    websites: [profile.websites[0] ?? "", profile.websites[1] ?? ""],
  }
}

/** Only include fields whose value differs from the loaded profile. */
function buildUpdate(form: FormValues, profile: BusinessProfile): ProfileUpdate {
  const update: ProfileUpdate = {}
  const description = form.description.trim()
  if (description !== (profile.description ?? "")) update.description = description
  const address = form.address.trim()
  if (address !== (profile.address ?? "")) update.address = address
  const email = form.email.trim()
  if (email !== (profile.email ?? "")) update.email = email
  const websites = form.websites.map(w => w.trim()).filter(Boolean)
  if (
    websites.length !== profile.websites.length ||
    websites.some((w, i) => w !== profile.websites[i])
  ) {
    update.websites = websites
  }
  return update
}

function isAbsoluteHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const parsed = new URL(value)
    return Boolean(parsed.host) && (parsed.protocol === "http:" || parsed.protocol === "https:")
  } catch {
    return false
  }
}

function validateForm(form: FormValues): string | null {
  // The backend enforces byte limits; maxLength counts UTF-16 units, so
  // multibyte text can pass the inputs but still be rejected server-side.
  const bytes = (value: string) => new TextEncoder().encode(value).length
  const email = form.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address."
  if (bytes(email) > 320) return "Email is too long."
  if (bytes(form.description.trim()) > 1024) return "Description is too long."
  if (bytes(form.address.trim()) > 512) return "Address is too long."
  const websites = form.websites.map(w => w.trim()).filter(Boolean)
  if (websites.length > 2) return "You can add up to two websites."
  if (websites.some(s => bytes(s) > 2048)) return "A website URL is too long."
  if (websites.some(s => !isAbsoluteHttpUrl(s))) {
    return "Websites must be absolute http:// or https:// URLs."
  }
  return null
}

function humanize(value: string | null): string | null {
  if (!value) return null
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

/** A real line per day; 24h and appointment-only never invent clock times. */
function businessHourLine(hour: BusinessHour): string | null {
  const rawDay = typeof hour.day_of_week === "string" ? hour.day_of_week.trim() : ""
  const day = rawDay ? rawDay.charAt(0).toUpperCase() + rawDay.slice(1) : ""
  const mode = typeof hour.mode === "string" ? hour.mode.trim().toLowerCase() : ""
  const open = typeof hour.open_time === "string" ? hour.open_time.trim() : ""
  const close = typeof hour.close_time === "string" ? hour.close_time.trim() : ""

  if (mode === "appointment_only") return day ? `${day}: By appointment only` : "By appointment only"
  if (mode === "open_24h" || (open === "0" && close === "0")) {
    return day ? `${day}: Open 24 hours` : "Open 24 hours"
  }
  if (open && close) {
    const range = `${open}–${close}`
    return day ? `${day}: ${range}` : range
  }
  return day || null
}

const LABEL_CLASS =
  "text-[12px] font-semibold uppercase tracking-wide text-light-muted dark:text-dark-muted"

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="px-5 py-3.5">
      <div className={LABEL_CLASS}>{label}</div>
      <div className="mt-1 break-words text-sm text-light-text dark:text-dark-text">{value}</div>
    </div>
  )
}

function InfoWebsites({ websites }: { websites: string[] }) {
  if (websites.length === 0) return null
  return (
    <div className="px-5 py-3.5">
      <div className={LABEL_CLASS}>Websites</div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {websites.map((url, i) => (
          <li key={`${url}-${i}`}>
            {isAbsoluteHttpUrl(url) ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block break-all text-sm text-blue-500 hover:underline"
              >
                {url}
              </a>
            ) : (
              <span className="block break-all text-sm text-light-text dark:text-dark-text">
                {url}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function InfoHours({ hours, timezone }: { hours: BusinessHour[]; timezone: string | null }) {
  const lines = hours
    .map(businessHourLine)
    .filter((line): line is string => Boolean(line))
  if (lines.length === 0 && !timezone) return null
  return (
    <div className="px-5 py-3.5">
      <div className={LABEL_CLASS}>Opening hours</div>
      {lines.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {lines.map((line, i) => (
            <li key={`${line}-${i}`} className="text-sm text-light-text dark:text-dark-text">
              {line}
            </li>
          ))}
        </ul>
      )}
      {timezone && (
        <p className="mt-1 text-[12px] text-light-muted dark:text-dark-muted">
          Timezone: {timezone}
        </p>
      )}
    </div>
  )
}

const BusinessSettingsScreen = () => {
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading")
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [form, setForm] = useState<FormValues>({
    description: "",
    address: "",
    email: "",
    websites: ["", ""],
  })
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  /** `silent` is used after a save so the form does not flash a loading state. */
  const load = useCallback(async (silent = false): Promise<boolean> => {
    if (!silent) setStatus("loading")
    try {
      const raw = await GetMyBusinessProfile()
      const next = normalizeProfile(raw)
      if (!next.isBusiness) {
        setProfile(null)
        setStatus("unavailable")
        return false
      }
      setProfile(next)
      setStatus("ready")
      return true
    } catch {
      // Never surface a raw binding error, but do not misattribute a fetch
      // failure (offline, rate limit, not logged in) to the account type.
      setProfile(null)
      setStatus("error")
      return false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (status === "ready" && profile) {
      setForm(formFromProfile(profile))
      setValidationError(null)
    }
  }, [status, profile])

  const handleSave = async () => {
    if (!profile || saving) return
    const error = validateForm(form)
    if (error) {
      setValidationError(error)
      return
    }
    const update = buildUpdate(form, profile)
    setValidationError(null)
    if (Object.keys(update).length === 0) {
      useUIStore.getState().addNotification("No changes to save", { tone: "info" })
      return
    }
    setSaving(true)
    try {
      await UpdateMyBusinessProfile(update)
      useUIStore.getState().addNotification("Business profile saved", { tone: "success" })
      await load(true)
    } catch {
      useUIStore.getState().addNotification("Couldn't save business profile", { tone: "error" })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!profile) return
    setForm(formFromProfile(profile))
    setValidationError(null)
  }

  if (status === "loading") {
    return <p className="text-sm text-light-muted dark:text-dark-muted">Loading business profile…</p>
  }

  if (status === "error") {
    return (
      <SettingsCard>
        <div className="px-5 py-8 text-center">
          <h3 className="text-[15px] font-semibold text-light-text dark:text-dark-text">
            Business profile unavailable right now
          </h3>
          <p className="mt-1 text-[13px] text-light-muted dark:text-dark-muted">
            Try again later. Your other settings are unaffected.
          </p>
        </div>
      </SettingsCard>
    )
  }

  if (status === "unavailable" || !profile) {
    return (
      <SettingsCard>
        <div className="px-5 py-8 text-center">
          <h3 className="text-[15px] font-semibold text-light-text dark:text-dark-text">
            This account isn't a WhatsApp Business account
          </h3>
          <p className="mt-1 text-[13px] text-light-muted dark:text-dark-muted">
            Business profile editing is unavailable for this account.
          </p>
        </div>
      </SettingsCard>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <SettingsSection title="Current business info">
        <SettingsCard>
          <div className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
            <InfoRow label="Description" value={profile.description} />
            <InfoWebsites websites={profile.websites} />
            <InfoRow label="Email" value={profile.email} />
            <InfoRow label="Address" value={profile.address} />
            <InfoRow
              label="Categories"
              value={profile.categories.length ? profile.categories.join(", ") : null}
            />
            <InfoHours hours={profile.businessHours} timezone={profile.timezone} />
            <InfoRow label="Account type" value={humanize(profile.aeaAccountType)} />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Edit business info">
        <SettingsCard>
          <div className="space-y-4 p-5">
            <label className="block min-w-0 flex-1">
              <span className={LABEL_CLASS}>Description</span>
              <textarea
                aria-label="Business description"
                value={form.description}
                maxLength={LIMITS.description}
                rows={4}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className={
                  "mt-1.5 w-full resize-y rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-sm text-light-text placeholder:text-light-muted transition-colors dark:border-white/[0.1] dark:bg-transparent dark:text-dark-text dark:placeholder:text-dark-muted " +
                  FOCUS_RING
                }
              />
              <span className="mt-1 block text-[12px] text-light-muted dark:text-dark-muted">
                {form.description.length}/{LIMITS.description}
              </span>
            </label>

            <TextField
              label="Address"
              aria-label="Business address"
              value={form.address}
              maxLength={LIMITS.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
            />

            <TextField
              label="Email"
              aria-label="Business email"
              type="email"
              value={form.email}
              maxLength={LIMITS.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Website 1"
                aria-label="First business website"
                placeholder="https://example.com"
                value={form.websites[0] ?? ""}
                maxLength={LIMITS.website}
                onChange={e =>
                  setForm(f => ({ ...f, websites: [e.target.value, f.websites[1] ?? ""] }))
                }
              />
              <TextField
                label="Website 2"
                aria-label="Second business website"
                placeholder="https://example.org"
                value={form.websites[1] ?? ""}
                maxLength={LIMITS.website}
                onChange={e =>
                  setForm(f => ({ ...f, websites: [f.websites[0] ?? "", e.target.value] }))
                }
              />
            </div>

            {validationError && <StatusBanner tone="error">{validationError}</StatusBanner>}

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </ActionButton>
              <ActionButton variant="neutral" onClick={handleReset} disabled={saving}>
                Cancel
              </ActionButton>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}

export default BusinessSettingsScreen
