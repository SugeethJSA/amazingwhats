//go:build windows

package notify

import (
	"net/url"
	"testing"

	toast "git.sr.ht/~jackmordaunt/go-toast"
)

func TestWindowsActivationArgs(t *testing.T) {
	opts := Options{ChatJID: "1203630@g.us", MessageID: "ABC", SenderJID: "123@s.whatsapp.net"}
	values, err := url.ParseQuery(activationArgs(ActionReply, opts))
	if err != nil {
		t.Fatal(err)
	}
	if values.Get("action") != ActionReply || values.Get("chatJid") != opts.ChatJID ||
		values.Get("messageId") != opts.MessageID || values.Get("senderJid") != opts.SenderJID {
		t.Fatalf("unexpected activation args: %v", values)
	}
}

func TestWindowsActivationDispatch(t *testing.T) {
	previous := actionHandler
	t.Cleanup(func() { actionHandler = previous })

	var gotAction, gotChat, gotMessage, gotText string
	SetActionHandler(func(action, chatJID, messageID, text string) {
		gotAction, gotChat, gotMessage, gotText = action, chatJID, messageID, text
	})
	opts := Options{ChatJID: "123@s.whatsapp.net", MessageID: "M1"}
	handleWindowsActivation(activationArgs(ActionReply, opts), []toast.UserData{{Key: replyInputID, Value: " hi "}})
	if gotAction != ActionReply || gotChat != opts.ChatJID || gotMessage != "M1" || gotText != "hi" {
		t.Fatalf("unexpected activation dispatch: %q %q %q %q", gotAction, gotChat, gotMessage, gotText)
	}
}
