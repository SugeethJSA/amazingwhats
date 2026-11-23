package store

import (
	"fmt"
	"html"
	"regexp"
	"strings"
	"time"

	"github.com/polymorfa/hypermeow/proto/waE2E"
)

// vcardTelRE pulls the first phone number out of a vCard payload.
var vcardTelRE = regexp.MustCompile(`(?m)^TEL[^:]*:(.+)$`)

func esc(s string) string { return html.EscapeString(strings.TrimSpace(s)) }

func mapsLink(lat, lng float64, label string) string {
	if label == "" {
		label = "Open in Maps"
	}
	return fmt.Sprintf(
		`<a class="msg-link" href="https://www.google.com/maps?q=%f,%f">%s</a>`,
		lat, lng, esc(label),
	)
}

func contactCard(displayName, vcard string) string {
	var b strings.Builder
	b.WriteString(`<div class="msg-card">👤 <b>` + esc(displayName) + `</b>`)
	if m := vcardTelRE.FindStringSubmatch(vcard); m != nil {
		b.WriteString(`<br>` + esc(m[1]))
	}
	b.WriteString(`</div>`)
	return b.String()
}

// pollFromMessage checks the poll variants that carry a PollCreationMessage
// directly. V4 is handled separately because it wraps the payload in a
// FutureProofMessage.
func pollFromMessage(msg *waE2E.Message) *waE2E.PollCreationMessage {
	if msg == nil {
		return nil
	}
	if poll := msg.GetPollCreationMessage(); poll != nil {
		return poll
	}
	if poll := msg.GetPollCreationMessageV2(); poll != nil {
		return poll
	}
	if poll := msg.GetPollCreationMessageV3(); poll != nil {
		return poll
	}
	if poll := msg.GetPollCreationMessageV5(); poll != nil {
		return poll
	}
	return msg.GetPollCreationMessageV6()
}

// PollCreation returns the poll creation payload from any of its protobuf
// variants (V1–V6), or nil when msg is not a poll creation. V4 stores the
// PollCreationMessage inside a FutureProofMessage, so unwrap it explicitly.
func PollCreation(msg *waE2E.Message) *waE2E.PollCreationMessage {
	if poll := pollFromMessage(msg); poll != nil {
		return poll
	}
	if msg == nil {
		return nil
	}
	if v4 := msg.GetPollCreationMessageV4(); v4 != nil {
		return pollFromMessage(v4.GetMessage())
	}
	return nil
}

