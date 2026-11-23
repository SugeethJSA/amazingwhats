package query_test

import (
	"strings"
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
)

func TestCreateLinkPreviewsTable(t *testing.T) {
	t.Parallel()
	ddl := query.CreateLinkPreviewsTable
	mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS link_previews")
	for _, col := range []string{
		"message_id TEXT PRIMARY KEY", "url TEXT", "title TEXT",
		"description TEXT", "thumbnail BLOB", "direct_path TEXT",
		"media_key BLOB", "file_sha256 BLOB", "file_enc_sha256 BLOB",
	} {
		mustContain(t, ddl, col)
	}
	mustHavePlaceholders(t, ddl, 0)
}

func TestLinkPreviewAlterStatements(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sql  string
		col  string
		typ  string
	}{
		{"direct path", query.AddLinkPreviewDirectPath, "direct_path", "TEXT"},
		{"media key", query.AddLinkPreviewMediaKey, "media_key", "BLOB"},
		{"file sha256", query.AddLinkPreviewFileSHA, "file_sha256", "BLOB"},
		{"file enc sha256", query.AddLinkPreviewFileEncSHA, "file_enc_sha256", "BLOB"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			want := "ALTER TABLE link_previews ADD COLUMN " + tt.col + " " + tt.typ + ";"
			if strings.TrimSpace(tt.sql) != want {
				t.Errorf("statement = %q, want %q", tt.sql, want)
			}
			if n := strings.Count(tt.sql, ";"); n != 1 {
				t.Errorf("statement count = %d, want 1", n)
			}
		})
	}

	t.Run("columns are all distinct", func(t *testing.T) {
		t.Parallel()
		all := []string{
			query.AddLinkPreviewDirectPath, query.AddLinkPreviewMediaKey,
			query.AddLinkPreviewFileSHA, query.AddLinkPreviewFileEncSHA,
		}
		for i := range all {
			for j := i + 1; j < len(all); j++ {
				if all[i] == all[j] {
					t.Errorf("ALTER statements %d and %d are identical", i, j)
				}
			}
		}
	})
}

func TestInsertLinkPreview(t *testing.T) {
	t.Parallel()
	sql := query.InsertLinkPreview
	mustHavePlaceholders(t, sql, 9)
	table, cols := insertTableAndColumns(sql)
	if table != "link_previews" {
		t.Errorf("insert target = %q, want link_previews", table)
	}
	want := []string{
		"message_id", "url", "title", "description", "thumbnail",
		"direct_path", "media_key", "file_sha256", "file_enc_sha256",
	}
	if len(cols) != len(want) {
		t.Fatalf("insert column count = %d, want %d: %v", len(cols), len(want), cols)
	}
	for i := range want {
		if cols[i] != want[i] {
			t.Errorf("insert column[%d] = %q, want %q", i, cols[i], want[i])
		}
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO link_previews")
}

func TestLinkPreviewSelects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sql  string
		want string
	}{
		{"display fields", query.SelectLinkPreviewByMessageID, "SELECT url, title, description, thumbnail FROM link_previews WHERE message_id = ?;"},
		{"poster download info", query.SelectLinkPreviewMediaByMessageID, "SELECT thumbnail, direct_path, media_key, file_sha256, file_enc_sha256"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustHavePlaceholders(t, tt.sql, 1)
			mustContain(t, tt.sql, tt.want)
			mustContain(t, tt.sql, "FROM link_previews")
		})
	}
}

func TestUpdateLinkPreviewThumbnail(t *testing.T) {
	t.Parallel()
	sql := query.UpdateLinkPreviewThumbnail
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "UPDATE link_previews SET thumbnail = ? WHERE message_id = ?;")
}
