package notify

import "testing"

func TestDispatchUsesRegisteredHandler(t *testing.T) {
	previous := actionHandler
	t.Cleanup(func() { actionHandler = previous })

	var gotAction, gotChat, gotMessage, gotText string
	SetActionHandler(func(action, chatJID, messageID, text string) {
		gotAction, gotChat, gotMessage, gotText = action, chatJID, messageID, text
	})
	dispatch(ActionReply, "123@g.us", "ABC", "hello")

	if gotAction != ActionReply || gotChat != "123@g.us" || gotMessage != "ABC" || gotText != "hello" {
		t.Fatalf("unexpected dispatch: %q %q %q %q", gotAction, gotChat, gotMessage, gotText)
	}
}

func TestIsCallAction(t *testing.T) {
	for _, tc := range []struct {
		action string
		want   bool
	}{
		{ActionAcceptCall, true},
		{ActionDeclineCall, true},
		{ActionOpen, false},
		{ActionReply, false},
		{"", false},
	} {
		if got := IsCallAction(tc.action); got != tc.want {
			t.Fatalf("IsCallAction(%q) = %v, want %v", tc.action, got, tc.want)
		}
	}
}
