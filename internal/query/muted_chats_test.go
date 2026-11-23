package query_test

import (
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
)

func TestCreateMutedChatsTable(t *testing.T) {
	t.Parallel()
	ddl := query.CreateMutedChatsTable
	mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS muted_chats")
	mustContain(t, ddl, "chat_jid TEXT PRIMARY KEY")
	mustContain(t, ddl, "muted_until INTEGER NOT NULL")
	mustHavePlaceholders(t, ddl, 0)
}

func TestUpsertMutedChat(t *testing.T) {
	t.Parallel()
	sql := query.UpsertMutedChat
	mustHavePlaceholders(t, sql, 2)
	table, cols := insertTableAndColumns(sql)
	if table != "muted_chats" {
		t.Errorf("insert target = %q, want muted_chats", table)
	}
	if len(cols) != 2 || cols[0] != "chat_jid" || cols[1] != "muted_until" {
		t.Errorf("insert columns = %v, want [chat_jid muted_until]", cols)
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO muted_chats")
	mustContain(t, sql, "VALUES (?, ?)")
}

func TestSelectMutedUntilByChatJID(t *testing.T) {
	t.Parallel()
	sql := query.SelectMutedUntilByChatJID
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "SELECT muted_until")
	mustContain(t, sql, "FROM muted_chats")
	mustContain(t, sql, "WHERE chat_jid = ?")
}

func TestDeleteMutedChatByChatJID(t *testing.T) {
	t.Parallel()
	sql := query.DeleteMutedChatByChatJID
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "DELETE FROM muted_chats")
	mustContain(t, sql, "WHERE chat_jid = ?")
}
