package api

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// TestRedactJID verifies the documented shape of the log-safe JID token:
// the first eight hex characters of SHA-256(full JID), optionally followed by
// "@" and the server/domain. Crucially, neither the phone number / LID user
// part nor the full JID may appear in the result.
func TestRedactJID(t *testing.T) {
	tests := []struct {
		name string
		jid  string
	}{
		{"empty", ""},
		{"phone JID", "1234567890@s.whatsapp.net"},
		{"phone JID with device", "1234567890:12@s.whatsapp.net"},
		{"LID JID", "9876543210@lid"},
		{"group JID", "120363000000000001@g.us"},
		{"newsletter JID", "1234567890@newsletter"},
		{"no server", "bareuser"},
		{"empty user with server", "@s.whatsapp.net"},
		{"multiple at signs uses last", "user@inner@outer.example"},
		{"single character", "a"},
		{"abc golden", "abc"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := redactJID(tt.jid)
			if tt.jid == "" {
				if got != "<empty>" {
					t.Fatalf("redactJID(%q) = %q, want %q", tt.jid, got, "<empty>")
				}
				return
			}

			// Independently derive the expected token from the documented
			// contract (truncated SHA-256 plus the non-personal server part).
			sum := sha256.Sum256([]byte(tt.jid))
			want := hex.EncodeToString(sum[:])[:8]
			server := ""
			if i := strings.LastIndexByte(tt.jid, '@'); i >= 0 {
				server = tt.jid[i+1:]
			}
			if server != "" {
				want += "@" + server
			}
			if got != want {
				t.Fatalf("redactJID(%q) = %q, want %q", tt.jid, got, want)
			}

			digestPart := got
			if i := strings.IndexByte(got, '@'); i >= 0 {
				digestPart = got[:i]
			}
			if len(digestPart) != 8 {
				t.Fatalf("digest part %q has length %d, want 8", digestPart, len(digestPart))
			}
			if _, err := hex.DecodeString(digestPart); err != nil {
				t.Fatalf("digest part %q is not hex: %v", digestPart, err)
			}

			userPart := tt.jid
			if i := strings.LastIndexByte(userPart, '@'); i >= 0 {
				userPart = userPart[:i]
			}
			// Skip the substring leak checks for very short user parts: an
			// eight-character hex digest can coincidentally contain a one- or
			// two-character fragment, which is not a leak. An empty user part
			// is just the server, which is intentionally preserved verbatim.
			if len(userPart) < 3 {
				return
			}
			if strings.Contains(got, tt.jid) {
				t.Fatalf("redactJID(%q) leaked the full JID: %q", tt.jid, got)
			}
			if strings.Contains(got, userPart) {
				t.Fatalf("redactJID(%q) leaked user part %q: %q", tt.jid, userPart, got)
			}
		})
	}
}

func TestRedactJIDKnownSHA256Prefix(t *testing.T) {
	t.Parallel()

	// SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223...
	// SHA-256("a")   = ca978112ca1bbdcafac231b39a23dc4d...
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"abc", "abc", "ba7816bf"},
		{"a", "a", "ca978112"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := redactJID(tt.in); got != tt.want {
				t.Fatalf("redactJID(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestRedactJIDIsDeterministicAndDistinct(t *testing.T) {
	t.Parallel()

	const a = "1234567890@s.whatsapp.net"
	const b = "1234567891@s.whatsapp.net"

	first := redactJID(a)
	if again := redactJID(a); again != first {
		t.Fatalf("redactJID is not deterministic: %q then %q", first, again)
	}
	if other := redactJID(b); other == first {
		t.Fatalf("distinct JIDs collapsed to the same token %q", first)
	}
	if !strings.HasSuffix(first, "@s.whatsapp.net") || !strings.HasSuffix(redactJID(b), "@s.whatsapp.net") {
		t.Fatal("server suffix was not preserved for phone-number JIDs")
	}
}
