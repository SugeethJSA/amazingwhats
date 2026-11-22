package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/gen2brain/beeep"
	"github.com/lugvitc/whats4linux/internal/store"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// LinkPreviewResult is the link preview surfaced to the frontend.
type LinkPreviewResult struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Thumbnail   string `json:"thumbnail"` // data URL, or empty
}

// GetLinkPreview returns the stored preview card for a message's URL, or nil.
func (a *Api) GetLinkPreview(messageID string) *LinkPreviewResult {
	if a.messageStore == nil {
		return nil
	}
	lp := a.messageStore.GetLinkPreview(messageID)
	if lp == nil {
		return nil
	}
	res := &LinkPreviewResult{URL: lp.URL, Title: lp.Title, Description: lp.Description}
	if len(lp.Thumbnail) > 0 {
		res.Thumbnail = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(lp.Thumbnail)
	}
	return res
}

// GetLinkPreviewImage returns the preview poster as a data URL, downloading and
// caching it on first request (WhatsApp ships the poster as an encrypted
// reference rather than embedded). Empty string if there's nothing to fetch.
func (a *Api) GetLinkPreviewImage(messageID string) string {
	if a.messageStore == nil {
		return ""
	}
	m := a.messageStore.GetLinkPreviewMedia(messageID)
	if m == nil {
		return ""
	}
	if len(m.Thumbnail) > 0 {
		return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(m.Thumbnail)
	}
	if m.DirectPath == "" || len(m.MediaKey) == 0 {
		return ""
	}
	if a.waClient == nil {
		return ""
	}
	data, err := a.waClient.DownloadMediaWithPath(
		a.ctx, m.DirectPath, m.FileEncSHA256, m.FileSHA256, m.MediaKey,
		whatsmeow.MediaLinkThumbnail, "thumbnail-link", true,
	)
	if err != nil || len(data) == 0 {
		return ""
	}
	if err := a.messageStore.CacheLinkPreviewThumbnail(messageID, data); err != nil {
		log.Printf("[GetLinkPreviewImage] failed to cache poster for %s: %v", messageID, err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
}

// GetVideoThumbnail returns the message's embedded preview image as a data URL,
// or an empty string if none was stored. Lets the UI show a video preview + play
// button without downloading the full video.
func (a *Api) GetVideoThumbnail(messageID string) string {
	if a.messageStore == nil {
		return ""
	}
	thumb := a.messageStore.GetThumbnail(messageID)
	if isUnavailableThumbnail(thumb) || len(thumb) == 0 {
		return ""
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb)
}

// GetImageThumbnail returns a small JPEG preview for an image/sticker message.
// It reads the stored thumbnail first, otherwise generates one from the cached
// image and stores it (including a negative-cache sentinel for failures).
func (a *Api) GetImageThumbnail(messageID string) string {
	if a.messageStore == nil {
		return ""
	}
	thumb := a.messageStore.GetThumbnail(messageID)
	if isUnavailableThumbnail(thumb) {
		return ""
	}
	if len(thumb) > 0 {
		return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumb)
	}
	if a.imageCache == nil {
		return ""
	}
	data, mime, err := a.imageCache.ReadImageByMessageID(messageID)
	if err != nil || len(data) == 0 {
		return ""
	}
	thumbData := generateThumbnail(data, mime)
	if len(thumbData) == 0 {
		if err := a.messageStore.CacheThumbnail(messageID, thumbnailUnavailable); err != nil {
			log.Printf("[GetImageThumbnail] failed to store negative thumbnail for %s: %v", messageID, err)
		}
		return ""
	}
	if err := a.messageStore.CacheThumbnail(messageID, thumbData); err != nil {
		log.Printf("[GetImageThumbnail] failed to cache thumbnail for %s: %v", messageID, err)
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(thumbData)
}

func (a *Api) DownloadMedia(chatJID string, messageID string) (string, error) {
	if a.messageStore == nil {
		return "", fmt.Errorf("message store is not ready")
	}
	msg, err := a.messageStore.GetMessageWithMedia(chatJID, messageID)
	if err != nil || msg == nil {
		return "", fmt.Errorf("message not found")
	}
	if msg.Media == nil {
		return "", fmt.Errorf("message %s has no downloadable media", messageID)
	}
	if a.waClient == nil {
		return "", fmt.Errorf("WhatsApp client is not ready")
	}

	mimeType := msg.Media.GetMimetype()
	width, height := msg.Media.GetDimensions()

	mediaType := msg.Media.GetMediaType()
	if mimeType == "" {
		// A correct MIME is required or <video>/<audio> won't play the data URL.
		switch mediaType {
		case whatsmeow.MediaImage:
			mimeType = "image/jpeg"
		case whatsmeow.MediaVideo:
			mimeType = "video/mp4"
		case whatsmeow.MediaAudio:
			mimeType = "audio/ogg"
		default:
			mimeType = "application/octet-stream"
		}
	}
	data, err := a.waClient.Download(a.ctx, msg.Media)
	if err != nil {
		return "", fmt.Errorf("failed to download media: %v", err)
	}

	// Save to cache for images. The cache can be nil during startup/shutdown
	// (D-AUD-003a), and only a valid image MIME belongs in the image index
	// (D-AUD-003d) — a non-image would poison GetCachedImage/fetchImageBytes.
	if mediaType == whatsmeow.MediaImage && a.imageCache != nil && isImageMime(mimeType) {
		if _, err := a.imageCache.SaveImage(messageID, data, mimeType, width, height); err != nil {
			log.Printf("[DownloadMedia] failed to cache image for %s: %v", messageID, err)
		}
	}

	// Return a ready-to-use data URL with the correct MIME.
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// downloadMedia downloads media from a message and returns data, mimeType, width, height
func (a *Api) downloadMedia(msg *store.ExtendedMessage) ([]byte, string, int, int, error) {
	if msg == nil || msg.Media == nil {
		return nil, "", 0, 0, fmt.Errorf("message has no downloadable media")
	}
	if a.waClient == nil {
		return nil, "", 0, 0, fmt.Errorf("WhatsApp client is not ready")
	}
	data, err := a.waClient.Download(a.ctx, msg.Media)
	mimeType := msg.Media.GetMimetype()

	if mimeType == "" && msg.Media.GetMediaType() == whatsmeow.MediaImage {
		mimeType = "image/jpeg"
	}
	width, height := msg.Media.GetDimensions()

	return data, mimeType, width, height, err
}

func (a *Api) GetCachedImage(messageID string) (string, error) {
	data, mimeType, err := a.fetchImageBytes(messageID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data)), nil
}

const (
	maxCachedImageBatchItems = 8
	maxCachedImageBatchBytes = 2 << 20
)

// GetCachedImages retrieves multiple cached images by message IDs (batch operation).
// Only already-cached image/sticker bytes are returned; the batch is capped so a
// single IPC string cannot evict on-screen images or freeze the UI.
func (a *Api) GetCachedImages(messageIDs []string) (map[string]string, error) {
	result := make(map[string]string)
	if a.imageCache == nil {
		return result, fmt.Errorf("image cache is not ready")
	}
	if len(messageIDs) > maxCachedImageBatchItems {
		messageIDs = messageIDs[:maxCachedImageBatchItems]
	}
	metas, err := a.imageCache.GetImagesByMessageIDs(messageIDs)
	if err != nil {
		return nil, err
	}

	remaining := maxCachedImageBatchBytes
	for _, msgID := range messageIDs {
		meta := metas[msgID]
		if meta == nil || !isImageMime(meta.Mime) {
			continue
		}
		data, mimeType, err := a.imageCache.ReadImageByMessageID(msgID)
		if err != nil || len(data) == 0 || !isImageMime(mimeType) {
			continue
		}
		encodedLen := base64.StdEncoding.EncodedLen(len(data))
		if encodedLen > remaining {
			continue
		}
		result[msgID] = fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data))
		remaining -= encodedLen
		if remaining <= 0 {
			break
		}
	}

	return result, nil
}

