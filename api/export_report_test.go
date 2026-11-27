package api

import (
	"errors"
	"strings"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/store"
	mtypes "github.com/lugvitc/amazingwhats/internal/types"
)

func transcriptRow(id, timestamp, sender string, fromMe bool, media mtypes.MediaType, content *store.DecodedMessageContent) store.DecodedMessage {
	return store.DecodedMessage{
		Type: media,
		Info: store.DecodedMessageInfo{
			ID:        id,
			Timestamp: timestamp,
			Sender:    sender,
			IsFromMe:  fromMe,
		},
		Content: content,
	}
}

func plainContent(text string) *store.DecodedMessageContent {
	return &store.DecodedMessageContent{Conversation: text}
}

// An empty chat produces a clearly labelled empty transcript, never synthetic
// messages. All assertions are purely in-memory: no store, client or network.
func TestBuildLocalTranscriptEmptyChat(t *testing.T) {
	got := buildLocalTranscript("123@s.whatsapp.net", nil, false)
	for _, want := range []string{
		"Local chat history export",
		"NOT WhatsApp's cloud",
		"no network request was made",
		"Local rows: 0",
		"truncated: false",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("empty transcript missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "[id=") {
		t.Fatalf("empty transcript contains fabricated message rows:\n%s", got)
	}
	if !strings.Contains(got, "# --- transcript begins ---\n# --- transcript ends ---\n") {
		t.Fatalf("empty transcript has no empty transcript body:\n%s", got)
	}
}

func TestBuildLocalTranscriptUsesOnlyRealRowsChronologically(t *testing.T) {
	rows := []store.DecodedMessage{
		transcriptRow("newest", "2026-01-03T10:00:00Z", "b@s.whatsapp.net", false,
			mtypes.MediaTypeNone, plainContent("third <b>line</b> &amp; more")),
		transcriptRow("middle", "2026-01-02T10:00:00Z", "123@s.whatsapp.net", true,
			mtypes.MediaTypeImage, &store.DecodedMessageContent{
				ImageMessage: &store.MediaMessageContent{Caption: "a <i>photo</i>"},
			}),
		transcriptRow("oldest", "2026-01-01T10:00:00Z", "a@s.whatsapp.net", false,
			mtypes.MediaTypeAudio, &store.DecodedMessageContent{
				AudioMessage: &store.MediaMessageContent{PTT: true},
			}),
	}
	got := buildLocalTranscript("123@s.whatsapp.net", rows, false)

	if n := strings.Count(got, "[id="); n != 3 {
		t.Fatalf("got %d message rows, want exactly 3:\n%s", n, got)
	}
	iOld, iMid, iNew := strings.Index(got, "[id=oldest]"), strings.Index(got, "[id=middle]"), strings.Index(got, "[id=newest]")
	if iOld < 0 || iMid < 0 || iNew < 0 {
		t.Fatalf("a real row ID is missing:\n%s", got)
	}
	if !(iOld < iMid && iMid < iNew) {
		t.Fatalf("rows are not chronological (oldest, middle, newest at %d, %d, %d):\n%s", iOld, iMid, iNew, got)
	}

	// Stored text is rendered HTML; the transcript must show real plain text.
	if !strings.Contains(got, "third line & more") || strings.Contains(got, "<b>") {
		t.Fatalf("HTML was not stripped from a real row:\n%s", got)
	}
	if !strings.Contains(got, "a photo") || strings.Contains(got, "<i>") {
		t.Fatalf("media caption was not stripped from a real row:\n%s", got)
	}
	if !strings.Contains(got, "[image]") || !strings.Contains(got, "[voice note]") {
		t.Fatalf("media markers missing:\n%s", got)
	}
	if !strings.Contains(got, "You (123@s.whatsapp.net)") {
		t.Fatalf("own message not labelled with its real sender JID:\n%s", got)
	}
	if strings.Contains(got, "FAKE") || strings.Contains(got, "Lorem") {
		t.Fatalf("transcript contains invented content:\n%s", got)
	}
}

func TestBuildLocalTranscriptMediaMarkers(t *testing.T) {
	tests := []struct {
		name    string
		media   mtypes.MediaType
		content *store.DecodedMessageContent
		want    string
	}{
		{"image", mtypes.MediaTypeImage, &store.DecodedMessageContent{ImageMessage: &store.MediaMessageContent{}}, "[image]"},
		{"video", mtypes.MediaTypeVideo, &store.DecodedMessageContent{VideoMessage: &store.MediaMessageContent{}}, "[video]"},
		{"gif", mtypes.MediaTypeVideo, &store.DecodedMessageContent{VideoMessage: &store.MediaMessageContent{GifPlayback: true}}, "[gif]"},
		{"audio", mtypes.MediaTypeAudio, &store.DecodedMessageContent{AudioMessage: &store.MediaMessageContent{}}, "[audio]"},
		{"document", mtypes.MediaTypeDocument, &store.DecodedMessageContent{DocumentMessage: &store.DocumentMessageContent{FileName: "notes.txt"}}, "[document]"},
		{"sticker", mtypes.MediaTypeSticker, &store.DecodedMessageContent{StickerMessage: &store.MediaMessageContent{}}, "[sticker]"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := buildLocalTranscript("123@s.whatsapp.net", []store.DecodedMessage{
				transcriptRow("m1", "2026-01-01T00:00:00Z", "a@s.whatsapp.net", false, tc.media, tc.content),
			}, false)
			if !strings.Contains(got, tc.want) {
				t.Fatalf("missing marker %q:\n%s", tc.want, got)
			}
			if tc.name == "document" && !strings.Contains(got, "notes.txt") {
				t.Fatalf("real document filename lost:\n%s", got)
			}
		})
	}

	textOnly := buildLocalTranscript("123@s.whatsapp.net", []store.DecodedMessage{
		transcriptRow("t1", "2026-01-01T00:00:00Z", "a@s.whatsapp.net", false, mtypes.MediaTypeNone, plainContent("hello")),
	}, false)
	if strings.Contains(textOnly, "[image]") || strings.Contains(textOnly, "[audio]") {
		t.Fatalf("text-only row got a fabricated media marker:\n%s", textOnly)
	}
}

func TestBuildLocalTranscriptDisclosesTruncation(t *testing.T) {
	got := buildLocalTranscript("123@s.whatsapp.net", nil, true)
	if !strings.Contains(got, "truncated: true") {
		t.Fatalf("truncation not disclosed:\n%s", got)
	}
}

// ReportChat must fail without touching a client, a database or the network:
// a zero-value Api is enough to prove there is no fake nil success.
func TestReportChatHonestFailure(t *testing.T) {
	err := (&Api{}).ReportChat("123@s.whatsapp.net", "spam")
	if err == nil {
		t.Fatal("ReportChat returned nil success without a report protocol")
	}
	if !errors.Is(err, ErrReportChatUnavailable) {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, want := range []string{"report chat is not available", "no report API", "no verified stanza"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error missing %q: %v", want, err)
		}
	}
}

// ExportChat guards run before any store or network access, so they are
// testable on a zero-value Api offline.
func TestExportChatGuardsWithoutStore(t *testing.T) {
	a := &Api{}
	if _, err := a.ExportChat("user:abc@s.whatsapp.net"); err == nil {
		t.Fatal("malformed JID accepted")
	}
	if _, err := a.ExportChat("123@s.whatsapp.net"); err == nil {
		t.Fatal("missing message store did not produce an error")
	}
}
