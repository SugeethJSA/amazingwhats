import { SettingsCard } from "../../../components/settings/ui-kit"

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
    <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
  </svg>
)

const PRIVATE_ITEMS = [
  "Text and Voice messages",
  "Audio and Video calls",
  "Photos, videos and documents",
  "Location sharing",
  "Status updates",
]

export function SecurityNotificationsScreen() {
  return (
    <div className="flex flex-col gap-5">
      <SettingsCard className="p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green/10 text-green-deep dark:text-green-light">
          <ShieldIcon />
        </div>
        <div className="mt-4 text-lg font-semibold text-light-text dark:text-dark-text">
          Your chats and calls are private
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-light-muted dark:text-dark-muted">
          End-to-end encryption keeps your personal messages and calls between you and the people
          you choose. No one outside of the chat, not even WhatsApp, can read, listen to, or share
          them. This includes your:
        </p>
        <div className="mt-4 grid gap-1.5">
          {PRIVATE_ITEMS.map(item => (
            <div
              key={item}
              className="flex items-center gap-2.5 rounded-xl bg-black/[0.03] px-3.5 py-2 text-sm text-light-text dark:bg-white/[0.04] dark:text-dark-text"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green/15 text-green-deep dark:text-green-light">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                  <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </span>
              {item}
            </div>
          ))}
        </div>
        <button
          onClick={() => window.open("https://www.whatsapp.com/security/?lg=en", "_blank")}
          className="mt-5 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-green-deep transition-colors hover:underline dark:text-green-light"
        >
          Learn more about WhatsApp security (opens external site)
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
          </svg>
        </button>
      </SettingsCard>

      <SettingsCard className="p-5">
        <h3 className="text-[15px] font-semibold text-light-text dark:text-dark-text">
          Security alerts
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-light-muted dark:text-dark-muted">
          Security code change alerts are managed by WhatsApp and are always active for this
          session. There is no separate switch for them in Whats4Linux, so nothing here can be
          turned off by mistake.
        </p>
      </SettingsCard>
    </div>
  )
}

export default SecurityNotificationsScreen
