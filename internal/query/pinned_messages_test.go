package query_test

import (
	"testing"

	"github.com/lugvitc/amazingwhats/internal/query"
)

func TestCreatePinnedMessagesTable(t *testing.T) {
	t.Parallel()

	t.Run("declares the pinned_messages schema", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreatePinnedMessagesTable
		mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS pinned_messages")
		for _, col := range []string{
			"message_id TEXT NOT NULL", "chat_jid TEXT NOT NULL",
			"sender_jid TEXT NOT NULL", "pinned_at INTEGER NOT NULL",
			"expiry INTEGER NOT NULL", "PRIMARY KEY (message_id, chat_jid)",
		} {
			mustContain(t, ddl, col)
		}
		mustHavePlaceholders(t, ddl, 0)
	})

	t.Run("declares expected indexes", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreatePinnedMessagesTable
		for _, idx := range []string{
			"CREATE INDEX IF NOT EXISTS idx_pinned_messages_chat_jid ON pinned_messages(chat_jid);",
			"CREATE INDEX IF NOT EXISTS idx_pinned_messages_sender_jid ON pinned_messages(sender_jid);",
			"CREATE INDEX IF NOT EXISTS idx_pinned_messages_pinned_at ON pinned_messages(pinned_at DESC);",
		} {
			mustContain(t, ddl, idx)
		}
	})
}

func TestInsertPinnedMessages(t *testing.T) {
	t.Parallel()
	sql := query.InsertPinnedMessages
	mustHavePlaceholders(t, sql, 5)
	table, cols := insertTableAndColumns(sql)
	if table != "pinned_messages" {
		t.Errorf("insert target = %q, want pinned_messages", table)
	}
	want := []string{"message_id", "chat_jid", "sender_jid", "pinned_at", "expiry"}
	if len(cols) != len(want) {
		t.Fatalf("insert column count = %d, want %d: %v", len(cols), len(want), cols)
	}
	for i := range want {
		if cols[i] != want[i] {
			t.Errorf("insert column[%d] = %q, want %q", i, cols[i], want[i])
		}
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO pinned_messages")
}

func TestDeletePinnedMessageByMessageId(t *testing.T) {
	t.Parallel()
	sql := query.DeletePinnedMessageByMessageId
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "DELETE FROM pinned_messages")
	mustContain(t, sql, "WHERE message_id = ?;")
}
