package api

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/purpshell/meowcaller"
	"github.com/rs/zerolog"
	"github.com/polymorfa/hypermeow/types/events"
)

// CallStats holds diagnostic info about an active call for the frontend stats panel.
type CallStats struct {
	CallID           string `json:"call_id"`
	PeerJID          string `json:"peer_jid"`
	State            string `json:"state"`
	IsVideo          bool   `json:"is_video"`
	IsSendingVideo   bool   `json:"is_sending_video"`
	IsReceivingVideo bool   `json:"is_receiving_video"`
	Codec            string `json:"codec"`         // "MLow" (WhatsApp default)
	SampleRate       int    `json:"sample_rate"`   // 16000
	FrameSize        int    `json:"frame_size"`    // 960 samples (60ms)
	RelayEnabled     bool   `json:"relay_enabled"` // always true for WhatsApp calls
	BridgeActive     bool   `json:"bridge_active"` // audio bridge live
	Duration         int64  `json:"duration"`      // call duration in seconds (0 while ringing)
	IsGroup          bool   `json:"is_group"`
	GroupJID         string `json:"group_jid"`
	Participants     int    `json:"participants"` // roster size for group calls
}

type ActiveCall struct {
	Call       *meowcaller.Call
	Bridge     *LiveAudioBridge
	PeerJID    string
	GroupJID   string
	IsGroup    bool
	Direction  string // "incoming" or "outgoing"
	IsVideo    bool
	StartTime  time.Time
	AnswerTime time.Time
}

var (
	callsMu     sync.Mutex
	activeCalls = make(map[string]*ActiveCall)
	// callOfferHandlerID is the whatsmeow handler registered in initMeowcaller
	// to patch the group JID onto active calls. whatsmeow's AddEventHandler
	// returns a uint32 ID (first ID is 1), so 0 is a safe "not registered"
	// sentinel. Kept at package scope because the Api struct is defined in
	// api.go, outside this remediation's file scope. Guarded by callsMu.
	callOfferHandlerID uint32
)

