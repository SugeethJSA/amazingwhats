package api

import (
	"strings"
	"testing"

	"github.com/lugvitc/whats4linux/internal/store"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"github.com/lugvitc/whats4linux/internal/wa"
)

// Note: media_test.go already exists, so the pure-helper tests for media.go
// live in this source-derived split file rather than modifying that file.

func TestIsImageMime(t *testing.T) {
	tests := []struct {
		name string
		mime string
		want bool
	}{
		{"jpeg", "image/jpeg", true},
		{"jpg", "image/jpg", true},
		{"png", "image/png", true},
		{"gif", "image/gif", true},
		{"webp", "image/webp", true},
		{"uppercase", "IMAGE/PNG", true},
		{"surrounding whitespace", "  image/jpeg  ", true},
		{"other raster image", "image/bmp", true},
		{"avif", "image/avif", true},
		{"svg is explicitly rejected", "image/svg+xml", false},
		{"svg uppercase", "IMAGE/SVG+XML", false},
		{"pdf", "application/pdf", false},
		{"video", "video/mp4", false},
		{"audio", "audio/ogg", false},
		{"empty", "", false},
		{"malformed", "image", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isImageMime(tt.mime); got != tt.want {
				t.Fatalf("isImageMime(%q) = %v, want %v", tt.mime, got, tt.want)
			}
		})
	}
}

func pureTestMediaMessage(mediaType mtypes.MediaType) *store.ExtendedMessage {
	return &store.ExtendedMessage{
		Media: wa.NewMedia("", nil, nil, nil, "", "image/jpeg", 0, 0, mediaType, ""),
	}
}

func TestIsImageOrSticker(t *testing.T) {
	tests := []struct {
		name string
		msg  *store.ExtendedMessage
		want bool
	}{
		{"nil message", nil, false},
		{"nil media", &store.ExtendedMessage{}, false},
		{"image", pureTestMediaMessage(mtypes.MediaTypeImage), true},
		{"sticker", pureTestMediaMessage(mtypes.MediaTypeSticker), true},
		{"sticker metadata", pureTestMediaMessage(mtypes.MediaTypeStickerMetadata), false},
		{"sticker pack", pureTestMediaMessage(mtypes.MediaTypeStickerPack), false},
		{"video", pureTestMediaMessage(mtypes.MediaTypeVideo), false},
		{"audio", pureTestMediaMessage(mtypes.MediaTypeAudio), false},
		{"document", pureTestMediaMessage(mtypes.MediaTypeDocument), false},
		{"none", pureTestMediaMessage(mtypes.MediaTypeNone), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isImageOrSticker(tt.msg); got != tt.want {
				t.Fatalf("isImageOrSticker(%+v) = %v, want %v", tt.msg, got, tt.want)
			}
		})
	}
}

func TestThumbnailDownloadExtension(t *testing.T) {
	tests := []struct {
		name string
		mime string
		want string
	}{
		{"png", "image/png", ".png"},
		{"gif", "image/gif", ".gif"},
		{"webp", "image/webp", ".webp"},
		{"jpeg", "image/jpeg", ".jpg"},
		{"jpg", "image/jpg", ".jpg"},
		{"uppercase", "IMAGE/GIF", ".gif"},
		{"whitespace", " image/webp ", ".webp"},
		{"mime parameters", "image/png; charset=utf-8", ".png"},
		{"unsupported mime defaults to jpg", "application/pdf", ".jpg"},
		{"svg defaults to jpg", "image/svg+xml", ".jpg"},
		{"empty defaults to jpg", "", ".jpg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := thumbnailDownloadExtension(tt.mime); got != tt.want {
				t.Fatalf("thumbnailDownloadExtension(%q) = %q, want %q", tt.mime, got, tt.want)
			}
		})
	}
}

