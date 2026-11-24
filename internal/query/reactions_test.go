package query_test

import (
	"strings"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/query"
)

func TestCreateReactionsTable(t *testing.T) {
	t.Parallel()

	t.Run("declares the reactions schema with cascade", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateReactionsTable
		mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS reactions")
		for _, col := range []string{
			"id INTEGER PRIMARY KEY AUTOINCREMENT", "message_id TEXT NOT NULL",
			"sender_id TEXT NOT NULL", "emoji TEXT NOT NULL",
			"FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE",
		} {
			mustContain(t, ddl, col)
		}
		mustHavePlaceholders(t, ddl, 0)
	})

	t.Run("declares expected indexes", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateReactionsTable
		mustContain(t, ddl, "CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions(message_id);")
		mustContain(t, ddl, "CREATE INDEX IF NOT EXISTS idx_reactions_sender_id ON reactions(sender_id);")
	})
}

func TestInsertReaction(t *testing.T) {
	t.Parallel()
	sql := query.InsertReaction
	mustHavePlaceholders(t, sql, 3)
	table, cols := insertTableAndColumns(sql)
	if table != "reactions" {
		t.Errorf("insert target = %q, want reactions", table)
	}
	want := []string{"message_id", "sender_id", "emoji"}
	if len(cols) != len(want) {
		t.Fatalf("insert column count = %d, want %d: %v", len(cols), len(want), cols)
	}
	for i := range want {
		if cols[i] != want[i] {
			t.Errorf("insert column[%d] = %q, want %q", i, cols[i], want[i])
		}
	}
	mustContain(t, sql, "INSERT INTO reactions")
	mustNotContain(t, strings.ToUpper(sql), "REPLACE")
}

func TestDeleteReactionsByMessageIDAndSenderID(t *testing.T) {
	t.Parallel()
	sql := query.DeleteReactionsByMessageIDAndSenderID
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "DELETE FROM reactions")
	mustContain(t, sql, "WHERE message_id = ? AND sender_id = ?")
}

func TestSelectReactionsByMessageID(t *testing.T) {
	t.Parallel()
	sql := query.SelectReactionsByMessageID
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "SELECT id, message_id, sender_id, emoji")
	mustContain(t, sql, "FROM reactions")
	mustContain(t, sql, "WHERE message_id = ?")
	mustContain(t, sql, "ORDER BY id ASC")
}

func TestSelectReactionsByMessageIDsPrefix(t *testing.T) {
	t.Parallel()
	sql := query.SelectReactionsByMessageIDsPrefix
	mustHavePlaceholders(t, sql, 0)
	mustContain(t, sql, "SELECT id, message_id, sender_id, emoji")
	mustContain(t, sql, "FROM reactions")
	mustContain(t, sql, "WHERE message_id IN (")
	if !strings.HasSuffix(strings.TrimSpace(sql), "IN (") {
		t.Errorf("prefix must end with an open IN ( for caller completion, got %q", sql)
	}
}
