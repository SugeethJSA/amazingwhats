import { useState, useEffect, useRef } from "react"
import {
  GetCustomCSS,
  SetCustomCSS,
  GetCustomJS,
  SetCustomJS,
  Reinitialize,
  SetProxy,
  FetchStickerPack,
  CheckForUpdates,
} from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"

import ComponentColorSelector from "../../components/settings/ComponentColorSelector"
import EaseVisualizer from "../../components/settings/ComponentEaseSelector"
import {
  SettingsCard,
  TextField,
  ActionButton,
  StatusBanner,
} from "../../components/settings/ui-kit"

function CodeEditorCard({
  title,
  description,
  value,
  onChange,
  onSave,
  placeholder,
  saved,
  dirty,
}: {
  title: string
  description: string
  value: string
  onChange: (v: string) => void
  onSave: () => void
  placeholder: string
  saved: boolean
  dirty: boolean
}) {
  return (
    <SettingsCard>
      <div className="border-b border-black/[0.04] px-5 py-4 dark:border-white/[0.06]">
        <h3 className="text-[15px] font-semibold text-light-text dark:text-dark-text">{title}</h3>
        <p className="mt-0.5 text-[13px] text-light-muted dark:text-dark-muted">{description}</p>
      </div>
      <div className="space-y-3 p-5">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="h-40 w-full resize-y rounded-xl border border-black/[0.08] bg-light-secondary p-3 font-mono text-[13px] leading-relaxed text-light-text outline-none transition-all placeholder:text-light-muted focus:border-[#21c063] focus:ring-2 focus:ring-[var(--color-focus-ring)] dark:border-white/[0.1] dark:bg-dark-tertiary dark:text-dark-text dark:placeholder:text-dark-muted"
        />
        <div className="flex items-center gap-3">
          <ActionButton onClick={onSave}>Save {title}</ActionButton>
          {dirty && (
            <span className="text-[12px] font-medium text-light-muted dark:text-dark-muted">
              Unsaved changes
            </span>
          )}
          {saved && <StatusBanner tone="success">Applied and saved</StatusBanner>}
        </div>
      </div>
    </SettingsCard>
  )
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <SettingsCard>
      <div className="border-b border-black/[0.04] px-5 py-4 dark:border-white/[0.06]">
        <h3 className="text-[15px] font-semibold text-light-text dark:text-dark-text">{title}</h3>
        <p className="mt-0.5 text-[13px] text-light-muted dark:text-dark-muted">{description}</p>
      </div>
      <div className="space-y-3 p-5">{children}</div>
    </SettingsCard>
  )
}

