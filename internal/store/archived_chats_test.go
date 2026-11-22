package store

import (
	"database/sql"
	"testing"
	"time"

	"github.com/lugvitc/whats4linux/internal/query"
)

func TestIsChatArchived(t *testing.T) {
	ms := newTestMessageStore(t)
	chat := "1234567890@s.whatsapp.net"

	if ms.IsChatArchived(chat) {
		t.Fatal("new chat should not be archived")
	}

	err := ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.UpsertArchivedChat, chat, time.Now().Unix())
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if !ms.IsChatArchived(chat) {
		t.Fatal("archived chat should be reported as archived")
	}

	err = ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.DeleteArchivedChat, chat)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if ms.IsChatArchived(chat) {
		t.Fatal("unarchived chat should not be reported as archived")
	}
}
