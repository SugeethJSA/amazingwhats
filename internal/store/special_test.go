package store

import (
	"strings"
	"testing"
	"time"

	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
	"google.golang.org/protobuf/proto"
)

func TestDescribeSpecialMessagePoll(t *testing.T) {
	msg := &waE2E.Message{
		PollCreationMessageV3: &waE2E.PollCreationMessage{
			Name: proto.String("Lunch <spot>?"),
			Options: []*waE2E.PollCreationMessage_Option{
				{OptionName: proto.String("Pizza")},
				{OptionName: proto.String("Sushi & more")},
			},
		},
	}
	out, ok := DescribeSpecialMessage(msg)
	if !ok {
		t.Fatal("poll not recognized")
	}
	for _, want := range []string{"Lunch &lt;spot&gt;?", "Pizza", "Sushi &amp; more", "msg-poll"} {
		if !strings.Contains(out, want) {
			t.Errorf("poll html missing %q in %q", want, out)
		}
	}
}

func TestDescribeSpecialMessageLocation(t *testing.T) {
	msg := &waE2E.Message{
		LocationMessage: &waE2E.LocationMessage{
			DegreesLatitude:  proto.Float64(12.9716),
			DegreesLongitude: proto.Float64(77.5946),
			Name:             proto.String("MG Road"),
		},
	}
	out, ok := DescribeSpecialMessage(msg)
	if !ok {
		t.Fatal("location not recognized")
	}
	if !strings.Contains(out, "google.com/maps") || !strings.Contains(out, "MG Road") {
		t.Errorf("location html wrong: %q", out)
	}
}

func TestDescribeSpecialMessageContactExtractsPhone(t *testing.T) {
	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: proto.String("Alice"),
			Vcard:       proto.String("BEGIN:VCARD\nVERSION:3.0\nFN:Alice\nTEL;type=CELL:+91 98765 43210\nEND:VCARD"),
		},
	}
	out, ok := DescribeSpecialMessage(msg)
	if !ok {
		t.Fatal("contact not recognized")
	}
	if !strings.Contains(out, "Alice") || !strings.Contains(out, "+91 98765 43210") {
		t.Errorf("contact html wrong: %q", out)
	}
}

func TestDescribeSpecialMessageGroupInvite(t *testing.T) {
	msg := &waE2E.Message{
		GroupInviteMessage: &waE2E.GroupInviteMessage{
			GroupName:  proto.String("Linux Forum"),
			InviteCode: proto.String("AbC123"),
		},
	}
	out, ok := DescribeSpecialMessage(msg)
	if !ok {
		t.Fatal("invite not recognized")
	}
	if !strings.Contains(out, "chat.whatsapp.com/AbC123") || !strings.Contains(out, "Linux Forum") {
		t.Errorf("invite html wrong: %q", out)
	}
}

func TestDescribeSpecialMessageUnknownFallsThrough(t *testing.T) {
	if out, ok := DescribeSpecialMessage(&waE2E.Message{}); ok {
		t.Errorf("empty message should not be special, got %q", out)
	}
	if _, ok := DescribeSpecialMessage(nil); ok {
		t.Error("nil message should not be special")
	}
}

func TestSpecialPreview(t *testing.T) {
	poll := &waE2E.Message{
		PollCreationMessage: &waE2E.PollCreationMessage{Name: proto.String("Q")},
	}
	if p, ok := SpecialPreview(poll); !ok || p != "📊 Q" {
		t.Errorf("poll preview = %q ok=%v", p, ok)
	}
	ptv := &waE2E.Message{PtvMessage: &waE2E.VideoMessage{}}
	if p, ok := SpecialPreview(ptv); !ok || p != "🎥 Video note" {
		t.Errorf("ptv preview = %q ok=%v", p, ok)
	}
	if _, ok := SpecialPreview(&waE2E.Message{}); ok {
		t.Error("empty message should have no special preview")
	}
}

