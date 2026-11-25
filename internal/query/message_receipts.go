package query

const (
	// CreateMessageReceiptsTable is a durable per-message read-receipt ledger.
	// Unlike read_receipts (a per-chat watermark with no writers), this table
	// records which participant read which message and when. The composite
	// primary key makes repeated receipts idempotent.
	CreateMessageReceiptsTable = `
	CREATE TABLE IF NOT EXISTS message_receipts (
		chat_jid TEXT NOT NULL,
		message_id TEXT NOT NULL,
		reader_jid TEXT NOT NULL,
		receipt_type TEXT NOT NULL,
		timestamp INTEGER NOT NULL,
		PRIMARY KEY (chat_jid, message_id, reader_jid, receipt_type)
	);
	CREATE INDEX IF NOT EXISTS idx_message_receipts_chat_message ON message_receipts(chat_jid, message_id);
	`

	// UpsertMessageReceipt refreshes the timestamp of an existing receipt row.
	UpsertMessageReceipt = `
	INSERT INTO message_receipts
		(chat_jid, message_id, reader_jid, receipt_type, timestamp)
	VALUES (?, ?, ?, ?, ?)
	ON CONFLICT(chat_jid, message_id, reader_jid, receipt_type) DO UPDATE SET
		timestamp = excluded.timestamp;
	`

	// SelectMessageReceiptsByMessage returns every receipt recorded for a
	// message, oldest first.
	SelectMessageReceiptsByMessage = `
	SELECT chat_jid, message_id, reader_jid, receipt_type, timestamp
	FROM message_receipts
	WHERE chat_jid = ? AND message_id = ?
	ORDER BY timestamp ASC;
	`
)
