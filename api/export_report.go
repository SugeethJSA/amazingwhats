package api

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/lugvitc/amazingwhats/internal/markdown"
	"github.com/lugvitc/amazingwhats/internal/store"
	mtypes "github.com/lugvitc/amazingwhats/internal/types"
	"github.com/polymorfa/hypermeow/types"
)

// maxExportMessages bounds a single local-history read so a pathological chat
// cannot make one UI call unbounded. The returned transcript explicitly says
// when this cap was reached; it is never presented as a complete cloud export.
const maxExportMessages = 10000

// maxUnix sorts rows with an unparseable timestamp last without dropping them.
const maxUnix = int64(1<<63 - 1)

// ErrReportChatUnavailable is returned by ReportChat for every input.
//
// Evidence, checked directly against the pinned HyperMeow source
// (v0.0.0-20261121205317-6e3f26d9b53f, 239 Go files):
//   - internals.go:36-44 exposes only generic SendIQ / SendNodeAndGetData and
//     the infoQuery aliases. There is no exported ReportChat (or ExportChat),
//     and no report/export IQ builder anywhere in the module.
//   - reportingtoken.go:49-69 builds a <reporting><reporting_token> node that
//     is ATTACHED TO OUTGOING MESSAGES as message metadata (send.go:870-871,
//     935-936). It has no target chat and no reason: it is not a report action.
//   - proto/waReporting/WAWebProtobufsReporting.pb.go models reportability
//     configuration fields, not a request to report a chat.
//   - no module source, test, README or CHANGELOG contains an export/report
//     stanza shape.
//
// Guessing a stanza would be a fabricated protocol action. This binding
// therefore fails honestly and never returns a fake success.
var ErrReportChatUnavailable = errors.New(
	"report chat is not available: pinned HyperMeow has no report API and no verified stanza exists " +
		"(evidence: no ReportChat in pinned v0.0.0-20261121205317-6e3f26d9b53f; " +
		"reportingtoken.go only emits message-metadata <reporting_token>; " +
		"proto/waReporting only models reportability config; no export/report IQ in module source or docs)",
)

// ReportChat is intentionally not wired to the network. chatJID and reason are
// accepted only to keep the agreed binding signature stable for the frontend;
// neither can be turned into a real request without a verified protocol.
func (a *Api) ReportChat(chatJID string, reason string) error {
	_ = chatJID
	_ = reason
	return ErrReportChatUnavailable
}

// ExportChat exports the app's LOCAL chat history for chatJID as a plain-text
// transcript built exclusively from rows in this app's own message store.
//
// This IS NOT WhatsApp's cloud "Export chat": no request is sent to WhatsApp,
// no media files are downloaded, and no messages are invented. The returned
// text says so in its header. Messages that were never synced to this device
// cannot appear in the result.
func (a *Api) ExportChat(chatJID string) (string, error) {
	if a == nil {
		return "", errors.New("api is not initialised; cannot export chat history")
	}
	if _, err := types.ParseJID(chatJID); err != nil {
		return "", fmt.Errorf("invalid chat JID: %w", err)
	}
	if a.messageStore == nil {
		return "", errors.New("local message store is not available; cannot export chat history")
	}
	messages, truncated, err := a.localHistory(chatJID)
	if err != nil {
		return "", fmt.Errorf("read local chat history: %w", err)
	}
	return buildLocalTranscript(chatJID, messages, truncated), nil
}

// localHistory pages through every locally stored row for chatJID using the
// same read API as the chat screen (GetDecodedMessagesPaged). Each page is
// oldest-first and the compound cursor is the page's oldest row, matching the
// store's SelectMessagesByChatBeforeCursor query. No network is involved.
func (a *Api) localHistory(chatJID string) ([]store.DecodedMessage, bool, error) {
	all := make([]store.DecodedMessage, 0, maxPageSize)
	seen := make(map[string]struct{})
	var beforeTS int64
	var beforeID string

	for {
		page, err := a.messageStore.GetDecodedMessagesPaged(chatJID, beforeTS, beforeID, maxPageSize)
		if err != nil {
			return nil, false, err
		}
		if len(page) == 0 {
			return all, false, nil
		}
		for _, msg := range page {
			if _, duplicate := seen[msg.Info.ID]; duplicate {
				continue
			}
			seen[msg.Info.ID] = struct{}{}
			all = append(all, msg)
		}
		if len(all) >= maxExportMessages {
			// A full page means more rows may exist beyond the cap.
			truncated := len(page) == maxPageSize
			if len(all) > maxExportMessages {
				all = all[:maxExportMessages]
			}
			return all, truncated, nil
		}
		if len(page) < maxPageSize {
			return all, false, nil
		}
		oldest := page[0]
		ts, ok := transcriptUnixSec(oldest.Info.Timestamp)
		if !ok || (ts == beforeTS && oldest.Info.ID == beforeID) {
			// Cursor cannot advance: stop instead of looping forever.
			return all, true, nil
		}
		beforeTS, beforeID = ts, oldest.Info.ID
	}
}