func TestShouldSkipMessage(t *testing.T) {
	cases := []struct {
		name string
		msg  *waE2E.Message
		want bool
	}{
		{"nil", nil, true},
		{"poll update", &waE2E.Message{PollUpdateMessage: &waE2E.PollUpdateMessage{}}, true},
		{"keep in chat", &waE2E.Message{KeepInChatMessage: &waE2E.KeepInChatMessage{}}, true},
		{"protocol", &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{}}, true},
		{"plain text", &waE2E.Message{Conversation: proto.String("hi")}, false},
		{"poll creation", &waE2E.Message{
			PollCreationMessage: &waE2E.PollCreationMessage{Name: proto.String("Q")},
		}, false},
	}
	for _, tc := range cases {
		if got := ShouldSkipMessage(tc.msg); got != tc.want {
			t.Errorf("%s: ShouldSkipMessage = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestPollCreationVariants(t *testing.T) {
	poll := &waE2E.PollCreationMessage{
		Name: proto.String("Which distro?"),
		Options: []*waE2E.PollCreationMessage_Option{
			{OptionName: proto.String("Arch")},
		},
	}
	cases := []struct {
		name string
		msg  *waE2E.Message
	}{
		{"v1", &waE2E.Message{PollCreationMessage: poll}},
		{"v2", &waE2E.Message{PollCreationMessageV2: poll}},
		{"v3", &waE2E.Message{PollCreationMessageV3: poll}},
		{"v4 wrapping v1", &waE2E.Message{PollCreationMessageV4: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{PollCreationMessage: poll},
		}}},
		{"v4 wrapping v5", &waE2E.Message{PollCreationMessageV4: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{PollCreationMessageV5: poll},
		}}},
		{"v5", &waE2E.Message{PollCreationMessageV5: poll}},
		{"v6", &waE2E.Message{PollCreationMessageV6: poll}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := PollCreation(tc.msg)
			if got == nil || got.GetName() != "Which distro?" {
				t.Fatalf("PollCreation = %v, want poll %q", got, "Which distro?")
			}
			desc, ok := DescribeSpecialMessage(tc.msg)
			if !ok || !strings.Contains(desc, "Which distro?") || !strings.Contains(desc, "Arch") {
				t.Errorf("description = %q, ok=%v", desc, ok)
			}
			preview, ok := SpecialPreview(tc.msg)
			if !ok || preview != "📊 Which distro?" {
				t.Errorf("preview = %q, ok=%v", preview, ok)
			}
		})
	}
}