func isImageMime(mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	switch mimeType {
	case "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp":
		return true
	}
	return strings.HasPrefix(mimeType, "image/") && !strings.HasPrefix(mimeType, "image/svg")
}

func isImageOrSticker(msg *store.ExtendedMessage) bool {
	if msg == nil || msg.Media == nil {
		return false
	}
	switch msg.Media.GetMediaGeneralType() {
	case mtypes.MediaTypeImage, mtypes.MediaTypeSticker:
		return true
	default:
		return false
	}
}

// fetchImageBytes returns the decoded image bytes and MIME for a message.
// It reads the on-disk image cache first and only downloads image/sticker media.
func (a *Api) fetchImageBytes(messageID string) (data []byte, mime string, err error) {
	if a.imageCache == nil {
		return nil, "", fmt.Errorf("image cache is not ready")
	}
	if data, mime, err = a.imageCache.ReadImageByMessageID(messageID); err == nil && len(data) > 0 {
		if isImageMime(mime) {
			return data, mime, nil
		}
		// Self-heal (D-AUD-003d): a corrupt/non-image index row must not
		// permanently break this message. Discard the cached bytes and fall
		// through to a fresh download; the SaveImage below uses INSERT OR
		// REPLACE, so a successful re-download overwrites the bad row.
		log.Printf("[fetchImageBytes] discarding non-image cached MIME %q for %s", mime, messageID)
	}

	if a.messageStore == nil {
		return nil, "", fmt.Errorf("message store is not ready")
	}
	msg, err := a.messageStore.GetMessageWithMediaByID(messageID)
	if err != nil || msg == nil {
		return nil, "", fmt.Errorf("message not found")
	}
	if msg.Media == nil || !isImageOrSticker(msg) {
		return nil, "", fmt.Errorf("message %s has no downloadable image", messageID)
	}
	if storedMime := msg.Media.GetMimetype(); storedMime != "" && !isImageMime(storedMime) {
		return nil, "", fmt.Errorf("message %s has no downloadable image", messageID)
	}

	data, mime, width, height, err := a.downloadMedia(msg)
	if err != nil {
		return nil, "", fmt.Errorf("failed to download image: %w", err)
	}
	if mime != "" && !isImageMime(mime) {
		return nil, "", fmt.Errorf("message %s has no downloadable image", messageID)
	}
	if mime == "" {
		mime = "image/jpeg"
	}
	if _, saveErr := a.imageCache.SaveImage(messageID, data, mime, width, height); saveErr != nil {
		log.Printf("[fetchImageBytes] failed to cache image for %s: %v", messageID, saveErr)
	}
	return data, mime, nil
}

