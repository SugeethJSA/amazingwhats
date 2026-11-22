/**
 * Compatibility shim for the legacy v2 runtime helpers used by the React UI.
 * Wails v3 exposes these through `@wailsio/runtime`, where event
 * callbacks receive a `WailsEvent` wrapper and `Events.On` returns its own
 * unsubscribe function.
 */
import { Browser, Events } from "@wailsio/runtime"

type EventCallback = (data: any) => void
type Unsubscribe = () => void

export function EventsOn(name: string, cb: EventCallback): Unsubscribe {
  return Events.On(name, (event) => cb(event.data))
}

export function BrowserOpenURL(url: string): Promise<void> {
  return Browser.OpenURL(url)
}
