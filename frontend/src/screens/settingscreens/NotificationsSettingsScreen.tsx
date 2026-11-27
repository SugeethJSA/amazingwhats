import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  ActionButton,
  ChevronIcon,
  RowList,
  SettingRow,
  StatusBanner,
  SwitchRow,
} from "../../components/settings/ui-kit"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"
import {
  GetNotificationsEnabled,
  SendTestNotification,
  SetNotificationsEnabled,
} from "../../../bindings/github.com/lugvitc/amazingwhats/api/api.js"
import { EventsOn } from "../../lib/wailsRuntime"

const BellIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 22a2.98 2.98 0 0 0 2.818-2H9.182A2.98 2.98 0 0 0 12 22zm7-7.414V10c0-3.217-2.185-5.927-5.145-6.742C13.562 2.52 12.846 2 12 2s-1.562.52-1.855 1.258C7.185 4.074 5 6.783 5 10v4.586l-1.707 1.707A.996.996 0 0 0 3 17v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-1a.996.996 0 0 0-.293-.707L19 14.586z" />
  </svg>
)

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
  </svg>
)

const HeartIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
)

const GroupIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M8 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm8-.5a3 3 0 100-6 3 3 0 000 6zM8 13c-3.3 0-8 1.6-8 4.3V20h16v-2.7C16 14.6 11.3 13 8 13zm8 0c-.5 0-1 0-1.5.1 2.1 1.1 3.5 2.7 3.5 4.6V20h6v-2.9c0-2.7-4.4-4.1-8-4.1z" />
  </svg>
)

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.32.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z" />
  </svg>
)

const SoundIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
)

function Category({
  id,
  title,
  summary,
  icon,
  expanded,
  onToggle,
  children,
}: {
  id: string
  title: string
  summary: string
  icon: ReactNode
  expanded: string | null
  onToggle: (id: string) => void
  children: ReactNode
}) {
  const isOpen = expanded === id
  return (
    <div>
      <SettingRow
        title={title}
        icon={icon}
        onClick={() => onToggle(id)}
        control={
          <span className="flex items-center gap-2 text-sm text-light-muted dark:text-dark-muted">
            {summary}
            <ChevronIcon className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          </span>
        }
      />
      {isOpen && <div className="ml-6 border-l-2 border-green-muted pl-3">{children}</div>}
    </div>
  )
}

const NotificationsSettingsScreen = () => {
  const { showPreviews, updateSetting } = useAppSettingsStore()

  const [desktopNotifications, setDesktopNotifications] = useState(true)
  const [desktopBusy, setDesktopBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>("messages")
  const [testStatus, setTestStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    GetNotificationsEnabled()
      .then(enabled => {
        if (!cancelled) setDesktopNotifications(!!enabled)
      })
      .catch(err => {
        console.error("Failed to load notifications state:", err)
      })

    const unsub = EventsOn("wa:notifications_toggled", (enabled: boolean) => {
      setDesktopNotifications(!!enabled)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const handleToggleDesktopNotifications = useCallback(async () => {
    if (desktopBusy) return
    const next = !desktopNotifications
    setDesktopBusy(true)
    setDesktopNotifications(next)
    try {
      await SetNotificationsEnabled(next)
    } catch (err) {
      console.error("Failed to toggle desktop notifications:", err)
      setDesktopNotifications(!next)
    } finally {
      setDesktopBusy(false)
    }
  }, [desktopBusy, desktopNotifications])

  const handleTest = async () => {
    setTestStatus(null)
    try {
      await SendTestNotification()
      setTestStatus("Test notification sent.")
    } catch {
      setTestStatus("Couldn't send a test notification. Check Windows notification permissions.")
    }
  }

  const on = (value: boolean) => (value ? "On" : "Off")

  return (
    <div className="flex flex-col gap-6">
      <RowList>
        <Category
          id="messages"
          title="Messages"
          summary={on(desktopNotifications)}
          icon={<BellIcon />}
          expanded={expanded}
          onToggle={id => setExpanded(expanded === id ? null : id)}
        >
          <SwitchRow
            title="Message notifications"
            description="Show desktop notifications for incoming messages"
            icon={<BellIcon />}
            enabled={desktopNotifications}
            onToggle={() => void handleToggleDesktopNotifications()}
          />
          <SwitchRow
            title="Show previews"
            description="Preview message text inside notifications"
            icon={<EyeIcon />}
            enabled={showPreviews}
            onToggle={() => updateSetting("showPreviews", !showPreviews)}
          />
          <SettingRow
            title="Reaction notifications"
            description="Get notified when a message you sent receives a reaction."
            hint="Not available in this client yet."
          />
          <SettingRow
            title="Notification sounds"
            description="Sounds are controlled by your device notification settings."
            hint="This client cannot change them yet."
          />
        </Category>

        <Category
          id="groups"
          title="Groups"
          summary={on(desktopNotifications)}
          icon={<GroupIcon />}
          expanded={expanded}
          onToggle={id => setExpanded(expanded === id ? null : id)}
        >
          <SettingRow
            title="Group messages"
            description="Group messages follow your message notification setting."
            hint="There is no separate group notification channel."
          />
        </Category>

        <Category
          id="status"
          title="Status"
          summary="Unavailable"
          icon={<HeartIcon />}
          expanded={expanded}
          onToggle={id => setExpanded(expanded === id ? null : id)}
        >
          <SettingRow
            title="Status reactions"
            description="Notifications for likes on your status."
            hint="Not available in this client yet."
          />
        </Category>

        <Category
          id="calling"
          title="Calling"
          summary="Unavailable"
          icon={<PhoneIcon />}
          expanded={expanded}
          onToggle={id => setExpanded(expanded === id ? null : id)}
        >
          <SettingRow
            title="Call notifications"
            description="Notifications and sounds for incoming calls."
            hint="Not available in this client yet."
          />
        </Category>
      </RowList>

      <div>
        <div className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-light-muted dark:text-dark-muted">
          Diagnostics
        </div>
        <RowList>
          <SettingRow
            title="Send test notification"
            description="Checks that this device can display a notification."
            control={<ActionButton onClick={() => void handleTest()}>Send</ActionButton>}
          />
          <SettingRow
            title="Run in background"
            description="Keep the app in the tray so messages still arrive with no window open."
            hint="Managed in General settings."
          />
        </RowList>
        {testStatus && (
          <div className="mt-3">
            <StatusBanner tone={testStatus.startsWith("Couldn't") ? "error" : "success"}>
              {testStatus}
            </StatusBanner>
          </div>
        )}
        <p className="mt-3 px-1 text-[13px] text-light-muted dark:text-dark-muted">
          To get notifications, make sure they are allowed in your device settings.
        </p>
      </div>
    </div>
  )
}

export default NotificationsSettingsScreen
