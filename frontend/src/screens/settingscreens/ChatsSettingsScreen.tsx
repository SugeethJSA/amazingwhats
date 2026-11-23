import { useState } from "react"
import {
  RowList,
  SwitchRow,
  TextField,
  ActionButton,
  StatusBanner,
  SettingsCard,
  SettingsSection,
} from "../../components/settings/ui-kit"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"
import { EditLabel } from "../../../bindings/github.com/lugvitc/whats4linux/api/api.js"

/** Stable numeric IDs are what the backend stores; names are for humans. */
interface LabelColor {
  value: number
  name: string
  color: string
}

const LABEL_COLOR_GROUPS: { name: string; colors: LabelColor[] }[] = [
  {
    name: "Warm",
    colors: [
      { value: 0, name: "Rose", color: "hsl(348 72% 52%)" },
      { value: 1, name: "Coral", color: "hsl(14 78% 56%)" },
      { value: 2, name: "Amber", color: "hsl(38 85% 50%)" },
      { value: 3, name: "Gold", color: "hsl(46 82% 48%)" },
      { value: 4, name: "Lime", color: "hsl(82 62% 45%)" },
      { value: 5, name: "Olive", color: "hsl(96 38% 38%)" },
      { value: 6, name: "Rust", color: "hsl(20 62% 40%)" },
    ],
  },
  {
    name: "Cool",
    colors: [
      { value: 7, name: "Mint", color: "hsl(156 56% 42%)" },
      { value: 8, name: "Emerald", color: "hsl(160 68% 36%)" },
      { value: 9, name: "Teal", color: "hsl(184 62% 40%)" },
      { value: 10, name: "Cyan", color: "hsl(192 78% 46%)" },
      { value: 11, name: "Azure", color: "hsl(210 78% 50%)" },
      { value: 12, name: "Indigo", color: "hsl(236 66% 55%)" },
      { value: 13, name: "Violet", color: "hsl(268 60% 56%)" },
    ],
  },
  {
    name: "Soft and neutral",
    colors: [
      { value: 14, name: "Blush", color: "hsl(344 52% 72%)" },
      { value: 15, name: "Peach", color: "hsl(24 72% 72%)" },
      { value: 16, name: "Sand", color: "hsl(38 44% 68%)" },
      { value: 17, name: "Sky", color: "hsl(202 60% 72%)" },
      { value: 18, name: "Lilac", color: "hsl(272 46% 74%)" },
      { value: 19, name: "Slate", color: "hsl(215 16% 48%)" },
      { value: 20, name: "Graphite", color: "hsl(220 10% 32%)" },
    ],
  },
]

const ALL_LABEL_COLORS: LabelColor[] = LABEL_COLOR_GROUPS.flatMap(group => group.colors)