// initMeowcaller initializes the WhatsApp VoIP extension library
func (a *Api) initMeowcaller() {
	if a.waClient == nil {
		log.Println("[Calls] WhatsApp client not initialized, skipping meowcaller")
		return
	}

	a.callClient = meowcaller.NewClient(a.waClient, meowcaller.WithLogger(
		zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr}),
	))

	// For group calls, whatsmeow populates GroupJID on the CallOffer. This
	// handler runs after meowcaller's own handler has registered the call and
	// fired OnIncomingCall, so we patch the group JID onto the active call and
	// emit the incoming event here (the OnIncomingCall callback defers group
	// emits until the group JID is known).
	offerHandlerID := a.waClient.AddEventHandler(func(evt any) {
		offer, ok := evt.(*events.CallOffer)
		if !ok || offer.GroupJID.IsEmpty() {
			return
		}
		callsMu.Lock()
		ac := activeCalls[offer.CallID]
		var peerJID, groupJID string
		var isVideo bool
		if ac != nil {
			ac.GroupJID = offer.GroupJID.String()
			ac.IsGroup = true
			// Use one canonical JID for a group's peer: ActiveCall.PeerJID was
			// seeded from the library's call.Peer() (the call creator), which is
			// also what outbound group calls use. Fall back to the inviter only
			// if that seed was empty, and emit that same value below.
			// (D-AUD-004j)
			if ac.PeerJID == "" {
				ac.PeerJID = offer.From.String()
			}
			peerJID = ac.PeerJID
			isVideo = ac.IsVideo
			groupJID = ac.GroupJID
		}
		callsMu.Unlock()
		if ac != nil && a.ctx != nil {
			// Reveal the dedicated call window before telling the frontend about
			// the call so its listeners are mounted on a visible webview.
			showCallWindow()
			a.app.Event.Emit("call:incoming", map[string]any{
				"callID":   offer.CallID,
				"peerJID":  peerJID,
				"isVideo":  isVideo,
				"isGroup":  true,
				"groupJID": groupJID,
			})
		}
	})
	// Remember the handler so cleanup can actually unregister it. Nil-ing
	// callClient alone would leave this closure firing on waClient after
	// shutdown. (critic: MAJOR D-AUD-004a)
	callsMu.Lock()
	callOfferHandlerID = offerHandlerID
	callsMu.Unlock()

	// Handle incoming calls
	a.callClient.OnIncomingCall(func(call *meowcaller.Call) {
		log.Printf("[Calls] Incoming call from %s (CallID: %s)", redactJID(call.Peer().String()), call.ID())
		now := time.Now()
		_, isGroup := call.GroupState()
		callsMu.Lock()
		ac := &ActiveCall{
			Call:      call,
			PeerJID:   call.Peer().String(),
			Direction: "incoming",
			IsVideo:   call.IsVideo(),
			StartTime: now,
		}
		if isGroup {
			ac.IsGroup = true
		}
		activeCalls[call.ID()] = ac
		callsMu.Unlock()

		// Register OnEnd immediately after insertion, before any bridge is
		// opened or the incoming event is emitted, so a terminal event racing
		// setup is never missed. (D-AUD-004d)
		call.OnEnd(func(reason string) {
			log.Printf("[Calls] Call %s ended: %s", call.ID(), reason)
			callsMu.Lock()
			ended := activeCalls[call.ID()]
			if ended != nil {
				delete(activeCalls, call.ID())
			}
			callsMu.Unlock()
			if ended != nil {
				// Close is idempotent; safe even when no bridge was attached.
				// (D-AUD-004g)
				if ended.Bridge != nil {
					ended.Bridge.SetMuted(false) // clear local mute on teardown (CALL-001)
					_ = ended.Bridge.Close()
				}
				a.insertCallLog(ended)
			}

			if a.ctx != nil {
				a.app.Event.Emit("call:ended", map[string]any{
					"callID": call.ID(),
					"reason": reason,
				})
				// The call is over: retire the dedicated call window.
				hideCallWindow()
			}
		})

		// meowcaller's OnMuteState reports the REMOTE party's microphone state
		// (a local mute setter does not exist in the library). Forward it as a
		// distinct event; ignore late events once this call is no longer active.
		// (CALL-001)
		call.OnMuteState(func(muted bool) {
			callsMu.Lock()
			stillActive := activeCalls[call.ID()] != nil
			callsMu.Unlock()
			if !stillActive || a.ctx == nil {
				return
			}
			a.app.Event.Emit("call:remote_mute", map[string]any{
				"callID": call.ID(),
				"muted":  muted,
			})
		})

		// Group calls emit call:incoming from the CallOffer handler above,
		// once the group JID is known. 1:1 calls emit here, after OnEnd is
		// installed. Use the snapshotted isGroup value rather than reading the
		// shared ActiveCall outside callsMu. (D-AUD-004d, D-AUD-004f)
		if a.ctx != nil && !isGroup {
			showCallWindow()
			a.app.Event.Emit("call:incoming", map[string]any{
				"callID":  call.ID(),
				"peerJID": call.Peer().String(),
				"isVideo": call.IsVideo(),
				"isGroup": false,
			})
		}
	})
}

// AcceptCall accepts an incoming call by ID
func (a *Api) AcceptCall(callID string) error {
	callsMu.Lock()
	callData, ok := activeCalls[callID]
	callsMu.Unlock()
	if !ok {
		return fmt.Errorf("call %s not found", callID)
	}

	// Bring the OS audio bridge up before answering so a bridge/device failure
	// leaves the call untouched (still ringing) rather than creating a live,
	// unanswered call with no audio path. (D-AUD-004b)
	bridge, err := NewLiveAudioBridge()
	if err != nil {
		log.Printf("[Calls] Failed to initialize live audio bridge: %v", err)
		return fmt.Errorf("audio bridge init failed: %w", err)
	}
	if err := bridge.Start(); err != nil {
		log.Printf("[Calls] Failed to start audio bridge: %v", err)
		_ = bridge.Close()
		return fmt.Errorf("audio bridge start failed: %w", err)
	}

	// Never swallow Answer(): a failed answer must not mark the call answered
	// or leave a running bridge attached to a dead call. (D-AUD-004b)
	if err := callData.Call.Answer(); err != nil {
		log.Printf("[Calls] Failed to answer call %s: %v", callID, err)
		_ = bridge.Close()
		return fmt.Errorf("answer call: %w", err)
	}

	// Guard AnswerTime and Bridge writes with callsMu; these are read by
	// GetCallStats and cleared by OnEnd/EndCall. (D-AUD-004f)
	callsMu.Lock()
	ac, stillActive := activeCalls[callID]
	if stillActive {
		ac.AnswerTime = time.Now()
		ac.Bridge = bridge
	}
	callsMu.Unlock()
	if !stillActive {
		// The call ended while Answer() was in flight; do not attach the bridge.
		_ = bridge.Close()
		return fmt.Errorf("call %s ended while answering", callID)
	}

	callData.Call.Play(bridge)
	callData.Call.Receive(bridge)

	return nil
}