func TestDescribeSpecialMessageCommonMissingTypes(t *testing.T) {
	cases := []struct {
		name        string
		msg         *waE2E.Message
		wantDesc    string
		wantPreview string
	}{
		{
			name: "interactive body text",
			msg: &waE2E.Message{InteractiveMessage: &waE2E.InteractiveMessage{
				Body: &waE2E.InteractiveMessage_Body{Text: proto.String("Pick an option <b>now</b>")},
			}},
			wantDesc:    "Pick an option &lt;b&gt;now&lt;/b&gt;",
			wantPreview: "Pick an option &lt;b&gt;now&lt;/b&gt;",
		},
		{
			name: "interactive response body text",
			msg: &waE2E.Message{InteractiveResponseMessage: &waE2E.InteractiveResponseMessage{
				Body: &waE2E.InteractiveResponseMessage_Body{Text: proto.String("Flow done")},
			}},
			wantDesc:    "Flow done",
			wantPreview: "Flow done",
		},
		{
			name: "list response",
			msg: &waE2E.Message{ListResponseMessage: &waE2E.ListResponseMessage{
				Title: proto.String("Pizza"),
			}},
			wantDesc:    "Pizza",
			wantPreview: "Pizza",
		},
		{
			name: "list response selection fallback",
			msg: &waE2E.Message{ListResponseMessage: &waE2E.ListResponseMessage{
				SingleSelectReply: &waE2E.ListResponseMessage_SingleSelectReply{
					SelectedRowID: proto.String("row-2"),
				},
			}},
			wantDesc:    "row-2",
			wantPreview: "row-2",
		},
		{
			name: "buttons response",
			msg: &waE2E.Message{ButtonsResponseMessage: &waE2E.ButtonsResponseMessage{
				Response: &waE2E.ButtonsResponseMessage_SelectedDisplayText{SelectedDisplayText: "Yes"},
			}},
			wantDesc:    "Yes",
			wantPreview: "Yes",
		},
		{
			name: "template button reply",
			msg: &waE2E.Message{TemplateButtonReplyMessage: &waE2E.TemplateButtonReplyMessage{
				SelectedDisplayText: proto.String("Confirm"),
			}},
			wantDesc:    "Confirm",
			wantPreview: "Confirm",
		},
		{
			name: "album with counts",
			msg: &waE2E.Message{AlbumMessage: &waE2E.AlbumMessage{
				ExpectedImageCount: proto.Uint32(2),
				ExpectedVideoCount: proto.Uint32(1),
			}},
			wantDesc:    "3 items",
			wantPreview: "3 items",
		},
		{
			name:        "album without counts",
			msg:         &waE2E.Message{AlbumMessage: &waE2E.AlbumMessage{}},
			wantDesc:    "Album",
			wantPreview: "Album",
		},
		{
			name:        "placeholder",
			msg:         &waE2E.Message{PlaceholderMessage: &waE2E.PlaceholderMessage{}},
			wantDesc:    "Placeholder",
			wantPreview: "Placeholder",
		},
		{
			name: "call log",
			msg: &waE2E.Message{CallLogMesssage: &waE2E.CallLogMessage{
				IsVideo:      proto.Bool(true),
				DurationSecs: proto.Int64(42),
			}},
			wantDesc:    "Video call log · 42s",
			wantPreview: "Video call log · 42s",
		},
		{
			name: "product snapshot",
			msg: &waE2E.Message{ProductMessage: &waE2E.ProductMessage{
				Product: &waE2E.ProductMessage_ProductSnapshot{Title: proto.String("Linux mug")},
			}},
			wantDesc:    "Linux mug",
			wantPreview: "Linux mug",
		},
		{
			name: "spoiler wrapping text",
			msg: &waE2E.Message{SpoilerMessage: &waE2E.FutureProofMessage{
				Message: &waE2E.Message{Conversation: proto.String("hidden text")},
			}},
			wantDesc:    "hidden text",
			wantPreview: "hidden text",
		},
		{
			name: "spoiler wrapping poll",
			msg: &waE2E.Message{SpoilerMessage: &waE2E.FutureProofMessage{
				Message: &waE2E.Message{PollCreationMessageV6: &waE2E.PollCreationMessage{
					Name: proto.String("Hidden poll"),
				}},
			}},
			wantDesc:    "Hidden poll",
			wantPreview: "Hidden poll",
		},
		{
			name:        "cancel payment request",
			msg:         &waE2E.Message{CancelPaymentRequestMessage: &waE2E.CancelPaymentRequestMessage{}},
			wantDesc:    "Payment request canceled",
			wantPreview: "Payment request canceled",
		},
		{
			name:        "payment invite",
			msg:         &waE2E.Message{PaymentInviteMessage: &waE2E.PaymentInviteMessage{}},
			wantDesc:    "Payment invite",
			wantPreview: "Payment invite",
		},
		{
			name:        "invoice note",
			msg:         &waE2E.Message{InvoiceMessage: &waE2E.InvoiceMessage{Note: proto.String("Invoice #12")}},
			wantDesc:    "Invoice #12",
			wantPreview: "Invoice #12",
		},
		{
			name:        "payment reminder",
			msg:         &waE2E.Message{PaymentReminderMessage: &waE2E.PaymentReminderMessage{Description: proto.String("Rent")}},
			wantDesc:    "Rent",
			wantPreview: "Rent",
		},
		{
			name:        "split payment",
			msg:         &waE2E.Message{SplitPaymentMessage: &waE2E.SplitPaymentMessage{Description: proto.String("Dinner")}},
			wantDesc:    "Dinner",
			wantPreview: "Dinner",
		},
		{
			name:        "split payment update",
			msg:         &waE2E.Message{SplitPaymentUpdateMessage: &waE2E.SplitPaymentUpdateMessage{}},
			wantDesc:    "Split payment updated",
			wantPreview: "Split payment updated",
		},
		{
			name:        "empty list message",
			msg:         &waE2E.Message{ListMessage: &waE2E.ListMessage{}},
			wantDesc:    "📋 List",
			wantPreview: "📋 List",
		},
		{
			name:        "template without hydrated text",
			msg:         &waE2E.Message{TemplateMessage: &waE2E.TemplateMessage{}},
			wantDesc:    "Template message",
			wantPreview: "Template message",
		},
		{
			name: "buttons with whitespace-only content",
			msg: &waE2E.Message{ButtonsMessage: &waE2E.ButtonsMessage{
				ContentText: proto.String("   "),
			}},
			wantDesc:    "Buttons",
			wantPreview: "Buttons",
		},
		{
			name: "template with whitespace-only hydrated text",
			msg: &waE2E.Message{TemplateMessage: &waE2E.TemplateMessage{
				HydratedTemplate: &waE2E.TemplateMessage_HydratedFourRowTemplate{
					HydratedContentText: proto.String("   "),
				},
			}},
			wantDesc:    "Template message",
			wantPreview: "Template message",
		},
		{
			name:        "unhandled kind uses neutral fallback",
			msg:         &waE2E.Message{MusicMessage: &waE2E.MusicMessage{}},
			wantDesc:    "Unsupported message kind",
			wantPreview: "Unsupported message kind",
		},
		{
			name:        "another unhandled kind uses neutral fallback",
			msg:         &waE2E.Message{StickerPackMessage: &waE2E.StickerPackMessage{}},
			wantDesc:    "Unsupported message kind",
			wantPreview: "Unsupported message kind",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			desc, ok := DescribeSpecialMessage(tc.msg)
			if !ok || desc == "" {
				t.Fatalf("DescribeSpecialMessage = %q, ok=%v; want non-empty description", desc, ok)
			}
			if !strings.Contains(desc, tc.wantDesc) {
				t.Errorf("description %q does not contain %q", desc, tc.wantDesc)
			}
			preview, ok := SpecialPreview(tc.msg)
			if !ok || preview == "" {
				t.Fatalf("SpecialPreview = %q, ok=%v; want non-empty preview", preview, ok)
			}
			if !strings.Contains(preview, tc.wantPreview) {
				t.Errorf("preview %q does not contain %q", preview, tc.wantPreview)
			}
		})
	}
}

