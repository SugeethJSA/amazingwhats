# Wails v3 native APIs

Source: https://v3.wails.io/reference/dialogs/ , /reference/menu/ , /features/menus/systray/ , /features/menus/application/ , /features/keyboard/global-shortcuts/ , /features/notifications/overview/ , /features/clipboard/basics/.

## Dialogs

```go
path, err := app.Dialog.OpenFile().
    SetTitle("Select File").
    AddFilter("Images", "*.png;*.jpg").
    PromptForSingleSelection()

app.Dialog.Info().SetTitle("Success").SetMessage("Done").Show()
app.Dialog.Error().SetTitle("Error").SetMessage("Failed").Show()
```

Question dialogs use buttons with `OnClick`; save dialogs `app.Dialog.SaveFile()`; folder selection `OpenFile().CanChooseDirectories(true).CanChooseFiles(false)`.

## Menus

```go
menu := app.NewMenu()
file := menu.AddSubmenu("File")
file.Add("Quit").OnClick(func(ctx *application.Context) { app.Quit() })
```

After changing a menu item's label/enabled/checked state, call `menu.Update()`.

## System tray

```go
systray := app.SystemTray.New()
systray.SetIcon(iconBytes)          // embed with go:embed
systray.SetLabel("My App")          // macOS label / Windows tooltip
systray.SetDarkModeIcon(iconDark)
systray.SetMenu(menu)
systray.AttachWindow(window)        // left-click toggles, right-click opens menu
```

Platform notes: Windows icons 16x16/32x32 PNG/ICO, tooltip <=127 UTF-16 chars; macOS template icons (black+transparent), short labels, `NSImageLeft/Right/Only/None` positioning; Linux StatusNotifierItem, DE support varies — degrade gracefully, there is no `SystemTraySupported()` helper. Call `systray.Destroy()` in `OnShutdown`. Preserve every tray action from a v2 app; never silently drop one.

## Other managers

`app.Clipboard.SetText(...)`, `app.Screen.GetAll()`, `app.Browser.OpenURL(...)`, `app.Env`, `app.ContextMenu`, `app.KeyBinding` (global shortcuts), notifications via the official notifications service package.

## Security

Treat all frontend input as untrusted; validate paths/URLs in Go; never expose secrets through bindings, events or tray labels.