// MakeCall initiates an outbound voice call to a user or group
func (a *Api) MakeCall(targetJID string) error {
	if a.callClient == nil {
		return fmt.Errorf("call client not initialized")
	}

	ctx := context.Background()
	call, err := a.callClient.Call(ctx, targetJID)
	if err != nil {
		log.Printf("[Calls] Failed to initiate call to %s: %v", redactJID(targetJID), err)
		return fmt.Errorf("failed to make call: %v", err)
	}

	return a.trackOutgoingCall(call, targetJID, "", false)
}

// MakeGroupCall initiates an outbound voice call to every member of a group
func (a *Api) MakeGroupCall(groupJID string) error {
	if a.callClient == nil {
		return fmt.Errorf("call client not initialized")
	}

	ctx := context.Background()
	call, err := a.callClient.GroupCallByID(ctx, groupJID)
	if err != nil {
		log.Printf("[Calls] Failed to initiate group call to %s: %v", redactJID(groupJID), err)
		return fmt.Errorf("failed to make group call: %v", err)
	}

	return a.trackOutgoingCall(call, groupJID, groupJID, true)
}

// trackOutgoingCall registers an outbound call with meowcaller's callbacks and
// wires the audio bridge, shared by MakeCall and MakeGroupCall.
func (a *Api) trackOutgoingCall(call *meowcaller.Call, peerJID, groupJID string, isGroup bool) error {
	log.Printf("[Calls] Outbound call placed to %s (CallID: %s)", redactJID(peerJID), call.ID())
	now := time.Now()
	callsMu.Lock()
	activeCalls[call.ID()] = &ActiveCall{
		Call:      call,
		PeerJID:   peerJID,
		GroupJID:  groupJID,
		IsGroup:   isGroup,
		Direction: "outgoing",
		IsVideo:   call.IsVideo(),
		StartTime: now,
	}
	callsMu.Unlock()

	// Install terminal/accept handlers before opening the audio bridge so no
	// end event can be missed during (or race with) bridge setup. (D-AUD-004d)
	call.OnEnd(func(reason string) {
		log.Printf("[Calls] Outbound call %s ended: %s", call.ID(), reason)
		callsMu.Lock()
		ended := activeCalls[call.ID()]
		if ended != nil {
			delete(activeCalls, call.ID())
		}
		callsMu.Unlock()
		if ended != nil {
			// Close is idempotent, so this is safe even if setup never attached
			// a bridge. (D-AUD-004g)
			if ended.Bridge != nil {
				ended.Bridge.SetMuted(false) // clear local mute on teardown (CALL-001)
				_ = ended.Bridge.Close()
			}
			a.insertCallLog(ended)
		}
		if a.ctx != nil {
			a.app.Event.Emit("call:ended", map[string]any{
				"callID": call.ID(),
				"reason": reason,
			})
			hideCallWindow()
		}
	})

	call.OnPeerAccept(func() {
		log.Printf("[Calls] Outbound call %s accepted by peer", call.ID())
		callsMu.Lock()
		if ac := activeCalls[call.ID()]; ac != nil {
			ac.AnswerTime = time.Now()
		}
		callsMu.Unlock()
		if a.ctx != nil {
			a.app.Event.Emit("call:accepted", map[string]any{
				"callID": call.ID(),
			})
		}
	})

	// Mirror the incoming path: forward the REMOTE party's mic state from
	// meowcaller's OnMuteState without touching our local mute flag. Late
	// events after the call ended are dropped. (CALL-001)
	call.OnMuteState(func(muted bool) {
		callsMu.Lock()
		stillActive := activeCalls[call.ID()] != nil
		callsMu.Unlock()
		if !stillActive || a.ctx == nil {
			return
		}
		a.app.Event.Emit("call:remote_mute", map[string]any{
			"callID": call.ID(),
			"muted":  muted,
		})
	})

	// Bridge setup happens after the handlers are installed. A call with no
	// working audio path is unusable, so a bridge failure tears the call down
	// and returns an error through MakeCall/MakeGroupCall to the UI toast,
	// instead of reporting a phantom success. (critic: MINOR D-AUD-004)
	abort := func() {
		callsMu.Lock()
		delete(activeCalls, call.ID())
		callsMu.Unlock()
		if err := call.Hangup(); err != nil {
			log.Printf("[Calls] Failed to hangup outbound call %s after audio failure: %v", call.ID(), err)
		}
	}

	bridge, err := NewLiveAudioBridge()
	if err != nil {
		log.Printf("[Calls] Failed to initialize live audio bridge for outbound call: %v", err)
		abort()
		return fmt.Errorf("audio bridge init failed: %w", err)
	}
	if err := bridge.Start(); err != nil {
		log.Printf("[Calls] Failed to start audio bridge for outbound call: %v", err)
		_ = bridge.Close() // Close is idempotent and releases a partial device.
		abort()
		return fmt.Errorf("audio bridge start failed: %w", err)
	}

	callsMu.Lock()
	ac, ok := activeCalls[call.ID()]
	if ok {
		ac.Bridge = bridge
	}
	callsMu.Unlock()
	if !ok {
		// The call ended during bridge setup; don't attach to a dead call.
		_ = bridge.Close()
	} else {
		call.Play(bridge)
		call.Receive(bridge)
	}

	// Emit only after the handlers are in place, so the frontend can never
	// observe a call it cannot control (end/accept callbacks already exist).
	// (D-AUD-004d)
	if a.ctx != nil {
		showCallWindow()
		a.app.Event.Emit("call:outgoing", map[string]any{
			"callID":   call.ID(),
			"peerJID":  peerJID,
			"isVideo":  false,
			"isGroup":  isGroup,
			"groupJID": groupJID,
		})
	}

	return nil
}

