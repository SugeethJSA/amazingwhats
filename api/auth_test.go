package api

import "testing"

func TestRedactPhone(t *testing.T) {
	tests := []struct {
		name  string
		phone string
		want  string
	}{
		{"empty", "", "***"},
		{"letters only", "abcdef", "***"},
		{"one digit", "1", "***"},
		{"four digits", "1234", "***"},
		{"five digits", "12345", "***2345"},
		{"exactly six digits", "123456", "***3456"},
		{"international formatting", "+1 (415) 555-0123", "***0123"},
		{"four digits with spaces is still fully masked", "12 34", "***"},
		{"trailing non digits", "12345abc", "***2345"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := redactPhone(tt.phone); got != tt.want {
				t.Fatalf("redactPhone(%q) = %q, want %q", tt.phone, got, tt.want)
			}
		})
	}
}

func TestRedactPhoneNeverReturnsFullInput(t *testing.T) {
	t.Parallel()

	const phone = "+15551234567"
	got := redactPhone(phone)
	if len(got) >= len(phone) {
		t.Fatalf("redacted phone %q is not shorter than input %q", got, phone)
	}
	if got != "***4567" {
		t.Fatalf("redacted phone = %q, want %q", got, "***4567")
	}
}
