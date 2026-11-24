package query_test

import (
	"testing"

	"github.com/lugvitc/amazingwhats/internal/query"
)

func TestCreatePinnedChatsTable(t *testing.T) {
	t.Parallel()
	ddl := query.CreatePinnedChatsTable
	mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS pinned_chats")
	mustContain(t, ddl, "chat_jid TEXT PRIMARY KEY")
	mustContain(t, ddl, "pinned_at INTEGER NOT NULL")
	mustHavePlaceholders(t, ddl, 0)
}

func TestUpsertPinnedChat(t *testing.T) {
	t.Parallel()
	sql := query.UpsertPinnedChat
	mustHavePlaceholders(t, sql, 2)
	table, cols := insertTableAndColumns(sql)
	if table != "pinned_chats" {
		t.Errorf("insert target = %q, want pinned_chats", table)
	}
	if len(cols) != 2 || cols[0] != "chat_jid" || cols[1] != "pinned_at" {
		t.Errorf("insert columns = %v, want [chat_jid pinned_at]", cols)
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO pinned_chats")
	mustContain(t, sql, "VALUES (?, ?);")
}

func TestDeletePinnedChat(t *testing.T) {
	t.Parallel()
	sql := query.DeletePinnedChat
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "DELETE FROM pinned_chats WHERE chat_jid = ?;")
}

func TestSelectPinnedChats(t *testing.T) {
	t.Parallel()
	sql := query.SelectPinnedChats
	mustHavePlaceholders(t, sql, 0)
	mustContain(t, sql, "SELECT chat_jid, pinned_at FROM pinned_chats;")
}

func TestGetChatPinnedMessagesWithText(t *testing.T) {
	t.Parallel()

	t.Run("binds chat jid and current time", func(t *testing.T) {
		t.Parallel()
		sql := query.GetChatPinnedMessagesWithText
		mustHavePlaceholders(t, sql, 2)
		mustContain(t, sql, "WHERE p.chat_jid = ? AND (p.expiry <= 0 OR p.pinned_at + p.expiry > ?)")
	})

	t.Run("joins message text and orders oldest pin first", func(t *testing.T) {
		t.Parallel()
		sql := query.GetChatPinnedMessagesWithText
		mustContain(t, sql, "LEFT JOIN messages m ON m.message_id = p.message_id AND m.chat_jid = p.chat_jid")
		mustContain(t, sql, "COALESCE(m.text, '')")
		mustContain(t, sql, "ORDER BY p.pinned_at ASC;")
	})
}