// AddCallParticipant invites a user into an established call. The call must be
// active (connected); the invite is sent via the group invite signaling flow.
func (a *Api) AddCallParticipant(callID, targetJID string) error {
	callsMu.Lock()
	ac, ok := activeCalls[callID]
	callsMu.Unlock()
	if !ok {
		return fmt.Errorf("call %s not found", callID)
	}
	// ac.Call is assigned once at insertion and never mutated, so it is safe to
	// use outside callsMu. (D-AUD-004f)
	if err := ac.Call.AddParticipant(context.Background(), targetJID); err != nil {
		log.Printf("[Calls] Failed to add %s to call %s: %v", redactJID(targetJID), callID, err)
		return fmt.Errorf("failed to add participant: %v", err)
	}
	log.Printf("[Calls] Invited %s to call %s", redactJID(targetJID), callID)
	if a.ctx != nil {
		a.app.Event.Emit("call:participant_added", map[string]any{
			"callID":    callID,
			"targetJID": targetJID,
		})
	}
	return nil
}

// MuteCall toggles the LOCAL microphone mute for an active call. This mutes in
// our own AudioSource (meowcaller has no public local-mute setter). The updated
// state is broadcast with call:mute_state for the dedicated call window.
// (CALL-001)
func (a *Api) MuteCall(callID string, muted bool) error {
	callsMu.Lock()
	ac, ok := activeCalls[callID]
	if !ok {
		callsMu.Unlock()
		return fmt.Errorf("call %s not found", callID)
	}
	bridge := ac.Bridge
	callsMu.Unlock()
	if bridge == nil {
		// A still-ringing incoming call has no bridge; the UI only enables the
		// mute button once the call is active, so this is a defensive guard.
		return fmt.Errorf("call %s has no active audio bridge", callID)
	}

	bridge.SetMuted(muted)
	if a.ctx != nil {
		a.app.Event.Emit("call:mute_state", map[string]any{
			"callID": callID,
			"muted":  muted,
		})
	}
	return nil
}

