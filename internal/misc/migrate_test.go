package misc

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestMigrateLegacyConfigNoLegacyDir(t *testing.T) {
	root := t.TempDir()
	newDir := filepath.Join(root, AppName)
	if err := migrateLegacyConfig(newDir); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := os.Stat(newDir); !os.IsNotExist(err) {
		t.Fatalf("migration must not create the destination when no legacy dir exists: %v", err)
	}
}

func TestMigrateLegacyConfigCopiesAndIsIdempotent(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, legacyAppName)
	newDir := filepath.Join(root, AppName)
	if err := os.MkdirAll(filepath.Join(legacy, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "settings.json"), []byte(`{"debug":true}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "sub", "session.wa"), []byte("session"), 0o644); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Symlink("settings.json", filepath.Join(legacy, "link")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
	}

	if err := migrateLegacyConfig(newDir); err != nil {
		t.Fatalf("first migration: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(newDir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"debug":true}` {
		t.Fatalf("settings content = %q", got)
	}
	if got, err = os.ReadFile(filepath.Join(newDir, "sub", "session.wa")); err != nil || string(got) != "session" {
		t.Fatalf("nested session = %q, err=%v", got, err)
	}
	if runtime.GOOS != "windows" {
		target, err := os.Readlink(filepath.Join(newDir, "link"))
		if err != nil || target != "settings.json" {
			t.Fatalf("symlink target = %q, err=%v", target, err)
		}
	}

	// Copied config files must be tightened even when the legacy was permissive.
	if runtime.GOOS != "windows" {
		info, err := os.Stat(filepath.Join(newDir, "settings.json"))
		if err != nil {
			t.Fatal(err)
		}
		if perm := info.Mode().Perm(); perm != secretFilePerm {
			t.Fatalf("copied file mode = %o, want %o", perm, secretFilePerm)
		}
	}

	// A second run must not overwrite existing destination files.
	if err := os.WriteFile(filepath.Join(newDir, "settings.json"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyConfig(newDir); err != nil {
		t.Fatalf("second migration: %v", err)
	}
	got, err = os.ReadFile(filepath.Join(newDir, "settings.json"))
	if err != nil || string(got) != "new" {
		t.Fatalf("existing file was overwritten: %q, err=%v", got, err)
	}

	// Legacy data is never modified or deleted.
	if _, err := os.Stat(legacy); err != nil {
		t.Fatalf("legacy directory was removed: %v", err)
	}
}

func TestMigrateLegacyConfigBothDirsExist(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, legacyAppName)
	newDir := filepath.Join(root, AppName)
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "settings.json"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(newDir, "settings.json"), []byte("current"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyConfig(newDir); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(newDir, "settings.json"))
	if err != nil || string(got) != "current" {
		t.Fatalf("current file changed: %q, err=%v", got, err)
	}
	got, err = os.ReadFile(filepath.Join(legacy, "settings.json"))
	if err != nil || string(got) != "old" {
		t.Fatalf("legacy file changed: %q, err=%v", got, err)
	}
}
