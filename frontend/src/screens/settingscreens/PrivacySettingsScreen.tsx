import { useCallback, useEffect, useState } from "react"
import {
  GetPrivacySettings,
  SetPrivacySetting,
  GetStatusPrivacy,
  GetBlockList,
  SetStatusPrivacy,
  GetDisappearingTimerDefault,
  SetDisappearingTimerDefault,
} from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import {
  RowList,
  SettingRow,
  SelectMenu,
  SettingsSection,
  ActionButton,
} from "../../components/settings/ui-kit"

interface Setting {
  key: string
  label: string
  description: string
  options: { value: string; label: string }[]
}

/** Render excluded contacts as phone numbers rather than raw JIDs. */
function jidToPhone(jid: string): string {
  const raw = jid.split("@")[0].split(":")[0]
  const digits = raw.replace(/\D/g, "")
  // Only phone-number JIDs get a "+"; LIDs and other identifiers are shown
  // as-is rather than being falsely presented as phone numbers.
  return digits && /^\d+$/.test(raw) ? `+${digits}` : raw || jid
}

// D-TIMER-001: the four standard account-default values, kept as strings so
// they can feed SelectMenu<string> directly.
const TIMER_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "86400", label: "24 hours" },
  { value: "604800", label: "7 days" },
  { value: "7776000", label: "90 days" },
]
const STANDARD_TIMER_SECONDS = new Set(TIMER_OPTIONS.map(o => Number(o.value)))

/** Humanize a REAL server value; never substitute a guessed one. */
function formatTimerSeconds(seconds: number): string {
  const standard = TIMER_OPTIONS.find(o => Number(o.value) === seconds)
  if (standard) return standard.label
  if (!Number.isFinite(seconds)) return `Unknown value (${seconds})`
  if (seconds <= 0) return `Unknown value (${seconds})`
  const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"}`
  if (seconds % 86400 === 0) return unit(seconds / 86400, "day")
  if (seconds % 3600 === 0) return unit(seconds / 3600, "hour")
  if (seconds % 60 === 0) return unit(seconds / 60, "minute")
  return unit(seconds, "second")
}

const SETTINGS: Setting[] = [
  {
    key: "last",
    label: "Last seen & online",
    description: "Who can see your last seen time and online status.",
    options: [
      { value: "all", label: "Everyone" },
      { value: "contacts", label: "My contacts" },
      { value: "contact_blacklist", label: "My contacts except…" },
      { value: "none", label: "Nobody" },
    ],
  },
  {
    key: "profile",
    label: "Profile photo",
    description: "Who can see your profile photo.",
    options: [
      { value: "all", label: "Everyone" },
      { value: "contacts", label: "My contacts" },
      { value: "contact_blacklist", label: "My contacts except…" },
      { value: "none", label: "Nobody" },
    ],
  },
  {
    key: "status",
    label: "About",
    description: "Who can see your about information.",
    options: [
      { value: "all", label: "Everyone" },
      { value: "contacts", label: "My contacts" },
      { value: "contact_blacklist", label: "My contacts except…" },
      { value: "none", label: "Nobody" },
    ],
  },
  {
    key: "groupadd",
    label: "Groups",
    description: "Who can add you to groups.",
    options: [
      { value: "all", label: "Everyone" },
      { value: "contacts", label: "My contacts" },
      { value: "contact_blacklist", label: "My contacts except…" },
    ],
  },
  {
    key: "readreceipts",
    label: "Read receipts",
    description:
      "Who can see when you read their messages. Read receipts are always sent for group chats.",
    options: [
      { value: "all", label: "Everyone" },
      { value: "none", label: "Nobody" },
    ],
  },
  {
    key: "online",
    label: "Online status",
    description: "Who can see when you are online.",
    // whatsmeow: valid values are only "all" and "match_last_seen".
    options: [
      { value: "all", label: "Everyone" },
      { value: "match_last_seen", label: "Same as last seen" },
    ],
  },
  {
    key: "calladd",
    label: "Calls",
    description: "Who can call you.",
    // whatsmeow: valid values are only "all" and "known".
    options: [
      { value: "all", label: "Everyone" },
      { value: "known", label: "Known contacts" },
    ],
  },
]