// RejectCall rejects an incoming call
func (a *Api) RejectCall(callID string) error {
	callsMu.Lock()
	callData, ok := activeCalls[callID]
	if !ok {
		callsMu.Unlock()
		return fmt.Errorf("call %s not found", callID)
	}
	delete(activeCalls, callID)
	callsMu.Unlock()
	// Removed from the map under the lock, so no other goroutine can mutate
	// callData here. (D-AUD-004f)
	a.insertCallLog(callData)
	if callData.Bridge != nil {
		callData.Bridge.SetMuted(false) // clear local mute on teardown (CALL-001)
		_ = callData.Bridge.Close()
	}
	if err := callData.Call.Reject(); err != nil {
		log.Printf("[Calls] Failed to reject call %s: %v", callID, err)
	}
	// Reject terminates the call without an OnEnd/call:ended event, so retire
	// the dedicated call window here as well.
	hideCallWindow()
	return nil
}

// cleanupMeowcaller tears down the VoIP client and any active calls so no
// stale callbacks fire after shutdown and no audio resources leak.
func (a *Api) cleanupMeowcaller() {
	// Snapshot and remove every entry while holding callsMu, then tear the
	// calls down after releasing it. OnEnd callbacks take the same mutex, so
	// calling Hangup under the lock deadlocks shutdown whenever a call is
	// active. Removing the entries first also stops those callbacks from
	// firing during teardown. (D-AUD-004a)
	callsMu.Lock()
	snapshot := make([]*ActiveCall, 0, len(activeCalls))
	for id, ac := range activeCalls {
		snapshot = append(snapshot, ac)
		delete(activeCalls, id)
	}
	callsMu.Unlock()

	for _, ac := range snapshot {
		if ac.Bridge != nil {
			_ = ac.Bridge.Close()
		}
		if ac.Call != nil {
			if err := ac.Call.Hangup(); err != nil {
				log.Printf("[Calls] Failed to hangup call %s during cleanup: %v", ac.Call.ID(), err)
			}
		}
	}

	// Unregister the CallOffer handler registered in initMeowcaller. Dropping
	// the a.callClient reference does NOT remove a whatsmeow handler — without
	// this, the closure stays live on waClient and can still mutate the map and
	// Emit call:incoming after shutdown. (critic: MAJOR D-AUD-004a)
	callsMu.Lock()
	handlerID := callOfferHandlerID
	callOfferHandlerID = 0
	callsMu.Unlock()
	if a.waClient != nil && handlerID != 0 {
		a.waClient.RemoveEventHandler(handlerID)
	}

	// Drop the local meowcaller reference only after unregistering our own
	// handler above; this does not unregister meowcaller's internal handlers.
	if a.callClient != nil {
		a.callClient = nil
	}
}

// insertCallLog stores a call history entry as a system message in the chat so
// the frontend can display it as a call log entry. The format uses a [call]
// prefix so the UI can distinguish it from group system messages.
// Callers invoke this only after removing the ActiveCall from activeCalls, so
// its fields are no longer subject to concurrent writes. (D-AUD-004f)
func (a *Api) insertCallLog(ac *ActiveCall) {
	mediaType := "voice"
	if ac.IsVideo {
		mediaType = "video"
	}

	var status string
	durSecs := int64(0)
	endTime := time.Now()
	if ac.AnswerTime.IsZero() {
		status = "missed"
	} else {
		status = "answered"
		durSecs = int64(endTime.Sub(ac.AnswerTime).Seconds())
	}

	durStr := ""
	if durSecs > 0 {
		mins := durSecs / 60
		secs := durSecs % 60
		durStr = fmt.Sprintf(" · %d:%02d", mins, secs)
	}

	prefix := "[call]"
	text := fmt.Sprintf("%s📞%s %s call%s", prefix, status, mediaType, durStr)
	msgID := fmt.Sprintf("call_%s_%d", ac.PeerJID, ac.StartTime.UnixMilli())
	chatJID := ac.PeerJID
	if ac.IsGroup {
		chatJID = ac.GroupJID
		if chatJID == "" {
			chatJID = ac.PeerJID
		}
		text = fmt.Sprintf("%s📞%s group %s call%s", prefix, status, mediaType, durStr)
	}

	if err := a.messageStore.InsertSystemMessage(chatJID, msgID, text, ac.StartTime.Unix()); err != nil {
		slog.Warn(fmt.Sprintf("Failed to store call log: %v", err), "source", "calls")
	}
	a.app.Event.Emit("wa:chat_list_refresh")
}

