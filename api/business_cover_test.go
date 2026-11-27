package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Minimal real signatures. downloadBusinessCoverImage validates magic bytes
// (not full decoding), so these fixtures exercise the exact allow-list logic.
var (
	coverPNGBytes  = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00}
	coverJPEGBytes = []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00}
	coverGIFBytes  = []byte("GIF89a\x00\x00")
	coverWEBPBytes = []byte{'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P'}
)

func serveCoverBytes(t *testing.T, contentType string, body []byte) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	return server.URL
}

// Non-image payloads must never produce a data URL. The binding maps the
// returned error to state "unavailable", never "ready".
func TestDownloadBusinessCoverImageRejectsNonImages(t *testing.T) {
	html := []byte("<html><body>not an image</body></html>")
	svg := []byte("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")

	tests := []struct {
		name        string
		contentType string
		body        []byte
	}{
		{"html with text/html", "text/html", html},
		{"html spoofed as jpeg", "image/jpeg", html},
		{"svg excluded", "image/svg+xml", svg},
		{"png header on jpeg bytes", "image/png", coverJPEGBytes},
		{"parameter bearing header", "image/png; charset=utf-8", coverPNGBytes},
		{"empty body", "image/png", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dataURL, mime, err := downloadBusinessCoverImage(serveCoverBytes(t, tt.contentType, tt.body))
			if err == nil {
				t.Fatalf("expected rejection, got ready dataURL=%q mime=%q", dataURL, mime)
			}
			if dataURL != "" || mime != "" {
				t.Fatalf("rejected payload leaked a data URL or MIME: %q %q", dataURL, mime)
			}
		})
	}
}

func TestDownloadBusinessCoverImageAcceptsKnownImages(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		body        []byte
		mime        string
	}{
		{"png", "image/png", coverPNGBytes, "image/png"},
		{"jpeg", "image/jpeg", coverJPEGBytes, "image/jpeg"},
		{"gif", "image/gif", coverGIFBytes, "image/gif"},
		{"webp", "image/webp", coverWEBPBytes, "image/webp"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dataURL, mime, err := downloadBusinessCoverImage(serveCoverBytes(t, tt.contentType, tt.body))
			if err != nil {
				t.Fatalf("unexpected rejection: %v", err)
			}
			if mime != tt.mime {
				t.Fatalf("mime = %q, want %q", mime, tt.mime)
			}
			if !strings.HasPrefix(dataURL, "data:"+tt.mime+";base64,") {
				t.Fatalf("dataURL = %q, want data:%s;base64 prefix", dataURL, tt.mime)
			}
		})
	}
}

// Unknown bytes must return "" rather than being assumed to be JPEG. This is
// the guard that keeps a non-image payload out of state "ready".
func TestCoverImageMIMEFromMagicFailsClosed(t *testing.T) {
	positive := []struct {
		name string
		body []byte
		mime string
	}{
		{"png", coverPNGBytes, "image/png"},
		{"jpeg", coverJPEGBytes, "image/jpeg"},
		{"gif", coverGIFBytes, "image/gif"},
		{"webp", coverWEBPBytes, "image/webp"},
	}
	for _, tt := range positive {
		if got := coverImageMIMEFromMagic(tt.body); got != tt.mime {
			t.Errorf("%s: got %q, want %q", tt.name, got, tt.mime)
		}
	}

	negative := []struct {
		name string
		body []byte
	}{
		{"text", []byte("<html>not an image</html>")},
		{"svg", []byte("<svg></svg>")},
		{"random", []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05}},
		{"short", []byte{0xFF, 0xD8}},
		{"empty", nil},
	}
	for _, tt := range negative {
		if got := coverImageMIMEFromMagic(tt.body); got != "" {
			t.Errorf("%s: got %q, want empty (no JPEG default)", tt.name, got)
		}
	}
}

func TestCoverImageMIMEMatchesRejectsSVGEvenWithMatchingBytes(t *testing.T) {
	// No magic byte sequence produces image/svg+xml; the declared type alone
	// must never make an inline SVG a "ready" cover.
	if coverImageMIMEMatches("image/svg+xml", "image/png") {
		t.Fatal("image/svg+xml must never be accepted")
	}
	if !coverImageMIMEMatches("image/jpg", "image/jpeg") {
		t.Fatal("image/jpg should be accepted as the sniffed JPEG type")
	}
}
