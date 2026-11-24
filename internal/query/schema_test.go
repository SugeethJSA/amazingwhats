package query_test

import (
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
)

// This file holds the cross-file schema regression guards plus the small
// string helpers shared by the per-source-file test files. All query
// constants are exported, so every test lives in the black-box query_test
// package and exercises the public SQL contract.

// ---------------------------------------------------------------------------
// Shared helpers (used by the other *_test.go files in this package)
// ---------------------------------------------------------------------------

// countPlaceholders counts SQL bind markers. None of the query constants
// embed a '?' inside a comment or string literal, so a raw rune count is an
// exact measure of the driver's required argument count.
func countPlaceholders(sql string) int {
	return strings.Count(sql, "?")
}

func mustContain(t *testing.T, got, want string) {
	t.Helper()
	if !strings.Contains(got, want) {
		t.Errorf("query does not contain %q\nquery: %s", want, got)
	}
}

func mustNotContain(t *testing.T, got, unwanted string) {
	t.Helper()
	if strings.Contains(got, unwanted) {
		t.Errorf("query unexpectedly contains %q\nquery: %s", unwanted, got)
	}
}

func mustHavePlaceholders(t *testing.T, sql string, want int) {
	t.Helper()
	if got := countPlaceholders(sql); got != want {
		t.Errorf("placeholder count = %d, want %d\nquery: %s", got, want, sql)
	}
}

var (
	createTableRE = regexp.MustCompile(`(?i)CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)`)
	createIndexRE = regexp.MustCompile(`(?i)CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)`)
	// Stops at the first statement terminator so trailing CREATE INDEX
	// statements are not mistaken for table columns.
	createTableBodyRE = regexp.MustCompile(`(?is)CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[A-Za-z_][A-Za-z0-9_]*\s*\((.*?)\);`)
	insertColumnsRE   = regexp.MustCompile(`(?is)INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)`)
	doUpdateSetRE     = regexp.MustCompile(`(?is)DO\s+UPDATE\s+SET\s+(.*?)(?:;|$)`)
)

func tableNamesIn(ddl string) []string {
	m := createTableRE.FindAllStringSubmatch(ddl, -1)
	names := make([]string, 0, len(m))
	for _, sub := range m {
		names = append(names, sub[1])
	}
	return names
}

func indexNamesIn(ddl string) []string {
	m := createIndexRE.FindAllStringSubmatch(ddl, -1)
	names := make([]string, 0, len(m))
	for _, sub := range m {
		names = append(names, sub[1])
	}
	return names
}

// tableColumns returns the column names of the first CREATE TABLE statement
// in declaration order. Table-level constraints (PRIMARY/FOREIGN/CHECK/etc.)
// are skipped because they are not columns.
func tableColumns(ddl string) []string {
	m := createTableBodyRE.FindStringSubmatch(ddl)
	if m == nil {
		return nil
	}
	var cols []string
	for _, line := range strings.Split(m[1], "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		upper := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(upper, "PRIMARY"),
			strings.HasPrefix(upper, "FOREIGN"),
			strings.HasPrefix(upper, "UNIQUE"),
			strings.HasPrefix(upper, "CHECK"),
			strings.HasPrefix(upper, "CONSTRAINT"):
			continue
		}
		fields := strings.Fields(line)
		cols = append(cols, fields[0])
	}
	return cols
}

// insertTableAndColumns parses "INSERT [OR REPLACE] INTO <table> (a, b, ...)"
// and returns the table name plus the ordered column list.
func insertTableAndColumns(sql string) (string, []string) {
	m := insertColumnsRE.FindStringSubmatch(sql)
	if m == nil {
		return "", nil
	}
	cols := strings.Split(m[2], ",")
	for i := range cols {
		cols[i] = strings.TrimSpace(cols[i])
	}
	return m[1], cols
}