// RenderPollCard renders a poll card with per-option vote counts. The option
// lines keep their original `○ Name` shape so the frontend's existing option
// parser keeps working; vote totals are appended in a separate results block.
// myIndices marks the current user's selections, which are rendered with a
// "✓" prefix and the poll-mine class.
func RenderPollCard(question string, options []string, counts []int, myIndices []int) string {
	total := 0
	for _, c := range counts {
		total += c
	}
	mine := make(map[int]bool, len(myIndices))
	for _, i := range myIndices {
		mine[i] = true
	}

	var b strings.Builder
	b.WriteString(`<div class="msg-card msg-poll">📊 <b>` + esc(question) + `</b>`)
	for _, opt := range options {
		b.WriteString(`<div class="poll-opt">○ ` + esc(opt) + `</div>`)
	}
	if total > 0 {
		b.WriteString(`<div class="poll-results">`)
		for i, opt := range options {
			prefix := ""
			cls := "poll-result"
			if mine[i] {
				prefix = "✓ "
				cls = "poll-result poll-mine"
			}
			pct := 0
			if total > 0 {
				pct = counts[i] * 100 / total
			}
			b.WriteString(fmt.Sprintf(`<div class="%s">%s%s · %d vote%s (%d%%)</div>`,
				cls, prefix, esc(opt), counts[i], plural(counts[i]), pct))
		}
		b.WriteString(`</div>`)
	}
	note := "No votes yet"
	if total > 0 {
		note = fmt.Sprintf("%d vote%s", total, plural(total))
	}
	b.WriteString(`<div class="msg-card-note">` + note + `</div></div>`)
	return b.String()
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// pollOptRE matches the option lines of a rendered poll card.
var pollOptRE = regexp.MustCompile(`<div class="poll-opt">○ ([^<]+)</div>`)

// pollNameRE matches the question line of a rendered poll card.
var pollNameRE = regexp.MustCompile(`📊 <b>([^<]+)</b>`)

// ParsePollCardHTML extracts the question and option names from a previously
// rendered poll card (used as a fallback for polls that predate the polls
// metadata table).
func ParsePollCardHTML(s string) (string, []string) {
	question := ""
	if m := pollNameRE.FindStringSubmatch(s); m != nil {
		question = html.UnescapeString(m[1])
	}
	var options []string
	for _, m := range pollOptRE.FindAllStringSubmatch(s, -1) {
		options = append(options, html.UnescapeString(m[1]))
	}
	return question, options
}

// contentFieldsHandledElsewhere lists the Message fields that already yield a
// text body through extractMessageContent (or are plain text themselves).
// They must never be reported as "unsupported" just because a caption is
// empty: the media/text path renders those rows instead.
// Keys are protoreflect field names, which this proto declares in camelCase
// (e.g. "extendedTextMessage", not "extended_text_message").
var contentFieldsHandledElsewhere = map[string]bool{
	"conversation":        true,
	"extendedTextMessage": true,
	"imageMessage":        true,
	"videoMessage":        true,
	"audioMessage":        true,
	"documentMessage":     true,
	"stickerMessage":      true,
	"ptvMessage":          true,
}

// hasPopulatedContentField reports whether msg carries any populated field
// other than the text/media fields handled above. protobuf reflection is used
// deliberately: new waE2E message kinds are then covered automatically, so a
// future enum addition cannot reintroduce empty chat rows.
func hasPopulatedContentField(msg *waE2E.Message) bool {
	if msg == nil {
		return false
	}
	rm := msg.ProtoReflect()
	fields := rm.Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		if contentFieldsHandledElsewhere[string(fd.Name())] {
			continue
		}
		if rm.Has(fd) {
			return true
		}
	}
	return false
}

