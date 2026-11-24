package api

import (
	"fmt"
	"log/slog"

	appstore "github.com/lugvitc/amazingwhats/internal/store"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
)

// isNewsletterProtocolItem reports posts that act on another message (reactions,
// edits, revocations, poll updates) rather than being standalone posts. The
// message pipeline resolves these to the TARGET message's ID, so pairing them
// with their own server ID here would corrupt the frontend's `before` cursor.
// They are skipped in this backfill path; live events still handle them.
func isNewsletterProtocolItem(msg *waE2E.Message) bool {
	if msg == nil {
		return true
	}
	return msg.GetReactionMessage() != nil ||
		msg.GetProtocolMessage() != nil ||
		msg.GetPollUpdateMessage() != nil ||
		msg.GetEditedMessage() != nil
}

// NewsletterHistoryEntry is a channel post fetched from the server and
// persisted through the normal message pipeline. ServerID is the newsletter
// server ID; the local DB has no server_id column, so the frontend uses it as
// the cursor for the next backwards page.
type NewsletterHistoryEntry struct {
	ServerID int                     `json:"server_id"`
	Message  appstore.DecodedMessage `json:"message"`
}

// FetchNewsletterHistory loads older posts of a WhatsApp channel from the
// server, stores them in messages.db and returns the decoded rows. The server
// returns posts newest-first; that order is preserved here and the frontend is
// responsible for merging/sorting them with what it already has.
func (a *Api) FetchNewsletterHistory(jidStr string, count int, beforeServerID int) ([]NewsletterHistoryEntry, error) {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	if a.messageStore == nil {
		return nil, fmt.Errorf("message store unavailable")
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return nil, err
	}
	if jid.Server != types.NewsletterServer {
		return nil, fmt.Errorf("not a channel")
	}
	if count < 1 {
		count = 50
	}
	if count > 100 {
		count = 100
	}

	params := whatsmeow.GetNewsletterMessagesParams{Count: count}
	if beforeServerID > 0 {
		params.Before = types.MessageServerID(beforeServerID)
	}
	msgs, err := a.waClient.GetNewsletterMessages(a.ctx, jid, &params)
	if err != nil {
		return nil, err
	}

	out := make([]NewsletterHistoryEntry, 0, len(msgs))
	stored, skipped := 0, 0
	for _, m := range msgs {
		if m == nil || m.Message == nil {
			skipped++
			continue
		}
		msg := appstore.UnwrapMessage(m.Message)
		if isNewsletterProtocolItem(msg) {
			skipped++
			continue
		}
		info := types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat:     jid,
				Sender:   jid,
				IsFromMe: false,
			},
			ID:        types.MessageID(m.MessageID),
			ServerID:  m.MessageServerID,
			Timestamp: m.Timestamp,
		}
		parsedHTML := a.processMessageText(msg)
		msgID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, &events.Message{
			Info:    info,
			Message: msg,
		}, parsedHTML)
		if msgID == "" {
			skipped++
			continue
		}
		decoded, err := a.messageStore.GetDecodedMessage(jid.String(), msgID)
		if err != nil || decoded == nil {
			slog.Warn("Failed to load stored newsletter history message", "source", "channels")
			skipped++
			continue
		}
		out = append(out, NewsletterHistoryEntry{
			ServerID: int(m.MessageServerID),
			Message:  *decoded,
		})
		stored++
	}
	if stored > 0 {
		a.app.Event.Emit("wa:chat_list_refresh")
	}
	slog.Info(fmt.Sprintf("Stored %d newsletter history messages (%d skipped)", stored, skipped), "source", "channels")
	return out, nil
}
