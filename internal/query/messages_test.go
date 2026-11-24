package query_test

import (
	"strings"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/query"
)

func TestCreateMessagesTable(t *testing.T) {
	t.Parallel()

	t.Run("declares messages table and columns", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateMessagesTable
		mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS messages")
		for _, col := range []string{
			"message_id TEXT PRIMARY KEY",
			"chat_jid TEXT NOT NULL",
			"sender_jid TEXT NOT NULL",
			"timestamp INTEGER NOT NULL",
			"is_from_me BOOLEAN NOT NULL",
			"text TEXT",
			"has_media BOOLEAN DEFAULT FALSE",
			"reply_to_message_id TEXT",
			"edited BOOLEAN DEFAULT FALSE",
			"forwarded BOOLEAN DEFAULT FALSE",
			"type INTEGER DEFAULT 0",
		} {
			mustContain(t, ddl, col)
		}
	})

	t.Run("declares expected indexes", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateMessagesTable
		for _, idx := range []string{
			"CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);",
			"CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid);",
			"CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);",
			"CREATE INDEX IF NOT EXISTS idx_messages_chat_cursor ON messages(chat_jid, timestamp DESC, message_id DESC);",
		} {
			mustContain(t, ddl, idx)
		}
	})

	t.Run("is idempotent DDL only", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateMessagesTable
		mustHavePlaceholders(t, ddl, 0)
		mustNotContain(t, strings.ToUpper(ddl), "DROP TABLE")
	})
}

func TestInsertMessage(t *testing.T) {
	t.Parallel()

	t.Run("upserts into messages with 11 bound columns", func(t *testing.T) {
		t.Parallel()
		sql := query.InsertMessage
		mustContain(t, sql, "INSERT INTO messages")
		mustHavePlaceholders(t, sql, 11)

		table, cols := insertTableAndColumns(sql)
		if table != "messages" {
			t.Errorf("insert target = %q, want messages", table)
		}
		wantCols := []string{
			"message_id", "chat_jid", "sender_jid", "timestamp", "is_from_me",
			"text", "has_media", "reply_to_message_id", "edited", "forwarded", "type",
		}
		if len(cols) != len(wantCols) {
			t.Fatalf("insert column count = %d, want %d: %v", len(cols), len(wantCols), cols)
		}
		for i := range wantCols {
			if cols[i] != wantCols[i] {
				t.Errorf("insert column[%d] = %q, want %q", i, cols[i], wantCols[i])
			}
		}
	})

	t.Run("preserves row identity with ON CONFLICT instead of REPLACE", func(t *testing.T) {
		t.Parallel()
		sql := query.InsertMessage
		mustContain(t, sql, "ON CONFLICT(message_id) DO UPDATE SET")
		mustNotContain(t, strings.ToUpper(sql), "REPLACE")
		mustNotContain(t, sql, "ON DELETE CASCADE")

		assignments := upsertAssignments(sql)
		wantUpdated := []string{
			"chat_jid", "sender_jid", "timestamp", "is_from_me", "text",
			"has_media", "reply_to_message_id", "edited", "forwarded", "type",
		}
		if len(assignments) != len(wantUpdated) {
			t.Fatalf("upsert assignment count = %d, want %d: %v", len(assignments), len(wantUpdated), assignments)
		}
		for i, col := range wantUpdated {
			want := col + " = excluded." + col
			if assignments[i] != want {
				t.Errorf("upsert assignment[%d] = %q, want %q", i, assignments[i], want)
			}
		}
		for _, a := range assignments {
			if strings.HasPrefix(a, "message_id ") {
				t.Errorf("primary key must not be reassigned by upsert, got %q", a)
			}
		}
	})
}

func TestUpdateMessage(t *testing.T) {
	t.Parallel()
	sql := query.UpdateMessage
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "UPDATE messages")
	mustContain(t, sql, "SET text = ?, edited = TRUE")
	mustContain(t, sql, "WHERE message_id = ?")
}

func TestSelectMessageByID(t *testing.T) {
	t.Parallel()
	sql := query.SelectMessageByID
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "FROM messages")
	mustContain(t, sql, "WHERE message_id = ?")
	for _, col := range []string{
		"chat_jid", "sender_jid", "timestamp", "is_from_me", "text",
		"has_media", "reply_to_message_id", "edited", "forwarded",
	} {
		mustContain(t, sql, col)
	}
}