// simpleSpecialLabel returns a plain one-line label for user-visible message
// kinds that need no rich card. It is shared by the message bubble (which
// wraps the label in a card) and the chat-list preview so the two stay in sync.
func simpleSpecialLabel(msg *waE2E.Message) (string, bool) {
	switch {
	case msg.GetInteractiveMessage() != nil:
		if body := msg.GetInteractiveMessage().GetBody().GetText(); body != "" {
			return "💬 " + esc(body), true
		}
		return "💬 Interactive message", true

	case msg.GetInteractiveResponseMessage() != nil:
		if body := msg.GetInteractiveResponseMessage().GetBody().GetText(); body != "" {
			return "💬 " + esc(body), true
		}
		return "💬 Interactive reply", true

	case msg.GetListResponseMessage() != nil:
		lr := msg.GetListResponseMessage()
		label := lr.GetTitle()
		if label == "" {
			label = lr.GetSingleSelectReply().GetSelectedRowID()
		}
		if label == "" {
			label = "List selection"
		}
		return "📋 " + esc(label), true

	case msg.GetButtonsResponseMessage() != nil:
		br := msg.GetButtonsResponseMessage()
		label := br.GetSelectedDisplayText()
		if label == "" {
			label = br.GetSelectedButtonID()
		}
		if label == "" {
			label = "Button reply"
		}
		return "🔘 " + esc(label), true

	case msg.GetTemplateButtonReplyMessage() != nil:
		tr := msg.GetTemplateButtonReplyMessage()
		label := tr.GetSelectedDisplayText()
		if label == "" {
			label = tr.GetSelectedID()
		}
		if label == "" {
			label = "Template reply"
		}
		return "🔘 " + esc(label), true

	case msg.GetButtonsMessage() != nil:
		return "🔘 Buttons", true

	case msg.GetListMessage() != nil:
		return "📋 List", true

	case msg.GetTemplateMessage() != nil:
		return "💬 Template message", true

	case msg.GetAlbumMessage() != nil:
		album := msg.GetAlbumMessage()
		count := album.GetExpectedImageCount() + album.GetExpectedVideoCount()
		if count > 0 {
			return fmt.Sprintf("🖼️ Album (%d item%s)", count, plural(int(count))), true
		}
		return "🖼️ Album", true

	case msg.GetPlaceholderMessage() != nil:
		return "Placeholder", true

	case msg.GetCallLogMesssage() != nil:
		call := msg.GetCallLogMesssage()
		label := "Call log"
		if call.GetIsVideo() {
			label = "Video call log"
		}
		if secs := call.GetDurationSecs(); secs > 0 {
			label += fmt.Sprintf(" · %ds", secs)
		}
		return "📞 " + label, true

	case msg.GetProductMessage() != nil:
		product := msg.GetProductMessage()
		label := "Product"
		if snapshot := product.GetProduct(); snapshot != nil && snapshot.GetTitle() != "" {
			label = snapshot.GetTitle()
		} else if product.GetBody() != "" {
			label = product.GetBody()
		}
		return "📦 " + esc(label), true

	case msg.GetSpoilerMessage() != nil:
		// Spoilers wrap another message in a FutureProofMessage. whatsmeow
		// unwraps normal containers, but this one still needs a peek so the
		// row is not blank; never recurse into a nested spoiler.
		inner := msg.GetSpoilerMessage().GetMessage()
		if inner != nil && inner.GetSpoilerMessage() == nil {
			if text := ExtractMessageText(inner); text != "" && text != "message" {
				return "🙈 " + esc(text), true
			}
		}
		return "🙈 Spoiler", true

	case msg.GetCancelPaymentRequestMessage() != nil:
		return "💳 Payment request canceled", true
	case msg.GetPaymentInviteMessage() != nil:
		return "💳 Payment invite", true
	case msg.GetInvoiceMessage() != nil:
		if note := msg.GetInvoiceMessage().GetNote(); note != "" {
			return "🧾 Invoice: " + esc(note), true
		}
		return "🧾 Invoice", true
	case msg.GetPaymentReminderMessage() != nil:
		if desc := msg.GetPaymentReminderMessage().GetDescription(); desc != "" {
			return "💳 Payment reminder: " + esc(desc), true
		}
		return "💳 Payment reminder", true
	case msg.GetSplitPaymentMessage() != nil:
		if desc := msg.GetSplitPaymentMessage().GetDescription(); desc != "" {
			return "💳 Split payment: " + esc(desc), true
		}
		return "💳 Split payment", true
	case msg.GetSplitPaymentUpdateMessage() != nil:
		return "💳 Split payment updated", true

	case msg.GetRequestPhoneNumberMessage() != nil:
		return "📱 Phone number request", true
	case msg.GetPinInChatMessage() != nil:
		return "📌 Message pinned", true
	case msg.GetScheduledCallCreationMessage() != nil:
		return "📅 Scheduled call", true
	case msg.GetScheduledCallEditMessage() != nil:
		return "📅 Scheduled call updated", true
	}
	return "", false
}

