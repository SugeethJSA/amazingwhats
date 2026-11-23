package query_test

import (
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
)

func TestCreateReadReceiptsTable(t *testing.T) {
	t.Parallel()

	t.Run("declares the read_receipts schema", func(t *testing.T) {
		t.Parallel()
		ddl := query.CreateReadReceiptsTable
		mustContain(t, ddl, "CREATE TABLE IF NOT EXISTS read_receipts")
		mustContain(t, ddl, "chat_jid TEXT PRIMARY KEY")
		mustContain(t, ddl, "read_after_timestamp INTEGER NOT NULL")
		mustHavePlaceholders(t, ddl, 0)
	})

	t.Run("indexes the watermark column", func(t *testing.T) {
		t.Parallel()
		mustContain(t, query.CreateReadReceiptsTable, "CREATE INDEX IF NOT EXISTS idx_read_receipts_timestamp ON read_receipts(read_after_timestamp);")
	})
}