func TestDescribeSpecialMessageSkipsTextAndMedia(t *testing.T) {
	cases := []struct {
		name string
		msg  *waE2E.Message
	}{
		{"conversation", &waE2E.Message{Conversation: proto.String("hello")}},
		{"extended text", &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("hello")}}},
		{"image", &waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}},
		{"video", &waE2E.Message{VideoMessage: &waE2E.VideoMessage{}}},
		{"audio", &waE2E.Message{AudioMessage: &waE2E.AudioMessage{}}},
		{"document", &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{}}},
		{"sticker", &waE2E.Message{StickerMessage: &waE2E.StickerMessage{}}},
	}
	for _, tc := range cases {
		if out, ok := DescribeSpecialMessage(tc.msg); ok {
			t.Errorf("%s: unexpectedly described as special: %q", tc.name, out)
		}
		if out, ok := SpecialPreview(tc.msg); ok {
			t.Errorf("%s: unexpectedly has special preview: %q", tc.name, out)
		}
	}
	// PTV has an intentional chat-list preview, but it is still media and must
	// not be described as a special bubble by DescribeSpecialMessage.
	if out, ok := DescribeSpecialMessage(&waE2E.Message{PtvMessage: &waE2E.VideoMessage{}}); ok {
		t.Errorf("ptv: unexpectedly described as special: %q", out)
	}
}