// GetCallStats returns diagnostic information about an active call.
func (a *Api) GetCallStats(callID string) (*CallStats, error) {
	// Snapshot every ActiveCall field under callsMu; the meowcaller Call
	// accessors below are internally synchronized. (D-AUD-004f)
	callsMu.Lock()
	callData, ok := activeCalls[callID]
	if !ok {
		callsMu.Unlock()
		return nil, fmt.Errorf("call %s not found", callID)
	}
	call := callData.Call
	bridgeActive := callData.Bridge != nil
	answerTime := callData.AnswerTime
	isGroup := callData.IsGroup
	groupJID := callData.GroupJID
	callsMu.Unlock()

	state := call.State()
	phase := ""
	switch state {
	case meowcaller.CallPhaseIdle:
		phase = "idle"
	case meowcaller.CallPhaseCalling:
		phase = "calling"
	case meowcaller.CallPhaseRinging:
		phase = "ringing"
	case meowcaller.CallPhaseConnecting:
		phase = "connecting"
	case meowcaller.CallPhaseActive:
		phase = "active"
	case meowcaller.CallPhaseEnded:
		phase = "ended"
	default:
		phase = "unknown"
	}

	// Group call roster size, if this is a group call. GroupState() is the
	// library's authoritative roster snapshot. (D-AUD-004h)
	var participantCount int
	if gs, ok := call.GroupState(); ok {
		participantCount = len(gs.Participants)
	}

	// Derive duration from AnswerTime once the call is active; 0 while ringing
	// or before an answer was recorded. (D-AUD-004c)
	var dur int64
	if state == meowcaller.CallPhaseActive && !answerTime.IsZero() {
		dur = int64(time.Since(answerTime).Seconds())
		if dur < 0 {
			dur = 0
		}
	}

	return &CallStats{
		CallID:           call.ID(),
		PeerJID:          call.Peer().String(),
		State:            phase,
		IsVideo:          call.IsVideo(),
		IsSendingVideo:   call.IsSendingVideo(),
		IsReceivingVideo: call.IsReceivingVideo(),
		Codec:            "MLow",
		SampleRate:       16000,
		FrameSize:        960,
		RelayEnabled:     true,
		BridgeActive:     bridgeActive,
		Duration:         dur,
		IsGroup:          isGroup,
		GroupJID:         groupJID,
		Participants:     participantCount,
	}, nil
}

// EndCall terminates an active call
func (a *Api) EndCall(callID string) error {
	callsMu.Lock()
	callData, ok := activeCalls[callID]
	if !ok {
		callsMu.Unlock()
		return fmt.Errorf("call %s not found", callID)
	}
	delete(activeCalls, callID)
	callsMu.Unlock()
	// Removed from the map under the lock; safe to read outside it. (D-AUD-004f)
	a.insertCallLog(callData)
	if callData.Bridge != nil {
		callData.Bridge.SetMuted(false) // clear local mute on teardown (CALL-001)
		_ = callData.Bridge.Close()
	}
	if err := callData.Call.Hangup(); err != nil {
		log.Printf("[Calls] Failed to hangup call %s: %v", callID, err)
	}
	// Hangup will also fire OnEnd (and emit call:ended), but the call was
	// already removed from activeCalls above, so hide explicitly here too.
	hideCallWindow()
	return nil
}