func TestSanitizeFileNamePart(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain name", "hello world.txt", "hello world.txt"},
		{"path separators", "../etc/passwd", "_etc_passwd"},
		{"windows reserved characters", `a:b*c?d"e<f>g|h`, "a_b_c_d_e_f_g_h"},
		{"control characters", "bad\x00name\x1f.txt", "bad_name_.txt"},
		{"delete character", "del\x7fete", "del_ete"},
		{"leading and trailing dots and spaces", "  ..report..  ", "report"},
		{"only dots", "...", ""},
		{"only spaces", "   ", ""},
		{"empty", "", ""},
		{"unicode is preserved", "日本語.txt", "日本語.txt"},
		{"single dot", ".", ""},
		{"double dot", "..", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := sanitizeFileNamePart(tt.in); got != tt.want {
				t.Fatalf("sanitizeFileNamePart(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestSafeDownloadNameFallbackAndSanitization(t *testing.T) {
	tests := []struct {
		name       string
		messageID  string
		mime       string
		storedName string
		want       string
	}{
		{"stored name wins over message id", "id", "image/png", "photo.png", "photo.png"},
		{"stored path is reduced to base name", "id", "image/png", "../../photo.png", "photo.png"},
		{"stored name is sanitized", "id", "image/png", "bad\x00name.png", "bad_name.png"},
		{"stored dot names fall back to id", "abc123", "image/gif", "..", "abc123.gif"},
		{"empty stored name falls back to id", "abc123", "image/gif", "", "abc123.gif"},
		{"existing extension is not duplicated", "photo.JPG", "image/jpeg", "", "photo.JPG"},
		{"unknown mime defaults to jpg", "m1", "application/pdf", "", "m1.jpg"},
		{"malicious id is sanitized", "../.ssh/authorized_keys", "image/jpeg", "", "authorized_keys.jpg"},
		{"everything empty uses image default", "", "", "", "image.jpg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := safeDownloadName(tt.messageID, tt.mime, tt.storedName)
			if got != tt.want {
				t.Fatalf("safeDownloadName(%q, %q, %q) = %q, want %q", tt.messageID, tt.mime, tt.storedName, got, tt.want)
			}
			if strings.Contains(got, "..") || strings.ContainsAny(got, `/\<>:"|?*`) {
				t.Fatalf("safeDownloadName returned an unsafe name %q", got)
			}
		})
	}
}

func TestSafeDownloadNameWithExt(t *testing.T) {
	tests := []struct {
		name      string
		messageID string
		extension string
		stored    string
		want      string
	}{
		{"stored name wins", "id", ".pdf", "report.pdf", "report.pdf"},
		{"fallback to message id", "msg-1", ".pdf", "", "msg-1.pdf"},
		{"extension suffix is case insensitive", "photo.PDF", ".pdf", "", "photo.PDF"},
		{"empty everything uses download default", "", ".mp4", "", "download.mp4"},
		{"dot message id uses default", "..", ".bin", "", "download.bin"},
		{"stored name is sanitized to base", "../evil", ".txt", "../note.txt", "note.txt"},
		{"empty extension is not appended", "id", "", "", "id"},
		{"generic media keeps real extension", "msg-2", ".ogg", "", "msg-2.ogg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := safeDownloadNameWithExt(tt.messageID, tt.extension, tt.stored)
			if got != tt.want {
				t.Fatalf("safeDownloadNameWithExt(%q, %q, %q) = %q, want %q", tt.messageID, tt.extension, tt.stored, got, tt.want)
			}
			if strings.Contains(got, "..") || strings.ContainsAny(got, `/\<>:"|?*`) {
				t.Fatalf("safeDownloadNameWithExt returned an unsafe name %q", got)
			}
		})
	}
}

func TestGetFileExtension(t *testing.T) {
	tests := []struct {
		name string
		mime string
		want string
	}{
		{"png", "image/png", ".png"},
		{"gif", "image/gif", ".gif"},
		{"webp", "image/webp", ".webp"},
		{"jpeg", "image/jpeg", ".jpg"},
		{"jpg", "image/jpg", ".jpg"},
		{"jpeg with parameters", "image/jpeg; charset=utf-8", ".jpg"},
		{"mp4", "video/mp4", ".mp4"},
		{"ogg", "audio/ogg", ".ogg"},
		{"ogg with codec parameter", "audio/ogg; codecs=opus", ".ogg"},
		{"mp3", "audio/mpeg", ".mp3"},
		{"pdf", "application/pdf", ".pdf"},
		{"octet stream", "application/octet-stream", ".bin"},
		{"empty", "", ".bin"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := getFileExtension(tt.mime); got != tt.want {
				t.Fatalf("getFileExtension(%q) = %q, want %q", tt.mime, got, tt.want)
			}
		})
	}
}
