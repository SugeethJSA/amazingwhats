import { Component, type ErrorInfo, type ReactNode } from "react"
import { EventsEmit } from "../lib/wailsRuntime"

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Top-level error boundary. Without it, any render-time error unmounts the
 * whole React tree and leaves a blank white window (see the missing-useState
 * regression). This renders a recoverable fallback instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack)
    // Forward the real error to the backend log so it survives a reload, and
    // show it on screen below (the old fallback hid the message entirely).
    EventsEmit("wa:frontend_error", {
      message: String(error?.message || error),
      stack: String(error?.stack || "").slice(0, 4000),
      component: String(info?.componentStack || "").slice(0, 4000),
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state

    if (!error) return this.props.children

    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-light-secondary text-light-text dark:bg-dark-bg dark:text-white p-8">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-gray-500 dark:text-dark-muted text-center max-w-md">
          The app hit an unexpected error and could not continue rendering.
        </p>
        <pre className="max-w-full overflow-auto rounded bg-gray-100 dark:bg-dark-tertiary px-4 py-2 text-xs text-red-600 dark:text-red-400">
          {error.message || "An unexpected error occurred."}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
        <div className="flex gap-3">
          <button
            onClick={this.handleReset}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-dark-tertiary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
          >
            Try again
          </button>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 rounded-lg bg-green text-white hover:bg-green-dark"
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