const PrivacySettingsScreen = () => {
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [statusBlacklist, setStatusBlacklist] = useState<string[]>([])
  const [blockedCount, setBlockedCount] = useState(0)

  // D-TIMER-001: the timer's state is independent of the other privacy rows so
  // an unreadable account default is never reported as a privacy-settings error.
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null)
  const [timerReadLoading, setTimerReadLoading] = useState(true)
  const [timerReadError, setTimerReadError] = useState("")
  const [timerBusy, setTimerBusy] = useState(false)
  const [timerStatus, setTimerStatus] = useState<{
    tone: "success" | "error"
    text: string
  } | null>(null)

  /** Read the real account default. A null result means "no trustworthy value". */
  const loadTimerDefault = useCallback(async (isCancelled?: () => boolean) => {
    setTimerReadLoading(true)
    setTimerReadError("")
    try {
      const seconds = await GetDisappearingTimerDefault()
      if (!isCancelled?.()) {
        setTimerSeconds(seconds)
        return seconds
      }
    } catch (err) {
      if (!isCancelled?.()) {
        console.error("Failed to read the default message timer:", err)
        setTimerSeconds(null)
        setTimerReadError("Couldn't read the current default from the server")
      }
    } finally {
      if (!isCancelled?.()) setTimerReadLoading(false)
    }
    return null
  }, [])

  useEffect(() => {
    let cancelled = false
    GetPrivacySettings()
      .then(res => {
        if (cancelled) return
        setValues({
          last: res.last_seen,
          profile: res.profile,
          status: res.status,
          groupadd: res.group_add,
          readreceipts: res.read_receipts,
          online: res.online,
          calladd: res.call_add,
        })
      })
      .catch(err => {
        console.error("Failed to load privacy settings:", err)
        setError("Failed to load privacy settings")
      })
      .finally(() => !cancelled && setLoading(false))

    GetBlockList()
      .then(entries => {
        if (!cancelled) setBlockedCount(entries.length)
      })
      .catch(() => {})

    GetStatusPrivacy()
      .then(entries => {
        if (cancelled) return
        for (const e of entries) {
          // StatusPrivacy.Type is "contacts" | "blacklist" | "whitelist"
          // (whatsmeow), not the "contact_blacklist" privacy-setting value.
          if (e.type === "blacklist") {
            setStatusBlacklist(e.jids || [])
          }
        }
      })
      .catch(() => {})

    // The account default is read from the server on mount, not assumed.
    loadTimerDefault(() => cancelled)

    return () => {
      cancelled = true
    }
  }, [loadTimerDefault])

  const handleChange = async (key: string, value: string) => {
    setBusy(key)
    setError("")
    try {
      if (key === "status") {
        await SetStatusPrivacy(value)
      } else {
        await SetPrivacySetting(key, value)
      }
      setValues(prev => ({ ...prev, [key]: value }))
    } catch (err) {
      console.error(`Failed to set ${key}:`, err)
      setError(`Failed to update ${key}`)
    } finally {
      setBusy(null)
    }
  }

  const handleTimerRefresh = () => {
    setTimerStatus(null)
    void loadTimerDefault()
  }

  const handleTimerChange = async (value: string) => {
    if (!value) return // the "Choose…" placeholder is not a real selection
    const seconds = Number(value)
    if (!Number.isFinite(seconds)) return
    setTimerStatus(null)
    setTimerBusy(true)
    try {
      await SetDisappearingTimerDefault(seconds)
      // Read-after-write: a local choice is never shown as the current value.
      // Only a fresh server read may update what the row displays, so a failed
      // save or a failed confirmation cannot leave a guessed number on screen.
      const confirmed = await loadTimerDefault()
      setTimerStatus(
        confirmed === null
          ? {
              tone: "error",
              text: "Saved, but the server value could not be re-read. Use Refresh to confirm.",
            }
          : {
              tone: "success",
              text: `Saved. Server now reports: ${formatTimerSeconds(confirmed)}`,
            },
      )
    } catch (err) {
      console.error("Failed to set the default message timer:", err)
      setTimerStatus({
        tone: "error",
        text: "Couldn't save the default timer. The value shown is the last server reading.",
      })
    } finally {
      setTimerBusy(false)
    }
  }

  // D-TIMER-001: GetDisappearingTimerDefault() reads the account-level default
  // through the usync-backed getter in the generated bindings (unlike
  // GetDisappearingTimer, which only reads per-chat group metadata). Every value
  // shown below comes from that getter — on mount, on Refresh/Retry, and again
  // after each SetDisappearingTimerDefault() write. The locally picked option is
  // never treated as evidence; the post-write re-read is the only thing that
  // updates the displayed value, so a failed save or a failed confirmation can
  // never leave a guessed default on screen.

  const timerSelectValue =
    timerSeconds !== null && STANDARD_TIMER_SECONDS.has(timerSeconds) ? String(timerSeconds) : ""
  const timerSelectOptions =
    timerSelectValue === "" ? [{ value: "", label: "Choose…" }, ...TIMER_OPTIONS] : TIMER_OPTIONS
  const timerHint = timerReadError
    ? timerReadError
    : timerSeconds === null
      ? "Reading the current default from your account…"
      : `Current default from your account: ${formatTimerSeconds(timerSeconds)}`

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] text-light-muted dark:text-dark-muted">
        Control who can see your personal information.
      </p>

      {loading && (
        <div className="flex justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-green border-t-transparent" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl bg-red-500/10 px-3.5 py-2.5 text-[13px] font-medium text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!loading && (
        <SettingsSection title="Who can see my personal info">
          <RowList>
            {SETTINGS.map(s => (
              <div key={s.key}>
                <SettingRow
                  title={s.label}
                  description={s.description}
                  control={
                    <SelectMenu
                      value={values[s.key] || ""}
                      options={s.options}
                      onChange={v => handleChange(s.key, v)}
                      disabled={busy === s.key}
                    />
                  }
                />
                {s.key === "status" &&
                  values[s.key] === "contact_blacklist" &&
                  statusBlacklist.length > 0 && (
                    <div className="px-4 pb-2.5 text-[12px] text-light-muted dark:text-dark-muted">
                      Excluded: {statusBlacklist.map(jidToPhone).join(", ")}
                    </div>
                  )}
              </div>
            ))}
          </RowList>
        </SettingsSection>
      )}

      <SettingsSection title="Messaging">
        <RowList>
          <SettingRow
            title="Blocked contacts"
            description="People whose messages and calls you do not receive."
            control={
              <span className="text-sm text-light-text dark:text-dark-text">{blockedCount}</span>
            }
            hint="Manage blocked contacts on your phone."
          />
          <div>
            <SettingRow
              title="Default message timer"
              description="How long new messages stay before disappearing. This is an account-level setting stored on your WhatsApp account."
              hint={timerHint}
              control={
                <div className="flex shrink-0 items-center gap-1.5">
                  <SelectMenu
                    value={timerSelectValue}
                    options={timerSelectOptions}
                    onChange={handleTimerChange}
                    disabled={timerReadLoading || timerBusy}
                    ariaLabel="Default message timer"
                  />
                  <ActionButton
                    variant="ghost"
                    onClick={handleTimerRefresh}
                    disabled={timerReadLoading || timerBusy}
                    className="min-h-8 px-2.5 text-[12px]"
                  >
                    Refresh
                  </ActionButton>
                </div>
              }
            />
            {timerReadError && !timerReadLoading && (
              <div className="px-4 pb-2.5">
                <ActionButton
                  variant="ghost"
                  onClick={handleTimerRefresh}
                  disabled={timerBusy}
                  className="min-h-8 px-2.5 text-[12px]"
                >
                  Retry
                </ActionButton>
              </div>
            )}
            {timerStatus && (
              <div
                className={`px-4 pb-2.5 text-[12px] font-medium ${
                  timerStatus.tone === "error"
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-deep dark:text-green-light"
                }`}
              >
                {timerStatus.text}
              </div>
            )}
          </div>
        </RowList>
      </SettingsSection>

      <SettingsSection title="Advanced">
        <RowList>
          {[
            ["Block unknown account messages", "Not available in this client yet."],
            ["Protect IP address in calls", "Not available in this client yet."],
            ["Turn off link previews", "Not available in this client yet."],
            ["App lock", "Not available in this client yet."],
          ].map(([title, hint]) => (
            <SettingRow key={title} title={title} hint={hint} />
          ))}
        </RowList>
      </SettingsSection>
    </div>
  )
}

export default PrivacySettingsScreen
