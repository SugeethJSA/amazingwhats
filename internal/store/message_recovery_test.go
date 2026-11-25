package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/misc"
)

func TestIsCorruptMessageSchema(t *testing.T) {
	if isCorruptMessageSchema(nil) {
		t.Fatal("nil error must not be treated as corruption")
	}
	if isCorruptMessageSchema(errors.New("database is locked")) {
		t.Fatal("lock error must not trigger a cache rebuild")
	}
	for _, msg := range []string{
		"malformed database schema (message_receipts) - invalid rootpage",
		"database disk image is malformed",
		"file is not a database",
	} {
		if !isCorruptMessageSchema(errors.New(msg)) {
			t.Errorf("expected corruption for %q", msg)
		}
	}
}

func TestQuarantineMessageDB(t *testing.T) {
	old := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = old })

	for _, suffix := range []string{"", "-wal", "-shm"} {
		name := filepath.Join(misc.ConfigDir, "messages.db"+suffix)
		if err := os.WriteFile(name, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := quarantineMessageDB(); err != nil {
		t.Fatalf("quarantine: %v", err)
	}
	files, err := os.ReadDir(misc.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 {
		t.Fatalf("want 3 quarantined files, got %d", len(files))
	}
	for _, f := range files {
		if f.Name() == "messages.db" || f.Name() == "messages.db-wal" || f.Name() == "messages.db-shm" {
			t.Fatalf("original %s still present", f.Name())
		}
		if !strings.Contains(f.Name(), ".corrupt-") {
			t.Fatalf("quarantined name %s lacks marker", f.Name())
		}
		got, err := os.ReadFile(filepath.Join(misc.ConfigDir, f.Name()))
		if err != nil || string(got) != "x" {
			t.Fatalf("quarantined %s content = %q, err=%v", f.Name(), got, err)
		}
	}
}

func TestQuarantineMessageDBSkipsMissingSidecars(t *testing.T) {
	old := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = old })

	if err := os.WriteFile(filepath.Join(misc.ConfigDir, "messages.db"), []byte("only-main"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := quarantineMessageDB(); err != nil {
		t.Fatalf("quarantine: %v", err)
	}
	files, err := os.ReadDir(misc.ConfigDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || !strings.HasPrefix(files[0].Name(), "messages.db.corrupt-") {
		t.Fatalf("unexpected quarantine result: %v", files)
	}
}