// upsertAssignments returns the individual "col = value" assignments of an
// ON CONFLICT ... DO UPDATE SET clause. Commas nested inside function calls
// (e.g. COALESCE(a, b)) are not separators, so splitting honours parenthesis
// depth.
func upsertAssignments(sql string) []string {
	m := doUpdateSetRE.FindStringSubmatch(sql)
	if m == nil {
		return nil
	}
	clause := m[1]
	var parts []string
	depth, start := 0, 0
	for i, r := range clause {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, strings.TrimSpace(clause[start:i]))
				start = i + 1
			}
		}
	}
	return append(parts, strings.TrimSpace(clause[start:]))
}

// ---------------------------------------------------------------------------
// Cross-file schema registry
// ---------------------------------------------------------------------------

// allCreateTableConstants is the canonical registry of every DDL constant in
// the package. When a new CREATE TABLE constant is added to the package it
// must also be registered here for the cross-file schema guards to cover it.
var allCreateTableConstants = []struct {
	name string
	ddl  string
}{
	{"CreateMessagesTable", query.CreateMessagesTable},
	{"CreateMessageMediaTable", query.CreateMessageMediaTable},
	{"CreatePollsTable", query.CreatePollsTable},
	{"CreatePollVotesTable", query.CreatePollVotesTable},
	{"CreateArchivedChatsTable", query.CreateArchivedChatsTable},
	{"CreateMutedChatsTable", query.CreateMutedChatsTable},
	{"CreatePinnedChatsTable", query.CreatePinnedChatsTable},
	{"CreatePinnedMessagesTable", query.CreatePinnedMessagesTable},
	{"CreateReactionsTable", query.CreateReactionsTable},
	{"CreateReadReceiptsTable", query.CreateReadReceiptsTable},
	{"CreateLinkPreviewsTable", query.CreateLinkPreviewsTable},
	{"CreateGroupsTable", query.CreateGroupsTable},
	{"CreateImageIndexTable", query.CreateImageIndexTable},
}

// expectedTableOwner maps table name -> the single constant allowed to create
// it. This is the regression guard for the earlier poll collision: if two
// constants ever emit CREATE TABLE for the same name, the uniqueness test
// below fails immediately.
var expectedTableOwner = map[string]string{
	"messages":           "CreateMessagesTable",
	"message_media":      "CreateMessageMediaTable",
	"polls":              "CreatePollsTable",
	"poll_votes":         "CreatePollVotesTable",
	"archived_chats":     "CreateArchivedChatsTable",
	"muted_chats":        "CreateMutedChatsTable",
	"pinned_chats":       "CreatePinnedChatsTable",
	"pinned_messages":    "CreatePinnedMessagesTable",
	"reactions":          "CreateReactionsTable",
	"read_receipts":      "CreateReadReceiptsTable",
	"link_previews":      "CreateLinkPreviewsTable",
	"amazingwhats_groups": "CreateGroupsTable",
	"image_index":        "CreateImageIndexTable",
}

// expectedTableColumns pins the shape of every table. It makes a
// renamed/reused table name with different columns fail the schema test
// rather than silently changing on-disk compatibility.
var expectedTableColumns = map[string][]string{
	"messages":           {"message_id", "chat_jid", "sender_jid", "timestamp", "is_from_me", "text", "has_media", "reply_to_message_id", "edited", "forwarded", "type"},
	"message_media":      {"message_id", "type", "url", "mimetype", "direct_path", "media_key", "file_sha256", "file_enc_sha256", "width", "height", "file_name", "gif_playback", "thumbnail", "ptt", "seconds", "waveform", "file_length"},
	"polls":              {"chat_jid", "message_id", "question", "options_json"},
	"poll_votes":         {"chat_jid", "poll_message_id", "voter_jid", "option_indices_json"},
	"archived_chats":     {"chat_jid", "archived_at"},
	"muted_chats":        {"chat_jid", "muted_until"},
	"pinned_chats":       {"chat_jid", "pinned_at"},
	"pinned_messages":    {"message_id", "chat_jid", "sender_jid", "pinned_at", "expiry"},
	"reactions":          {"id", "message_id", "sender_id", "emoji"},
	"read_receipts":      {"chat_jid", "read_after_timestamp"},
	"link_previews":      {"message_id", "url", "title", "description", "thumbnail", "direct_path", "media_key", "file_sha256", "file_enc_sha256"},
	"amazingwhats_groups": {"jid", "name", "topic", "owner_jid", "participant_count", "parent_jid", "parent_name", "is_parent", "is_default_sub"},
	"image_index":        {"message_id", "sha256", "mime", "width", "height", "created_at"},
}

