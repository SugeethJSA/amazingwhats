export const THEME = {
  DropDown: {
    "dropdown text": "#111b21",
    "dropdown dark text": "#e9edef",

    "dropdown bg": "#ffffff",
    "dropdown dark bg": "#233138",

    "dropdown hover bg": "#f5f6f6",
    "dropdown dark hover bg": "#2a3942",

    "dropdown element text": "#111b21",
    "dropdown element dark text": "#e9edef",

    "dropdown element bg": "#ffffff",
    "dropdown element dark bg": "#233138",

    "dropdown element hover bg": "#f5f6f6",
    "dropdown element dark hover bg": "#2a3942",

    "dropdown border": "rgba(220, 220, 220, 0.35)",
    "dropdown dark border": "rgba(220, 220, 220, 0.12)",
  },

  Button: {
    "toggle bg": "#21c063",
    "toggle dark bg": "#21c063",

    "toggle closed": "#4a5565",
    "toggle dark closed": "#4a5565",

    "toggle circle": "#ffffff",
    "toggle dark circle": "#ffffff",
  },

  "Keyboard Shortcut": {
    "shortcut bg": "#f0f2f5",
    "shortcut dark bg": "#2a3942",
    "shortcut border": "#8696a0",
    "shortcut text": "#111b21",
    "shortcut dark text": "#e9edef",
  },

  "Chat Bubble": {
    "sent bubble bg": "#d9fdd3",
    "sent bubble dark bg": "#0b3d2b",
    "sent bubble text": "#111b21",
    "sent bubble dark text": "#f0f2f5",
    "received bubble bg": "#ffffff",
    "received bubble dark bg": "#121212",
    "received bubble text": "#111b21",
    "received bubble dark text": "#f0f2f5",
  },
} as const

const toCssVar = (label: string) => `--color-${label.replace(/\s+/g, "-")}`

export const applyThemeColors = (colors = THEME) => {
  Object.values(colors).forEach(group => {
    Object.entries(group).forEach(([label, value]) => {
      document.documentElement.style.setProperty(toCssVar(label), value)
    })
  })
}

export const DEFAULT_EASES = {
  DropDown: {
    open: "power2.out",
    close: "power2.in",
    rotate: "power2.out",
  },
  ToggleButton: {
    slide: "elastic.out(1, 0.5)",
  },
} as const
