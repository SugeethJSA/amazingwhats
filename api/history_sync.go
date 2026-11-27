package api

import (
	"errors"
	"time"

	"github.com/polymorfa/hypermeow"
	waHistorySync "github.com/polymorfa/hypermeow/proto/waHistorySync"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
)

const (
	// The primary can answer an on-demand request in several chunks. Keep a
	// request alive long enough for a slow phone, but never forever.
	historyBackfillTimeout     = 2 * time.Minute
	historyBackfillMinInterval = 2 * time.Second
	maxConcurrentBackfills     = 2
)

type historyBackfill struct {
	chatJID  string
	anchorID types.MessageID
}

// RequestHistorySync asks the primary device for messages immediately BEFORE
// the oldest message we have in a chat. WA Web pages backwards from the oldest
// local anchor; using the newest message would only re-fetch what we already
// have. On empty chatJID the most recently active chat is used.
func (a *Api) RequestHistorySync(chatJID string, count int) error {
	if a.waClient == nil || a.waClient.Store.ID == nil {
		return errors.New("not connected")
	}
	if a.messageStore == nil {
		return errors.New("message store unavailable")
	}
	if count < 1 || count > 50 {
		count = 50
	}

	if chatJID == "" {
		chats := a.messageStore.GetChatList()
		if len(chats) == 0 {
			return errors.New("no chat history available to request")
		}
		chatJID = chats[0].JID.String()
	}
	jid, err := types.ParseJID(chatJID)
	if err != nil {
		return errors.New("invalid chat")
	}
	chatJID = jid.String()

	anchor, err := a.messageStore.GetOldestMessageInfo(chatJID)
	if err != nil {
		// sql.ErrNoRows is intentionally treated as "no local anchor"; the UI
		// shows a generic message rather than a backend error string.
		return errors.New("no messages in this chat yet")
	}

	requestID := a.waClient.GenerateMessageID()
	if err := a.registerHistoryBackfill(chatJID, anchor.ID, requestID); err != nil {
		return err
	}

	message := a.waClient.BuildHistorySyncRequest(&anchor, count)
	_, err = a.waClient.SendMessage(a.ctx, a.waClient.Store.ID.ToNonAD(), message, whatsmeow.SendRequestExtra{
		Peer: true,
		ID:   requestID,
	})
	if err != nil {
		a.finishHistoryBackfill(string(requestID), false, true)
		return errors.New("could not request history from your phone")
	}

	a.emitHistoryBackfill(chatJID, string(requestID), "started", 0, false, false)
	// A dropped background task must not strand a pending request forever.
	time.AfterFunc(historyBackfillTimeout, func() {
		a.finishHistoryBackfill(string(requestID), false, true)
	})
	return nil
}

func (a *Api) registerHistoryBackfill(chatJID string, anchorID, requestID types.MessageID) error {
	a.historyBackfillMu.Lock()
	defer a.historyBackfillMu.Unlock()
	if a.pendingBackfills == nil {
		a.pendingBackfills = make(map[string]*historyBackfill)
	}
	if a.backfillByChat == nil {
		a.backfillByChat = make(map[string]string)
	}
	if len(a.pendingBackfills) >= maxConcurrentBackfills {
		return errors.New("too many history requests in progress")
	}
	if _, busy := a.backfillByChat[chatJID]; busy {
		return errors.New("history request already in progress for this chat")
	}
	if !a.lastHistoryRequest.IsZero() && time.Since(a.lastHistoryRequest) < historyBackfillMinInterval {
		return errors.New("history requests are rate limited; try again in a moment")
	}
	a.pendingBackfills[string(requestID)] = &historyBackfill{
		chatJID:  chatJID,
		anchorID: anchorID,
	}
	a.backfillByChat[chatJID] = string(requestID)
	a.lastHistoryRequest = time.Now()
	return nil
}

func isOnDemandHistorySync(v *events.HistorySync) bool {
	return v != nil && v.Data != nil && v.Data.GetSyncType() == waHistorySync.HistorySync_ON_DEMAND
}

// historyBackfillFor correlates an ON_DEMAND response with an outstanding
// request. It returns false for initial/full syncs and for responses we did not
// ask for; those are still stored as usual.
//
// There is deliberately no dedup by v.MessageID: a redelivered chunk is harmless
// because message inserts are idempotent, whereas dropping the terminal chunk
// would delay completion until the timeout.
func (a *Api) historyBackfillFor(v *events.HistorySync) (*historyBackfill, string, bool) {
	if !isOnDemandHistorySync(v) {
		return nil, "", false
	}
	sessionID := v.Notification.GetPeerDataRequestSessionID()
	if sessionID == "" {
		return nil, "", false
	}
	a.historyBackfillMu.Lock()
	defer a.historyBackfillMu.Unlock()
	pending := a.pendingBackfills[sessionID]
	if pending == nil {
		return nil, sessionID, false
	}
	return pending, sessionID, true
}

func historyBackfillExhausted(v *events.HistorySync, chatJID string) bool {
	if v == nil || v.Data == nil {
		return false
	}
	for _, conv := range v.Data.GetConversations() {
		if conv.GetID() != chatJID && conv.GetPnJID() != chatJID && conv.GetLidJID() != chatJID {
			continue
		}
		if conv.GetEndOfHistoryTransferType() ==
			waHistorySync.Conversation_COMPLETE_AND_NO_MORE_MESSAGE_REMAIN_ON_PRIMARY {
			return true
		}
	}
	return false
}

func (a *Api) finishHistoryBackfill(sessionID string, exhausted, failed bool) {
	a.historyBackfillMu.Lock()
	pending := a.pendingBackfills[sessionID]
	if pending == nil {
		a.historyBackfillMu.Unlock()
		return
	}
	chatJID := pending.chatJID
	delete(a.pendingBackfills, sessionID)
	delete(a.backfillByChat, chatJID)
	a.historyBackfillMu.Unlock()

	a.emitHistoryBackfill(chatJID, sessionID, "done", 0, exhausted, failed)
}

func (a *Api) emitHistoryBackfill(chatJID, sessionID, phase string, stored int, exhausted, failed bool) {
	if a.app == nil {
		return
	}
	a.app.Event.Emit("wa:history_backfill", map[string]any{
		"chatJID":   chatJID,
		"sessionID": sessionID,
		"phase":     phase,
		"stored":    stored,
		"exhausted": exhausted,
		"failed":    failed,
		"done":      phase == "done",
	})
}
