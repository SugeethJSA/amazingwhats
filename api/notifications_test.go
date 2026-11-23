package api

import "testing"

func TestMutedUntilFromMuteEnd(t *testing.T) {
	tests := []struct {
		name  string
		muted bool
		end   int64
		want  int64
	}{
		{"unmuted ignores end", false, 1_700_000_000_000, 0},
		{"unmuted ignores forever sentinel", false, -1, 0},
		{"unmuted ignores zero", false, 0, 0},
		{"muted with zero end means forever", true, 0, -1},
		{"muted with negative end means forever", true, -1, -1},
		{"muted with second-based timestamp kept", true, 1_000_000_000, 1_000_000_000},
		{"muted at second/millisecond boundary kept", true, 100_000_000_000, 100_000_000_000},
		{"muted millisecond timestamp converted", true, 1_700_000_000_000, 1_700_000_000},
		{"muted just past boundary converted", true, 100_000_000_001, 100_000_000},
		{"muted large millisecond timestamp truncated", true, 1_700_000_000_999, 1_700_000_000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := mutedUntilFromMuteEnd(tt.muted, tt.end); got != tt.want {
				t.Fatalf("mutedUntilFromMuteEnd(%v, %d) = %d, want %d", tt.muted, tt.end, got, tt.want)
			}
		})
	}
}
