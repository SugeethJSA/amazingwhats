package api

import (
	"errors"
	"log"
	"strings"
	"sync"

	"github.com/lugvitc/amazingwhats/internal/store"
	"github.com/polymorfa/hypermeow/types/events"
)

// receiptPersistFailureOnce keeps a ledger write failure from flooding the log
// on high-frequency receipt events. The message is deliberately generic: no
// raw JIDs, message IDs or bodies are ever logged.
var receiptPersistFailureOnce sync.Once

// persistReceiptEvent writes one durable row per message ID carried by a
// receipt event. v.Sender is the reader (WhatsApp sends one event per group
// participant), and the raw receipt type is preserved so e.g. "read-self"
// (the user's other device) stays distinct from "read". Persistence failures
// are ignored with a once-only log so the wa:message_receipt emit is never
// blocked or altered.
func (a *Api) persistReceiptEvent(v *events.Receipt) {
	if a == nil || a.messageStore == nil || v == nil {
		return
	}

	entries := make([]store.MessageReceipt, 0, len(v.MessageIDs))
	chatJID := v.Chat.String()
	readerJID := v.Sender.String()
	receiptType := string(v.Type)
	timestamp := v.Timestamp.Unix()
	for _, messageID := range v.MessageIDs {
		id := string(messageID)
		if id == "" {
			continue
		}
		entries = append(entries, store.MessageReceipt{
			ChatJID:     chatJID,
			MessageID:   id,
			ReaderJID:   readerJID,
			ReceiptType: receiptType,
			Timestamp:   timestamp,
		})
	}
	if len(entries) == 0 {
		return
	}

	if err := a.messageStore.InsertMessageReceipts(entries); err != nil {
		receiptPersistFailureOnce.Do(func() {
			log.Println("failed to persist message receipts")
		})
	}
}

// GetMessageReceipts returns the durable per-message read-receipt ledger for a
// message. It is a Wails binding: callers must supply both a chat JID and a
// message ID. When nobody has read the message an empty slice is returned; no
// readers are ever fabricated.
func (a *Api) GetMessageReceipts(chatJID, messageID string) ([]store.MessageReceipt, error) {
	if strings.TrimSpace(chatJID) == "" || strings.TrimSpace(messageID) == "" {
		return nil, errors.New("chatJID and messageID are required")
	}
	return a.messageStore.GetMessageReceipts(chatJID, messageID)
}
