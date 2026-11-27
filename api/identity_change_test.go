package api

import (
	"strings"
	"testing"
)

func TestIdentityChangeSystemText(t *testing.T) {
	got := identityChangeSystemText("Alice")
	if !strings.HasPrefix(got, "[system] ") {
		t.Fatalf("info line must use the system message prefix: %q", got)
	}
	if !strings.Contains(got, "Alice") || !strings.Contains(got, "Security code changed") {
		t.Fatalf("info line lost the contact or the event: %q", got)
	}
	if strings.Contains(got, "@") {
		t.Fatalf("info line must not contain a JID: %q", got)
	}

	fallback := identityChangeSystemText("")
	if !strings.Contains(fallback, "a contact") {
		t.Fatalf("missing-name fallback is not user-friendly: %q", fallback)
	}
}
