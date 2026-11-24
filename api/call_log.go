package api

import (
	"log"

	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/polymorfa/hypermeow/appstate"
	"github.com/polymorfa/hypermeow/proto/waSyncAction"
	"github.com/polymorfa/hypermeow/types/events"
)

// GetRecentCalls is the Wails binding for the future Calls screen. It returns
// structured call history newest first, with the limit clamped to 1..500 in
// the store layer.
func (a *Api) GetRecentCalls(limit int) ([]store.CallLogEntry, error) {
	return a.messageStore.GetRecentCalls(limit)
}

// callLogRecordsFromHistory maps the call-log records carried in a HistorySync
// payload into structured rows. Nil records and records without a call ID are
// skipped: the ID is the primary key used for de-duplication.
// normalizeCallLogTime converts a history timestamp to Unix seconds. The
// protobuf does not document units; WhatsApp has shipped both seconds and
// milliseconds, so values above 1e12 are treated as milliseconds. Without this,
// a millisecond value would render as a date tens of thousands of years out.
func normalizeCallLogTime(v int64) int64 {
	if v > 1e12 {
		return v / 1000
	}
	return v
}

func callLogRecordsFromHistory(records []*waSyncAction.CallLogRecord) []store.CallLogEntry {
	out := make([]store.CallLogEntry, 0, len(records))
	for _, record := range records {
		if record == nil {
			continue
		}
		callID := record.GetCallID()
		if callID == "" {
			continue
		}
		out = append(out, store.CallLogEntry{
			CallID:       callID,
			PeerJID:      record.GetCallCreatorJID(),
			GroupJID:     record.GetGroupJID(),
			IsIncoming:   record.GetIsIncoming(),
			IsVideo:      record.GetIsVideo(),
			Result:       record.GetCallResult().String(),
			StartedAt:    normalizeCallLogTime(record.GetStartTime()),
			DurationSecs: record.GetDuration(),
			Source:       "history",
		})
	}
	return out
}

// storeCallLogRecords persists a batch of structured call-log rows and, on
// success, notifies the frontend that the call log changed. Errors are logged
// once per batch (never once per record) and never propagate into the event
// handlers that call this.
func (a *Api) storeCallLogRecords(records []store.CallLogEntry) {
	if len(records) == 0 {
		return
	}
	if err := a.messageStore.UpsertCallLogEntries(records); err != nil {
		log.Printf("Failed to store %d structured call log records: %v", len(records), err)
		return
	}
	a.app.Event.Emit("wa:call_log_updated")
}

// callLogEntryFromAppState converts a generic app-state mutation into a
// structured call-log row. Only the two call-log indexes are considered; the
// first index component is the mutation type (e.g. "call_log").
//
// SET (IndexCallLog): the record is read from
// SyncActionValue.GetCallLogAction().GetCallLogRecord() and mapped like a
// history-sync record, with Source="appstate".
//
// DELETE (IndexDeleteIndividualCallLog): deliberately not applied. HyperMeow
// only emits *events.AppState for SyncdMutation_SET mutations, so a delete
// should not reach this handler. Even if one did, DeleteIndividualCallLogAction
// carries only PeerJID + IsIncoming and no CallID; this table is keyed by
// call_id, so there is no safe way to target a single row. Deleting by peer and
// direction would remove unrelated calls. We return ok=false rather than
// delete blindly; deletions are left to a future explicit design.
func callLogEntryFromAppState(v *events.AppState) (store.CallLogEntry, bool) {
	if v == nil || len(v.Index) == 0 {
		return store.CallLogEntry{}, false
	}

	switch v.Index[0] {
	case appstate.IndexCallLog:
		record := v.GetCallLogAction().GetCallLogRecord()
		if record == nil || record.GetCallID() == "" {
			return store.CallLogEntry{}, false
		}
		return store.CallLogEntry{
			CallID:       record.GetCallID(),
			PeerJID:      record.GetCallCreatorJID(),
			GroupJID:     record.GetGroupJID(),
			IsIncoming:   record.GetIsIncoming(),
			IsVideo:      record.GetIsVideo(),
			Result:       record.GetCallResult().String(),
			StartedAt:    normalizeCallLogTime(record.GetStartTime()),
			DurationSecs: record.GetDuration(),
			Source:       "appstate",
		}, true
	case appstate.IndexDeleteIndividualCallLog:
		// No call_id key available; see the doc comment. Do not delete blindly.
		return store.CallLogEntry{}, false
	default:
		return store.CallLogEntry{}, false
	}
}
