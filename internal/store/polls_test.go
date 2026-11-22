package store

import (
	"database/sql"
	"reflect"
	"strings"
	"testing"

	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/query"
)

func TestPollSchemaIsForkShape(t *testing.T) {
	ms := newTestMessageStore(t)

	cols, pk, err := pollTableShape(ms.db, pragmaPollsTableInfo)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"chat_jid", "message_id", "question", "options_json"}; !reflect.DeepEqual(cols, want) {
		t.Errorf("polls columns = %v, want %v", cols, want)
	}
	if want := []int{1, 2}; !reflect.DeepEqual(pk, want) {
		t.Errorf("polls PK positions = %v, want %v", pk, want)
	}

	cols, pk, err = pollTableShape(ms.db, pragmaVotesTableInfo)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"chat_jid", "poll_message_id", "voter_jid", "option_indices_json"}; !reflect.DeepEqual(cols, want) {
		t.Errorf("poll_votes columns = %v, want %v", cols, want)
	}
	if want := []int{1, 2, 3}; !reflect.DeepEqual(pk, want) {
		t.Errorf("poll_votes PK positions = %v, want %v", pk, want)
	}

	var indexes int
	if err := ms.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?`, idxPollVotesPoll).Scan(&indexes); err != nil {
		t.Fatal(err)
	}
	if indexes != 1 {
		t.Errorf("idx_poll_votes_poll count = %d, want 1", indexes)
	}
	// Exactly one CREATE TABLE definition per poll table: no upstream DDL
	// should have produced a second/competing schema object.
	for _, table := range []string{"polls", "poll_votes"} {
		var creates int
		if err := ms.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&creates); err != nil {
			t.Fatal(err)
		}
		if creates != 1 {
			t.Errorf("%s CREATE definitions = %d, want 1", table, creates)
		}
	}
	if err := assertPollSchemaShape(ms.db); err != nil {
		t.Fatal(err)
	}
}

func TestPollSchemaUpgradeFromUpstreamShape(t *testing.T) {
	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	const (
		chat      = "g1@s.whatsapp.net"
		messageID = "poll-upstream-1"
		voter     = "alice@s.whatsapp.net"
	)

	// Pre-create a DB with the incompatible upstream poll schema and a
	// messages row so the startup migration has something to resolve.
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("messages.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(query.CreateMessagesTable); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(query.InsertMessage, messageID, chat, voter, int64(100), false, messageID, false, "", false, false, 0); err != nil {
		t.Fatal(err)
	}
	for _, ddl := range []string{
		`CREATE TABLE polls (
			message_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			options_json TEXT NOT NULL,
			selectable_count INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
		)`,
		`CREATE TABLE poll_votes (
			poll_message_id TEXT NOT NULL,
			sender_jid TEXT NOT NULL,
			options_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (poll_message_id, sender_jid),
			FOREIGN KEY (poll_message_id) REFERENCES messages(message_id) ON DELETE CASCADE
		)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO polls (message_id, name, options_json, selectable_count) VALUES (?, ?, ?, ?)`,
		messageID, "Lunch?", `["Pizza","Sushi"]`, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO poll_votes (poll_message_id, sender_jid, options_json, updated_at) VALUES (?, ?, ?, ?)`,
		messageID, voter, `["Sushi"]`, int64(123)); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	ms, err := NewMessageStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ms.Close() })

	if err := assertPollSchemaShape(ms.db); err != nil {
		t.Fatalf("DB did not converge on fork schema: %v", err)
	}
	question, options, found, err := ms.GetPollMetadata(chat, messageID)
	if err != nil {
		t.Fatal(err)
	}
	if !found || question != "Lunch?" || !reflect.DeepEqual(options, []string{"Pizza", "Sushi"}) {
		t.Errorf("poll metadata not preserved: found=%v question=%q options=%v", found, question, options)
	}
	votes, err := ms.GetPollVotes(chat, messageID)
	if err != nil {
		t.Fatal(err)
	}
	if want := []int{1}; !reflect.DeepEqual(votes[voter], want) {
		t.Errorf("vote option names not remapped to indices: got %v, want %v", votes[voter], want)
	}
	for _, backup := range []string{pollsBackupTable, votesBackupTable} {
		exists, err := tableExists(ms.db, backup)
		if err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Errorf("backup table %s still exists after upgrade", backup)
		}
	}
}

