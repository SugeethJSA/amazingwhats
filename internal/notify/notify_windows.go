//go:build windows

package notify

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	toast "git.sr.ht/~jackmordaunt/go-toast"
	"git.sr.ht/~jackmordaunt/go-toast/wintoast"
)

const replyInputID = "replyText"

var (
	registerCallbackOnce sync.Once
	// warnedFailures keeps a degraded notification backend quiet: each failure
	// class is logged at most once, instead of once per incoming message.
	warnedFailures sync.Map // failure kind -> struct{}
	safeIconMu     sync.Mutex
	safeIconPaths  = map[string]string{}
)

func init() {
	// go-toast keeps a single process-wide activation callback. Registering it
	// once at package init means the D-Bus/WinRT activation path can invoke the
	// API handler whenever SetActionHandler has installed one.
	registerCallbackOnce.Do(func() {
		toast.SetActivationCallback(handleWindowsActivation)
	})
}

func warnFailureOnce(kind string, err error) {
	if _, seen := warnedFailures.LoadOrStore(kind, struct{}{}); !seen {
		log.Printf("notify: %s: %v", kind, err)
	}
}

func handleWindowsActivation(args string, data []toast.UserData) {
	values, err := url.ParseQuery(args)
	if err != nil {
		return
	}
	action := values.Get("action")
	if action != ActionOpen && action != ActionReply {
		return
	}
	text := ""
	if action == ActionReply {
		for _, item := range data {
			if item.Key == replyInputID {
				text = strings.TrimSpace(item.Value)
				break
			}
		}
	}
	dispatch(action, values.Get("chatJid"), values.Get("messageId"), text)
}

// activationArgs round-trips chat/message identity through the toast's
// foreground activation arguments. JIDs contain reserved characters, so encode
// rather than concatenating with a hand-rolled separator. The returned string
// is still raw (with literal "&" separators); it must be escaped with
// xmlAttribute before being placed in the toast template.
func activationArgs(action string, opts Options) string {
	v := url.Values{}
	v.Set("action", action)
	v.Set("chatJid", opts.ChatJID)
	v.Set("messageId", opts.MessageID)
	v.Set("senderJid", opts.SenderJID)
	return v.Encode()
}

// safeIconPath returns a path that is safe to write into a toast XML attribute.
// go-toast passes the same Icon field to the registry as the application icon,
// so escaping it in the notification would corrupt the registry path. Instead,
// an override whose path contains XML metacharacters is copied once to a
// generated path with a plain name; both the toast and the registry then refer
// to a real, correctly named file.
func safeIconPath(path string) string {
	if path == "" || isXMLAttributeSafe(path) {
		return path
	}

	safeIconMu.Lock()
	cached := safeIconPaths[path]
	safeIconMu.Unlock()
	if cached != "" {
		return cached
	}

	data, err := os.ReadFile(path)
	if err != nil {
		warnFailureOnce("reading notification icon", err)
		return embeddedIconPath()
	}
	dir, err := os.MkdirTemp("", "amazingwhats-notify-icon-")
	if err != nil {
		warnFailureOnce("creating safe icon directory", err)
		return embeddedIconPath()
	}
	safe := filepath.Join(dir, "icon.png")
	if err := os.WriteFile(safe, data, 0o600); err != nil {
		warnFailureOnce("writing safe icon", err)
		return embeddedIconPath()
	}

	safeIconMu.Lock()
	safeIconPaths[path] = safe
	safeIconMu.Unlock()
	return safe
}

func embeddedIconPath() string {
	path, err := writeAppIcon()
	if err != nil {
		warnFailureOnce("extracting app icon", err)
		return ""
	}
	return path
}

// baseWindowsNotification contains only values that are always safe to render.
// Title/Body are CDATA-safe and the icon path has been vetted by safeIconPath.
func baseWindowsNotification(opts Options, iconPath string) toast.Notification {
	return toast.Notification{
		AppID:          AppName,
		Title:          xmlCDATA(opts.Title),
		Body:           xmlCDATA(opts.Body),
		Icon:           iconPath,
		ActivationType: toast.Foreground,
	}
}

// buildWindowsNotification builds the full toast with Open/Reply actions. A
// foreground activation type is required for the in-process activation
// callback to fire. Every value that lands in an XML attribute is escaped
// first, including the URL-encoded arguments (whose "&" separators otherwise
// produce the LoadXml failure).
func buildWindowsNotification(opts Options, iconPath string) toast.Notification {
	n := baseWindowsNotification(opts, iconPath)
	n.ActivationArguments = xmlAttribute(activationArgs(ActionOpen, opts))
	if opts.Actions {
		n.Inputs = []toast.Input{{
			ID:          replyInputID,
			Title:       "Reply",
			Placeholder: "Type your reply...",
		}}
		n.Actions = []toast.Action{
			{Type: toast.Foreground, Content: "Open", Arguments: xmlAttribute(activationArgs(ActionOpen, opts))},
			{Type: toast.Foreground, Content: "Reply", Arguments: xmlAttribute(activationArgs(ActionReply, opts))},
		}
	}
	return n
}