func TestSelectDecodedMessageByChatAndID(t *testing.T) {
	t.Parallel()

	t.Run("joins media and link previews for one message", func(t *testing.T) {
		t.Parallel()
		sql := query.SelectDecodedMessageByChatAndID
		mustHavePlaceholders(t, sql, 2)
		mustContain(t, sql, "LEFT JOIN message_media AS mm ON mm.message_id = m.message_id")
		mustContain(t, sql, "LEFT JOIN link_previews AS lp ON lp.message_id = m.message_id")
		mustContain(t, sql, "WHERE m.chat_jid = ? AND m.message_id = ?")
		mustContain(t, sql, "LIMIT 1")
	})

	t.Run("derives has-preview flag from thumbnail or media key", func(t *testing.T) {
		t.Parallel()
		sql := query.SelectDecodedMessageByChatAndID
		mustContain(t, sql, "length(COALESCE(lp.thumbnail, x'')) > 0")
		mustContain(t, sql, "COALESCE(lp.direct_path, '') <> ''")
		mustContain(t, sql, "length(COALESCE(lp.media_key, x'')) > 0")
		mustContain(t, sql, "THEN 1 ELSE 0 END")
	})
}

func TestSelectAllMessagesJIDs(t *testing.T) {
	t.Parallel()
	sql := query.SelectAllMessagesJIDs
	mustHavePlaceholders(t, sql, 0)
	mustContain(t, sql, "SELECT message_id, chat_jid, sender_jid")
	mustContain(t, sql, "FROM messages")
}

func TestUpdateMessageJIDs(t *testing.T) {
	t.Parallel()
	sql := query.UpdateMessageJIDs
	mustHavePlaceholders(t, sql, 3)
	mustContain(t, sql, "UPDATE messages")
	mustContain(t, sql, "SET chat_jid = ?, sender_jid = ?")
	mustContain(t, sql, "WHERE message_id = ?;")
}

func TestSelectMessagesByChatBeforeCursor(t *testing.T) {
	t.Parallel()

	t.Run("keyset cursor binds five arguments", func(t *testing.T) {
		t.Parallel()
		sql := query.SelectMessagesByChatBeforeCursor
		mustHavePlaceholders(t, sql, 5)
		mustContain(t, sql, "WHERE chat_jid = ?")
		mustContain(t, sql, "AND (timestamp < ? OR (timestamp = ? AND message_id < ?))")
		mustContain(t, sql, "LIMIT ?")
	})

	t.Run("pages newest-first in the subquery and returns rows oldest-first", func(t *testing.T) {
		t.Parallel()
		sql := query.SelectMessagesByChatBeforeCursor
		mustContain(t, sql, "FROM (")
		mustContain(t, sql, "ORDER BY timestamp DESC, message_id DESC")
		mustContain(t, sql, ") AS m")
		mustContain(t, sql, "LEFT JOIN message_media AS mm ON mm.message_id = m.message_id")
		mustContain(t, sql, "LEFT JOIN link_previews AS lp ON lp.message_id = m.message_id")
		mustContain(t, sql, "ORDER BY m.timestamp ASC, m.message_id ASC")
	})
}

func TestSelectLatestMessagesByChat(t *testing.T) {
	t.Parallel()
	sql := query.SelectLatestMessagesByChat
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "WHERE chat_jid = ?")
	mustContain(t, sql, "ORDER BY timestamp DESC, message_id DESC")
	mustContain(t, sql, "LIMIT ?")
	mustContain(t, sql, "ORDER BY m.timestamp ASC, m.message_id ASC")
	mustContain(t, sql, "LEFT JOIN message_media AS mm ON mm.message_id = m.message_id")
	mustContain(t, sql, "LEFT JOIN link_previews AS lp ON lp.message_id = m.message_id")
}

func TestSelectDecodedMessagesByIDPrefix(t *testing.T) {
	t.Parallel()
	sql := query.SelectDecodedMessagesByIDPrefix
	mustHavePlaceholders(t, sql, 0)
	mustContain(t, sql, "FROM messages AS m")
	mustContain(t, sql, "LEFT JOIN message_media AS mm ON mm.message_id = m.message_id")
	mustContain(t, sql, "WHERE m.message_id IN (")
	if !strings.HasSuffix(strings.TrimSpace(sql), "IN (") {
		t.Errorf("prefix must end with an open IN ( for caller completion, got tail %q", sql[len(sql)-min(12, len(sql)):])
	}
}

func TestSelectMessageByChatAndID(t *testing.T) {
	t.Parallel()
	sql := query.SelectMessageByChatAndID
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "FROM messages")
	mustContain(t, sql, "WHERE chat_jid = ? AND message_id = ?")
	mustContain(t, sql, "LIMIT 1")
}

