package store

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func newMediaHubTestStore(t *testing.T) *MessageStore {
	t.Helper()
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "hub.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	for _, stmt := range []string{
		`CREATE TABLE messages (message_id TEXT PRIMARY KEY, chat_jid TEXT NOT NULL, sender_jid TEXT NOT NULL, timestamp INTEGER NOT NULL, is_from_me BOOLEAN NOT NULL, text TEXT, has_media BOOLEAN DEFAULT FALSE, reply_to_message_id TEXT, edited BOOLEAN DEFAULT FALSE, forwarded BOOLEAN DEFAULT FALSE, type INTEGER DEFAULT 0)`,
		`CREATE TABLE message_media (message_id TEXT PRIMARY KEY, type INTEGER, url TEXT, mimetype TEXT, direct_path TEXT, media_key BLOB, file_sha256 BLOB, file_enc_sha256 BLOB, width INTEGER, height INTEGER, file_name TEXT, gif_playback BOOLEAN, thumbnail BLOB, ptt BOOLEAN, seconds INTEGER, waveform BLOB, file_length INTEGER)`,
		`CREATE TABLE link_previews (message_id TEXT PRIMARY KEY, url TEXT, title TEXT, description TEXT, thumbnail BLOB, direct_path TEXT, media_key BLOB, file_sha256 BLOB, file_enc_sha256 BLOB)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}
	return &MessageStore{db: db}
}

func TestGetMediaHubItems(t *testing.T) {
	ms := newMediaHubTestStore(t)
	seed := []string{
		`INSERT INTO messages (message_id, chat_jid, sender_jid, timestamp, is_from_me, text, has_media) VALUES ('m1','c1@s','s1@lid',100,0,'photo caption',1)`,
		`INSERT INTO message_media (message_id, type, mimetype, file_name, file_length, width, height) VALUES ('m1',1,'image/jpeg','p.jpg',1234,100,200)`,
		`INSERT INTO messages (message_id, chat_jid, sender_jid, timestamp, is_from_me, text, has_media) VALUES ('m2','c1@s','s1@lid',200,1,'',1)`,
		`INSERT INTO message_media (message_id, type, mimetype, file_name, file_length) VALUES ('m2',4,'application/pdf','a.pdf',5000)`,
		`INSERT INTO messages (message_id, chat_jid, sender_jid, timestamp, is_from_me, text, has_media) VALUES ('m3','c2@s','s2@lid',300,0,'',0)`,
		`INSERT INTO link_previews (message_id, url, title, description) VALUES ('m3','https://example.com','Example','desc')`,
	}
	for _, stmt := range seed {
		if _, err := ms.db.Exec(stmt); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	tests := []struct {
		name    string
		kind    string
		wantIDs []string
	}{
		{"media lists images", "media", []string{"m1"}},
		{"docs lists documents", "docs", []string{"m2"}},
		{"links lists link previews", "links", []string{"m3"}},
		{"all is newest first", "all", []string{"m3", "m2", "m1"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ms.GetMediaHubItems(tt.kind, 10)
			if err != nil {
				t.Fatalf("GetMediaHubItems: %v", err)
			}
			if len(got) != len(tt.wantIDs) {
				t.Fatalf("got %d rows, want %d", len(got), len(tt.wantIDs))
			}
			for i, id := range tt.wantIDs {
				if got[i].MessageID != id {
					t.Errorf("row %d = %s, want %s", i, got[i].MessageID, id)
				}
			}
		})
	}

	if _, err := ms.GetMediaHubItems("bogus", 10); err == nil {
		t.Error("invalid kind should return an error")
	}
}
