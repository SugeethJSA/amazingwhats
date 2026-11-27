package api

// D-ID: WIRE-002 — Go bindings for the 15 unwired HyperMeow MEDIA Client APIs.
//
// Every Wire* method below calls a real Client method. Complex library inputs
// (protobuf messages, io.Reader/io.ReadWriteSeeker, the File interface) never
// cross Wails IPC: they are reconstructed in Go from validated primitive
// values (base64 strings, paths, tokens, bools). Downloaded bytes and built
// protobuf requests are returned as base64 strings. No response is fabricated,
// and no raw message body or media key is ever logged.

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/protobuf/proto"

	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/proto/waMediaTransport"
	"github.com/polymorfa/hypermeow/types"
)

// WireMediaUploadResult is the frontend-safe subset of a HyperMeow
// UploadResponse. The media key, file hashes and streaming sidecar are
// deliberately NOT exposed here: they belong inside the protobuf message built
// for the send path, never in a generic IPC DTO.
type WireMediaUploadResult struct {
	URL        string `json:"url"`
	DirectPath string `json:"directPath"`
	Handle     string `json:"handle"`
	ObjectID   string `json:"objectId"`
	FileLength uint64 `json:"fileLength"`
	Mime       string `json:"mime,omitempty"`
}

func wireUploadResult(resp whatsmeow.UploadResponse, mime string) WireMediaUploadResult {
	return WireMediaUploadResult{
		URL:        resp.URL,
		DirectPath: resp.DirectPath,
		Handle:     resp.Handle,
		ObjectID:   resp.ObjectID,
		FileLength: resp.FileLength,
		Mime:       mime,
	}
}

// wireCtx falls back to a background context for bindings invoked before
// ServiceStartup (tests) so HTTP media requests never get a nil Context.
func (a *Api) wireCtx() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func (a *Api) wireClient() (*whatsmeow.Client, error) {
	if a.waClient == nil {
		return nil, errors.New("WhatsApp client is not ready")
	}
	return a.waClient, nil
}

// wireDecodeBase64 decodes a base64 field at the IPC boundary. Empty values
// yield a nil slice only when allowEmpty is set (hashes are optional in the
// no-hash download APIs); otherwise an empty field is a validation error.
func wireDecodeBase64(field, value string, allowEmpty bool) ([]byte, error) {
	if value == "" {
		if allowEmpty {
			return nil, nil
		}
		return nil, fmt.Errorf("%s must not be empty", field)
	}
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 in %s: %w", field, err)
	}
	return data, nil
}

// wireMediaTypes accepts friendly tokens and the exact (lower-cased) MediaType
// constants, so callers can pass either "image" or "WhatsApp Image Keys".
var wireMediaTypes = map[string]whatsmeow.MediaType{
	"image": whatsmeow.MediaImage,
	strings.ToLower(string(whatsmeow.MediaImage)): whatsmeow.MediaImage,
	"video": whatsmeow.MediaVideo,
	strings.ToLower(string(whatsmeow.MediaVideo)): whatsmeow.MediaVideo,
	"audio": whatsmeow.MediaAudio,
	strings.ToLower(string(whatsmeow.MediaAudio)): whatsmeow.MediaAudio,
	"document": whatsmeow.MediaDocument,
	strings.ToLower(string(whatsmeow.MediaDocument)): whatsmeow.MediaDocument,
	"history": whatsmeow.MediaHistory,
	strings.ToLower(string(whatsmeow.MediaHistory)): whatsmeow.MediaHistory,
	"app_state": whatsmeow.MediaAppState,
	strings.ToLower(string(whatsmeow.MediaAppState)):             whatsmeow.MediaAppState,
	"sticker_pack_thumbnail":                                     whatsmeow.MediaStickerPackThumbnail,
	strings.ToLower(string(whatsmeow.MediaStickerPackThumbnail)): whatsmeow.MediaStickerPackThumbnail,
	"sticker_pack": whatsmeow.MediaStickerPack,
	strings.ToLower(string(whatsmeow.MediaStickerPack)): whatsmeow.MediaStickerPack,
	"link_thumbnail": whatsmeow.MediaLinkThumbnail,
	strings.ToLower(string(whatsmeow.MediaLinkThumbnail)): whatsmeow.MediaLinkThumbnail,
}

