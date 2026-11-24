package misc

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestConstants(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		got  any
		want any
	}{
		{"AppName", AppName, "amazingwhats"},
		{"AppID", AppID, "net.lugvitc.amazingwhats"},
		{"configDirPerm", configDirPerm, 0700},
		{"secretFilePerm", secretFilePerm, 0600},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if tt.got != tt.want {
				t.Errorf("got %v, want %v", tt.got, tt.want)
			}
		})
	}
}

func TestGetSQLiteAddress(t *testing.T) {
	// GetSQLiteAddress reads the package-level ConfigDir, so this test must not
	// run in parallel with other code that mutates it.
	original := ConfigDir
	dir := t.TempDir()
	ConfigDir = dir
	t.Cleanup(func() { ConfigDir = original })

	tests := []struct {
		name   string
		dbName string
	}{
		{"simple database name", "session.db"},
		{"nested database name", filepath.Join("sub", "session.db")},
		{"name with spaces", "my session.db"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			want := "file:" + filepath.Join(dir, tt.dbName) +
				"?_foreign_keys=on&_busy_timeout=5000&_synchronous=NORMAL"
			if got := GetSQLiteAddress(tt.dbName); got != want {
				t.Errorf("GetSQLiteAddress(%q) = %q, want %q", tt.dbName, got, want)
			}
		})
	}
}

func TestRestrictFile(t *testing.T) {
	t.Run("existing file mode is tightened", func(t *testing.T) {
		t.Parallel()
		path := filepath.Join(t.TempDir(), "secret")
		if err := os.WriteFile(path, []byte("secret"), 0o644); err != nil {
			t.Fatal(err)
		}

		RestrictFile(path) // must not panic

		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if runtime.GOOS == "windows" {
			// Windows does not implement POSIX mode bits; Chmod is best-effort,
			// so only assert that the call did not break the file.
			return
		}
		if got := info.Mode().Perm(); got != secretFilePerm {
			t.Errorf("mode = %04o, want %04o", got, secretFilePerm)
		}
	})

	t.Run("missing path is a no-op", func(t *testing.T) {
		t.Parallel()
		missing := filepath.Join(t.TempDir(), "does-not-exist")

		RestrictFile(missing) // must not panic and must not create the file

		if _, err := os.Stat(missing); !os.IsNotExist(err) {
			t.Errorf("RestrictFile created a file at %q: %v", missing, err)
		}
	})
}

func TestDirExists(t *testing.T) {
	base := t.TempDir()
	existing := filepath.Join(base, "dir")
	if err := os.Mkdir(existing, 0o755); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		path string
		want bool
	}{
		{"existing directory", existing, true},
		{"missing path", filepath.Join(base, "missing"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := dirExists(tt.path); got != tt.want {
				t.Errorf("dirExists(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}
