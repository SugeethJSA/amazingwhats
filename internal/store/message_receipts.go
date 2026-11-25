package store

import (
	"database/sql"
	"fmt"

	"github.com/lugvitc/amazingwhats/internal/query"
)

// MessageReceipt is one durable read-receipt row: who (reader_jid) read a
// given message (message_id) in a chat (chat_jid), with the raw receipt type
// and the event timestamp. It is a flat, JSON-tagged value so it can cross the
// Wails binding boundary unchanged.
type MessageReceipt struct {
	ChatJID     string `json:"chat_jid"`
	MessageID   string `json:"message_id"`
	ReaderJID   string `json:"reader_jid"`
	ReceiptType string `json:"receipt_type"`
	Timestamp   int64  `json:"timestamp"`
}

// InsertMessageReceipts inserts or refreshes receipt rows in one write
// transaction. Entries with an empty message ID are skipped: the message ID is
// part of the primary key and an empty key would collapse unrelated receipts.
func (ms *MessageStore) InsertMessageReceipts(entries []MessageReceipt) error {
	return ms.runSync(func(tx *sql.Tx) error {
		stmt, err := tx.Prepare(query.UpsertMessageReceipt)
		if err != nil {
			return fmt.Errorf("prepare message receipt upsert: %w", err)
		}
		defer func() { _ = stmt.Close() }()

		for _, entry := range entries {
			if entry.MessageID == "" {
				continue
			}
			if _, err := stmt.Exec(
				entry.ChatJID,
				entry.MessageID,
				entry.ReaderJID,
				entry.ReceiptType,
				entry.Timestamp,
			); err != nil {
				return fmt.Errorf("upsert message receipt: %w", err)
			}
		}
		return nil
	})
}

// GetMessageReceipts returns every stored receipt for a message, ordered by
// timestamp ascending. An empty (non-nil) slice is returned when there are no
// rows; readers are never fabricated.
func (ms *MessageStore) GetMessageReceipts(chatJID, messageID string) ([]MessageReceipt, error) {
	rows, err := ms.db.Query(query.SelectMessageReceiptsByMessage, chatJID, messageID)
	if err != nil {
		return nil, fmt.Errorf("query message receipts: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := make([]MessageReceipt, 0)
	for rows.Next() {
		var entry MessageReceipt
		if err := rows.Scan(
			&entry.ChatJID,
			&entry.MessageID,
			&entry.ReaderJID,
			&entry.ReceiptType,
			&entry.Timestamp,
		); err != nil {
			return nil, fmt.Errorf("scan message receipt row: %w", err)
		}
		out = append(out, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate message receipts: %w", err)
	}
	return out, nil
}
