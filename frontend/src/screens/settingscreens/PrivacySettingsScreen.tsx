import { useEffect, useState } from "react"
import {
  GetPrivacySettings,
  SetPrivacySetting,
  GetStatusPrivacy,
  GetBlockList,
  SetStatusPrivacy,
} from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { RowList, SettingRow, SelectMenu, SettingsSection } from "../../components/settings/ui-kit"

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

    return () => {
      cancelled = true
    }
  }, [])

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

  // D-TIMER-001: HyperMeow exposes SetDefaultDisappearingTimer but no getter
  // for the account-level default (no client method, no appstate/global setting,
  // no handled notification). A picker seeded with 0 would falsely claim
  // "Off", so the row below states the limitation honestly instead. Revisit
  // when the fork adds a real GetDefaultDisappearingTimer binding.

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
            control={<span className="text-sm text-light-text dark:text-dark-text">{blockedCount}</span>}
            hint="Manage blocked contacts on your phone."
          />
          <SettingRow
            title="Default message timer"
            description="How long new messages stay before disappearing. This is an account-level setting stored on your WhatsApp account."
            hint="Value not shown: this client cannot read the account default back — HyperMeow only exposes a setter, so any value displayed here would be a guess. The in-app per-chat timer control is group-only (1:1 chats read back as 0); set the account default or a 1:1 chat timer on the phone."
          />
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