// tempImagePath writes an avatar/thumbnail to a short-lived file with a plain
// name, so it can be referenced from toast XML without XML escaping problems.
// The file is removed after Windows has had time to load it into the toast.
func tempImagePath(data []byte) (string, error) {
	if len(data) == 0 {
		return "", fmt.Errorf("empty notification image")
	}
	ext := ".png"
	switch http.DetectContentType(data) {
	case "image/jpeg":
		ext = ".jpg"
	case "image/gif":
		ext = ".gif"
	case "image/webp":
		ext = ".webp"
	}
	dir, err := os.MkdirTemp("", "amazingwhats-notify-image-")
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, "avatar"+ext)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		_ = os.RemoveAll(dir)
		return "", err
	}
	time.AfterFunc(10*time.Minute, func() { _ = os.RemoveAll(dir) })
	return path, nil
}

// pushWindowsToastWithAvatar renders toast XML directly so the chat avatar can
// be placed in the appLogoOverride badge (the small top-left app-logo slot).
// go-toast v1.1.2 uses that same path for registry branding, so a plain
// toast.Notification would overwrite the app's identity icon with the contact's
// avatar. We register the real app icon separately, then put the avatar only in
// this toast's XML.
func pushWindowsToastWithAvatar(opts Options, appIcon string, avatar []byte) error {
	avatarPath, err := tempImagePath(avatar)
	if err != nil {
		return err
	}
	if err := toast.SetAppData(toast.AppData{
		AppID:    AppName,
		IconPath: appIcon,
		GUID:     "",
	}); err != nil {
		return err
	}
	return wintoast.Push(buildWindowsAvatarToastXML(opts, avatarPath), wintoast.PowershellFallback)
}

// buildWindowsAvatarToastXML is a pure helper so the hand-built toast can be
// unit-tested (well-formedness, hostiles, placement and argument round-trip).
// The avatar occupies the appLogoOverride badge; the real app icon is not in
// the toast XML at all (it is registered via SetAppData above).
func buildWindowsAvatarToastXML(opts Options, avatarPath string) string {
	var b strings.Builder
	b.WriteString(`<toast activationType="Foreground" launch="`)
	b.WriteString(xmlAttribute(activationArgs(ActionOpen, opts)))
	b.WriteString(`" duration="Short"><visual><binding template="ToastGeneric">`)
	b.WriteString(`<image placement="appLogoOverride" hint-crop="circle" src="` + xmlAttribute(avatarPath) + `" />`)
	b.WriteString(`<text><![CDATA[` + xmlCDATA(opts.Title) + `]]></text>`)
	b.WriteString(`<text><![CDATA[` + xmlCDATA(opts.Body) + `]]></text>`)
	b.WriteString(`</binding></visual>`)
	if opts.Actions {
		b.WriteString(`<actions>`)
		b.WriteString(`<input id="` + replyInputID + `" type="text" placeHolderContent="Type your reply..." />`)
		b.WriteString(`<action activationType="foreground" content="Open" arguments="` + xmlAttribute(activationArgs(ActionOpen, opts)) + `" />`)
		b.WriteString(`<action activationType="foreground" content="Reply" arguments="` + xmlAttribute(activationArgs(ActionReply, opts)) + `" />`)
		b.WriteString(`</actions>`)
	}
	b.WriteString(`</toast>`)
	return b.String()
}

// Notify pushes a Windows toast with Open and Reply actions. If the rich
// notification is rejected (for example by a Windows build with a stricter XML
// parser), it degrades to a plain toast with the same app name and icon instead
// of returning the same error for every message.
func Notify(opts Options) error {
	iconPath, err := resolveIconPath(opts)
	if err != nil {
		warnFailureOnce("resolving notification icon", err)
		iconPath = ""
	}
	iconPath = safeIconPath(iconPath)

	// The API layer fills Avatar for person/group chats; the Linux backend
	// already renders it. Use the avatar-as-badge toast on Windows when available.
	avatar := opts.Avatar
	if len(avatar) == 0 {
		avatar = opts.Image
	}
	if len(avatar) > 0 && iconPath != "" {
		if err := pushWindowsToastWithAvatar(opts, iconPath, avatar); err == nil {
			return nil
		} else {
			warnFailureOnce("toast with avatar", err)
		}
	}

	notification := buildWindowsNotification(opts, iconPath)
	if err := notification.Push(); err != nil {
		warnFailureOnce("toast with actions", err)
		return pushPlainWindowsNotification(opts, iconPath)
	}
	return nil
}

// pushPlainWindowsNotification keeps the alert flowing even when actions
// cannot be delivered. go-toast falls back to PowerShell when COM is
// unavailable; that path cannot deliver callbacks, so the notification is
// already effectively plain there. Returning nil is deliberate: the caller
// logs every returned error, and a persistent backend failure must not be
// logged once per message.
func pushPlainWindowsNotification(opts Options, iconPath string) error {
	plain := baseWindowsNotification(opts, iconPath)
	if err := plain.Push(); err != nil {
		warnFailureOnce("plain toast", err)
	}
	return nil
}

// Close is a no-op on Windows: go-toast owns no long-lived notifier object and
// the activation callback must remain installed for the process lifetime.
func Close() error {
	return nil
}
