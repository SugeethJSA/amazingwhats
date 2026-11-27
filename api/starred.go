package api

// Starred messages are stored by WhatsApp in the "regular_high" app state
// collection. The app state store keeps only mutation MACs (no readable
// values), so this file mirrors Star events into a small local table in the
// session DB, exactly like quick replies do for the "regular" collection.
//
// api.go already full-syncs regular_high on every connect, so this file never
// duplicates that sync. The only gap is the very first run, where the local
// app-state version has never been stored (0) before that startup sync ran;
// bootstrap covers exactly that case. Every subsequent change arrives as a
// real Star event.

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/polymorfa/hypermeow/appstate"
	"github.com/polymorfa/hypermeow/types/events"
)

// StarredMessage is the JSON shape exposed to the frontend. Field names match
// SearchResult so the starred view can reuse the search results presentation.
type StarredMessage struct {
	ChatJID   string `json:"chat_jid"`
	MessageID string `json:"message_id"`
	SenderJID string `json:"sender_jid"`
	// Timestamp is the message timestamp in unix seconds when the local message
	// store knows it; otherwise it falls back to StarredAt.
	Timestamp int64  `json:"timestamp"`
	Text      string `json:"text"`
	IsFromMe  bool   `json:"is_from_me"`
	HasMedia  bool   `json:"has_media"`
	MediaType int    `json:"media_type"`
	Edited    bool   `json:"edited"`
	Forwarded bool   `json:"forwarded"`
	ChatName  string `json:"chat_name"`
	// StarredAt is when the star was set, in unix seconds.
	StarredAt int64 `json:"starred_at"`
}

const starredCreateTable = `
CREATE TABLE IF NOT EXISTS starred_messages (
	chat_jid   TEXT NOT NULL,
	message_id TEXT NOT NULL,
	sender_jid TEXT NOT NULL DEFAULT '',
	is_from_me INTEGER NOT NULL DEFAULT 0,
	starred_at INTEGER NOT NULL,
	PRIMARY KEY (chat_jid, message_id)
);
CREATE INDEX IF NOT EXISTS idx_starred_messages_starred_at ON starred_messages(starred_at DESC);
`

var (
	starredInits     sync.Map // map[*Api]*sync.Once — Star event handler registration
	starredBootstrap sync.Map // map[*Api]*sync.Once — first full-sync enumeration
)

func (a *Api) starredContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func (a *Api) ensureStarredTable(ctx context.Context) error {
	if a.sessionDB == nil {
		return fmt.Errorf("starred messages: local store unavailable")
	}
	if _, err := a.sessionDB.ExecContext(ctx, starredCreateTable); err != nil {
		return fmt.Errorf("starred messages: open local store: %w", err)
	}
	return nil
}

// initStarredSync registers one HyperMeow event handler per Api instance. It
// mirrors stars made on any device (including full-sync events) into the local
// table so the view is authoritative and restart-safe.
func (a *Api) initStarredSync() {
	onceValue, _ := starredInits.LoadOrStore(a, &sync.Once{})
	onceValue.(*sync.Once).Do(func() {
		if a.waClient == nil {
			return
		}
		// The app-wide client already enables this, but the star mirror depends
		// on full-sync events being emitted, so make the dependency explicit.
		a.waClient.EmitAppStateEventsOnFullSync = true
		a.waClient.AddEventHandler(func(evt any) {
			starEvt, ok := evt.(*events.Star)
			if !ok || starEvt == nil || starEvt.Action == nil || a.sessionDB == nil {
				return
			}
			if starEvt.ChatJID.IsEmpty() || starEvt.MessageID == "" {
				return
			}
			ctx := a.starredContext()
			if !starEvt.Action.GetStarred() {
				if _, err := a.sessionDB.ExecContext(ctx,
					`DELETE FROM starred_messages WHERE chat_jid = ? AND message_id = ?`,
					starEvt.ChatJID.String(), starEvt.MessageID); err != nil {
					slog.Warn("starred messages: failed to mirror remote unstar", "error", err)
					return
				}
				a.emitStarredUpdated()
				return
			}
			starredAt := starEvt.Timestamp.UnixMilli()
			if starredAt <= 0 {
				starredAt = time.Now().UnixMilli()
			}
			senderJID := ""
			if !starEvt.SenderJID.IsEmpty() {
				senderJID = starEvt.SenderJID.String()
			}
			isFromMe := 0
			if starEvt.IsFromMe {
				isFromMe = 1
			}
			if _, err := a.sessionDB.ExecContext(ctx,
				`INSERT INTO starred_messages (chat_jid, message_id, sender_jid, is_from_me, starred_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(chat_jid, message_id) DO UPDATE SET
				   sender_jid = excluded.sender_jid,
				   is_from_me = excluded.is_from_me,
				   starred_at = excluded.starred_at`,
				starEvt.ChatJID.String(), starEvt.MessageID, senderJID, isFromMe, starredAt); err != nil {
				slog.Warn("starred messages: failed to mirror remote star", "error", err)
				return
			}
			a.emitStarredUpdated()
		})
	})
}

