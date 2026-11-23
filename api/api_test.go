package api

import "testing"

func TestFormatEphemeralTimer(t *testing.T) {
	tests := []struct {
		name string
		secs uint32
		want string
	}{
		{"zero is off", 0, "off"},
		{"one second", 1, "1s"},
		{"just under a minute", 59, "59s"},
		{"one minute", 60, "1m"},
		{"just under an hour", 3599, "59m"},
		{"one hour", 3600, "1h"},
		{"just under a day", 86399, "23h"},
		{"one day", 86400, "1d"},
		{"seven days", 604800, "7d"},
		{"ninety days", 7776000, "90d"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := formatEphemeralTimer(tt.secs); got != tt.want {
				t.Fatalf("formatEphemeralTimer(%d) = %q, want %q", tt.secs, got, tt.want)
			}
		})
	}
}