const AdvancedScreen = () => {
  const rootRef = useRef<HTMLDivElement>(null)
  const [customCSS, setCustomCSS] = useState("")
  const [cssBaseline, setCssBaseline] = useState("")
  const [customJS, setCustomJS] = useState("")
  const [jsBaseline, setJsBaseline] = useState("")
  const [codeError, setCodeError] = useState<string | null>(null)
  const [proxyURL, setProxyURL] = useState("")
  const [proxyBusy, setProxyBusy] = useState(false)
  const [proxyResult, setProxyResult] = useState<string | null>(null)
  const [stickerPackID, setStickerPackID] = useState("")
  const [stickerBusy, setStickerBusy] = useState(false)
  const [stickerResult, setStickerResult] = useState<string | null>(null)
  const [cssSaved, setCssSaved] = useState(false)
  const [jsSaved, setJsSaved] = useState(false)
  const [reloadMsg, setReloadMsg] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const cssDirty = customCSS !== cssBaseline
  const jsDirty = customJS !== jsBaseline
  const hasUnsavedCode = cssDirty || jsDirty

  useEffect(() => {
    let cancelled = false
    Promise.all([GetCustomCSS(), GetCustomJS()])
      .then(([css, js]) => {
        if (cancelled) return
        setCustomCSS(css)
        setCssBaseline(css)
        setCustomJS(js)
        setJsBaseline(js)
      })
      .catch(() => {
        if (!cancelled) {
          setCodeError(
            "Could not load your saved customizations. You can still edit and save below.",
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!codeError) return
    const t = setTimeout(() => setCodeError(null), 5000)
    return () => clearTimeout(t)
  }, [codeError])

  // beforeunload covers closing/reloading the window. Category changes and
  // "Back to chats" are owned by the parent screen, so this capture-phase
  // guard keeps unsaved editor text from being discarded silently.
  useEffect(() => {
    if (!hasUnsavedCode) return

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)

    const onClickCapture = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return
      const button = e.target.closest("button")
      // Save/Reload and other controls inside this screen handle their own flow.
      if (!button || rootRef.current?.contains(button)) return
      // Clearing the settings search does not navigate away.
      if (button.getAttribute("aria-label") === "Clear search") return
      if (
        !window.confirm(
          "You have unsaved changes in Custom CSS or Custom JS. Leave without saving?",
        )
      ) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener("click", onClickCapture, true)

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClickCapture, true)
    }
  }, [hasUnsavedCode])

  useEffect(() => {
    if (!cssSaved) return
    const t = setTimeout(() => setCssSaved(false), 2000)
    return () => clearTimeout(t)
  }, [cssSaved])

  useEffect(() => {
    if (!jsSaved) return
    const t = setTimeout(() => setJsSaved(false), 2000)
    return () => clearTimeout(t)
  }, [jsSaved])

  useEffect(() => {
    if (!reloadMsg) return
    const t = setTimeout(() => setReloadMsg(null), 2000)
    return () => clearTimeout(t)
  }, [reloadMsg])

  useEffect(() => {
    if (!updateError) return
    const t = setTimeout(() => setUpdateError(null), 5000)
    return () => clearTimeout(t)
  }, [updateError])

  const applyCustomCode = (code: string, id: string, tag: "style" | "script") => {
    const oldElement = document.getElementById(id)
    if (oldElement) oldElement.remove()

    if (code) {
      const element = document.createElement(tag)
      element.id = id
      element.innerHTML = code
      document[tag === "style" ? "head" : "body"].appendChild(element)
    }
  }

  const handleSaveCSS = async () => {
    setCodeError(null)
    try {
      await SetCustomCSS(customCSS)
      applyCustomCode(customCSS, "custom-css", "style")
      setCssBaseline(customCSS)
      setCssSaved(true)
    } catch {
      setCodeError(
        "Could not save custom CSS. Your changes are still in the editor — please try again.",
      )
    }
  }

  const handleSaveJS = async () => {
    setCodeError(null)
    try {
      await SetCustomJS(customJS)
      applyCustomCode(customJS, "custom-js", "script")
      setJsBaseline(customJS)
      setJsSaved(true)
    } catch {
      setCodeError(
        "Could not save custom JS. Your changes are still in the editor — please try again.",
      )
    }
  }

  const handleReloadCustom = async () => {
    if (
      hasUnsavedCode &&
      !window.confirm("Reloading will discard your unsaved CSS and JS edits. Continue?")
    ) {
      return
    }
    setCodeError(null)
    try {
      const [css, js] = await Promise.all([GetCustomCSS(), GetCustomJS()])
      setCustomCSS(css)
      setCssBaseline(css)
      setCustomJS(js)
      setJsBaseline(js)
      applyCustomCode(css, "custom-css", "style")
      applyCustomCode(js, "custom-js", "script")
      setReloadMsg("Custom CSS and JS reloaded from disk")
    } catch {
      setCodeError(
        "Could not reload customizations from disk. Your editor contents were left unchanged.",
      )
    }
  }

  const handleReinitialize = async () => {
    setCodeError(null)
    try {
      await Reinitialize()
      setReloadMsg("Connection re-initialized")
    } catch {
      setCodeError(
        "Could not re-initialize the connection. Your session is unchanged — please try again.",
      )
    }
  }

  const handleCheckForUpdates = () => {
    setUpdateError(null)
    // The binding starts the interactive update flow in the background and
    // returns immediately; availability and failures are reported by the
    // wa:update_available / wa:update_error toasts. Only a rejected binding
    // call is handled here, with a fixed user-safe message.
    CheckForUpdates().catch(() => {
      setUpdateError("Could not start the update check. Please try again.")
    })
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      {codeError && <StatusBanner tone="error">{codeError}</StatusBanner>}

      <ComponentColorSelector />
      <EaseVisualizer />

      <CodeEditorCard
        title="Custom CSS"
        description="Inject custom styles that are applied across the entire app"
        value={customCSS}
        onChange={setCustomCSS}
        onSave={handleSaveCSS}
        placeholder="/* Enter custom CSS here */"
        saved={cssSaved}
        dirty={cssDirty}
      />

      <p className="px-1 text-[13px] leading-relaxed text-light-muted dark:text-dark-muted">
        <span className="font-semibold text-light-text dark:text-dark-text">
          Custom JS runs only in Whats4Linux, on this device.
        </span>{" "}
        It can change how the interface looks and behaves, but it is an unsupported experiment: a
        bad script can break the UI until you remove it. Only paste code you understand and trust.
      </p>

      <CodeEditorCard
        title="Custom JS"
        description="Inject custom scripts for advanced tweaks and experiments"
        value={customJS}
        onChange={setCustomJS}
        onSave={handleSaveJS}
        placeholder="// Enter custom JS here"
        saved={jsSaved}
        dirty={jsDirty}
      />

      <SectionCard
        title="Reload customizations"
        description="Reload custom CSS and JS from disk. Useful if you edited the files externally."
      >
        <div className="flex items-center gap-3">
          <ActionButton variant="neutral" onClick={handleReloadCustom}>
            Reload CSS & JS
          </ActionButton>
          {reloadMsg && <StatusBanner tone="info">{reloadMsg}</StatusBanner>}
        </div>
      </SectionCard>

      <SectionCard
        title="Updates"
        description="Check for a newer version. If one is found, the updater window will guide you through installing it."
      >
        <div className="flex flex-col gap-2">
          <ActionButton variant="neutral" onClick={handleCheckForUpdates}>
            Check for updates
          </ActionButton>
          {updateError && <StatusBanner tone="error">{updateError}</StatusBanner>}
        </div>
      </SectionCard>

      <SectionCard
        title="Session management"
        description="Re-initialize the WhatsApp connection. Use this if you're experiencing sync issues."
      >
        <ActionButton variant="neutral" onClick={handleReinitialize}>
          Re-initialize connection
        </ActionButton>
      </SectionCard>

      <SectionCard
        title="Proxy"
        description="Set a SOCKS5 or HTTP proxy for the WhatsApp connection"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextField
            value={proxyURL}
            onChange={e => setProxyURL(e.target.value)}
            placeholder="socks5://127.0.0.1:1080"
          />
          <ActionButton
            variant="neutral"
            disabled={proxyBusy || !proxyURL.trim()}
            onClick={async () => {
              setProxyBusy(true)
              setProxyResult(null)
              try {
                await SetProxy(proxyURL)
                setProxyResult("Proxy set!")
              } catch {
                // Do not surface the raw error string: proxy URLs can embed credentials.
                setProxyResult("Failed to set proxy. Check the URL and try again.")
              } finally {
                setProxyBusy(false)
              }
            }}
          >
            {proxyBusy ? "Setting…" : "Set proxy"}
          </ActionButton>
        </div>
        {proxyResult && (
          <StatusBanner tone={proxyResult === "Proxy set!" ? "success" : "error"}>
            {proxyResult}
          </StatusBanner>
        )}
      </SectionCard>

      <SectionCard
        title="Sticker pack"
        description="Fetch a sticker pack by its ID to download all stickers"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextField
            value={stickerPackID}
            onChange={e => setStickerPackID(e.target.value)}
            placeholder="Sticker pack ID"
          />
          <ActionButton
            variant="neutral"
            disabled={stickerBusy || !stickerPackID.trim()}
            onClick={async () => {
              setStickerBusy(true)
              setStickerResult(null)
              try {
                await FetchStickerPack(stickerPackID.trim())
                setStickerResult("Fetched pack successfully")
              } catch (err) {
                setStickerResult("Failed to fetch sticker pack. Check the ID and try again.")
              } finally {
                setStickerBusy(false)
              }
            }}
          >
            {stickerBusy ? "Fetching…" : "Fetch"}
          </ActionButton>
        </div>
        {stickerResult && (
          <StatusBanner tone={stickerResult.startsWith("Fetched") ? "success" : "error"}>
            {stickerResult}
          </StatusBanner>
        )}
      </SectionCard>
    </div>
  )
}

export default AdvancedScreen
