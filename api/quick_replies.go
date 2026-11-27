package api

// Quick replies are stored in WhatsApp's "regular" app state collection via
// HyperMeow's BuildQuickReply / BuildQuickReplyDelete helpers, so they sync to
// the phone and survive app restarts. The app state store itself only keeps
// mutation MACs (no readable values), and this client does not full-sync the
// "regular" collection on startup, so a small mirrored table in the local
// session DB provides an authoritative, restart-safe list. Every write is sent
// to app state first: a failed sync never produces a fake success locally.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/polymorfa/hypermeow/appstate"
	"github.com/polymorfa/hypermeow/types/events"
)

// QuickReply is a saved message snippet that can be inserted into the composer.
type QuickReply struct {
	ID        string   `json:"id"`
	Shortcut  string   `json:"shortcut"`
	Message   string   `json:"message"`
	Keywords  []string `json:"keywords"`
	CreatedAt int64    `json:"createdAt"` // unix milliseconds
}

const (
	// Honest, local limits. They keep malformed input out of app state and are
	// intentionally generous enough for normal canned replies.
	quickReplyMaxShortcut = 128 // runes
	quickReplyMaxMessage  = 4096 // runes

	quickReplyCreateTable = `CREATE TABLE IF NOT EXISTS quick_replies (
		id TEXT PRIMARY KEY,
		shortcut TEXT NOT NULL,
		message TEXT NOT NULL,
		keywords TEXT NOT NULL DEFAULT '[]',
		created_at INTEGER NOT NULL
	)`
)

var (
	quickReplyInits      sync.Map // map[*Api]*sync.Once — event handler registration
	quickReplyBootstraps sync.Map // map[*Api]*sync.Once — first full-sync enumeration
)

// ListQuickReplies lists all saved quick replies, newest first. It is backed by
// the persisted local mirror and also starts (once per session) the app-state
// event listener plus an initial enumeration when the "regular" collection has
// never been synced, so replies created on the phone can be discovered.
func (a *Api) ListQuickReplies() ([]QuickReply, error) {
	ctx := a.quickReplyContext()
	if err := a.ensureQuickRepliesTable(ctx); err != nil {
		return nil, err
	}
	a.initQuickReplySync()
	a.bootstrapQuickReplies()

	rows, err := a.sessionDB.QueryContext(ctx,
		`SELECT id, shortcut, message, keywords, created_at FROM quick_replies ORDER BY created_at DESC, shortcut ASC`)
	if err != nil {
		return nil, fmt.Errorf("quick replies: list: %w", err)
	}
	defer rows.Close()

	out := make([]QuickReply, 0)
	for rows.Next() {
		var qr QuickReply
		var keywords string
		if err := rows.Scan(&qr.ID, &qr.Shortcut, &qr.Message, &keywords, &qr.CreatedAt); err != nil {
			return nil, fmt.Errorf("quick replies: scan: %w", err)
		}
		qr.Keywords = []string{}
		if keywords != "" {
			var parsed []string
			if err := json.Unmarshal([]byte(keywords), &parsed); err == nil && parsed != nil {
				qr.Keywords = parsed
			}
		}
		out = append(out, qr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("quick replies: iterate: %w", err)
	}
	return out, nil
}

// CreateQuickReply saves a quick reply to WhatsApp app state and mirrors it in
// the local store. It returns an error if either step fails; nothing is
// reported as saved until the app-state write has succeeded.
func (a *Api) CreateQuickReply(shortcut, message string) (QuickReply, error) {
	var qr QuickReply
	shortcut = strings.TrimSpace(shortcut)
	message = strings.TrimSpace(message)
	if shortcut == "" {
		return qr, fmt.Errorf("quick replies: shortcut is required")
	}
	if message == "" {
		return qr, fmt.Errorf("quick replies: message is required")
	}
	if utf8.RuneCountInString(shortcut) > quickReplyMaxShortcut {
		return qr, fmt.Errorf("quick replies: shortcut must be at most %d characters", quickReplyMaxShortcut)
	}
	if utf8.RuneCountInString(message) > quickReplyMaxMessage {
		return qr, fmt.Errorf("quick replies: message must be at most %d characters", quickReplyMaxMessage)
	}

	ctx := a.quickReplyContext()
	if err := a.ensureQuickRepliesTable(ctx); err != nil {
		return qr, err
	}
	if a.waClient == nil {
		return qr, fmt.Errorf("quick replies: WhatsApp client is not connected")
	}
	a.initQuickReplySync()

	id, err := newQuickReplyID()
	if err != nil {
		return qr, err
	}
	if err := a.waClient.SendAppState(ctx, appstate.BuildQuickReply(id, shortcut, message, nil, 0)); err != nil {
		return qr, fmt.Errorf("quick replies: sync to WhatsApp failed: %w", err)
	}

	qr = QuickReply{
		ID:        id,
		Shortcut:  shortcut,
		Message:   message,
		Keywords:  []string{},
		CreatedAt: time.Now().UnixMilli(),
	}
	if err := a.upsertQuickReply(ctx, qr); err != nil {
		return QuickReply{}, fmt.Errorf("quick replies: synced to WhatsApp but local save failed: %w", err)
	}
	a.emitQuickRepliesUpdated()
	return qr, nil
}

// DeleteQuickReply writes a real app-state tombstone and removes the local
// mirror row. A failed sync leaves the reply intact locally.
func (a *Api) DeleteQuickReply(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("quick replies: id is required")
	}
	ctx := a.quickReplyContext()
	if err := a.ensureQuickRepliesTable(ctx); err != nil {
		return err
	}
	if a.waClient == nil {
		return fmt.Errorf("quick replies: WhatsApp client is not connected")
	}
	a.initQuickReplySync()

	if err := a.waClient.SendAppState(ctx, appstate.BuildQuickReplyDelete(id)); err != nil {
		return fmt.Errorf("quick replies: delete sync to WhatsApp failed: %w", err)
	}
	if _, err := a.sessionDB.ExecContext(ctx, `DELETE FROM quick_replies WHERE id = ?`, id); err != nil {
		return fmt.Errorf("quick replies: synced delete to WhatsApp but local remove failed: %w", err)
	}
	a.emitQuickRepliesUpdated()
	return nil
}