// DescribeSpecialMessage renders message types that have no plain-text body
// (polls, locations, contacts, invites, events, business templates) as HTML
// for the message bubble. ok=false means the type isn't special-cased.
func DescribeSpecialMessage(msg *waE2E.Message) (string, bool) {
	if msg == nil {
		return "", false
	}

	poll := PollCreation(msg)

	switch {
	case poll != nil:
		options := make([]string, 0, len(poll.GetOptions()))
		for _, opt := range poll.GetOptions() {
			options = append(options, opt.GetOptionName())
		}
		return RenderPollCard(poll.GetName(), options, make([]int, len(options)), nil), true

	case msg.GetLocationMessage() != nil:
		loc := msg.GetLocationMessage()
		label := loc.GetName()
		if label == "" {
			label = loc.GetAddress()
		}
		if label == "" {
			label = "Location"
		}
		out := `<div class="msg-card">📍 ` +
			mapsLink(loc.GetDegreesLatitude(), loc.GetDegreesLongitude(), label)
		if loc.GetAddress() != "" && loc.GetAddress() != label {
			out += `<br><span class="msg-card-note">` + esc(loc.GetAddress()) + `</span>`
		}
		return out + `</div>`, true

	case msg.GetLiveLocationMessage() != nil:
		live := msg.GetLiveLocationMessage()
		out := `<div class="msg-card">📍 Live location · ` +
			mapsLink(live.GetDegreesLatitude(), live.GetDegreesLongitude(), "last position")
		if live.GetCaption() != "" {
			out += `<br>` + esc(live.GetCaption())
		}
		return out + `</div>`, true

	case msg.GetContactMessage() != nil:
		c := msg.GetContactMessage()
		return contactCard(c.GetDisplayName(), c.GetVcard()), true

	case msg.GetContactsArrayMessage() != nil:
		arr := msg.GetContactsArrayMessage()
		var b strings.Builder
		for _, c := range arr.GetContacts() {
			b.WriteString(contactCard(c.GetDisplayName(), c.GetVcard()))
		}
		if b.Len() == 0 {
			return `<div class="msg-card">👤 ` + esc(arr.GetDisplayName()) + `</div>`, true
		}
		return b.String(), true

	case msg.GetGroupInviteMessage() != nil:
		inv := msg.GetGroupInviteMessage()
		out := `<div class="msg-card">👥 Group invite: <b>` + esc(inv.GetGroupName()) + `</b>`
		if inv.GetInviteCode() != "" {
			out += `<br><a class="msg-link" href="https://chat.whatsapp.com/` +
				esc(inv.GetInviteCode()) + `">chat.whatsapp.com/` + esc(inv.GetInviteCode()) + `</a>`
		}
		if inv.GetCaption() != "" {
			out += `<br>` + esc(inv.GetCaption())
		}
		return out + `</div>`, true

	case msg.GetEventMessage() != nil:
		ev := msg.GetEventMessage()
		out := `<div class="msg-card">📅 <b>` + esc(ev.GetName()) + `</b>`
		if ev.GetIsCanceled() {
			out += ` <i>(canceled)</i>`
		}
		if ev.GetStartTime() > 0 {
			out += `<br>` + esc(time.Unix(ev.GetStartTime(), 0).Format("Mon, Jan 2 · 3:04 PM"))
		}
		if loc := ev.GetLocation(); loc != nil && loc.GetName() != "" {
			out += `<br>📍 ` + esc(loc.GetName())
		}
		if ev.GetDescription() != "" {
			out += `<br><span class="msg-card-note">` + esc(ev.GetDescription()) + `</span>`
		}
		return out + `</div>`, true

	case msg.GetButtonsMessage() != nil:
		if text := esc(msg.GetButtonsMessage().GetContentText()); text != "" {
			return text, true
		}
		return `<div class="msg-card">🔘 Buttons</div>`, true

	case msg.GetListMessage() != nil:
		lst := msg.GetListMessage()
		out := esc(lst.GetTitle())
		if lst.GetDescription() != "" {
			if out != "" {
				out += "<br>"
			}
			out += esc(lst.GetDescription())
		}
		if out == "" {
			out = "📋 List"
		}
		return out, true

	case msg.GetTemplateMessage() != nil:
		if t := msg.GetTemplateMessage().GetHydratedTemplate(); t != nil {
			if text := esc(t.GetHydratedContentText()); text != "" {
				return text, true
			}
		}
		return `<div class="msg-card">💬 Template message</div>`, true

	case msg.GetOrderMessage() != nil:
		order := msg.GetOrderMessage()
		out := "🛒 Order"
		if order.GetOrderTitle() != "" {
			out += ": " + esc(order.GetOrderTitle())
		}
		if order.GetThumbnail() != nil {
			// just show the order
		}
		return `<div class="msg-card">` + out + `</div>`, true

	case msg.GetDeclinePaymentRequestMessage() != nil:
		return `<div class="msg-card">💳 Payment request declined</div>`, true

	case msg.GetRequestPaymentMessage() != nil:
		pay := msg.GetRequestPaymentMessage()
		out := "💳 Payment request"
		if note := pay.GetNoteMessage(); note != nil {
			out += "<br>" + esc(note.GetConversation())
		}
		if pay.GetAmount() != nil && pay.GetAmount().GetValue() > 0 {
			out += fmt.Sprintf("<br>Amount: %d %s", pay.GetAmount().GetValue(), esc(pay.GetAmount().GetCurrencyCode()))
		}
		return `<div class="msg-card">` + out + `</div>`, true

	case msg.GetSendPaymentMessage() != nil:
		return `<div class="msg-card">💳 Payment sent</div>`, true

	default:
		if label, ok := simpleSpecialLabel(msg); ok {
			return `<div class="msg-card">` + label + `</div>`, true
		}
	}

	// Terminal fallback: any other populated, non-text field is still a
	// user-visible row. Give it a neutral label rather than leaving the
	// database text empty (which the UI renders as "Unsupported Message Type").
	if hasPopulatedContentField(msg) {
		return `<div class="msg-card">Unsupported message kind</div>`, true
	}
	return "", false
}

