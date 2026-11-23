package settings

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/lugvitc/whats4linux/internal/misc"
)

// useTempConfigDir points misc.ConfigDir at a fresh temporary directory and
// restores the original value when the test finishes. Callers must not run in
// parallel because ConfigDir is process-wide mutable state.
func useTempConfigDir(t *testing.T) string {
	t.Helper()
	original := misc.ConfigDir
	dir := t.TempDir()
	misc.ConfigDir = dir
	t.Cleanup(func() { misc.ConfigDir = original })
	return dir
}

func TestSettings_GetDebug(t *testing.T) {
	tests := []struct {
		name  string
		debug bool
		want  bool
	}{
		{"debug enabled", true, true},
		{"debug disabled", false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c := _settings{Debug: tt.debug}
			if got := c.GetDebug(); got != tt.want {
				t.Errorf("GetDebug() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetLogLevel(t *testing.T) {
	// GetLogLevel reads the package-level settings value.
	original := s
	t.Cleanup(func() { s = original })

	tests := []struct {
		name string
		cfg  _settings
		want string
	}{
		{"debug flag forces DEBUG", _settings{Debug: true}, "DEBUG"},
		{"debug overrides explicit level", _settings{Debug: true, LogLevel: "WARN"}, "DEBUG"},
		{"empty level defaults to INFO", _settings{}, "INFO"},
		{"explicit level passes through", _settings{LogLevel: "WARN"}, "WARN"},
		{"lowercase level passes through unchanged", _settings{LogLevel: "trace"}, "trace"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s = tt.cfg
			if got := GetLogLevel(); got != tt.want {
				t.Errorf("GetLogLevel() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGetCustomCSS(t *testing.T) {
	useTempConfigDir(t)
	if got := GetCustomCSS(); got != "" {
		t.Errorf("GetCustomCSS() with no file = %q, want empty", got)
	}
}

func TestSetCustomCSS(t *testing.T) {
	dir := useTempConfigDir(t)
	const css = "body { color: red; }"

	if err := SetCustomCSS(css); err != nil {
		t.Fatal(err)
	}
	if got := GetCustomCSS(); got != css {
		t.Errorf("GetCustomCSS() = %q, want %q", got, css)
	}
	if runtime.GOOS == "windows" {
		return // POSIX mode bits are not enforced on Windows.
	}
	info, err := os.Stat(filepath.Join(dir, "custom.css"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("custom.css mode = %04o, want 0600", got)
	}
}

func TestGetCustomJS(t *testing.T) {
	useTempConfigDir(t)
	if got := GetCustomJS(); got != "" {
		t.Errorf("GetCustomJS() with no file = %q, want empty", got)
	}
}

func TestSetCustomJS(t *testing.T) {
	dir := useTempConfigDir(t)
	const js = "console.log('hi');"

	if err := SetCustomJS(js); err != nil {
		t.Fatal(err)
	}
	if got := GetCustomJS(); got != js {
		t.Errorf("GetCustomJS() = %q, want %q", got, js)
	}
	if runtime.GOOS == "windows" {
		return // POSIX mode bits are not enforced on Windows.
	}
	info, err := os.Stat(filepath.Join(dir, "custom.js"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("custom.js mode = %04o, want 0600", got)
	}
}
