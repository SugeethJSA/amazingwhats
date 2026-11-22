package store

import (
	"database/sql"
	"testing"

	"github.com/lugvitc/whats4linux/internal/query"
	mtypes "github.com/lugvitc/whats4linux/internal/types"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

// TestUpdateMessageContentUpdatesMediaAndText guards D-AUD-002b: the media
// edit statement used to declare 14 placeholders while the store binds only
// 11 arguments, so every edit failed and the surrounding transaction rolled
// back the text edit as well.
func TestUpdateMessageContentUpdatesMediaAndText(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		msgID = "media-edit-1"
		chat  = "g1@s.whatsapp.net"
	)

	insertTestMessage(t, ms, msgID, chat, 100, "")

	if err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.InsertMessageMedia,
			msgID, mtypes.MediaTypeImage,
			"https://old.example/img", "image/jpeg", "old-path",
			[]byte{1}, []byte{2}, []byte{3},
			100, 200, "old.jpg",
			false, nil, false, 0, nil, 0,
		)
		return err
	}); err != nil {
		t.Fatal(err)
	}

	edited := &waE2E.Message{
		DocumentMessage: &waE2E.DocumentMessage{
			Caption:    proto.String("edited caption"),
			FileName:   proto.String("edited.pdf"),
			URL:        proto.String("https://new.example/doc"),
			Mimetype:   proto.String("application/pdf"),
			DirectPath: proto.String("new-path"),
		},
	}
	if err := ms.UpdateMessageContent(msgID, edited, ""); err != nil {
		t.Fatalf("UpdateMessageContent failed: %v", err)
	}

	var (
		text, fileName, url, mimetype, directPath string
		isEdited                                  bool
	)
	err := ms.db.QueryRow(`
		SELECT m.text, m.edited, mm.file_name, mm.url, mm.mimetype, mm.direct_path
		FROM messages m JOIN message_media mm ON mm.message_id = m.message_id
		WHERE m.message_id = ?`, msgID).
		Scan(&text, &isEdited, &fileName, &url, &mimetype, &directPath)
	if err != nil {
		t.Fatal(err)
	}
	if text != "edited caption" || !isEdited {
		t.Errorf("text edit not persisted: text=%q edited=%v", text, isEdited)
	}
	if fileName != "edited.pdf" || url != "https://new.example/doc" ||
		mimetype != "application/pdf" || directPath != "new-path" {
		t.Errorf("media edit not persisted: file=%q url=%q mime=%q path=%q",
			fileName, url, mimetype, directPath)
	}
}

// TestResyncMessagePreservesReactions guards D-AUD-002a: re-inserting a
// message during history sync must UPDATE it in place. INSERT OR REPLACE would
// delete and re-create the row, firing the reactions ON DELETE CASCADE.
func TestResyncMessagePreservesReactions(t *testing.T) {
	ms := newTestMessageStore(t)
	const (
		msgID = "reaction-resync-1"
		chat  = "g1@s.whatsapp.net"
	)

	insertTestMessage(t, ms, msgID, chat, 100, "")
	if err := ms.AddReactionToMessage(msgID, "🔥", "alice@s.whatsapp.net"); err != nil {
		t.Fatal(err)
	}

	// Simulate a history re-sync of the same message ID.
	insertTestMessage(t, ms, msgID, chat, 100, "")

	var count int
	if err := ms.db.QueryRow(`SELECT COUNT(*) FROM reactions WHERE message_id = ?`, msgID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("reaction rows after re-sync = %d, want 1", count)
	}
}
