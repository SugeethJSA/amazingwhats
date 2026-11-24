package api

import (
	"context"
	"testing"

	"github.com/polymorfa/hypermeow/types/events"
)

// The lifecycle observer must ignore events whose originating ConnectContext
// is already cancelled (a delayed event does not establish authority), and it
// must supersede the app-level reconnect loop for a live Connected event
// without touching any UI status.
func TestHandleConnectionLifecycleConnectedAuthority(t *testing.T) {
	a := &Api{}
	a.reconnectActive = true

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	a.handleConnectionLifecycle(cancelled, &events.Connected{})
	if !a.reconnectActive {
		t.Fatal("cancelled ConnectContext must not supersede the reconnect loop")
	}

	a.handleConnectionLifecycle(nil, &events.Connected{})
	if !a.reconnectActive {
		t.Fatal("nil ConnectContext must be ignored")
	}

	a.handleConnectionLifecycle(context.Background(), &events.Connected{})
	if a.reconnectActive {
		t.Fatal("live Connected must supersede the reconnect loop")
	}
}

// A burst of AppStateSyncError events must collapse into a single queued
// resync, and an in-flight resync must not be duplicated.
func TestScheduleAppStateRetryCoalesces(t *testing.T) {
	a := &Api{ctx: context.Background(), taskCh: make(chan func(), 4)}

	a.scheduleAppStateRetry()
	a.scheduleAppStateRetry()
	a.scheduleAppStateRetry()
	if got := len(a.taskCh); got != 1 {
		t.Fatalf("expected 1 coalesced retry, got %d", got)
	}

	a.appStateResync.Store(true)
	a.scheduleAppStateRetry()
	if got := len(a.taskCh); got != 1 {
		t.Fatalf("in-flight resync must not queue another, got %d", got)
	}
}
