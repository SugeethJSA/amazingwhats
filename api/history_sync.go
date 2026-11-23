package api

import (
	"fmt"
	"time"

	"go.mau.fi/whatsmeow/types"
)

// RequestHistorySync asks the primary device for older messages from a chat.
// whatsmeow answers with an *events.HistorySync of type ON_DEMAND, which the
// existing event handler stores and reports through wa:history_progress.
//
// An empty chatJID uses the most recently active chat. count is clamped to the
// 1..50 range recommended by whatsmeow.
func (a *Api) RequestHistorySync(chatJID string, count int) error {
	if a.waClient == nil || a.waClient.Store.ID == nil {
		return fmt.Errorf("not connected")
	}
	if a.messageStore == nil {
		return fmt.Errorf("message store unavailable")
	}
	if count < 1 {
		count = 50
	}
	if count > 50 {
		count = 50
	}

	if chatJID == "" {
		chats := a.messageStore.GetChatList()
		if len(chats) == 0 {
			return fmt.Errorf("no chat history available to request")
		}
		chatJID = chats[0].JID.String()
	}

	jid, err := types.ParseJID(chatJID)
	if err != nil {
		return fmt.Errorf("invalid chat")
	}

	// BuildHistorySyncRequest needs a known message to page backwards from.
	page, err := a.messageStore.GetDecodedMessagesPaged(jid.String(), 0, "", 1)
	if err != nil {
		return fmt.Errorf("could not read local history")
	}
	if len(page) == 0 {
		return fmt.Errorf("no messages in this chat yet")
	}
	last := page[0].Info
	timestamp, err := time.Parse(time.RFC3339, last.Timestamp)
	if err != nil {
		return fmt.Errorf("invalid local message timestamp")
	}

	info := types.MessageInfo{
		ID:        last.ID,
		Chat:      jid,
		IsFromMe:  last.IsFromMe,
		Timestamp: timestamp,
	}
	if _, err = a.waClient.SendPeerMessage(a.ctx, a.waClient.BuildHistorySyncRequest(&info, count)); err != nil {
		return fmt.Errorf("could not request history from your phone")
	}
	return nil
}
