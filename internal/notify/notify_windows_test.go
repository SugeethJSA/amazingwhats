//go:build windows

package notify

import (
	"bytes"
	"encoding/xml"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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

func TestWindowsAvatarToastXML(t *testing.T) {
	opts := Options{
		ChatJID:   `120363&"'<@g.us`,
		MessageID: `M&"1`,
		SenderJID: `1&2@s.whatsapp.net`,
		Title:     `A < B & C ]]> "D"`,
		Body:      `line1 & <tag> "quoted"`,
		Actions:   true,
	}
	avatar := `C:\Temp\avatar&x.png`
	raw := buildWindowsAvatarToastXML(opts, avatar)

	var doc struct {
		Launch string `xml:"launch,attr"`
		Visual struct {
			Binding struct {
				Images []struct {
					Src   string `xml:"src,attr"`
					Place string `xml:"placement,attr"`
					Crop  string `xml:"hint-crop,attr"`
				} `xml:"image"`
				Texts []string `xml:"text"`
			} `xml:"binding"`
		} `xml:"visual"`
		Actions struct {
			Action []struct {
				Content   string `xml:"content,attr"`
				Arguments string `xml:"arguments,attr"`
			} `xml:"action"`
		} `xml:"actions"`
	}
	if err := xml.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("avatar toast XML is not well formed: %v\n%s", err, raw)
	}
	images := doc.Visual.Binding.Images
	if len(images) != 1 {
		t.Fatalf("want 1 image (avatar badge), got %d: %s", len(images), raw)
	}
	if images[0].Place != "appLogoOverride" || images[0].Src != avatar {
		t.Errorf("avatar badge = %+v, want appLogoOverride src %q", images[0], avatar)
	}
	if images[0].Crop != "circle" {
		t.Errorf("avatar badge crop = %q, want circle", images[0].Crop)
	}
	if strings.Contains(raw, `placement="hero"`) {
		t.Errorf("avatar toast must not contain a hero banner: %s", raw)
	}
	texts := doc.Visual.Binding.Texts
	if len(texts) != 2 || texts[0] != opts.Title || texts[1] != opts.Body {
		t.Errorf("texts = %q, want %q / %q", texts, opts.Title, opts.Body)
	}
	launch, err := url.ParseQuery(doc.Launch)
	if err != nil {
		t.Fatalf("launch args: %v", err)
	}
	if launch.Get("chatJid") != opts.ChatJID || launch.Get("messageId") != opts.MessageID {
		t.Errorf("launch args round-trip failed: %v", launch)
	}
	if len(doc.Actions.Action) != 2 {
		t.Fatalf("want 2 actions, got %d", len(doc.Actions.Action))
	}
	for _, action := range doc.Actions.Action {
		values, err := url.ParseQuery(action.Arguments)
		if err != nil {
			t.Fatalf("action args: %v", err)
		}
		if values.Get("chatJid") != opts.ChatJID {
			t.Errorf("action args round-trip failed: %v", values)
		}
	}
}

func callOptions() Options {
	return Options{
		ChatJID:   "123@s.whatsapp.net",
		MessageID: "call-42",
		SenderJID: "123@s.whatsapp.net",
		Title:     "Alice",
		Body:      "Incoming voice call",
		CallID:    "call-42",
	}
}

// callToastDoc parses the parts of a call toast that the generic
// parsedWindowsToast helper does not cover (audio and the reply input).
type callToastDoc struct {
	Launch string `xml:"launch,attr"`
	Audio  struct {
		Src    string `xml:"src,attr"`
		Loop   string `xml:"loop,attr"`
		Silent string `xml:"silent,attr"`
	} `xml:"audio"`
	Actions struct {
		Input []struct {
			ID string `xml:"id,attr"`
		} `xml:"input"`
		Action []struct {
			Content   string `xml:"content,attr"`
			Arguments string `xml:"arguments,attr"`
			Type      string `xml:"activationType,attr"`
		} `xml:"action"`
	} `xml:"actions"`
}

func parseCallToast(t *testing.T, raw string) callToastDoc {
	t.Helper()
	var doc callToastDoc
	if err := xml.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatalf("call toast XML is not well formed: %v\n%s", err, raw)
	}
	return doc
}

