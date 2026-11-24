package query_test

import (
	"strings"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/query"
)

func TestCreateImageIndexTable(t *testing.T) {
	t.Parallel()

	t.Run("declares the image_index schema", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateImageIndexTable
		mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS image_index")
		for _, col := range []string{
			"message_id TEXT PRIMARY KEY", "sha256", "mime",
			"width", "height", "created_at",
		} {
			mustContain(t, ddl, col)
		}
		mustHavePlaceholders(t, ddl, 0)
	})

	t.Run("indexes sha256 for dedupe lookups", func(t *testing.T) {
		t.Parallel()
		mustContain(t, query.CreateImageIndexTable, "CREATE INDEX IF NOT EXISTS idx_sha ON image_index (sha256);")
	})
}

func TestSaveImageIndex(t *testing.T) {
	t.Parallel()
	sql := query.SaveImageIndex
	mustHavePlaceholders(t, sql, 6)
	table, cols := insertTableAndColumns(sql)
	if table != "image_index" {
		t.Errorf("insert target = %q, want image_index", table)
	}
	want := []string{"message_id", "sha256", "mime", "width", "height", "created_at"}
	if len(cols) != len(want) {
		t.Fatalf("insert column count = %d, want %d: %v", len(cols), len(want), cols)
	}
	for i := range want {
		if cols[i] != want[i] {
			t.Errorf("insert column[%d] = %q, want %q", i, cols[i], want[i])
		}
	}
	mustContain(t, sql, "INSERT OR REPLACE INTO image_index")
}

func TestDeleteImageIndex(t *testing.T) {
	t.Parallel()
	sql := query.DeleteImageIndex
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "DELETE FROM image_index")
	mustContain(t, sql, "WHERE message_id = ?")
}

func TestGetImageByID(t *testing.T) {
	t.Parallel()
	sql := query.GetImageByID
	mustHavePlaceholders(t, sql, 1)
	mustContain(t, sql, "SELECT message_id, sha256, mime, width, height, created_at")
	mustContain(t, sql, "FROM image_index")
	mustContain(t, sql, "WHERE message_id = ?")
}

func TestGetImagesByIDsPrefix(t *testing.T) {
	t.Parallel()
	sql := query.GetImagesByIDsPrefix
	mustHavePlaceholders(t, sql, 0)
	mustContain(t, sql, "SELECT message_id, sha256, mime, width, height, created_at")
	mustContain(t, sql, "FROM image_index")
	mustContain(t, sql, "WHERE message_id IN (")
	if !strings.HasSuffix(strings.TrimSpace(sql), "IN (") {
		t.Errorf("prefix must end with an open IN ( for caller completion, got %q", sql)
	}
}
