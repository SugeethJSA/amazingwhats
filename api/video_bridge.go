package api

import (
	"encoding/base64"

	"github.com/purpshell/meowcaller"
)

// callVideoSink forwards meowcaller's inbound H.264 access units to the
// frontend over Wails events. Go performs no pixel encode/decode here: the
// browser owns H.264 through WebCodecs, and this sink only ferries the already
// encoded Annex-B access units across the bridge as base64. (D-ID CALL-002a)
type callVideoSink struct {
	emit   func(event string, data any) // injected; default is a.app.Event.Emit; nil drops events
	callID string
}

// Compile-time checks that the sink satisfies both meowcaller video interfaces.
var (
	_ meowcaller.VideoSink            = (*callVideoSink)(nil)
	_ meowcaller.VideoOrientationSink = (*callVideoSink)(nil)
)

// encodeVideoFrame copies au and returns its standard-base64 representation.
// The bool reports whether there was anything to encode: nil/empty access
// units are dropped rather than emitted as empty frames. callID is part of the
// signature for call-site symmetry with the event payload builders; the
// encoding itself is independent of the call. (D-ID CALL-002a)
func encodeVideoFrame(callID string, au []byte) (string, bool) {
	_ = callID
	if len(au) == 0 {
		return "", false
	}
	// Copy before encoding so a caller that reuses its buffer cannot mutate the
	// bytes while the encoded string is being built or emitted.
	return base64.StdEncoding.EncodeToString(append([]byte(nil), au...)), true
}

// emitEvent invokes the injected emitter. A nil emitter (or nil receiver) is a
// no-op, so a zero-value sink never panics when meowcaller calls it.
func (s *callVideoSink) emitEvent(event string, data map[string]any) {
	if s == nil || s.emit == nil {
		return
	}
	s.emit(event, data)
}

// WriteVideo implements meowcaller.VideoSink. It stays thin: all encoding and
// the empty-frame decision live in encodeVideoFrame.
func (s *callVideoSink) WriteVideo(accessUnit []byte) error {
	if s == nil {
		return nil
	}
	data, ok := encodeVideoFrame(s.callID, accessUnit)
	if !ok {
		return nil
	}
	s.emitEvent("call:video_frame", map[string]any{
		"callID": s.callID,
		"data":   data,
	})
	return nil
}

// SetOrientation implements meowcaller.VideoOrientationSink. meowcaller
// discovers the peer's display rotation from RTP metadata and calls this on
// the attached sink, so the browser can rotate the decoded frame upright.
func (s *callVideoSink) SetOrientation(orientation int) {
	s.emitEvent("call:video_orient", map[string]any{
		"callID":      s.callID,
		"orientation": orientation,
	})
}

// Close implements meowcaller.VideoSink. The sink owns no resources, so this
// is a no-op and is safe to call any number of times (also on a nil receiver).
func (s *callVideoSink) Close() error { return nil }
