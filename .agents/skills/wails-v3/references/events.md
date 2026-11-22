# Wails v3 events

Source: https://v3.wails.io/reference/events/ , https://v3.wails.io/features/events/system/ , /features/events/custom/ , /features/events/application/ , /features/events/window/.

## Go side

```go
unsubscribe := app.Event.On("message", func(e *application.CustomEvent) {
    data := e.Data
    _ = data
})
defer unsubscribe()

changed := app.Event.Emit("user-logged-in", map[string]any{"username": "john"})
// Emit returns true if a hook cancelled the emit.
```

Application lifecycle events use `app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(e *application.ApplicationEvent){...})` with types from `github.com/wailsapp/wails/v3/pkg/events`. Shutdown is NOT an event constant: use `app.OnShutdown(func(){...})`.

## Frontend side

```ts
import { Events } from '@wailsio/runtime'

Events.On('update', (data) => { /* ... */ })
Events.Emit('action', payload)
```

v2's `EventsOn`/`EventsEmit` from `../wailsjs/runtime/runtime` are obsolete. Event names must match exactly on both sides.

## Patterns

- Use events for streaming/progress instead of many binding calls (`app.Event.Emit("progress", ...)` in a goroutine).
- Track unsubscribe functions and clean them up on window/service shutdown.
- Avoid emitting sensitive payloads; events cross the webview boundary.
- For low-level cases use `RawMessageHandler` in `application.Options` only after profiling.
