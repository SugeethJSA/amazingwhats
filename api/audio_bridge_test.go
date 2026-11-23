package api

import (
	"reflect"
	"testing"
)

// Source-derived tests for audio_bridge.go (CALL-001). These are pure tests:
// no malgo device, no Wails runtime, no network.

func TestMuteFrame(t *testing.T) {
	tests := []struct {
		name     string
		frame    []float32
		muted    bool
		want     []float32
		wantSame bool // unmuted path must return the input slice itself
	}{
		{
			name:     "not muted returns same samples unchanged",
			frame:    []float32{0.1, -0.2, 0.3},
			muted:    false,
			want:     []float32{0.1, -0.2, 0.3},
			wantSame: true,
		},
		{
			name:  "muted returns all zeros of equal length",
			frame: []float32{0.1, -0.2, 0.3},
			muted: true,
			want:  []float32{0, 0, 0},
		},
		{
			name:  "muted empty slice",
			frame: []float32{},
			muted: true,
			want:  []float32{},
		},
		{
			name:  "muted nil slice",
			frame: nil,
			muted: true,
			want:  nil,
		},
		{
			name:  "input is not mutated when muted",
			frame: []float32{0.25, -0.75, 1.5},
			muted: true,
			want:  []float32{0, 0, 0},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			// Work on a private copy so any mutation of the caller's slice is
			// visible in `input` and can be asserted below.
			input := append([]float32(nil), tt.frame...)
			original := append([]float32(nil), tt.frame...)

			got := muteFrame(input, tt.muted)

			if len(got) != len(tt.want) {
				t.Fatalf("muteFrame() length = %d, want %d", len(got), len(tt.want))
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("muteFrame()[%d] = %v, want %v", i, got[i], tt.want[i])
				}
			}

			// The input must never be modified, in either mode.
			if !reflect.DeepEqual(input, original) {
				t.Errorf("muteFrame mutated its input: got %v, want %v", input, original)
			}

			// Unmuted reuses the input; muted must allocate a distinct slice.
			if len(input) > 0 && len(got) > 0 {
				sameBacking := &got[0] == &input[0]
				if tt.wantSame && !sameBacking {
					t.Error("muteFrame(unmuted) did not return the input slice")
				}
				if tt.muted && sameBacking {
					t.Error("muteFrame(muted) reused the input slice instead of allocating a fresh one")
				}
			}
		})
	}
}

func TestLiveAudioBridgeSetMuted(t *testing.T) {
	t.Parallel()

	// Zero value only: no hardware device is opened by SetMuted/IsMuted.
	var b LiveAudioBridge

	if b.IsMuted() {
		t.Fatal("zero-value bridge IsMuted() = true, want false")
	}
	b.SetMuted(true)
	if !b.IsMuted() {
		t.Fatal("IsMuted() = false after SetMuted(true)")
	}
	b.SetMuted(true) // idempotent
	if !b.IsMuted() {
		t.Fatal("IsMuted() = false after a repeated SetMuted(true)")
	}
	b.SetMuted(false)
	if b.IsMuted() {
		t.Fatal("IsMuted() = true after SetMuted(false)")
	}
}
