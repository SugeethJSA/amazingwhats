package api

import (
	"strings"
	"testing"

	"github.com/polymorfa/hypermeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestReplaceMentionAll(t *testing.T) {
	got := replaceMentionAll("hi @all!")
	want := `hi <span class="mention">@all</span>!`
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if got := replaceMentionAll("hi @alliance and support@all.com"); strings.Contains(got, "<span") {
		t.Fatalf("word-boundary violation: %q", got)
	}
}

func TestProcessMessageTextNonJIDMentionAll(t *testing.T) {
	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String("hello @all"),
			ContextInfo: &waE2E.ContextInfo{
				NonJIDMentions: proto.Uint32(nonJIDMentionAll),
			},
		},
	}
	got := (&Api{}).processMessageText(msg)
	if !strings.Contains(got, `<span class="mention">@all</span>`) {
		t.Fatalf("@all was not rendered as a mention: %q", got)
	}
}