const ChatsSettingsScreen = () => {
  const { spellCheck, replaceTextWithEmojis, enterIsSend, theme, updateSetting, toggleTheme } =
    useAppSettingsStore()
  const [labelId, setLabelId] = useState("")
  const [labelName, setLabelName] = useState("")
  const [labelColor, setLabelColor] = useState(0)
  const [labelBusy, setLabelBusy] = useState(false)
  const [deleteLabelId, setDeleteLabelId] = useState("")
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [labelMsg, setLabelMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null)

  const selectedColorName =
    ALL_LABEL_COLORS.find(color => color.value === labelColor)?.name ?? "Rose"

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Chat behaviour">
        <RowList>
          <SwitchRow
            title="Dark Theme"
            description={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            enabled={theme === "dark"}
            onToggle={toggleTheme}
          />
          <SwitchRow
            title="Enter is send"
            description="Pressing Enter will send the message instead of creating a new line"
            enabled={enterIsSend}
            onToggle={() => updateSetting("enterIsSend", !enterIsSend)}
          />
          <SwitchRow
            title="Spell Check"
            description="Check spelling as you type"
            hint="Not available yet — your preference is saved for a future release."
            enabled={spellCheck}
            onToggle={() => updateSetting("spellCheck", !spellCheck)}
            disabled
          />
          <SwitchRow
            title="Replace text with emojis"
            description="Emoji will replace specific text as you type"
            hint="Not available yet — your preference is saved for a future release."
            enabled={replaceTextWithEmojis}
            onToggle={() => updateSetting("replaceTextWithEmojis", !replaceTextWithEmojis)}
            disabled
          />
        </RowList>
      </SettingsSection>

      <SettingsSection title="Labels">
        <SettingsCard>
          <div className="border-b border-black/[0.04] px-5 py-4 dark:border-white/[0.06]">
            <h3 className="text-[15px] font-semibold text-light-text dark:text-dark-text">
              Create or delete labels
            </h3>
            <p className="mt-0.5 text-[13px] text-light-muted dark:text-dark-muted">
              Use the label ID in chat context menus.
            </p>
          </div>

          <div className="space-y-4 p-5">
            <div className="space-y-2">
              <div className="text-[13px] font-semibold text-light-text dark:text-dark-text">
                Create a label
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <TextField
                  value={labelId}
                  onChange={e => setLabelId(e.target.value)}
                  placeholder="Label ID (e.g. 1, 2, 3...)"
                />
                <TextField
                  value={labelName}
                  onChange={e => setLabelName(e.target.value)}
                  placeholder="Label name"
                />
              </div>
              <div className="pt-1">
                <div className="mb-1 text-[12px] font-medium text-light-muted dark:text-dark-muted">
                  Colour — currently {selectedColorName}
                </div>
                <div className="flex flex-col gap-2">
                  {LABEL_COLOR_GROUPS.map(group => (
                    <div key={group.name} role="group" aria-label={group.name}>
                      <div className="mb-1 text-[12px] font-semibold text-light-text dark:text-dark-text">
                        {group.name}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {group.colors.map(color => (
                          <button
                            key={color.value}
                            type="button"
                            title={color.name}
                            aria-label={`${color.name} label colour`}
                            aria-pressed={labelColor === color.value}
                            onClick={() => setLabelColor(color.value)}
                            className={[
                              "h-7 w-7 shrink-0 rounded-full transition-transform",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#21c063] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-dark-secondary",
                              labelColor === color.value
                                ? "scale-110 ring-2 ring-[#21c063] ring-offset-2 dark:ring-offset-dark-secondary"
                                : "hover:scale-105",
                            ].join(" ")}
                            style={{ backgroundColor: color.color }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                <ActionButton
                  variant="primary"
                  disabled={labelBusy || !labelId.trim() || !labelName.trim()}
                  onClick={async () => {
                    setLabelBusy(true)
                    setLabelMsg(null)
                    try {
                      await EditLabel(labelId.trim(), labelName.trim(), labelColor, false)
                      setLabelMsg({ tone: "success", text: "Label created!" })
                      setLabelId("")
                      setLabelName("")
                    } catch {
                      setLabelMsg({ tone: "error", text: "Failed to create label" })
                    } finally {
                      setLabelBusy(false)
                    }
                  }}
                >
                  {labelBusy ? "Creating…" : "Create"}
                </ActionButton>
              </div>
            </div>

            <div className="border-t border-black/[0.04] pt-4 dark:border-white/[0.06]">
              <div className="text-[13px] font-semibold text-light-text dark:text-dark-text">
                Delete a label
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <TextField
                  value={deleteLabelId}
                  onChange={e => setDeleteLabelId(e.target.value)}
                  placeholder="Delete label ID"
                />
                <ActionButton
                  variant="danger"
                  disabled={deleteBusy || !deleteLabelId.trim()}
                  onClick={async () => {
                    setDeleteBusy(true)
                    setLabelMsg(null)
                    try {
                      await EditLabel(deleteLabelId.trim(), "", 0, true)
                      setLabelMsg({ tone: "success", text: "Label deleted!" })
                      setDeleteLabelId("")
                    } catch {
                      setLabelMsg({ tone: "error", text: "Failed to delete label" })
                    } finally {
                      setDeleteBusy(false)
                    }
                  }}
                >
                  {deleteBusy ? "Deleting…" : "Delete"}
                </ActionButton>
              </div>
            </div>

            {labelMsg && <StatusBanner tone={labelMsg.tone}>{labelMsg.text}</StatusBanner>}
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}

export default ChatsSettingsScreen
