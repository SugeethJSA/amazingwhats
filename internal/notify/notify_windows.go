//go:build windows

package notify

import (
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	toast "git.sr.ht/~jackmordaunt/go-toast"
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
	dir, err := os.MkdirTemp("", "whats4linux-notify-icon-")
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