var expectedIndexNames = []string{
	"idx_messages_chat_jid",
	"idx_messages_sender_jid",
	"idx_messages_timestamp",
	"idx_messages_chat_cursor",
	"idx_poll_votes_poll",
	"idx_pinned_messages_chat_jid",
	"idx_pinned_messages_sender_jid",
	"idx_pinned_messages_pinned_at",
	"idx_reactions_message_id",
	"idx_reactions_sender_id",
	"idx_read_receipts_timestamp",
	"idx_sha",
}

func TestCreateTableConstantsUseIfNotExists(t *testing.T) {
	t.Parallel()

	for _, tc := range allCreateTableConstants {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			mustContain(t, strings.ToUpper(tc.ddl), "CREATE TABLE IF NOT EXISTS")
			if names := tableNamesIn(tc.ddl); len(names) != 1 {
				t.Errorf("expected exactly one CREATE TABLE in %s, got %v", tc.name, names)
			}
		})
	}
}

func TestCreateTableNamesAreUnique(t *testing.T) {
	t.Parallel()

	owners := make(map[string]string)
	for _, tc := range allCreateTableConstants {
		for _, name := range tableNamesIn(tc.ddl) {
			if prev, exists := owners[name]; exists {
				t.Errorf("table %q is created by both %s and %s", name, prev, tc.name)
			}
			owners[name] = tc.name
		}
	}

	for name, wantOwner := range expectedTableOwner {
		gotOwner, exists := owners[name]
		if !exists {
			t.Errorf("expected table %q (from %s) was not created by any registered constant", name, wantOwner)
			continue
		}
		if gotOwner != wantOwner {
			t.Errorf("table %q owner = %s, want %s", name, gotOwner, wantOwner)
		}
	}
	if len(owners) != len(expectedTableOwner) {
		t.Errorf("created %d distinct tables, want %d: %v", len(owners), len(expectedTableOwner), owners)
	}
}

func TestTableShapesMatchExpectedColumns(t *testing.T) {
	t.Parallel()

	for _, tc := range allCreateTableConstants {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			names := tableNamesIn(tc.ddl)
			if len(names) != 1 {
				t.Fatalf("expected one table in %s, got %v", tc.name, names)
			}
			want, ok := expectedTableColumns[names[0]]
			if !ok {
				t.Fatalf("no expected column shape registered for table %q", names[0])
			}
			got := tableColumns(tc.ddl)
			if !slices.Equal(got, want) {
				t.Errorf("columns for %s = %v, want %v", names[0], got, want)
			}
		})
	}
}

func TestIndexNamesAreUnique(t *testing.T) {
	t.Parallel()

	seen := make(map[string]string)
	for _, tc := range allCreateTableConstants {
		for _, idx := range indexNamesIn(tc.ddl) {
			if prev, exists := seen[idx]; exists {
				t.Errorf("index %q is declared by both %s and %s", idx, prev, tc.name)
			}
			seen[idx] = tc.name
		}
	}

	for _, want := range expectedIndexNames {
		if _, exists := seen[want]; !exists {
			t.Errorf("expected index %q was not declared by any DDL constant", want)
		}
	}
	if len(seen) != len(expectedIndexNames) {
		t.Errorf("declared %d distinct indexes, want %d: %v", len(seen), len(expectedIndexNames), seen)
	}
}
