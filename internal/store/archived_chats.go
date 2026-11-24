package store

import (
	"database/sql"
	"errors"
	"log"

	"github.com/lugvitc/amazingwhats/internal/query"
)

// IsChatArchived reports whether the chat is currently archived. It mirrors
// IsChatMuted: a query failure (including a missing row) is treated as
// "not archived", so a transient database error never suppresses a real
// notification.
func (ms *MessageStore) IsChatArchived(chatJID string) bool {
	var present int
	if err := ms.db.QueryRow(query.SelectArchivedChat, chatJID).Scan(&present); err != nil {
		// A missing row means "not archived" and is expected. Any other error
		// is a real DB failure worth logging. Both cases keep the safe default
		// of not suppressing notifications.
		if !errors.Is(err, sql.ErrNoRows) {
			log.Printf("store: failed to read archived state for %q: %v", chatJID, err)
		}
		return false
	}
	return present == 1
}
