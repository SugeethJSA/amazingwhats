//go:build windows

package notify

import (
	"fmt"
	"net/url"
	"strings"
	"sync"

	toast "git.sr.ht/~jackmordaunt/go-toast"
)

const replyInputID = "replyText"

var registerCallbackOnce sync.Once

func init() {
	// go-toast keeps a single process-wide activation callback. Registering it
	// once at package init means the D-Bus/WinRT activation path can invoke the
	// API handler whenever SetActionHandler has installed one.
	registerCallbackOnce.Do(func() {
		toast.SetActivationCallback(handleWindowsActivation)
	})
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
// rather than concatenating with a hand-rolled separator.
func activationArgs(action string, opts Options) string {
	v := url.Values{}
	v.Set("action", action)
	v.Set("chatJid", opts.ChatJID)
	v.Set("messageId", opts.MessageID)
	v.Set("senderJid", opts.SenderJID)
	return v.Encode()
}

// Notify pushes a Windows toast with Open and Reply actions. A foreground
// activation type is required for the in-process activation callback to fire.
// go-toast falls back to PowerShell when COM is unavailable; that fallback
// cannot deliver callbacks, so actions degrade to plain notifications there.
func Notify(opts Options) error {
	iconPath, err := resolveIconPath(opts)
	if err != nil {
		return err
	}

	notification := toast.Notification{
		AppID:               AppName,
		Title:               opts.Title,
		Body:                opts.Body,
		Icon:                iconPath,
		ActivationType:      toast.Foreground,
		ActivationArguments: activationArgs(ActionOpen, opts),
	}
	if opts.Actions {
		notification.Inputs = []toast.Input{{
			ID:          replyInputID,
			Title:       "Reply",
			Placeholder: "Type your reply...",
		}}
		notification.Actions = []toast.Action{
			{Type: toast.Foreground, Content: "Open", Arguments: activationArgs(ActionOpen, opts)},
			{Type: toast.Foreground, Content: "Reply", Arguments: activationArgs(ActionReply, opts)},
		}
	}
	if err := notification.Push(); err != nil {
		return fmt.Errorf("push toast: %w", err)
	}
	return nil
}

// Close is a no-op on Windows: go-toast owns no long-lived notifier object and
// the activation callback must remain installed for the process lifetime.
func Close() error {
	return nil
}
