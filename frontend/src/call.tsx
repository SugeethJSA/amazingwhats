import { createRoot } from "react-dom/client"
import "./style.css"
import { CallOverlayContent } from "./components/chat/CallOverlay"
import { ErrorBoundary } from "./components/ErrorBoundary"
import { applyThemeClass, readCachedTheme } from "./lib/theme"

// Dedicated call window entry point. Unlike the main app, this bundle renders
// ONLY the call UI — no chat list, no conversation pane, no app chrome. Wails
// opens /call.html in its own WebviewWindow; the call is the whole window.

applyThemeClass(readCachedTheme())

const container = document.getElementById("root")
if (!container) throw new Error("call window root element missing")

createRoot(container).render(
  <ErrorBoundary>
    <CallOverlayContent standalone />
  </ErrorBoundary>,
)
