package misc

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
)

const AppName = "whats4linux"
const AppID = "net.lugvitc.whats4linux"

// Config files and the session database hold long-lived credentials, so the
// config directory is owner-only and secret files are owner-read/write only.
const configDirPerm = 0700
const secretFilePerm = 0600

var ConfigDir = defaultConfigDir()

func GetSQLiteAddress(dbName string) string {
	path := filepath.Join(ConfigDir, dbName)
	// Enforce the safety/performance pragmas through the DSN so the SQLite
	// driver applies them to EVERY pooled connection as it is opened. Executing
	// `PRAGMA ...` on *sql.DB only affects whichever connection happens to be
	// checked out at that moment, leaving later connections with foreign keys
	// disabled and busy_timeout/synchronous at their defaults. This is critical
	// because reads and some writes use connections directly rather than the
	// store's serialized writer. (journal_mode is database-level and is still
	// set once in openDB.)
	return fmt.Sprintf("file:%s?_foreign_keys=on&_busy_timeout=5000&_synchronous=NORMAL", path)
}

// RestrictFile best-effort tightens a file to owner-only permissions. It is
// safe to call on every start: existing files are migrated and platforms that
// do not implement POSIX mode bits (e.g. Windows) simply ignore the mode, so
// a failure here must never break startup.
func RestrictFile(path string) {
	if err := os.Chmod(path, secretFilePerm); err != nil && !os.IsNotExist(err) {
		log.Printf("misc: could not restrict permissions for %s: %v", filepath.Base(path), err)
	}
}

func defaultConfigDir() string {
	cdr, err := os.UserConfigDir()
	if err != nil {
		panic(err)
	}
	cdr = filepath.Join(cdr, AppName)
	if !dirExists(cdr) {
		err = os.MkdirAll(cdr, configDirPerm)
		if err != nil {
			panic(err)
		}
	}
	// Migrate directories created by older versions with permissive modes.
	// Chmod is best-effort: no failure if the platform/filesystem does not
	// support it (notably Windows).
	if err := os.Chmod(cdr, configDirPerm); err != nil {
		log.Printf("misc: could not restrict config directory permissions: %v", err)
	}
	return cdr
}

func dirExists(name string) bool {
	_, err := os.ReadDir(name)
	return !os.IsNotExist(err)
}