// GetCachedAvatar retrieves or downloads and caches an avatar for a JID
func (a *Api) GetCachedAvatar(jid string, recache bool) (string, error) {
	if a.imageCache == nil {
		return "", fmt.Errorf("image cache is not ready")
	}

	// Try to get cached avatar data first
	data, mimeType, err := a.imageCache.ReadAvatarByJID(jid)

	if err == nil && !recache {
		avatarDataURL := fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data))
		return avatarDataURL, nil
	}

	// Avatar not in cache, download and cache it
	if a.waClient == nil || a.waClient.Store == nil {
		return "", fmt.Errorf("WhatsApp client is not ready")
	}
	jidParsed, err := types.ParseJID(jid)
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	// Get profile picture info. Community parent groups need IsCommunity: true.
	pic, err := a.waClient.GetProfilePictureInfo(a.ctx, jidParsed, &whatsmeow.GetProfilePictureParams{
		Preview: false, // Get full resolution
	})
	if (err != nil || pic == nil) && jidParsed.Server == types.GroupServer {
		pic, err = a.waClient.GetProfilePictureInfo(a.ctx, jidParsed, &whatsmeow.GetProfilePictureParams{
			Preview:     true,
			IsCommunity: true,
		})
	}
	if err != nil || pic == nil {
		if recache {
			a.startBackground(func() { _ = a.imageCache.DeleteAvatar(jid) })
		}
		return "", nil // No avatar available
	}

	return a.downloadAvatarFromURL(jid, pic.URL)
}

