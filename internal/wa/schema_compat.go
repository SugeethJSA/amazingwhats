package wa

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ReconcileUpstreamSessionSchema adapts a session database created by upstream
// go.mau.fi/whatsmeow to HyperMeow's extended migration sequence.
//
// Upstream already adds wasa_root_secret_id to whatsmeow_chat_settings at
// schema v16. HyperMeow's v18->v19 migration adds the very same column, so
// calling Upgrade on an existing upstream DB fails with
// "duplicate column name: wasa_root_secret_id" and the app can never start.
//
// We detect exactly that shape (recorded version below 19 but the column
// already present), apply HyperMeow's v18 change (contacts.username) if it is
// missing, and bump the recorded version to 19. HyperMeow's remaining
// migrations then run normally. Databases with a lower version that genuinely
// lack the column are left untouched so Upgrade can add it.
func ReconcileUpstreamSessionSchema(ctx context.Context, db *sql.DB) error {
	var version int
	err := db.QueryRowContext(ctx, `SELECT version FROM whatsmeow_version LIMIT 1`).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		// No version table yet: this is a fresh DB and Upgrade will create it.
		return nil
	}
	if err != nil {
		// The table may not exist yet on a brand-new database.
		if exists, e := tableExists(ctx, db, "whatsmeow_version"); e != nil || !exists {
			return nil
		}
		return fmt.Errorf("read session schema version: %w", err)
	}
	if version >= 19 {
		return nil
	}

	hasWASA, err := columnExists(ctx, db, "whatsmeow_chat_settings", "wasa_root_secret_id")
	if err != nil {
		return err
	}
	if !hasWASA {
		return nil // normal legacy DB; let HyperMeow add the column at v19
	}

	if hasUsername, err := columnExists(ctx, db, "whatsmeow_contacts", "username"); err != nil {
		return err
	} else if !hasUsername {
		// HyperMeow v18 persists the optional WhatsApp username. Upstream DBs
		// at v16 do not have this column yet.
		if _, err := db.ExecContext(ctx, `ALTER TABLE whatsmeow_contacts ADD COLUMN username TEXT`); err != nil {
			return fmt.Errorf("add contacts.username: %w", err)
		}
	}

	if _, err := db.ExecContext(ctx, `UPDATE whatsmeow_version SET version = 19 WHERE version < 19`); err != nil {
		return fmt.Errorf("bump session schema version to 19: %w", err)
	}
	return nil
}

func tableExists(ctx context.Context, db *sql.DB, table string) (bool, error) {
	var exists int
	err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND tbl_name = ?)`, table).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check table %s: %w", table, err)
	}
	return exists == 1, nil
}

func columnExists(ctx context.Context, db *sql.DB, table, column string) (bool, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, fmt.Errorf("inspect table %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, pk int
		var name, colType string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			return false, fmt.Errorf("scan table %s columns: %w", table, err)
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
