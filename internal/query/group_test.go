package query_test

import (
	"strings"
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
)

func TestCreateGroupsTable(t *testing.T) {
	t.Parallel()
	ddl := query.CreateGroupsTable
	mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS whats4linux_groups")
	for _, col := range []string{
		"jid TEXT PRIMARY KEY", "name TEXT", "topic TEXT", "owner_jid TEXT",
		"participant_count INTEGER", "parent_jid TEXT DEFAULT ''",
		"parent_name TEXT DEFAULT ''", "is_parent INTEGER DEFAULT 0",
		"is_default_sub INTEGER DEFAULT 0",
	} {
		mustContain(t, ddl, col)
	}
	mustHavePlaceholders(t, ddl, 0)
}

func TestGroupAlterStatements(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sql  string
		want string
	}{
		{"parent jid", query.AlterGroupsAddParentJID, "ALTER TABLE whats4linux_groups ADD COLUMN parent_jid TEXT DEFAULT '';"},
		{"parent name", query.AlterGroupsAddParentName, "ALTER TABLE whats4linux_groups ADD COLUMN parent_name TEXT DEFAULT '';"},
		{"is parent", query.AlterGroupsAddIsParent, "ALTER TABLE whats4linux_groups ADD COLUMN is_parent INTEGER DEFAULT 0;"},
		{"is default sub", query.AlterGroupsAddIsDefaultSub, "ALTER TABLE whats4linux_groups ADD COLUMN is_default_sub INTEGER DEFAULT 0;"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if strings.TrimSpace(tt.sql) != tt.want {
				t.Errorf("statement = %q, want %q", tt.sql, tt.want)
			}
			if n := strings.Count(tt.sql, ";"); n != 1 {
				t.Errorf("statement count = %d, want 1", n)
			}
			if n := strings.Count(strings.ToUpper(tt.sql), "ADD COLUMN"); n != 1 {
				t.Errorf("ADD COLUMN count = %d, want 1", n)
			}
		})
	}
}

func TestInsertOrReplaceGroup(t *testing.T) {
	t.Parallel()
	sql := query.InsertOrReplaceGroup
	mustHavePlaceholders(t, sql, 9)
	table, cols := insertTableAndColumns(sql)
	if table != "whats4linux_groups" {
		t.Errorf("insert target = %q, want whats4linux_groups", table)
	}
	want := []string{
		"jid", "name", "topic", "owner_jid", "participant_count",
		"parent_jid", "parent_name", "is_parent", "is_default_sub",
	}
	if len(cols) != len(want) {
		t.Fatalf("insert column count = %d, want %d: %v", len(cols), len(want), cols)
	}
	for i := range want {
		if cols[i] != want[i] {
			t.Errorf("insert column[%d] = %q, want %q", i, cols[i], want[i])
		}
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO whats4linux_groups")
}

func TestGroupReadQueries(t *testing.T) {
	t.Parallel()

	commonColumns := []string{
		"COALESCE(parent_jid, '')", "COALESCE(parent_name, '')",
		"COALESCE(is_parent, 0)", "COALESCE(is_default_sub, 0)",
	}

	tests := []struct {
		name         string
		sql          string
		want         []string
		count        int
		checkColumns bool
	}{
		{"all groups", query.SelectAllGroups, []string{"FROM whats4linux_groups;"}, 0, true},
		{"by jid", query.SelectGroupByJID, []string{"FROM whats4linux_groups", "WHERE jid = ?;"}, 1, true},
		{"communities", query.SelectCommunities, []string{"WHERE is_parent = 1", "ORDER BY name COLLATE NOCASE;"}, 0, true},
		{"count by parent", query.CountGroupsByParent, []string{"SELECT COUNT(*) FROM whats4linux_groups WHERE parent_jid = ?;"}, 1, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustHavePlaceholders(t, tt.sql, tt.count)
			for _, want := range tt.want {
				mustContain(t, tt.sql, want)
			}
			if tt.checkColumns {
				for _, col := range commonColumns {
					mustContain(t, tt.sql, col)
				}
			}
		})
	}
}