// maxAvatarBytes caps how much of a profile photo we read into memory. Avatar
// URLs are remote and untrusted, so an unbounded ReadAll is a memory-exhaustion
// risk (D-AUD-003g).
const maxAvatarBytes = 10 << 20 // 10 MiB

// downloadAvatarFromURL fetches an avatar image from URL, caches it, and
// returns a data URL. Used by both regular and community avatar paths.
func (a *Api) downloadAvatarFromURL(jid, url string) (string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to download avatar: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			log.Printf("failed to close avatar response body: %v", err)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download avatar: status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxAvatarBytes+1))
	if err != nil {
		return "", fmt.Errorf("failed to read avatar data: %w", err)
	}
	if len(data) > maxAvatarBytes {
		return "", fmt.Errorf("failed to download avatar: image exceeds %d bytes", maxAvatarBytes)
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	var mimeType string
	if contentType != "" {
		// Never embed a raw, unvalidated Content-Type into a data URL or the
		// image index (D-AUD-003). Reject parameter-bearing types (e.g.
		// "image/png; charset=utf-8") instead of silently accepting them, and
		// reject anything that is not a pure image MIME.
		if strings.Contains(contentType, ";") {
			return "", fmt.Errorf("failed to download avatar: unsupported Content-Type %q", contentType)
		}
		mimeType = strings.ToLower(contentType)
		if !isImageMime(mimeType) {
			return "", fmt.Errorf("failed to download avatar: non-image Content-Type %q", contentType)
		}
	} else {
		// No header: infer from magic bytes, defaulting to JPEG.
		mimeType = "image/jpeg"
		if len(data) > 3 {
			switch {
			case data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47:
				mimeType = "image/png"
			case data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46:
				mimeType = "image/gif"
			case data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46:
				mimeType = "image/webp"
			}
		}
	}
	// Final guard covers the sniffed path too: only pure image MIMEs may be
	// cached and turned into a data URL.
	if !isImageMime(mimeType) {
		return "", fmt.Errorf("failed to download avatar: unsupported image type %q", mimeType)
	}

	_, err = a.imageCache.SaveAvatar(jid, data, mimeType)
	if err != nil {
		log.Printf("[downloadAvatarFromURL] Failed to cache avatar for %s: %v", jid, err)
		return "", fmt.Errorf("failed to cache avatar: %w", err)
	}

	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data)), nil
}

// GetSelfAvatar retrieves the avatar of the logged-in user
//
// We need to check canonical JID as if we check store's ID, it
// contains the device ID like so:
// XXXX:45@s.whatsapp.net instead of XXXX:@s.whatsapp.net
func (a *Api) GetSelfAvatar(recache bool) (string, error) {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return "", fmt.Errorf("not logged in")
	}
	jid := canonicalUserJID(a.ctx, a.waClient, *a.waClient.Store.ID)
	selfJID := jid.String()

	avatar, err := a.GetCachedAvatar(selfJID, recache)
	if err != nil {
		log.Printf("[SelfAvatar] GetCachedAvatar failed: %v", err)
		return "", err
	}

	if avatar == "" {
		log.Printf("[SelfAvatar] WhatsApp returned no avatar for self")
		return "", nil
	}

	return avatar, nil
}