func TestShouldSkipMessageProtocolEnvelopes(t *testing.T) {
	cases := []struct {
		name string
		msg  *waE2E.Message
		want bool
	}{
		{"sender key distribution", &waE2E.Message{SenderKeyDistributionMessage: &waE2E.SenderKeyDistributionMessage{}}, true},
		{"fast ratchet sender key distribution", &waE2E.Message{FastRatchetKeySenderKeyDistributionMessage: &waE2E.SenderKeyDistributionMessage{}}, true},
		{"chat", &waE2E.Message{Chat: &waE2E.Chat{}}, true},
		{"call", &waE2E.Message{Call: &waE2E.Call{}}, true},
		{"enc reaction", &waE2E.Message{EncReactionMessage: &waE2E.EncReactionMessage{}}, true},
		{"enc comment", &waE2E.Message{EncCommentMessage: &waE2E.EncCommentMessage{}}, true},
		{"sticker sync", &waE2E.Message{StickerSyncRmrMessage: &waE2E.StickerSyncRMRMessage{}}, true},
		{"group root key share", &waE2E.Message{GroupRootKeyShare: &waE2E.GroupRootKeyShare{}}, true},
		{"root secret distribute", &waE2E.Message{RootSecretDistributeMessage: &waE2E.RootSecretDistributeMessage{}}, true},
		{"history bundle", &waE2E.Message{MessageHistoryBundle: &waE2E.MessageHistoryBundle{}}, true},
		{"history notice", &waE2E.Message{MessageHistoryNotice: &waE2E.MessageHistoryNotice{}}, true},
		{"call log is user visible", &waE2E.Message{CallLogMesssage: &waE2E.CallLogMessage{}}, false},
		{"interactive is user visible", &waE2E.Message{InteractiveMessage: &waE2E.InteractiveMessage{}}, false},
		{"album is user visible", &waE2E.Message{AlbumMessage: &waE2E.AlbumMessage{}}, false},
		{"spoiler is user visible", &waE2E.Message{SpoilerMessage: &waE2E.FutureProofMessage{}}, false},
		{"poll v4 is user visible", &waE2E.Message{PollCreationMessageV4: &waE2E.FutureProofMessage{}}, false},
		{"pin in chat handled by caller", &waE2E.Message{PinInChatMessage: &waE2E.PinInChatMessage{}}, false},
		{"reaction handled by caller", &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{}}, false},
		{"comment carries content", &waE2E.Message{CommentMessage: &waE2E.CommentMessage{}}, false},
	}
	for _, tc := range cases {
		if got := ShouldSkipMessage(tc.msg); got != tc.want {
			t.Errorf("%s: ShouldSkipMessage = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestInsertMessageStoresNeutralTextForUnhandledKind(t *testing.T) {
	ms := newTestMessageStore(t)
	info := &types.MessageInfo{
		ID: "unhandled-1",
		MessageSource: types.MessageSource{
			Chat:   types.JID{User: "123", Server: "s.whatsapp.net"},
			Sender: types.JID{User: "456", Server: "s.whatsapp.net"},
		},
		Timestamp: time.Unix(1_700_000_000, 0),
	}
	msg := &waE2E.Message{MusicMessage: &waE2E.MusicMessage{}}
	if err := ms.InsertMessage(info, msg, ""); err != nil {
		t.Fatal(err)
	}
	stored, err := ms.GetMessageWithMedia(info.Chat.String(), info.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Text == "" {
		t.Fatal("stored text is empty; UI would show Unsupported Message Type")
	}
	if !strings.Contains(stored.Text, "Unsupported message kind") {
		t.Errorf("stored text = %q, want neutral fallback", stored.Text)
	}
}
