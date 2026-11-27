export type ConnectionTone = "online" | "connecting" | "offline"

export interface ConnectionView {
  label: string
  detail: string
  tone: ConnectionTone
}

/** Maps raw backend status strings to a short, stable, human-readable cue. */
export function connectionView(status: string): ConnectionView {
  if (status === "logged_in" || status === "success") {
    return {
      label: "Connected",
      detail: "Linked device is active",
      tone: "online",
    }
  }
  if (status === "reconnecting") {
    return {
      label: "Reconnecting",
      detail: "Trying to reach your phone",
      tone: "connecting",
    }
  }
  if (status === "disconnected" || status.startsWith("error")) {
    return {
      label: "Disconnected",
      detail: "Check your phone and internet connection",
      tone: "offline",
    }
  }
  return {
    label: "Connecting",
    detail: "Waiting for your phone",
    tone: "connecting",
  }
}
