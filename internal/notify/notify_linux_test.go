//go:build linux

package notify

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestDecodeScaledRGBA(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 400, 200))
	src.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	got, err := decodeScaledRGBA(buf.Bytes(), 96)
	if err != nil {
		t.Fatal(err)
	}
	if got.Bounds().Dx() != 96 || got.Bounds().Dy() != 48 {
		t.Fatalf("unexpected bounds: %v", got.Bounds())
	}
}

func TestLinuxActionDispatch(t *testing.T) {
	previous := actionHandler
	t.Cleanup(func() { actionHandler = previous })

	var gotAction, gotChat, gotMessage, gotText string
	SetActionHandler(func(action, chatJID, messageID, text string) {
		gotAction, gotChat, gotMessage, gotText = action, chatJID, messageID, text
	})

	trackNotification(7, notificationContext{chatJID: "1@s.whatsapp.net", messageID: "M1"})
	handleLinuxAction(7, linuxActionReply)
	if gotAction != ActionReply || gotChat != "1@s.whatsapp.net" || gotMessage != "M1" || gotText != "" {
		t.Fatalf("unexpected reply dispatch: %q %q %q %q", gotAction, gotChat, gotMessage, gotText)
	}

	// A second activation of the same ID must be ignored (one-shot context).
	gotAction = ""
	handleLinuxAction(7, linuxActionReply)
	if gotAction != "" {
		t.Fatal("notification context was not consumed")
	}

	// Unknown IDs (other applications' signals) must be ignored too.
	handleLinuxAction(999, "default")
	if gotAction != "" {
		t.Fatal("untracked notification was dispatched")
	}
}