func (a *Api) quickReplyContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func (a *Api) ensureQuickRepliesTable(ctx context.Context) error {
	if a.sessionDB == nil {
		return fmt.Errorf("quick replies: local store unavailable")
	}
	if _, err := a.sessionDB.ExecContext(ctx, quickReplyCreateTable); err != nil {
		return fmt.Errorf("quick replies: open local store: %w", err)
	}
	return nil
}

// initQuickReplySync registers one HyperMeow event handler per Api instance.
// It captures replies created or removed from any device (including full-sync
// events) and keeps the mirror in step with app state.
func (a *Api) initQuickReplySync() {
	onceValue, _ := quickReplyInits.LoadOrStore(a, &sync.Once{})
	onceValue.(*sync.Once).Do(func() {
		if a.waClient == nil {
			return
		}
		a.waClient.EmitQuickReplyEventsOnFullSync = true
		a.waClient.AddEventHandler(func(evt any) {
			qrEvent, ok := evt.(*events.QuickReply)
			if !ok || qrEvent == nil || qrEvent.Action == nil || a.sessionDB == nil {
				return
			}
			ctx := a.quickReplyContext()
			if qrEvent.Action.GetDeleted() {
				if _, err := a.sessionDB.ExecContext(ctx, `DELETE FROM quick_replies WHERE id = ?`, qrEvent.ID); err != nil {
					slog.Warn("quick replies: failed to mirror remote delete", "id", qrEvent.ID, "error", err)
				}
				return
			}
			keywords, err := json.Marshal(qrEvent.Action.GetKeywords())
			if err != nil {
				keywords = []byte("[]")
			}
			createdAt := qrEvent.Timestamp.UnixMilli()
			if createdAt <= 0 {
				createdAt = time.Now().UnixMilli()
			}
			if _, err := a.sessionDB.ExecContext(ctx,
				`INSERT INTO quick_replies (id, shortcut, message, keywords, created_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
				   shortcut = excluded.shortcut,
				   message = excluded.message,
				   keywords = excluded.keywords,
				   created_at = excluded.created_at`,
				qrEvent.ID, qrEvent.Action.GetShortcut(), qrEvent.Action.GetMessage(), string(keywords), createdAt); err != nil {
				slog.Warn("quick replies: failed to mirror remote upsert", "id", qrEvent.ID, "error", err)
				return
			}
			a.emitQuickRepliesUpdated()
		})
	})
}

// bootstrapQuickReplies enumerates replies already on the account the first
// time the picker is opened. The "regular" collection is not part of the app's
// startup resync, so its version is normally zero until the first write.
func (a *Api) bootstrapQuickReplies() {
	onceValue, _ := quickReplyBootstraps.LoadOrStore(a, &sync.Once{})
	onceValue.(*sync.Once).Do(func() {
		if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.AppState == nil {
			return
		}
		ctx := a.quickReplyContext()
		version, _, err := a.waClient.Store.AppState.GetAppStateVersion(ctx, string(appstate.WAPatchRegular))
		if err != nil || version != 0 {
			return
		}
		go func() {
			if err := a.waClient.FetchAppState(ctx, appstate.WAPatchRegular, true, false); err != nil {
				slog.Warn("quick replies: initial app state sync failed", "error", err)
			}
		}()
	})
}

func (a *Api) upsertQuickReply(ctx context.Context, qr QuickReply) error {
	keywords, err := json.Marshal(qr.Keywords)
	if err != nil {
		return err
	}
	_, err = a.sessionDB.ExecContext(ctx,
		`INSERT INTO quick_replies (id, shortcut, message, keywords, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   shortcut = excluded.shortcut,
		   message = excluded.message,
		   keywords = excluded.keywords,
		   created_at = excluded.created_at`,
		qr.ID, qr.Shortcut, qr.Message, string(keywords), qr.CreatedAt)
	return err
}

func (a *Api) emitQuickRepliesUpdated() {
	if a.app != nil && a.app.Event != nil {
		a.app.Event.Emit("wa:quick_replies_updated")
	}
}

func newQuickReplyID() (string, error) {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("quick replies: generate id: %w", err)
	}
	return fmt.Sprintf("%d%s", time.Now().UnixMilli(), hex.EncodeToString(raw[:])), nil
}