func TestWindowsCallToastHasAcceptAndDeclineActions(t *testing.T) {
	opts := callOptions()
	n := buildWindowsNotification(opts, "C:\\icons\\appicon.png")
	doc := parseCallToast(t, renderWindowsToastXML(t, n))

	if len(doc.Actions.Input) != 0 {
		t.Fatalf("call toast must not carry a reply input: %+v", doc.Actions.Input)
	}
	if len(doc.Actions.Action) != 2 {
		t.Fatalf("want Accept and Decline actions, got %+v", doc.Actions.Action)
	}
	for i, want := range []struct{ action, label string }{
		{ActionAcceptCall, "Accept"},
		{ActionDeclineCall, "Decline"},
	} {
		got := doc.Actions.Action[i]
		if got.Content != want.label || got.Type != toast.Foreground {
			t.Fatalf("action %d = %+v, want %q/%s", i, got, want.label, toast.Foreground)
		}
		values, err := url.ParseQuery(got.Arguments)
		if err != nil {
			t.Fatal(err)
		}
		if values.Get("action") != want.action || values.Get("messageId") != opts.CallID ||
			values.Get("callId") != opts.CallID {
			t.Fatalf("action %d arguments did not round-trip: %v", i, values)
		}
	}
	if doc.Audio.Src != toast.LoopingCall || doc.Audio.Loop != "true" || doc.Audio.Silent != "" {
		t.Fatalf("call toast audio = %+v, want a looping call tone", doc.Audio)
	}
	launch, err := url.ParseQuery(doc.Launch)
	if err != nil {
		t.Fatal(err)
	}
	if launch.Get("callId") != opts.CallID {
		t.Fatalf("launch arguments did not carry the call ID: %v", launch)
	}
}

func TestWindowsSilentCallToast(t *testing.T) {
	opts := callOptions()
	opts.Silent = true
	n := buildWindowsNotification(opts, "C:\\icons\\appicon.png")
	doc := parseCallToast(t, renderWindowsToastXML(t, n))
	if doc.Audio.Silent != "true" || doc.Audio.Src != "" {
		t.Fatalf("silent call toast audio = %+v, want silent", doc.Audio)
	}
}

func TestWindowsCallActivationDispatch(t *testing.T) {
	previous := actionHandler
	t.Cleanup(func() { actionHandler = previous })

	var gotAction, gotChat, gotMessage, gotText string
	SetActionHandler(func(action, chatJID, messageID, text string) {
		gotAction, gotChat, gotMessage, gotText = action, chatJID, messageID, text
	})
	opts := callOptions()
	for _, action := range []string{ActionAcceptCall, ActionDeclineCall} {
		handleWindowsActivation(activationArgs(action, opts), nil)
		if gotAction != action || gotChat != opts.ChatJID || gotMessage != opts.CallID || gotText != "" {
			t.Fatalf("%s activation dispatched %q %q %q %q", action, gotAction, gotChat, gotMessage, gotText)
		}
	}
}

func TestWindowsAvatarCallToastXML(t *testing.T) {
	opts := callOptions()
	opts.CallID = `call&"42`
	opts.MessageID = opts.CallID
	raw := buildWindowsAvatarToastXML(opts, `C:\Temp\avatar.png`)
	doc := parseCallToast(t, raw)
	if len(doc.Actions.Action) != 2 || len(doc.Actions.Input) != 0 {
		t.Fatalf("avatar call toast actions = %+v / %+v", doc.Actions.Action, doc.Actions.Input)
	}
	for i, want := range []string{ActionAcceptCall, ActionDeclineCall} {
		values, err := url.ParseQuery(doc.Actions.Action[i].Arguments)
		if err != nil {
			t.Fatal(err)
		}
		if values.Get("action") != want || values.Get("callId") != opts.CallID ||
			values.Get("messageId") != opts.CallID {
			t.Fatalf("avatar call action %d did not round-trip: %v", i, values)
		}
	}
	if doc.Audio.Src != toast.LoopingCall {
		t.Fatalf("avatar call toast audio = %+v, want a looping call tone", doc.Audio)
	}
}
