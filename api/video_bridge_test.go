package api

import (
	"bytes"
	"encoding/base64"
	"testing"
)

// Source-derived tests for video_bridge.go (D-ID CALL-002a). These are pure
// tests: no Wails runtime, no WebView, no network, no H.264 codec.

func TestEncodeVideoFrame(t *testing.T) {
	tests := []struct {
		name     string
		callID   string
		au       []byte
		wantOK   bool
		wantData []byte
	}{
		{
			name:     "non-empty AU returns valid base64",
			callID:   "CALL1",
			au:       []byte{0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xc0, 0x1e},
			wantOK:   true,
			wantData: []byte{0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xc0, 0x1e},
		},
		{
			name:     "binary bytes with zero and high bytes survive round-trip",
			callID:   "CALL2",
			au:       []byte{0x00, 0xff, 0x80, 0x01, 0x00, 0x7f, 0xfe, 0x00},
			wantOK:   true,
			wantData: []byte{0x00, 0xff, 0x80, 0x01, 0x00, 0x7f, 0xfe, 0x00},
		},
		{
			name:   "empty AU is skipped",
			callID: "CALL3",
			au:     []byte{},
			wantOK: false,
		},
		{
			name:   "nil AU is skipped",
			callID: "CALL4",
			au:     nil,
			wantOK: false,
		},
		{
			name:     "single byte AU",
			callID:   "CALL5",
			au:       []byte{0xff},
			wantOK:   true,
			wantData: []byte{0xff},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			input := append([]byte(nil), tt.au...)
			got, ok := encodeVideoFrame(tt.callID, tt.au)

			if ok != tt.wantOK {
				t.Fatalf("encodeVideoFrame() ok = %v, want %v", ok, tt.wantOK)
			}
			if !tt.wantOK {
				if got != "" {
					t.Errorf("encodeVideoFrame() data = %q for empty AU, want empty string", got)
				}
				return
			}

			decoded, err := base64.StdEncoding.DecodeString(got)
			if err != nil {
				t.Fatalf("encodeVideoFrame() returned invalid std base64 %q: %v", got, err)
			}
			if !bytes.Equal(decoded, tt.wantData) {
				t.Errorf("round-trip AU = %x, want %x", decoded, tt.wantData)
			}
			if !bytes.Equal(tt.au, input) {
				t.Errorf("encodeVideoFrame mutated its input: got %x, want %x", tt.au, input)
			}
		})
	}
}

// The call ID is payload metadata, not part of the encoding: the same AU must
// produce the same string for any call.
func TestEncodeVideoFrameIgnoresCallID(t *testing.T) {
	t.Parallel()

	au := []byte{0x00, 0x00, 0x01, 0x65, 0xaa, 0xbb}
	a, okA := encodeVideoFrame("CALL_A", au)
	b, okB := encodeVideoFrame("CALL_B", au)
	if !okA || !okB || a != b {
		t.Fatalf("encodeVideoFrame depends on callID: (%q, %v) vs (%q, %v)", a, okA, b, okB)
	}
}

// Exercise the sink with an injected emitter (no Wails runtime) to pin the
// event names and payload keys the frontend listens for.
func TestCallVideoSinkWriteVideo(t *testing.T) {
	t.Parallel()

	type emitted struct {
		event string
		data  map[string]any
	}
	var got []emitted
	sink := &callVideoSink{
		callID: "CALL7",
		emit: func(event string, data any) {
			payload, ok := data.(map[string]any)
			if !ok {
				t.Errorf("emit() data type = %T, want map[string]any", data)
				return
			}
			got = append(got, emitted{event: event, data: payload})
		},
	}

	au := []byte{0x00, 0x00, 0x00, 0x01, 0x65, 0x88}
	if err := sink.WriteVideo(au); err != nil {
		t.Fatalf("WriteVideo() error = %v", err)
	}
	if err := sink.WriteVideo(nil); err != nil {
		t.Fatalf("WriteVideo(nil) error = %v", err)
	}
	sink.SetOrientation(2)
	if err := sink.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if err := sink.Close(); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}

	if len(got) != 2 {
		t.Fatalf("emitted %d events, want 2 (empty frame must be skipped)", len(got))
	}
	if got[0].event != "call:video_frame" {
		t.Errorf("first event = %q, want call:video_frame", got[0].event)
	}
	if got[0].data["callID"] != "CALL7" {
		t.Errorf("frame callID = %v, want CALL7", got[0].data["callID"])
	}
	if _, ok := got[0].data["data"].(string); !ok {
		t.Errorf("frame data = %T, want string", got[0].data["data"])
	}
	if got[1].event != "call:video_orient" {
		t.Errorf("second event = %q, want call:video_orient", got[1].event)
	}
	if got[1].data["orientation"] != 2 {
		t.Errorf("orientation = %v, want 2", got[1].data["orientation"])
	}
}

// A sink with no injected emitter must be safe to use (events are dropped).
func TestCallVideoSinkNilEmitter(t *testing.T) {
	t.Parallel()

	var sink callVideoSink
	if err := sink.WriteVideo([]byte{0x01}); err != nil {
		t.Fatalf("WriteVideo() error = %v", err)
	}
	sink.SetOrientation(1)
	if err := sink.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
}