func TestSelectDecodedChatList(t *testing.T) {
	t.Parallel()

	t.Run("picks the newest message per chat", func(t *testing.T) {
		t.Parallel()
		sql := query.SelectDecodedChatList
		mustHavePlaceholders(t, sql, 0)
		mustContain(t, sql, "ROW_NUMBER() OVER (")
		mustContain(t, sql, "PARTITION BY chat_jid")
		mustContain(t, sql, "ORDER BY timestamp DESC")
		mustContain(t, sql, "WHERE rn = 1")
		mustContain(t, sql, "LEFT JOIN message_media AS mm ON mm.message_id = m.message_id")
		mustContain(t, sql, "ORDER BY m.timestamp DESC;")
	})

	t.Run("excludes newsletter and broadcast chats", func(t *testing.T) {
		t.Parallel()
		sql := query.SelectDecodedChatList
		mustContain(t, sql, "m.chat_jid NOT LIKE '%@newsletter'")
		mustContain(t, sql, "m.chat_jid NOT LIKE '%@broadcast'")
	})
}

func TestSelectDecodedChannelList(t *testing.T) {
	t.Parallel()
	sql := query.SelectDecodedChannelList
	mustHavePlaceholders(t, sql, 0)
	mustContain(t, sql, "PARTITION BY chat_jid")
	mustContain(t, sql, "WHERE rn = 1")
	mustContain(t, sql, "m.chat_jid LIKE '%@newsletter'")
	mustNotContain(t, sql, "@broadcast")
	mustContain(t, sql, "ORDER BY m.timestamp DESC;")
}

func TestUpdateMessagesChat(t *testing.T) {
	t.Parallel()
	sql := query.UpdateMessagesChat
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "UPDATE messages")
	mustContain(t, sql, "SET chat_jid = ?")
	mustContain(t, sql, "WHERE chat_jid = ?;")
}

func TestSelectDistinctJIDColumnQueries(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		sql   string
		table string
		col   string
	}{
		{"reactions sender", query.SelectDistinctJIDColumnReactionsSender, "reactions", "sender_id"},
		{"pinned messages chat", query.SelectDistinctJIDColumnPinnedMessagesChat, "pinned_messages", "chat_jid"},
		{"pinned messages sender", query.SelectDistinctJIDColumnPinnedMessagesSender, "pinned_messages", "sender_jid"},
		{"pinned chats", query.SelectDistinctJIDColumnPinnedChats, "pinned_chats", "chat_jid"},
		{"archived chats", query.SelectDistinctJIDColumnArchivedChats, "archived_chats", "chat_jid"},
		{"muted chats", query.SelectDistinctJIDColumnMutedChats, "muted_chats", "chat_jid"},
		{"read receipts", query.SelectDistinctJIDColumnReadReceipts, "read_receipts", "chat_jid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustHavePlaceholders(t, tt.sql, 0)
			mustContain(t, tt.sql, "SELECT DISTINCT "+tt.col+" FROM "+tt.table)
			mustContain(t, tt.sql, tt.col+" IS NOT NULL")
			mustContain(t, tt.sql, tt.col+" != ''")
		})
	}
}

func TestUpdateJIDColumnQueries(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		sql   string
		table string
		col   string
	}{
		{"reactions sender", query.UpdateReactionsSenderJID, "reactions", "sender_id"},
		{"pinned messages chat", query.UpdatePinnedMessagesChatJID, "pinned_messages", "chat_jid"},
		{"pinned messages sender", query.UpdatePinnedMessagesSenderJID, "pinned_messages", "sender_jid"},
		{"pinned chats", query.UpdatePinnedChatsJID, "pinned_chats", "chat_jid"},
		{"archived chats", query.UpdateArchivedChatsJID, "archived_chats", "chat_jid"},
		{"muted chats", query.UpdateMutedChatsJID, "muted_chats", "chat_jid"},
		{"read receipts", query.UpdateReadReceiptsJID, "read_receipts", "chat_jid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustHavePlaceholders(t, tt.sql, 2)
			mustContain(t, tt.sql, "UPDATE "+tt.table+" SET "+tt.col+" = ? WHERE "+tt.col+" = ?;")
		})
	}
}

func TestSearchMessagesSelect(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		want string
	}{
		{"escaped LIKE protects wildcard characters", `LIKE '%' || ? || '%' ESCAPE '\'`},
		{"null text is searchable as empty string", `COALESCE(m.text, '')`},
		{"joins media for type fallback", `LEFT JOIN message_media mm ON mm.message_id = m.message_id`},
		{"selects expected display columns", `m.chat_jid, m.message_id, m.sender_jid, m.timestamp, m.text, m.is_from_me, m.has_media, COALESCE(mm.type, 0), m.edited, m.forwarded`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustContain(t, query.SearchMessagesSelect, tt.want)
		})
	}

	t.Run("binds exactly the search term", func(t *testing.T) {
		t.Parallel()
		mustHavePlaceholders(t, query.SearchMessagesSelect, 1)
	})
}
