package api

import (
	"testing"

	"github.com/lugvitc/amazingwhats/internal/notify"
)

func TestNotificationReplyAutoSend(t *testing.T) {
	tests := []struct {
		name        string
		action      string
		text        string
		wantSend    bool
		wantTrimmed string
	}{
		{"typed reply", notify.ActionReply, "  hello  ", true, "hello"},
		{"blank reply", notify.ActionReply, "   ", false, ""},
		{"open action", notify.ActionOpen, "hello", false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			send, trimmed := notificationReplyAutoSend(tt.action, tt.text)
			if send != tt.wantSend || trimmed != tt.wantTrimmed {
				t.Fatalf("got send=%v text=%q, want send=%v text=%q",
					send, trimmed, tt.wantSend, tt.wantTrimmed)
			}
		})
	}
}
