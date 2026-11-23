package query_test

import (
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
)

func TestCreatePollsTable(t *testing.T) {
	t.Parallel()
	ddl := query.CreatePollsTable
	mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS polls")
	for _, col := range []string{
		"chat_jid TEXT NOT NULL", "message_id TEXT NOT NULL",
		"question TEXT NOT NULL", "options_json TEXT NOT NULL",
		"PRIMARY KEY (chat_jid, message_id)",
	} {
		mustContain(t, ddl, col)
	}
	mustHavePlaceholders(t, ddl, 0)
}

func TestCreatePollVotesTable(t *testing.T) {
	t.Parallel()

	t.Run("declares the poll_votes schema", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreatePollVotesTable
		mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS poll_votes")
		for _, col := range []string{
			"chat_jid TEXT NOT NULL", "poll_message_id TEXT NOT NULL",
			"voter_jid TEXT NOT NULL", "option_indices_json TEXT NOT NULL",
			"PRIMARY KEY (chat_jid, poll_message_id, voter_jid)",
		} {
			mustContain(t, ddl, col)
		}
		mustHavePlaceholders(t, ddl, 0)
	})

	t.Run("indexes lookups by poll", func(t *testing.T) {
		t.Parallel()
		mustContain(t, query.CreatePollVotesTable, "CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(chat_jid, poll_message_id);")
	})
}

func TestInsertPoll(t *testing.T) {
	t.Parallel()
	sql := query.InsertPoll
	mustHavePlaceholders(t, sql, 4)
	table, cols := insertTableAndColumns(sql)
	if table != "polls" {
		t.Errorf("insert target = %q, want polls", table)
	}
	if len(cols) != 4 {
		t.Fatalf("insert column count = %d, want 4: %v", len(cols), cols)
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO polls")
	mustContain(t, sql, "VALUES (?, ?, ?, ?)")
}

func TestSelectPoll(t *testing.T) {
	t.Parallel()
	sql := query.SelectPoll
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "SELECT question, options_json")
	mustContain(t, sql, "FROM polls")
	mustContain(t, sql, "WHERE chat_jid = ? AND message_id = ?")
	mustContain(t, sql, "LIMIT 1")
}

func TestUpsertPollVote(t *testing.T) {
	t.Parallel()
	sql := query.UpsertPollVote
	mustHavePlaceholders(t, sql, 4)
	table, cols := insertTableAndColumns(sql)
	if table != "poll_votes" {
		t.Errorf("insert target = %q, want poll_votes", table)
	}
	if len(cols) != 4 {
		t.Fatalf("insert column count = %d, want 4: %v", len(cols), cols)
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO poll_votes")
}

func TestDeletePollVote(t *testing.T) {
	t.Parallel()
	sql := query.DeletePollVote
	mustHavePlaceholders(t, sql, 3)
	mustContain(t, sql, "DELETE FROM poll_votes")
	mustContain(t, sql, "WHERE chat_jid = ? AND poll_message_id = ? AND voter_jid = ?")
}

func TestSelectPollVotes(t *testing.T) {
	t.Parallel()
	sql := query.SelectPollVotes
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "SELECT voter_jid, option_indices_json")
	mustContain(t, sql, "FROM poll_votes")
	mustContain(t, sql, "WHERE chat_jid = ? AND poll_message_id = ?")
}

func TestUpdatePollCardText(t *testing.T) {
	t.Parallel()
	sql := query.UpdatePollCardText
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "UPDATE messages")
	mustContain(t, sql, "SET text = ?")
	mustContain(t, sql, "WHERE message_id = ?")
	mustNotContain(t, sql, "edited")
}
