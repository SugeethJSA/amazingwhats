package wa_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/wa"
	_ "github.com/mattn/go-sqlite3"
)

func newSessionDB(t *testing.T, version int, wasa, username bool) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "session.wa"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	stmts := []string{
		`CREATE TABLE whatsmeow_version (version INTEGER, compat INTEGER)`,
		`CREATE TABLE whatsmeow_chat_settings (our_jid TEXT, chat_jid TEXT)`,
		`CREATE TABLE whatsmeow_contacts (our_jid TEXT, their_jid TEXT)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}
	if wasa {
		if _, err := db.Exec(`ALTER TABLE whatsmeow_chat_settings ADD COLUMN wasa_root_secret_id TEXT NOT NULL DEFAULT ''`); err != nil {
			t.Fatalf("add wasa column: %v", err)
		}
	}
	if username {
		if _, err := db.Exec(`ALTER TABLE whatsmeow_contacts ADD COLUMN username TEXT`); err != nil {
			t.Fatalf("add username column: %v", err)
		}
	}
	if version > 0 {
		if _, err := db.Exec(`INSERT INTO whatsmeow_version (version, compat) VALUES (?, 8)`, version); err != nil {
			t.Fatalf("insert version: %v", err)
		}
	}
	return db
}

func hasColumn(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		t.Fatalf("pragma: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var name, typ string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if name == column {
			return true
		}
	}
	return false
}

func TestReconcileUpstreamSessionSchema(t *testing.T) {
	tests := []struct {
		name         string
		version      int
		wasa         bool
		username     bool
		wantVersion  int
		wantUsername bool
		wantWasa     bool
	}{
		{"fresh DB without version table is untouched", 0, false, false, 0, false, false},
		{"upstream v16 DB is repaired", 16, true, false, 19, true, true},
		{"v18 DB with username only needs version bump", 18, true, true, 19, true, true},
		{"already reconciled DB is a no-op", 19, true, true, 19, true, true},
		{"legacy DB without wasa column is untouched", 16, false, false, 16, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newSessionDB(t, tt.version, tt.wasa, tt.username)
			if err := wa.ReconcileUpstreamSessionSchema(context.Background(), db); err != nil {
				t.Fatalf("reconcile: %v", err)
			}
			var gotVersion int
			err := db.QueryRow(`SELECT version FROM whatsmeow_version LIMIT 1`).Scan(&gotVersion)
			if tt.wantVersion == 0 {
				if err == nil {
					t.Errorf("expected no version row, got %d", gotVersion)
				}
			} else {
				if err != nil {
					t.Fatalf("read version: %v", err)
				}
				if gotVersion != tt.wantVersion {
					t.Errorf("version = %d, want %d", gotVersion, tt.wantVersion)
				}
			}
			if got := hasColumn(t, db, "whatsmeow_contacts", "username"); got != tt.wantUsername {
				t.Errorf("username column = %v, want %v", got, tt.wantUsername)
			}
			if got := hasColumn(t, db, "whatsmeow_chat_settings", "wasa_root_secret_id"); got != tt.wantWasa {
				t.Errorf("wasa column = %v, want %v", got, tt.wantWasa)
			}
		})
	}
}