// thumbnailDownloadExtension mirrors the narrow image-only extension mapping
// used by the thumbnail download path. The shared getFileExtension below stays
// broad (documents, audio, video) for the fork's streaming download flows.
func thumbnailDownloadExtension(mime string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(mime, ";")[0])) {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	default:
		return ".jpg"
	}
}

// sanitizeFileNamePart applies the same strict filename sanitizer to every
// name component (stored media name and message-ID fallback alike, D-AUD-003f)
// so control characters and reserved/separator characters can never escape the
// Downloads folder or produce an unusable path on Windows.
func sanitizeFileNamePart(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || unicode.IsControl(r) {
			return '_'
		}
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			return '_'
		}
		return r
	}, s)
	return strings.Trim(s, " .")
}

// safeDownloadName derives a safe base filename from the stored media name (or
// the message ID when no name is available). Path components and control chars
// are stripped so a malicious name cannot escape the Downloads folder.
func safeDownloadName(messageID, mime, storedName string) string {
	ext := thumbnailDownloadExtension(mime)
	if storedName = strings.TrimSpace(storedName); storedName != "" {
		base := sanitizeFileNamePart(filepath.Base(storedName))
		if base != "" && base != "." && base != ".." {
			return base
		}
	}
	id := sanitizeFileNamePart(filepath.Base(strings.TrimSpace(messageID)))
	if id == "" || id == "." || id == ".." {
		id = "image"
	}
	if !strings.HasSuffix(strings.ToLower(id), ext) {
		id += ext
	}
	return id
}

// safeDownloadNameWithExt is the general-media counterpart of safeDownloadName.
// It applies the same strict sanitizer to the stored media name (or the message
// ID fallback) and appends the caller-provided extension, so documents, video
// and audio keep their real extension instead of the thumbnail path's
// image-only default. Unlike safeDownloadName, it is not tied to the image
// cache/thumbnail contract and does not change that helper's behavior.
func safeDownloadNameWithExt(messageID, extension, storedName string) string {
	name := ""
	if storedName = strings.TrimSpace(storedName); storedName != "" {
		base := sanitizeFileNamePart(filepath.Base(storedName))
		if base != "" && base != "." && base != ".." {
			name = base
		}
	}
	if name == "" {
		name = sanitizeFileNamePart(filepath.Base(strings.TrimSpace(messageID)))
	}
	if name == "" || name == "." || name == ".." {
		name = "download"
	}
	if extension != "" && !strings.HasSuffix(strings.ToLower(name), strings.ToLower(extension)) {
		name += extension
	}
	return name
}

// getFileExtension returns file extension for mimeType
func getFileExtension(mimeType string) string {
	mimeType = strings.Split(mimeType, ";")[0]

	switch mimeType {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "video/mp4":
		return ".mp4"
	case "audio/ogg", "audio/ogg; codecs=opus":
		return ".ogg"
	case "audio/mpeg":
		return ".mp3"
	case "application/pdf":
		return ".pdf"
	}

	exts, _ := mime.ExtensionsByType(mimeType)
	if len(exts) > 0 {
		// mime.ExtensionsByType can return multiple extensions, take the first one
		return exts[0]
	}

	parts := strings.Split(mimeType, "/")
	if len(parts) == 2 && parts[1] != "octet-stream" && parts[1] != "" {
		return "." + parts[1]
	}
	return ".bin"
}