func wireParseMediaType(token string) (whatsmeow.MediaType, error) {
	mt, ok := wireMediaTypes[strings.ToLower(strings.TrimSpace(token))]
	if !ok {
		return "", fmt.Errorf("unsupported media type %q", token)
	}
	return mt, nil
}

// openWireDestination validates a frontend-supplied absolute destination path
// before handing an *os.File (which satisfies whatsmeow.File) to the client.
// O_EXCL means an existing file is never truncated or overwritten: the caller
// gets a plain error instead. The returned created flag records whether THIS
// call created the file, so cleanup can never delete a pre-existing file.
func openWireDestination(destinationPath string) (*os.File, bool, error) {
	p := strings.TrimSpace(destinationPath)
	if p == "" {
		return nil, false, errors.New("destination path must not be empty")
	}
	if strings.IndexByte(p, 0) >= 0 {
		return nil, false, errors.New("destination path contains a NUL byte")
	}
	if !filepath.IsAbs(p) {
		return nil, false, errors.New("destination path must be absolute")
	}
	cleaned := filepath.Clean(p)
	f, err := os.OpenFile(cleaned, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return nil, false, errors.New("destination file already exists")
		}
		return nil, false, err
	}
	// O_EXCL guarantees the file did not exist before this call.
	return f, true, nil
}

// wireDownloadToFile opens the destination once and removes a partial file on
// failure ONLY when this call created it — a pre-existing file is never
// truncated or deleted. Close errors are surfaced only when no earlier error
// is pending so a failed transfer is not masked.
func (a *Api) wireDownloadToFile(destinationPath string, download func(whatsmeow.File) error) (err error) {
	f, created, err := openWireDestination(destinationPath)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if closeErr := f.Close(); err == nil && closeErr != nil {
			err = closeErr
		}
		if !committed && created {
			_ = os.Remove(f.Name())
		}
	}()
	if err = download(f); err != nil {
		return err
	}
	committed = true
	return nil
}

