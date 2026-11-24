package store

import (
	"database/sql"
	"fmt"

	"github.com/lugvitc/amazingwhats/internal/query"
)

// CallLogEntry is one structured call-history row. It is intentionally a flat,
// JSON-tagged value so the same shape can cross the Wails binding boundary to a
// future Calls screen without another DTO.
type CallLogEntry struct {
	CallID       string `json:"call_id"`
	PeerJID      string `json:"peer_jid"`
	GroupJID     string `json:"group_jid"`
	IsIncoming   bool   `json:"is_incoming"`
	IsVideo      bool   `json:"is_video"`
	Result       string `json:"result"`
	StartedAt    int64  `json:"started_at"`
	DurationSecs int64  `json:"duration_secs"`
	Source       string `json:"source"`
}

// UpsertCallLogEntries inserts or refreshes structured call-log rows in a
// single write transaction. Entries with an empty call ID are skipped: the ID
// is the table's primary key and an empty key would collapse unrelated calls.
func (ms *MessageStore) UpsertCallLogEntries(entries []CallLogEntry) error {
	return ms.runSync(func(tx *sql.Tx) error {
		stmt, err := tx.Prepare(query.UpsertCallLogEntry)
		if err != nil {
			return fmt.Errorf("prepare call log upsert: %w", err)
		}
		defer func() { _ = stmt.Close() }()

		for _, entry := range entries {
			if entry.CallID == "" {
				continue
			}
			if _, err := stmt.Exec(
				entry.CallID,
				entry.PeerJID,
				entry.GroupJID,
				entry.IsIncoming,
				entry.IsVideo,
				entry.Result,
				entry.StartedAt,
				entry.DurationSecs,
				entry.Source,
			); err != nil {
				return fmt.Errorf("upsert call log entry %q: %w", entry.CallID, err)
			}
		}
		return nil
	})
}

// GetRecentCalls returns structured call-log rows, newest first. The limit is
// clamped to 1..500 so a bad argument cannot return an unbounded result set (or
// a LIMIT 0 that silently yields nothing).
func (ms *MessageStore) GetRecentCalls(limit int) ([]CallLogEntry, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := ms.db.Query(query.SelectRecentCalls, limit)
	if err != nil {
		return nil, fmt.Errorf("query recent calls: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []CallLogEntry
	for rows.Next() {
		var entry CallLogEntry
		if err := rows.Scan(
			&entry.CallID,
			&entry.PeerJID,
			&entry.GroupJID,
			&entry.IsIncoming,
			&entry.IsVideo,
			&entry.Result,
			&entry.StartedAt,
			&entry.DurationSecs,
			&entry.Source,
		); err != nil {
			return nil, fmt.Errorf("scan call log row: %w", err)
		}
		out = append(out, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate call log rows: %w", err)
	}
	return out, nil
}