// transcriptUnixSec parses the store's RFC3339 timestamp for cursor math and
// chronological sorting. The original string is always kept in the output.
func transcriptUnixSec(value string) (int64, bool) {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return 0, false
	}
	return parsed.Unix(), true
}

// buildLocalTranscript renders real decoded rows only. It is a pure function
// so the transcript can be unit-tested without a database or a client.
func buildLocalTranscript(chatJID string, messages []store.DecodedMessage, truncated bool) string {
	type row struct {
		msg  store.DecodedMessage
		unix int64
	}
	rows := make([]row, 0, len(messages))
	for _, msg := range messages {
		unix, ok := transcriptUnixSec(msg.Info.Timestamp)
		if !ok {
			unix = maxUnix // keep the real row, sort it last
		}
		rows = append(rows, row{msg: msg, unix: unix})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].unix != rows[j].unix {
			return rows[i].unix < rows[j].unix
		}
		return rows[i].msg.Info.ID < rows[j].msg.Info.ID
	})

	var out strings.Builder
	out.WriteString("# Local chat history export (NOT WhatsApp's cloud \"Export chat\").\n")
	out.WriteString("# Source: this app's own locally stored messages only; no network request was made.\n")
	fmt.Fprintf(&out, "# Chat: %s\n", chatJID)
	fmt.Fprintf(&out, "# Generated (UTC): %s\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintf(&out, "# Local rows: %d (oldest first)\n", len(rows))
	fmt.Fprintf(&out, "# Cap: %d local rows; truncated: %t\n", maxExportMessages, truncated)
	out.WriteString("# Message text is plain text; embedded newlines are escaped as \\n.\n")
	out.WriteString("# --- transcript begins ---\n")
	for _, r := range rows {
		out.WriteString(formatTranscriptRow(r.msg))
		out.WriteByte('\n')
	}
	out.WriteString("# --- transcript ends ---\n")
	return out.String()
}

func formatTranscriptRow(msg store.DecodedMessage) string {
	sender := msg.Info.Sender
	if msg.Info.IsFromMe {
		if sender == "" {
			sender = "You"
		} else {
			sender = "You (" + sender + ")"
		}
	}
	var line strings.Builder
	fmt.Fprintf(&line, "[%s] %s [id=%s]", msg.Info.Timestamp, sender, msg.Info.ID)
	if marker := transcriptMediaMarker(msg); marker != "" {
		line.WriteByte(' ')
		line.WriteString(marker)
	}
	if text := transcriptText(msg); text != "" {
		line.WriteString(": ")
		line.WriteString(strings.ReplaceAll(text, "\n", "\\n"))
	}
	return line.String()
}

// transcriptText strips the HTML the store keeps for rendered text and uses
// only fields present on the row. Missing text stays empty; nothing is filled
// in on the caller's behalf.
func transcriptText(msg store.DecodedMessage) string {
	content := msg.Content
	if content == nil {
		return ""
	}
	var text string
	switch {
	case content.Conversation != "":
		text = content.Conversation
	case content.ExtendedTextMessage != nil:
		text = content.ExtendedTextMessage.Text
	case content.ImageMessage != nil:
		text = content.ImageMessage.Caption
	case content.VideoMessage != nil:
		text = content.VideoMessage.Caption
	case content.DocumentMessage != nil:
		text = content.DocumentMessage.Caption
		if text == "" {
			text = content.DocumentMessage.FileName
		}
	case content.StickerMessage != nil:
		text = content.StickerMessage.Caption
	}
	return markdown.StripHTML(text)
}

func transcriptMediaMarker(msg store.DecodedMessage) string {
	switch msg.Type {
	case mtypes.MediaTypeImage:
		return "[image]"
	case mtypes.MediaTypeVideo:
		if c := msg.Content; c != nil && c.VideoMessage != nil && c.VideoMessage.GifPlayback {
			return "[gif]"
		}
		return "[video]"
	case mtypes.MediaTypeAudio:
		if c := msg.Content; c != nil && c.AudioMessage != nil && c.AudioMessage.PTT {
			return "[voice note]"
		}
		return "[audio]"
	case mtypes.MediaTypeDocument:
		return "[document]"
	case mtypes.MediaTypeSticker, mtypes.MediaTypeStickerMetadata, mtypes.MediaTypeStickerPack:
		return "[sticker]"
	case mtypes.MediaTypeHistorySync:
		return "[history sync]"
	case mtypes.MediaTypeAppState:
		return "[app state]"
	}
	// Fall back to decoded content when the media-type column is unset.
	if c := msg.Content; c != nil {
		switch {
		case c.ImageMessage != nil:
			return "[image]"
		case c.VideoMessage != nil:
			return "[video]"
		case c.AudioMessage != nil:
			return "[audio]"
		case c.DocumentMessage != nil:
			return "[document]"
		case c.StickerMessage != nil:
			return "[sticker]"
		}
	}
	return ""
}