func TestSaveAndGetPollMetadata(t *testing.T) {
	ms := newTestMessageStore(t)
	if err := ms.SavePollMetadata("g1@s.whatsapp.net", "poll1", "Lunch?", []string{"Pizza", "Sushi"}); err != nil {
		t.Fatal(err)
	}
	question, options, found, err := ms.GetPollMetadata("g1@s.whatsapp.net", "poll1")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("metadata not found after save")
	}
	if question != "Lunch?" || !reflect.DeepEqual(options, []string{"Pizza", "Sushi"}) {
		t.Errorf("unexpected metadata: %q %v", question, options)
	}
}

func TestGetPollMetadataMissing(t *testing.T) {
	ms := newTestMessageStore(t)
	_, _, found, err := ms.GetPollMetadata("g1@s.whatsapp.net", "nope")
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatal("metadata should be missing")
	}
}

func TestPollVotesRoundTrip(t *testing.T) {
	ms := newTestMessageStore(t)
	chat := "g1@s.whatsapp.net"
	if err := ms.SavePollMetadata(chat, "poll1", "Q?", []string{"A", "B", "C"}); err != nil {
		t.Fatal(err)
	}
	if err := ms.UpsertPollVote(chat, "poll1", "alice@s.whatsapp.net", []int{0}); err != nil {
		t.Fatal(err)
	}
	if err := ms.UpsertPollVote(chat, "poll1", "bob@s.whatsapp.net", []int{1, 2}); err != nil {
		t.Fatal(err)
	}
	votes, err := ms.GetPollVotes(chat, "poll1")
	if err != nil {
		t.Fatal(err)
	}
	if len(votes) != 2 {
		t.Fatalf("expected 2 voters, got %d", len(votes))
	}
	if !reflect.DeepEqual(votes["alice@s.whatsapp.net"], []int{0}) {
		t.Errorf("alice votes wrong: %v", votes["alice@s.whatsapp.net"])
	}
	if !reflect.DeepEqual(votes["bob@s.whatsapp.net"], []int{1, 2}) {
		t.Errorf("bob votes wrong: %v", votes["bob@s.whatsapp.net"])
	}

	// Re-vote replaces the previous selection.
	if err := ms.UpsertPollVote(chat, "poll1", "alice@s.whatsapp.net", []int{2}); err != nil {
		t.Fatal(err)
	}
	votes, err = ms.GetPollVotes(chat, "poll1")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(votes["alice@s.whatsapp.net"], []int{2}) {
		t.Errorf("alice re-vote wrong: %v", votes["alice@s.whatsapp.net"])
	}
}

func TestUpdatePollCardText(t *testing.T) {
	ms := newTestMessageStore(t)
	insertTestMessage(t, ms, "poll1", "g1@s.whatsapp.net", 100, "")
	if err := ms.UpdatePollCardText("poll1", "<b>new card</b>"); err != nil {
		t.Fatal(err)
	}
	dm, err := ms.GetDecodedMessage("g1@s.whatsapp.net", "poll1")
	if err != nil {
		t.Fatal(err)
	}
	if dm.Content == nil || dm.Content.Conversation != "<b>new card</b>" {
		t.Errorf("card text not updated: %+v", dm.Content)
	}
	if dm.Edited {
		t.Error("card text update must not set the edited flag")
	}
}

func TestParsePollCardHTML(t *testing.T) {
	html := `<div class="msg-card msg-poll">📊 <b>Lunch?</b><div class="poll-opt">○ Pizza</div><div class="poll-opt">○ Sushi &amp; more</div><div class="msg-card-note">3 votes</div></div>`
	question, options := ParsePollCardHTML(html)
	if question != "Lunch?" {
		t.Errorf("question wrong: %q", question)
	}
	if !reflect.DeepEqual(options, []string{"Pizza", "Sushi & more"}) {
		t.Errorf("options wrong: %v", options)
	}
}

func TestRenderPollCardIncludesCountsAndMine(t *testing.T) {
	out := RenderPollCard("Lunch?", []string{"Pizza", "Sushi"}, []int{3, 1}, []int{0})
	for _, want := range []string{"msg-poll", "○ Pizza", "○ Sushi", "3 votes", "75%", "25%", "poll-mine", "✓ Pizza"} {
		if !strings.Contains(out, want) {
			t.Errorf("card missing %q in %q", want, out)
		}
	}
	if strings.Contains(out, "No votes yet") {
		t.Error("card should show vote total once votes exist")
	}
}

func TestRenderPollCardNoVotesYet(t *testing.T) {
	out := RenderPollCard("Lunch?", []string{"Pizza"}, []int{0}, nil)
	if !strings.Contains(out, "No votes yet") {
		t.Errorf("card should say no votes yet: %q", out)
	}
	if strings.Contains(out, "vote on your phone") {
		t.Error("card must not tell users to vote on their phone")
	}
}
