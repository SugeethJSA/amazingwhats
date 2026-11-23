//go:build windows

package notify

import (
	"bytes"
	"encoding/xml"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	toast "git.sr.ht/~jackmordaunt/go-toast"
	"git.sr.ht/~jackmordaunt/go-toast/tmpl"
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

// renderWindowsToastXML uses the exact template from go-toast v1.1.2, so these
// tests exercise the same text/template rendering that Windows receives.
func renderWindowsToastXML(t *testing.T, n toast.Notification) string {
	t.Helper()
	if n.Duration == "" {
		n.Duration = toast.Short
	}
	if n.Audio == "" {
		n.Audio = toast.Default
	}
	var out bytes.Buffer
	if err := tmpl.XMLTemplate.Execute(&out, &n); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

type parsedWindowsToast struct {
	Launch string `xml:"launch,attr"`
	Visual struct {
		Binding struct {
			Image struct {
				Src   string `xml:"src,attr"`
				Place string `xml:"placement,attr"`
			} `xml:"image"`
			Texts []string `xml:"text"`
		} `xml:"binding"`
	} `xml:"visual"`
	Actions struct {
		Action []struct {
			Content   string `xml:"content,attr"`
			Arguments string `xml:"arguments,attr"`
			Type      string `xml:"activationType,attr"`
		} `xml:"action"`
	} `xml:"actions"`
}

func parseWindowsToast(t *testing.T, raw string) parsedWindowsToast {
	t.Helper()
	var doc parsedWindowsToast
	if err := xml.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("generated toast XML is not well formed: %v\n%s", err, raw)
	}
	return doc
}

// TestWindowsRawActivationArgsRepro documents the original failure: the query
// string's "&" separators were written into the launch attribute verbatim.
func TestWindowsRawActivationArgsRepro(t *testing.T) {
	opts := hostileOptions()
	raw := activationArgs(ActionOpen, opts)
	n := toast.Notification{
		AppID:               AppName,
		Title:               opts.Title,
		Body:                opts.Body,
		Icon:                "C:\\icons\\appicon.png",
		ActivationType:      toast.Foreground,
		Duration:            toast.Short,
		Audio:               toast.Default,
		ActivationArguments: raw, // the unescaped value that used to be passed
	}
	var out bytes.Buffer
	if err := tmpl.XMLTemplate.Execute(&out, &n); err != nil {
		t.Fatal(err)
	}
	var doc parsedWindowsToast
	if err := xml.Unmarshal(out.Bytes(), &doc); err == nil {
		t.Fatalf("expected raw ampersands in launch to make the XML invalid, got:\n%s", out.String())
	}
}

func hostileOptions() Options {
	return Options{
		ChatJID:   "1203630&foo+bar%@g.us",
		MessageID: `msg"<&>7`,
		SenderJID: "123%40s.whatsapp.net",
		Title:     `Alice & Bob <team> said "hello"`,
		Body:      "first]]>second & <b> \x00 tail",
		Actions:   true,
	}
}

func TestWindowsToastXMLSafeForHostileValues(t *testing.T) {
	opts := hostileOptions()
	icon := "C:\\icons\\appicon.png"
	n := buildWindowsNotification(opts, icon)
	doc := parseWindowsToast(t, renderWindowsToastXML(t, n))

	wantLaunch := activationArgs(ActionOpen, opts)
	if doc.Launch != wantLaunch {
		t.Fatalf("launch = %q, want decoded %q", doc.Launch, wantLaunch)
	}
	if doc.Visual.Binding.Image.Src != icon || doc.Visual.Binding.Image.Place != "appLogoOverride" {
		t.Fatalf("unexpected icon: %+v", doc.Visual.Binding.Image)
	}
	wantBody := "first]]>second & <b>  tail"
	if len(doc.Visual.Binding.Texts) != 2 ||
		doc.Visual.Binding.Texts[0] != opts.Title || doc.Visual.Binding.Texts[1] != wantBody {
		t.Fatalf("unexpected toast texts: %q", doc.Visual.Binding.Texts)
	}

	if len(doc.Actions.Action) != 2 {
		t.Fatalf("expected Open and Reply actions, got %+v", doc.Actions.Action)
	}
	for i, want := range []struct{ content, args string }{
		{"Open", activationArgs(ActionOpen, opts)},
		{"Reply", activationArgs(ActionReply, opts)},
	} {
		got := doc.Actions.Action[i]
		if got.Content != want.content || got.Arguments != want.args || got.Type != toast.Foreground {
			t.Fatalf("action %d = %+v, want %+v", i, got, want)
		}
		values, err := url.ParseQuery(got.Arguments)
		if err != nil {
			t.Fatal(err)
		}
		if values.Get("chatJid") != opts.ChatJID || values.Get("messageId") != opts.MessageID ||
			values.Get("senderJid") != opts.SenderJID {
			t.Fatalf("action %d arguments did not round-trip: %v", i, values)
		}
	}

	// End-to-end: the argument string recovered from the XML must still drive
	// the activation callback with the original, percent-encoded JIDs.
	previous := actionHandler
	t.Cleanup(func() { actionHandler = previous })
	var gotAction, gotChat, gotMessage string
	SetActionHandler(func(action, chatJID, messageID, text string) {
		gotAction, gotChat, gotMessage = action, chatJID, messageID
	})
	handleWindowsActivation(doc.Launch, nil)
	if gotAction != ActionOpen || gotChat != opts.ChatJID || gotMessage != opts.MessageID {
		t.Fatalf("activation did not round-trip: %q %q %q", gotAction, gotChat, gotMessage)
	}
}

func TestWindowsPlainNotificationHasNoActionsOrArguments(t *testing.T) {
	opts := hostileOptions()
	icon := "C:\\icons\\appicon.png"
	n := baseWindowsNotification(opts, icon)
	raw := renderWindowsToastXML(t, n)
	doc := parseWindowsToast(t, raw)
	if doc.Launch != "" {
		t.Fatalf("plain notification should not carry activation arguments: %q", doc.Launch)
	}
	if len(doc.Actions.Action) != 0 {
		t.Fatalf("plain notification should not carry actions: %+v", doc.Actions.Action)
	}
	if doc.Visual.Binding.Image.Src != icon || len(doc.Visual.Binding.Texts) != 2 {
		t.Fatalf("plain notification lost its icon or text:\n%s", raw)
	}
}

func TestWindowsSafeIconPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "a&b")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(dir, "icon.png")
	content := []byte("fake png payload")
	if err := os.WriteFile(original, content, 0o600); err != nil {
		t.Fatal(err)
	}

	safe := safeIconPath(original)
	if safe == original || !isXMLAttributeSafe(safe) {
		t.Fatalf("safeIconPath(%q) = %q, want a different XML-safe path", original, safe)
	}
	if again := safeIconPath(original); again != safe {
		t.Fatalf("safeIconPath cache miss: %q then %q", safe, again)
	}
	got, err := os.ReadFile(safe)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("copied icon content = %q, want %q", got, content)
	}
	t.Cleanup(func() { _ = os.RemoveAll(filepath.Dir(safe)) })
}
