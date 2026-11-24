package query_test

import (
	"strings"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/query"
)

func TestCreateMessageMediaTable(t *testing.T) {
	t.Parallel()

	t.Run("declares all 17 media columns", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateMessageMediaTable
		mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS message_media")
		for _, col := range []string{
			"message_id TEXT PRIMARY KEY", "type INTEGER NOT NULL", "url TEXT",
			"mimetype TEXT", "direct_path TEXT", "media_key BLOB",
			"file_sha256 BLOB", "file_enc_sha256 BLOB", "width INTEGER",
			"height INTEGER", "file_name TEXT", "gif_playback INTEGER DEFAULT 0",
			"thumbnail BLOB", "ptt INTEGER DEFAULT 0", "seconds INTEGER DEFAULT 0",
			"waveform BLOB", "file_length INTEGER DEFAULT 0",
		} {
			mustContain(t, ddl, col)
		}
	})

	t.Run("insert column list matches the DDL column set", func(t *testing.T) {
		t.Parallel()
		_, insertCols := insertTableAndColumns(query.InsertMessageMedia)
		ddlCols := tableColumns(query.CreateMessageMediaTable)
		if len(insertCols) != 17 {
			t.Fatalf("insert has %d columns, want 17: %v", len(insertCols), insertCols)
		}
		if len(ddlCols) != len(insertCols) {
			t.Fatalf("DDL has %d columns but insert has %d", len(ddlCols), len(insertCols))
		}
		for i := range ddlCols {
			if ddlCols[i] != insertCols[i] {
				t.Errorf("column[%d] DDL=%q insert=%q", i, ddlCols[i], insertCols[i])
			}
		}
	})
}