// DownloadImageToFile writes a cached (or freshly downloaded) image to ~/Downloads.
func (a *Api) DownloadImageToFile(messageID string) error {
	data, mimeType, err := a.fetchImageBytes(messageID)
	if err != nil {
		return fmt.Errorf("image not available: %w", err)
	}
	if len(data) == 0 {
		return fmt.Errorf("image not available")
	}

	storedName := ""
	if a.messageStore != nil {
		if msg, msgErr := a.messageStore.GetMessageWithMediaByID(messageID); msgErr == nil && msg != nil && msg.Media != nil {
			storedName = msg.Media.GetFileName()
		}
	}

	homeDir, _ := os.UserHomeDir()
	downloadsDir := filepath.Join(homeDir, "Downloads")
	fileName := safeDownloadName(messageID, mimeType, storedName)
	filePath := filepath.Join(downloadsDir, fileName)

	// Check if file exists and prompt for new path
	if _, err := os.Stat(filePath); err == nil {
		filePath, err = a.app.Dialog.SaveFile().
			SetDirectory(downloadsDir).
			SetFilename(fileName).
			SetMessage("File already exists. Save as...").
			AddFilter("Image Files", "*"+getFileExtension(mimeType)).
			PromptForSingleSelection()
		if err != nil || filePath == "" {
			return err
		}
	}

	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return err
	}

	a.app.Event.Emit("download:complete", filePath)
	_ = beeep.Notify("whats4linux", "Downloaded: "+filePath, "")
	playBeep()
	return nil
}

func playBeep() {
	if _, err := exec.LookPath("mpg123"); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = exec.CommandContext(ctx, "mpg123", "./beep.mp3").Run()
}

// DownloadMediaToFile downloads any media type (document, video, audio, image) to the filesystem.
// It streams the download to a temp file (never loading it fully into memory)
// and prompts the user where to save it. Progress events are intentionally not
// emitted: no frontend listener consumes them (D-AUD-003e).
func (a *Api) DownloadMediaToFile(messageID string) error {
	if a.messageStore == nil {
		return fmt.Errorf("message store is not ready")
	}
	msg, err := a.messageStore.GetMessageWithMediaByID(messageID)
	if err != nil || msg == nil {
		return fmt.Errorf("message not found")
	}
	if msg.Media == nil {
		return fmt.Errorf("message %s has no downloadable media", messageID)
	}
	if a.waClient == nil {
		return fmt.Errorf("WhatsApp client is not ready")
	}

	mimeType := msg.Media.GetMimetype()
	homeDir, _ := os.UserHomeDir()
	downloadsDir := filepath.Join(homeDir, "Downloads")
	// This is the path MessageMenu actually calls. Never feed the raw IPC
	// message ID into a filesystem path: it may contain separators or control
	// characters (D-AUD-003f). Use the general-media helper with the broad
	// extension mapper so documents/video/audio keep their real extension
	// (the thumbnail path's safeDownloadName always defaults to .jpg).
	fileName := safeDownloadNameWithExt(messageID, getFileExtension(mimeType), msg.Media.GetFileName())

	// Stream to a temp file first so downloads never balloon memory.
	tmp, err := os.CreateTemp("", "whats4linux-dl-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
	}()

	// Stream the decrypted payload straight into the temp file. The previous
	// "media:download_progress" emits were removed (D-AUD-003e): no frontend
	// listener consumes that event, so it was orphaned IPC traffic with an
	// inconsistent total. "download:complete" below is kept intact.
	if dlErr := a.waClient.DownloadToFile(a.ctx, msg.Media, tmp); dlErr != nil {
		return fmt.Errorf("failed to download media: %w", dlErr)
	}

	filePath, err := a.app.Dialog.SaveFile().
		SetDirectory(downloadsDir).
		SetFilename(fileName).
		SetMessage("Save file").
		AddFilter("All Files", "*").
		PromptForSingleSelection()
	if err != nil {
		return err
	}
	if filePath == "" {
		return nil // Cancelled
	}

	// Copy from the temp file to the user-chosen destination.
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("failed to seek temp file: %w", err)
	}
	out, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to create destination file: %w", err)
	}
	defer func() { _ = out.Close() }()
	if _, err := io.Copy(out, tmp); err != nil {
		_ = os.Remove(filePath)
		return fmt.Errorf("failed to write destination file: %w", err)
	}

	a.app.Event.Emit("download:complete", filePath)
	_ = beeep.Notify("whats4linux", "Downloaded: "+filePath, "")
	playBeep()
	return nil
}