// bootstrapStarredMessages covers the one case the startup resync cannot:
// a regular_high app-state version that has never been stored (0). This
// follows quick_replies.go bootstrap — check the version first and only then
// fetch a snapshot. A non-zero version means api.go already synced the
// collection on connect, so doing nothing here avoids a second, destructive
// full sync that would reset a valid version before the network round-trip.
func (a *Api) bootstrapStarredMessages() {
	onceValue, _ := starredBootstrap.LoadOrStore(a, &sync.Once{})
	onceValue.(*sync.Once).Do(func() {
		if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.AppState == nil {
			return
		}
		ctx := a.starredContext()
		version, _, err := a.waClient.Store.AppState.GetAppStateVersion(ctx, string(appstate.WAPatchRegularHigh))
		if err != nil || version != 0 {
			return
		}
		fetchCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		if err := a.waClient.FetchAppState(fetchCtx, appstate.WAPatchRegularHigh, true, false); err != nil {
			slog.Warn("starred messages: initial app state sync failed", "error", err)
		}
	})
}

// ListStarredMessages lists starred messages across all chats, newest star
// first. The backing mirror is maintained from real WhatsApp app state events;
// nothing here is fabricated or synthesized.
func (a *Api) ListStarredMessages(limit int, offset int) ([]StarredMessage, error) {
	ctx := a.starredContext()
	if err := a.ensureStarredTable(ctx); err != nil {
		return nil, err
	}
	a.initStarredSync()
	a.bootstrapStarredMessages()

	if limit <= 0 {
		limit = 50
	}
	if limit > maxPageSize {
		limit = maxPageSize
	}
	if offset < 0 {
		offset = 0
	}

	rows, err := a.sessionDB.QueryContext(ctx,
		`SELECT chat_jid, message_id, sender_jid, is_from_me, starred_at
		 FROM starred_messages
		 ORDER BY starred_at DESC, chat_jid ASC, message_id ASC
		 LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("starred messages: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := make([]StarredMessage, 0)
	for rows.Next() {
		var item StarredMessage
		var isFromMe int
		var starredAtMs int64
		if err := rows.Scan(&item.ChatJID, &item.MessageID, &item.SenderJID, &isFromMe, &starredAtMs); err != nil {
			return nil, fmt.Errorf("starred messages: scan: %w", err)
		}
		item.IsFromMe = isFromMe != 0
		item.StarredAt = starredAtMs / 1000
		item.Timestamp = item.StarredAt
		item.ChatName = a.resolveChatName(item.ChatJID)
		if item.SenderJID == "" {
			item.SenderJID = item.ChatJID
		}

		if a.messageStore != nil {
			msg, msgErr := a.messageStore.GetDecodedMessage(item.ChatJID, item.MessageID)
			if msgErr == nil && msg != nil {
				item.Edited = msg.Edited
				item.Forwarded = msg.Forwarded
				item.MediaType = int(msg.Type)
				item.HasMedia = msg.Type != 0
				if msg.Content != nil {
					item.Text = msg.Content.Conversation
					if item.Text == "" && msg.Content.ExtendedTextMessage != nil {
						item.Text = msg.Content.ExtendedTextMessage.Text
					}
				}
				if ts, parseErr := time.Parse(time.RFC3339, msg.Info.Timestamp); parseErr == nil && ts.Unix() > 0 {
					item.Timestamp = ts.Unix()
				}
			} else if ext, extErr := a.messageStore.GetMessageWithMediaByID(item.MessageID); extErr == nil && ext != nil {
				// The star can outlive the local copy of the message (history
				// deleted). This lookup is by message id only and may return a
				// row from a different chat, so enrich text/media ONLY and keep
				// the chat, sender, timestamps and flags from the star record.
				item.Text = ext.Text
				item.HasMedia = ext.Media != nil
			}
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("starred messages: iterate: %w", err)
	}
	return out, nil
}

func (a *Api) emitStarredUpdated() {
	if a.app != nil && a.app.Event != nil {
		a.app.Event.Emit("wa:starred_updated")
	}
}