// SpecialPreview is the chat-list one-liner for special message types.
func SpecialPreview(msg *waE2E.Message) (string, bool) {
	if msg == nil {
		return "", false
	}
	if poll := PollCreation(msg); poll != nil {
		return "📊 " + esc(poll.GetName()), true
	}
	switch {
	case msg.GetLocationMessage() != nil, msg.GetLiveLocationMessage() != nil:
		return "📍 Location", true
	case msg.GetContactMessage() != nil:
		return "👤 " + esc(msg.GetContactMessage().GetDisplayName()), true
	case msg.GetContactsArrayMessage() != nil:
		return "👤 Contacts", true
	case msg.GetGroupInviteMessage() != nil:
		return "👥 Group invite", true
	case msg.GetEventMessage() != nil:
		return "📅 " + esc(msg.GetEventMessage().GetName()), true
	case msg.GetPtvMessage() != nil:
		return "🎥 Video note", true
	case msg.GetOrderMessage() != nil:
		return "🛒 Order", true
	case msg.GetRequestPaymentMessage() != nil:
		return "💳 Payment request", true
	case msg.GetSendPaymentMessage() != nil:
		return "💳 Payment", true
	case msg.GetDeclinePaymentRequestMessage() != nil:
		return "💳 Payment request declined", true
	}
	if label, ok := simpleSpecialLabel(msg); ok {
		return label, true
	}
	if hasPopulatedContentField(msg) {
		return "Unsupported message kind", true
	}
	return "", false
}

// ShouldSkipMessage reports protocol noise that must never create a visible
// chat row (poll votes, keep-in-chat markers, encrypted reactions/comments,
// key-distribution and history-sync envelopes). Edits, revokes and reactions
// are handled by the caller before this check; pin-in-chat is explicitly
// allowed through by the caller.
func ShouldSkipMessage(msg *waE2E.Message) bool {
	if msg == nil {
		return true
	}
	return msg.GetPollUpdateMessage() != nil ||
		msg.GetKeepInChatMessage() != nil ||
		msg.GetProtocolMessage() != nil ||
		msg.GetSenderKeyDistributionMessage() != nil ||
		msg.GetFastRatchetKeySenderKeyDistributionMessage() != nil ||
		msg.GetChat() != nil ||
		msg.GetCall() != nil ||
		msg.GetEncReactionMessage() != nil ||
		msg.GetEncCommentMessage() != nil ||
		msg.GetStickerSyncRmrMessage() != nil ||
		msg.GetGroupRootKeyShare() != nil ||
		msg.GetRootSecretDistributeMessage() != nil ||
		msg.GetMessageHistoryBundle() != nil ||
		msg.GetMessageHistoryNotice() != nil
}
