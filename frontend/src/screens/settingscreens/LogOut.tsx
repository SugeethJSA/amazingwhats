import { useState } from "react"
import ConfirmDialog from "@/components/common/ConfirmDialog"
import { Logout } from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import {
  ActionButton,
  RowList,
  SettingsCard,
  StatusBanner,
  SwitchRow,
} from "../../components/settings/ui-kit"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"

const LogOut = () => {
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { relinkWithFullHistory, updateSetting } = useAppSettingsStore()

  const handleLogout = async () => {
    setConfirmOpen(false)
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await Logout()
      window.location.reload()
    } catch {
      // Never surface a raw backend error: it can contain session identifiers.
      setError("Could not log out. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto mt-4 max-w-xl">
      <SettingsCard className="p-6">
        <h2 className="text-lg font-bold tracking-tight text-light-text dark:text-dark-text">
          Recover older messages
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-light-muted dark:text-dark-muted">
          Full history is sent by your phone only when a device is linked. To recover messages that
          are missing, turn this on, log out, remove this device from WhatsApp on your phone
          (Settings → Linked Devices), then scan the QR code again. Keep the phone nearby and online
          until the sync finishes. Your phone decides how much history it sends.
        </p>
        <RowList className="mt-3">
          <SwitchRow
            title="Request full history on next link"
            description="Applies to new pairings until turned off. Existing sessions are unaffected."
            enabled={relinkWithFullHistory}
            onToggle={() => updateSetting("relinkWithFullHistory", !relinkWithFullHistory)}
          />
        </RowList>
      </SettingsCard>

      <SettingsCard className="p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
            <path d="M16 13v-2H7V8l-5 4 5 4v-3z" />
            <path d="M20 3h-9c-1.103 0-2 .897-2 2v4h2V5h9v14h-9v-4H9v4c0 1.103.897 2 2 2h9c1.103 0 2-.897 2-2V5c0-1.103-.897-2-2-2z" />
          </svg>
        </div>
        <h2 className="mt-4 text-xl font-bold tracking-tight text-light-text dark:text-dark-text">
          Log out
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-light-muted dark:text-dark-muted">
          Logging out will disconnect your session and require scanning a QR code or entering a
          pairing code to reconnect.
        </p>
        {error && (
          <div className="mt-4">
            <StatusBanner tone="error">{error}</StatusBanner>
          </div>
        )}
        <ActionButton
          variant="danger"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          className="mt-5"
        >
          {busy ? "Logging out…" : "Log out"}
        </ActionButton>
      </SettingsCard>

      <p className="px-1 pt-4 text-[13px] leading-relaxed text-light-muted dark:text-dark-muted">
        Unofficial client — not affiliated with WhatsApp or Meta. Messages stay on this device.
      </p>

      <ConfirmDialog
        open={confirmOpen}
        title="Log out of amazingwhats?"
        description="You will need to scan a QR code or enter a pairing code again to reconnect."
        confirmLabel="Log out"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={handleLogout}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

export default LogOut