func TestMessageMediaAlterStatements(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sql  string
		col  string
		def  string
	}{
		{"gif playback", query.AddGifPlaybackColumn, "gif_playback", "INTEGER DEFAULT 0"},
		{"thumbnail", query.AddThumbnailColumn, "thumbnail", "BLOB"},
		{"ptt", query.AddPTTColumn, "ptt", "INTEGER DEFAULT 0"},
		{"seconds", query.AddSecondsColumn, "seconds", "INTEGER DEFAULT 0"},
		{"waveform", query.AddWaveformColumn, "waveform", "BLOB"},
		{"file length", query.AddFileLengthColumn, "file_length", "INTEGER DEFAULT 0"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			want := "ALTER TABLE message_media ADD COLUMN " + tt.col + " " + tt.def + ";"
			if strings.TrimSpace(tt.sql) != want {
				t.Errorf("statement = %q, want %q", strings.TrimSpace(tt.sql), want)
			}
			if n := strings.Count(tt.sql, ";"); n != 1 {
				t.Errorf("statement count = %d, want 1 (each ALTER must be standalone)", n)
			}
			if n := strings.Count(strings.ToUpper(tt.sql), "ALTER TABLE"); n != 1 {
				t.Errorf("ALTER TABLE count = %d, want 1", n)
			}
			if n := strings.Count(strings.ToUpper(tt.sql), "ADD COLUMN"); n != 1 {
				t.Errorf("ADD COLUMN count = %d, want 1", n)
			}
		})
	}

	t.Run("PTT metadata columns are three independent statements", func(t *testing.T) {
		t.Parallel()
		altars := []string{query.AddPTTColumn, query.AddSecondsColumn, query.AddWaveformColumn}
		for i := range altars {
			for j := i + 1; j < len(altars); j++ {
				if altars[i] == altars[j] {
					t.Errorf("ALTER statements %d and %d are identical", i, j)
				}
			}
		}
		combined := strings.Join(altars, "")
		for _, col := range []string{"ptt", "seconds", "waveform"} {
			mustContain(t, combined, "ADD COLUMN "+col)
		}
	})

	t.Run("every ALTER is distinct", func(t *testing.T) {
		t.Parallel()
		all := []string{
			query.AddGifPlaybackColumn, query.AddThumbnailColumn, query.AddPTTColumn,
			query.AddSecondsColumn, query.AddWaveformColumn, query.AddFileLengthColumn,
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

func TestInsertMessageMedia(t *testing.T) {
	t.Parallel()

	t.Run("binds 17 values on upsert", func(t *testing.T) {
		t.Parallel()
		sql := query.InsertMessageMedia
		table, cols := insertTableAndColumns(sql)
		if table != "message_media" {
			t.Errorf("insert target = %q, want message_media", table)
		}
		if len(cols) != 17 {
			t.Fatalf("insert column count = %d, want 17", len(cols))
		}
		mustHavePlaceholders(t, sql, 17)
		mustContain(t, sql, "ON CONFLICT(message_id) DO UPDATE SET")
		mustNotContain(t, strings.ToUpper(sql), "REPLACE")
	})

	t.Run("COALESCE protects cached optional fields", func(t *testing.T) {
		t.Parallel()
		sql := query.InsertMessageMedia
		assignments := upsertAssignments(sql)
		if len(assignments) != 16 {
			t.Fatalf("upsert assignment count = %d, want 16: %v", len(assignments), assignments)
		}

		got := make(map[string]string, len(assignments))
		for _, a := range assignments {
			col, _, _ := strings.Cut(a, " = ")
			got[col] = a
		}
		for _, col := range []string{
			"gif_playback", "thumbnail", "ptt", "seconds", "waveform", "file_length",
		} {
			want := col + " = COALESCE(excluded." + col + ", message_media." + col + ")"
			if got[col] != want {
				t.Errorf("assignment for %q = %q, want %q", col, got[col], want)
			}
		}
		for _, col := range []string{
			"type", "url", "mimetype", "direct_path", "media_key",
			"file_sha256", "file_enc_sha256", "width", "height", "file_name",
		} {
			want := col + " = excluded." + col
			if got[col] != want {
				t.Errorf("assignment for %q = %q, want %q", col, got[col], want)
			}
		}
	})
}

func TestMessageMediaSelects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sql  string
		want []string
	}{
		{"gif playback", query.SelectGifPlaybackByMessageID, []string{"gif_playback"}},
		{"dimensions", query.SelectDimensionsByMessageID, []string{"width, height"}},
		{"thumbnail", query.SelectThumbnailByMessageID, []string{"thumbnail"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustHavePlaceholders(t, tt.sql, 1)
			mustContain(t, tt.sql, "FROM message_media")
			for _, want := range tt.want {
				mustContain(t, tt.sql, want)
			}
		})
	}
}

func TestUpdateMessageMediaByMessageID(t *testing.T) {
	t.Parallel()

	t.Run("binds exactly 11 arguments", func(t *testing.T) {
		t.Parallel()
		sql := query.UpdateMessageMediaByMessageID
		mustHavePlaceholders(t, sql, 11)
		if n := strings.Count(sql, " = ?"); n != 11 {
			t.Errorf("assignment/WHERE placeholder count = %d, want 11", n)
		}
		mustContain(t, sql, "UPDATE message_media")
		mustContain(t, sql, "WHERE message_id = ?;")
	})

	t.Run("does not overwrite PTT metadata on edit", func(t *testing.T) {
		t.Parallel()
		sql := query.UpdateMessageMediaByMessageID
		wantSet := "type = ?, url = ?, mimetype = ?, direct_path = ?, media_key = ?, file_sha256 = ?, file_enc_sha256 = ?, width = ?, height = ?, file_name = ?"
		mustContain(t, sql, wantSet)
		for _, col := range []string{"ptt", "seconds", "waveform", "thumbnail", "gif_playback", "file_length"} {
			mustNotContain(t, sql, col+" = ?")
		}
	})
}

func TestMessageMediaRowSelects(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sql  string
		want []string
	}{
		{
			"full media row",
			query.SelectMessageMediaByMessageID,
			[]string{
				"type, url, mimetype, direct_path, media_key, file_sha256, file_enc_sha256, width, height, file_name, COALESCE(file_length, 0)",
				"FROM message_media",
				"WHERE message_id = ?;",
			},
		},
		{"media meta", query.SelectMediaMetaByMessageID, []string{"direct_path, file_enc_sha256"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mustHavePlaceholders(t, tt.sql, 1)
			mustContain(t, tt.sql, "FROM message_media")
			for _, want := range tt.want {
				mustContain(t, tt.sql, want)
			}
		})
	}
}

func TestUpdateThumbnailByMessageID(t *testing.T) {
	t.Parallel()
	sql := query.UpdateThumbnailByMessageID
	mustHavePlaceholders(t, sql, 2)
	mustContain(t, sql, "UPDATE message_media SET thumbnail = ? WHERE message_id = ?;")
}
