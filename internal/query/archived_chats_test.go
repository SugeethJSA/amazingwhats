package query_test

import (
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
)

func TestCreateArchivedChatsTable(t *testing.T) {
	t.Parallel()
	ddl := query.CreateArchivedChatsTable
	mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS archived_chats")
	mustContain(t, ddl, "chat_jid TEXT PRIMARY KEY")
	mustContain(t, ddl, "archived_at INTEGER NOT NULL")
	mustHavePlaceholders(t, ddl, 0)
}

func TestUpsertArchivedChat(t *testing.T) {
	t.Parallel()
	sql := query.UpsertArchivedChat
	mustHavePlaceholders(t, sql, 2)
	table, cols := insertTableAndColumns(sql)
	if table != "archived_chats" {
		t.Errorf("insert target = %q, want archived_chats", table)
	}
	if len(cols) != 2 || cols[0] != "chat_jid" || cols[1] != "archived_at" {
		t.Errorf("insert columns = %v, want [chat_jid archived_at]", cols)
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO archived_chats")
	mustContain(t, sql, "VALUES (?, ?);")
}

func TestDeleteArchivedChat(t *testing.T) {
	t.Parallel()
	sql := query.DeleteArchivedChat
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "DELETE FROM archived_chats WHERE chat_jid = ?;")
}

func TestArchivedChatSelects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		sql         string
		want        string
		placeholder int
	}{
		{"list all archived chats", query.SelectArchivedChats, "SELECT chat_jid, archived_at FROM archived_chats;", 0},
		{"existence probe", query.SelectArchivedChat, "SELECT 1 FROM archived_chats WHERE chat_jid = ?;", 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustContain(t, tt.sql, tt.want)
			mustHavePlaceholders(t, tt.sql, tt.placeholder)
		})
	}
}
