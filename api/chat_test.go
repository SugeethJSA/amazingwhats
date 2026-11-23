package api

import (
	"strings"
	"testing"
)

func TestFormatPhoneRejectsNonPhoneUsers(t *testing.T) {
	tests := []struct {
		name string
		user string
	}{
		{"empty", ""},
		{"letters", "abcdef"},
		{"too short", "123"},
		{"invalid country code", "0000000000"},
		{"LID-like digits", "12345678901234567890"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := formatPhone(tt.user); got != "" {
				t.Fatalf("formatPhone(%q) = %q, want empty", tt.user, got)
			}
		})
	}
}

func TestFormatPhoneFormatsValidNumbers(t *testing.T) {
	tests := []struct {
		name       string
		user       string
		wantPrefix string
		wantPart   string
	}{
		{"US number", "16505551234", "+1", "650"},
		{"UK number", "442070313000", "+44", "20"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := formatPhone(tt.user)
			if got == "" {
				t.Fatalf("formatPhone(%q) unexpectedly rejected a valid number", tt.user)
			}
			if !strings.HasPrefix(got, tt.wantPrefix) {
				t.Fatalf("formatPhone(%q) = %q, want prefix %q", tt.user, got, tt.wantPrefix)
			}
			if !strings.Contains(got, tt.wantPart) {
				t.Fatalf("formatPhone(%q) = %q, want it to contain %q", tt.user, got, tt.wantPart)
			}
		})
	}
}
