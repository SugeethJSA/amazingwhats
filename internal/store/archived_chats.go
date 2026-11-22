package store

import (
	"database/sql"

	"github.com/lugvitc/whats4linux/internal/query"
)

// IsChatArchived reports whether the chat is currently archived. It mirrors
// IsChatMuted: a query failure (including a missing row) is treated as
// "not archived", so a transient database error never suppresses a real
// notification.
func (ms *MessageStore) IsChatArchived(chatJID string) bool {
	var present int
	if err := ms.db.QueryRow(query.SelectArchivedChat, chatJID).Scan(&present); err != nil {
		if err != sql.ErrNoRows {
			// Keep this silent: notification decisions must not spam logs on a
			// transient read failure, and the safe default is to notify.
			return false
		}
		return false
	}
	return present == 1
}