// WireDownloadAny binds Client.DownloadAny. messageBase64 is a base64-encoded,
// protobuf-marshaled waE2E.Message; the real protobuf object is reconstructed
// in Go, so no opaque protobuf type crosses IPC. Downloaded bytes come back as
// base64 (the frontend adds the MIME/data-URL prefix).
func (a *Api) WireDownloadAny(messageBase64 string) (string, error) {
	cli, err := a.wireClient()
	if err != nil {
		return "", err
	}
	raw, err := wireDecodeBase64("message", messageBase64, false)
	if err != nil {
		return "", err
	}
	var msg waE2E.Message
	if err := proto.Unmarshal(raw, &msg); err != nil {
		return "", fmt.Errorf("invalid waE2E.Message protobuf: %w", err)
	}
	data, err := cli.DownloadAny(a.wireCtx(), &msg)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// WireDownloadThumbnail binds Client.DownloadThumbnail. The DownloadableThumbnail
// interface is reconstructed as one of its two concrete message types: kind is
// "extended_text" (link-preview thumbnails, the primary use case) or
// "sticker_pack". messageBase64 is the protobuf-marshaled message, base64-encoded.
func (a *Api) WireDownloadThumbnail(messageBase64, kind string) (string, error) {
	cli, err := a.wireClient()
	if err != nil {
		return "", err
	}
	raw, err := wireDecodeBase64("message", messageBase64, false)
	if err != nil {
		return "", err
	}
	var thumb whatsmeow.DownloadableThumbnail
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "extended_text", "extendedtextmessage":
		thumb = &waE2E.ExtendedTextMessage{}
	case "sticker_pack", "stickerpackmessage":
		thumb = &waE2E.StickerPackMessage{}
	default:
		return "", fmt.Errorf("unsupported thumbnail message kind %q", kind)
	}
	if err := proto.Unmarshal(raw, thumb); err != nil {
		return "", fmt.Errorf("invalid thumbnail protobuf: %w", err)
	}
	data, err := cli.DownloadThumbnail(a.wireCtx(), thumb)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// WireDownloadMediaWithOnlyPath binds Client.DownloadMediaWithOnlyPath for
// unencrypted/hash-less media. directPath is the plain string parameter of the
// library method; the client rejects paths that do not start with a slash.
func (a *Api) WireDownloadMediaWithOnlyPath(directPath string) (string, error) {
	cli, err := a.wireClient()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(directPath) == "" {
		return "", errors.New("direct path must not be empty")
	}
	data, err := cli.DownloadMediaWithOnlyPath(a.wireCtx(), directPath)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// WireDownloadFB binds Client.DownloadFB. transportBase64 holds a base64-encoded,
// protobuf-marshaled waMediaTransport.WAMediaTransport_Integral (the raw
// transport cannot be passed through Wails IPC); mediaType is a token accepted
// by wireParseMediaType.
func (a *Api) WireDownloadFB(transportBase64, mediaType string) (string, error) {
	cli, err := a.wireClient()
	if err != nil {
		return "", err
	}
	mt, err := wireParseMediaType(mediaType)
	if err != nil {
		return "", err
	}
	raw, err := wireDecodeBase64("transport", transportBase64, false)
	if err != nil {
		return "", err
	}
	var transport waMediaTransport.WAMediaTransport_Integral
	if err := proto.Unmarshal(raw, &transport); err != nil {
		return "", fmt.Errorf("invalid WAMediaTransport_Integral protobuf: %w", err)
	}
	data, err := cli.DownloadFB(a.wireCtx(), &transport, mt)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// WireDownloadMediaWithOnlyPathToFile binds Client.DownloadMediaWithOnlyPathToFile.
// The library's File interface is satisfied by the *os.File opened at a validated
// absolute destinationPath; a failed download removes the partial file.
func (a *Api) WireDownloadMediaWithOnlyPathToFile(directPath, destinationPath string) error {
	cli, err := a.wireClient()
	if err != nil {
		return err
	}
	if strings.TrimSpace(directPath) == "" {
		return errors.New("direct path must not be empty")
	}
	return a.wireDownloadToFile(destinationPath, func(f whatsmeow.File) error {
		return cli.DownloadMediaWithOnlyPathToFile(a.wireCtx(), directPath, f)
	})
}

// WireDownloadFBToFile binds Client.DownloadFBToFile. transportBase64 is a
// base64-encoded WAMediaTransport_Integral protobuf; the destination is handled
// exactly like WireDownloadMediaWithOnlyPathToFile.
func (a *Api) WireDownloadFBToFile(transportBase64, mediaType, destinationPath string) error {
	cli, err := a.wireClient()
	if err != nil {
		return err
	}
	mt, err := wireParseMediaType(mediaType)
	if err != nil {
		return err
	}
	raw, err := wireDecodeBase64("transport", transportBase64, false)
	if err != nil {
		return err
	}
	var transport waMediaTransport.WAMediaTransport_Integral
	if err := proto.Unmarshal(raw, &transport); err != nil {
		return fmt.Errorf("invalid WAMediaTransport_Integral protobuf: %w", err)
	}
	return a.wireDownloadToFile(destinationPath, func(f whatsmeow.File) error {
		return cli.DownloadFBToFile(a.wireCtx(), &transport, mt, f)
	})
}

// WireDownloadMediaWithPathToFile binds Client.DownloadMediaWithPathToFile with
// all encryption fields supplied as base64 strings. Empty hash/key fields decode
// to nil slices, which is required by the allowNoHash path.
func (a *Api) WireDownloadMediaWithPathToFile(directPath, encFileHashBase64, fileHashBase64, mediaKeyBase64, mediaType, mmsType string, allowNoHash bool, destinationPath string) error {
	cli, err := a.wireClient()
	if err != nil {
		return err
	}
	if strings.TrimSpace(directPath) == "" {
		return errors.New("direct path must not be empty")
	}
	mt, err := wireParseMediaType(mediaType)
	if err != nil {
		return err
	}
	encHash, err := wireDecodeBase64("encFileHash", encFileHashBase64, true)
	if err != nil {
		return err
	}
	fileHash, err := wireDecodeBase64("fileHash", fileHashBase64, true)
	if err != nil {
		return err
	}
	mediaKey, err := wireDecodeBase64("mediaKey", mediaKeyBase64, true)
	if err != nil {
		return err
	}
	return a.wireDownloadToFile(destinationPath, func(f whatsmeow.File) error {
		return cli.DownloadMediaWithPathToFile(a.wireCtx(), directPath, encHash, fileHash, mediaKey, mt, mmsType, allowNoHash, f)
	})
}

// wireStickerImage validates the image bytes and MIME shared by the sticker
// bindings. UploadSticker itself does not take a MIME: it is validated here and
// echoed in the DTO so the frontend can build the outgoing message correctly.
func wireStickerImage(imageBase64, mime string) ([]byte, string, error) {
	plaintext, err := wireDecodeBase64("image", imageBase64, false)
	if err != nil {
		return nil, "", err
	}
	mime = strings.TrimSpace(mime)
	if mime == "" {
		return nil, "", errors.New("mime must not be empty")
	}
	if !isImageMime(mime) {
		return nil, "", fmt.Errorf("unsupported sticker mime %q", mime)
	}
	return plaintext, mime, nil
}

// WireUploadSticker binds Client.UploadSticker. imageBase64 is the image bytes;
// mime is validated and returned in the DTO (the library uses image keys and
// the sticker MMS path, not a MIME argument).
func (a *Api) WireUploadSticker(imageBase64, mime string) (WireMediaUploadResult, error) {
	var out WireMediaUploadResult
	cli, err := a.wireClient()
	if err != nil {
		return out, err
	}
	plaintext, mime, err := wireStickerImage(imageBase64, mime)
	if err != nil {
		return out, err
	}
	resp, err := cli.UploadSticker(a.wireCtx(), plaintext)
	if err != nil {
		return out, err
	}
	return wireUploadResult(resp, mime), nil
}

// WireUploadStickerPackThumbnail binds Client.UploadStickerPackThumbnail.
// packMediaKeyBase64 must decode to the pack's 32-byte master media key.
func (a *Api) WireUploadStickerPackThumbnail(imageBase64, packMediaKeyBase64, mime string) (WireMediaUploadResult, error) {
	var out WireMediaUploadResult
	cli, err := a.wireClient()
	if err != nil {
		return out, err
	}
	plaintext, mime, err := wireStickerImage(imageBase64, mime)
	if err != nil {
		return out, err
	}
	packMediaKey, err := wireDecodeBase64("packMediaKey", packMediaKeyBase64, false)
	if err != nil {
		return out, err
	}
	if len(packMediaKey) != 32 {
		return out, fmt.Errorf("packMediaKey must contain 32 bytes, got %d", len(packMediaKey))
	}
	resp, err := cli.UploadStickerPackThumbnail(a.wireCtx(), plaintext, packMediaKey)
	if err != nil {
		return out, err
	}
	return wireUploadResult(resp, mime), nil
}

// WireUploadReader binds Client.UploadReader. The plaintext io.Reader is built
// from base64 bytes in Go. tempFile is intentionally nil: an io.ReadWriteSeeker
// cannot cross Wails IPC, and the library's documented nil path creates and
// removes its own temporary file, which is both safe and equivalent here.
func (a *Api) WireUploadReader(dataBase64, mediaType string) (WireMediaUploadResult, error) {
	var out WireMediaUploadResult
	cli, err := a.wireClient()
	if err != nil {
		return out, err
	}
	plaintext, err := wireDecodeBase64("data", dataBase64, false)
	if err != nil {
		return out, err
	}
	mt, err := wireParseMediaType(mediaType)
	if err != nil {
		return out, err
	}
	resp, err := cli.UploadReader(a.wireCtx(), bytes.NewReader(plaintext), nil, mt)
	if err != nil {
		return out, err
	}
	return wireUploadResult(resp, ""), nil
}

// WireUploadNewsletter binds Client.UploadNewsletter (unencrypted newsletter
// media). dataBase64 holds the plaintext bytes; mediaType is token-parsed.
func (a *Api) WireUploadNewsletter(dataBase64, mediaType string) (WireMediaUploadResult, error) {
	var out WireMediaUploadResult
	cli, err := a.wireClient()
	if err != nil {
		return out, err
	}
	data, err := wireDecodeBase64("data", dataBase64, false)
	if err != nil {
		return out, err
	}
	mt, err := wireParseMediaType(mediaType)
	if err != nil {
		return out, err
	}
	resp, err := cli.UploadNewsletter(a.wireCtx(), data, mt)
	if err != nil {
		return out, err
	}
	return wireUploadResult(resp, ""), nil
}

// WireUploadNewsletterReader binds Client.UploadNewsletterReader. The required
// io.ReadSeeker is a *bytes.Reader built from base64 bytes; no temp file is
// needed for the newsletter (unencrypted) path.
func (a *Api) WireUploadNewsletterReader(dataBase64, mediaType string) (WireMediaUploadResult, error) {
	var out WireMediaUploadResult
	cli, err := a.wireClient()
	if err != nil {
		return out, err
	}
	data, err := wireDecodeBase64("data", dataBase64, false)
	if err != nil {
		return out, err
	}
	mt, err := wireParseMediaType(mediaType)
	if err != nil {
		return out, err
	}
	resp, err := cli.UploadNewsletterReader(a.wireCtx(), bytes.NewReader(data), mt)
	if err != nil {
		return out, err
	}
	return wireUploadResult(resp, ""), nil
}

// WireSendMediaRetryReceipt binds Client.SendMediaRetryReceipt. The real
// *types.MessageInfo is loaded from a.messageStore by JID + message ID (never
// synthesized from IPC fields); a missing message is a hard error. IsGroup is
// derived from the parsed chat JID because the store does not persist it and
// the client needs it to include the participant attribute for group retries.
func (a *Api) WireSendMediaRetryReceipt(chatJID, messageID, mediaKeyBase64 string) error {
	cli, err := a.wireClient()
	if err != nil {
		return err
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return fmt.Errorf("invalid chat JID: %w", err)
	}
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return errors.New("message ID must not be empty")
	}
	if a.messageStore == nil {
		return errors.New("message store is not ready")
	}
	msg, err := a.messageStore.GetMessageWithMedia(chat.String(), messageID)
	// The store error may embed a raw JID, so never wrap or propagate it.
	if err != nil || msg == nil {
		return errors.New("media retry: message not found")
	}
	mediaKey, err := wireDecodeBase64("mediaKey", mediaKeyBase64, false)
	if err != nil {
		return err
	}
	if len(mediaKey) != 32 {
		return fmt.Errorf("mediaKey must contain 32 bytes, got %d", len(mediaKey))
	}
	info := msg.Info
	info.IsGroup = chat.Server == types.GroupServer || chat.IsBroadcastList()
	return cli.SendMediaRetryReceipt(a.wireCtx(), &info, mediaKey)
}

// wireMarshalPeerRequest serializes a built peer-data-operation message so a
// protobuf pointer never crosses IPC, and optionally sends it with the real
// Client.SendPeerMessage (the library documents these requests as sendable via
// that method). send=false keeps the binding a pure Build call.
func wireMarshalPeerRequest(cli *whatsmeow.Client, ctx context.Context, msg *waE2E.Message, send bool) (string, error) {
	raw, err := proto.Marshal(msg)
	if err != nil {
		return "", fmt.Errorf("failed to serialize peer request: %w", err)
	}
	if send {
		if _, err := cli.SendPeerMessage(ctx, msg); err != nil {
			return "", err
		}
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// WireBuildStickerReuploadRequest binds Client.BuildStickerReuploadRequest.
// hashBase64s holds one or more base64-encoded 32-byte sticker SHA-256 hashes.
// The returned string is the base64-serialized waE2E.Message request; with
// send=true it is also delivered via SendPeerMessage.
func (a *Api) WireBuildStickerReuploadRequest(hashBase64s []string, send bool) (string, error) {
	cli, err := a.wireClient()
	if err != nil {
		return "", err
	}
	if len(hashBase64s) == 0 {
		return "", errors.New("at least one sticker hash is required")
	}
	hashes := make([][]byte, 0, len(hashBase64s))
	for i, encoded := range hashBase64s {
		hash, err := wireDecodeBase64(fmt.Sprintf("stickerHash[%d]", i), encoded, false)
		if err != nil {
			return "", err
		}
		if len(hash) != 32 {
			return "", fmt.Errorf("stickerHash[%d] must contain 32 bytes, got %d", i, len(hash))
		}
		hashes = append(hashes, hash)
	}
	msg, err := cli.BuildStickerReuploadRequest(hashes)
	if err != nil {
		return "", err
	}
	return wireMarshalPeerRequest(cli, a.wireCtx(), msg, send)
}

// WireBuildRecentStickerBootstrapRequest binds
// Client.BuildRecentStickerBootstrapRequest. It takes no complex input; the
// built waE2E.Message is returned as base64 and optionally sent as a peer
// message (the primary device must be online to answer).
func (a *Api) WireBuildRecentStickerBootstrapRequest(send bool) (string, error) {
	cli, err := a.wireClient()
	if err != nil {
		return "", err
	}
	msg := cli.BuildRecentStickerBootstrapRequest()
	return wireMarshalPeerRequest(cli, a.wireCtx(), msg, send)
}
