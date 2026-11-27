package api

import (
	"testing"
	"time"

	waHistorySync "github.com/polymorfa/hypermeow/proto/waHistorySync"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestIsOnDemandHistorySync(t *testing.T) {
	onDemand := &events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType: waHistorySync.HistorySync_ON_DEMAND.Enum(),
	}}
	if !isOnDemandHistorySync(onDemand) {
		t.Fatal("ON_DEMAND sync must be recognised")
	}
	initial := &events.HistorySync{Data: &waHistorySync.HistorySync{
		SyncType: waHistorySync.HistorySync_INITIAL_BOOTSTRAP.Enum(),
	}}
	if isOnDemandHistorySync(initial) {
		t.Fatal("INITIAL_BOOTSTRAP must not be treated as per-chat backfill")
	}
}

func TestHistoryBackfillExhausted(t *testing.T) {
	const chat = "123@s.whatsapp.net"
	makeSync := func(kind waHistorySync.Conversation_EndOfHistoryTransferType) *events.HistorySync {
		return &events.HistorySync{Data: &waHistorySync.HistorySync{
			SyncType: waHistorySync.HistorySync_ON_DEMAND.Enum(),
			Conversations: []*waHistorySync.Conversation{{
				ID:                       proto.String(chat),
				EndOfHistoryTransferType: kind.Enum(),
			}},
		}}
	}

	if !historyBackfillExhausted(
		makeSync(waHistorySync.Conversation_COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY), chat) {
		t.Fatal("COMPLETE_AND_NO_MORE must end the backfill")
	}
	// The default enum value means "more messages remain on primary". Treating
	// it as terminal would silently truncate history.
	if historyBackfillExhausted(
		makeSync(waHistorySync.Conversation_COMPLETE_BUT_MORE_MESSAGES_REMAIN_ON_PRIMARY), chat) {
		t.Fatal("default/more-remain must not end the backfill")
	}
	if historyBackfillExhausted(
		makeSync(waHistorySync.Conversation_COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY),
		"other@s.whatsapp.net") {
		t.Fatal("a different conversation must not end this chat's backfill")
	}
}

func TestRegisterHistoryBackfillLimits(t *testing.T) {
	a := &Api{}
	if err := a.registerHistoryBackfill("a@s.whatsapp.net", types.MessageID("id-a"), "req-a"); err != nil {
		t.Fatal(err)
	}
	if err := a.registerHistoryBackfill("a@s.whatsapp.net", types.MessageID("x"), "req-b"); err == nil {
		t.Fatal("one request per chat must be enforced")
	}
	// Advance the global interval clock between assertions (no sleeping).
	a.lastHistoryRequest = time.Now().Add(-time.Hour)
	if err := a.registerHistoryBackfill("b@s.whatsapp.net", types.MessageID("x"), "req-c"); err != nil {
		t.Fatalf("a second chat should be allowed: %v", err)
	}
	if err := a.registerHistoryBackfill("c@s.whatsapp.net", types.MessageID("x"), "req-d"); err == nil {
		t.Fatal("concurrency cap must be enforced")
	}

	// Finishing a request frees its slot.
	a.finishHistoryBackfill("req-a", false, false)
	a.lastHistoryRequest = time.Now().Add(-time.Hour)
	if err := a.registerHistoryBackfill("c@s.whatsapp.net", types.MessageID("x"), "req-e"); err != nil {
		t.Fatalf("finished request must free its slot: %v", err)
	}

	rateLimited := &Api{lastHistoryRequest: time.Now()}
	if err := rateLimited.registerHistoryBackfill(
		"d@s.whatsapp.net", types.MessageID("x"), "req-f"); err == nil {
		t.Fatal("global request interval must be enforced")
	}
}
