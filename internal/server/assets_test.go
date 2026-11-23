package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// cacheHomeForTest points os.UserCacheDir at a temporary directory via
// environment variables and returns the cache root the app will resolve.
func cacheHomeForTest(t *testing.T) string {
	t.Helper()
	base := t.TempDir()
	switch runtime.GOOS {
	case "windows":
		t.Setenv("LocalAppData", base)
		return base
	case "darwin":
		t.Setenv("HOME", base)
		return filepath.Join(base, "Library", "Caches")
	default: // Unix: XDG_CACHE_HOME
		t.Setenv("XDG_CACHE_HOME", base)
		return base
	}
}

func TestNewAssetFileServer(t *testing.T) {
	h := NewAssetFileServer()
	if h == nil {
		t.Fatal("NewAssetFileServer() returned nil")
	}
	var _ http.Handler = h // the returned server must satisfy http.Handler
}

func TestAssetFileServer_ServeHTTP(t *testing.T) {
	cacheHome := cacheHomeForTest(t)
	imagesDir := filepath.Join(cacheHome, "whats4linux", "images")
	if err := os.MkdirAll(imagesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(imagesDir, "abc123.png"), []byte("image-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A file outside the images directory must never be served by the handler.
	if err := os.WriteFile(
		filepath.Join(cacheHome, "whats4linux", "outside.png"), []byte("outside"), 0o644,
	); err != nil {
		t.Fatal(err)
	}

	h := NewAssetFileServer()
	tests := []struct {
		name       string
		path       string
		wantStatus int
		wantBody   string
	}{
		{"cached image is served", "/cached-image/abc123.png", http.StatusOK, "image-bytes"},
		{"missing file is not found", "/cached-image/missing.png", http.StatusNotFound, ""},
		{"file outside images dir is not served", "/cached-image/outside.png", http.StatusNotFound, ""},
		{"parent traversal rejected", "/cached-image/../secret", http.StatusBadRequest, ""},
		{"absolute path rejected", "/cached-image//etc/passwd", http.StatusBadRequest, ""},
		{"nested separator rejected", "/cached-image/sub/file.png", http.StatusBadRequest, ""},
		{"empty filename rejected", "/cached-image/", http.StatusBadRequest, ""},
		{"unrelated path is not found", "/other", http.StatusNotFound, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()

			h.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if tt.wantBody != "" && rec.Body.String() != tt.wantBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}
