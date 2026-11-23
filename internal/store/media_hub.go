package store

import (
	"fmt"

	"github.com/lugvitc/whats4linux/internal/query"
)

// MediaHubItem is one row in the combined media/docs/links viewer.
type MediaHubItem struct {
	ChatJID     string `json:"chat_jid"`
	MessageID   string `json:"message_id"`
	SenderJID   string `json:"sender_jid"`
	Timestamp   int64  `json:"timestamp"`
	IsFromMe    bool   `json:"is_from_me"`
	MediaType   int    `json:"media_type"`
	MimeType    string `json:"mime_type"`
	FileName    string `json:"file_name"`
	FileSize    int64  `json:"file_size"`
	DirectPath  string `json:"direct_path"`
	Caption     string `json:"caption"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	GifPlayback bool   `json:"gif_playback"`
}

// GetMediaHubItems lists media, documents or links across all chats, newest
// first. kind must be one of "media", "docs", "links" or "all".
func (ms *MessageStore) GetMediaHubItems(kind string, limit int) ([]MediaHubItem, error) {
	q := query.MediaHubSelect
	switch kind {
	case "media":
		q += " AND mm.type IN (1, 2, 5)" // image, video, sticker
	case "docs":
		q += " AND mm.type = 4" // document
	case "links":
		q += " AND COALESCE(lp.url, '') <> ''"
	case "all":
		// no additional filter
	default:
		return nil, fmt.Errorf("invalid media hub kind %q", kind)
	}
	if limit <= 0 {
		limit = 200
	}
	q += " ORDER BY m.timestamp DESC LIMIT ?"

	rows, err := ms.db.Query(q, limit)
	if err != nil {
		return nil, fmt.Errorf("query media hub: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []MediaHubItem
	for rows.Next() {
		var item MediaHubItem
		var gif int
		if err := rows.Scan(
			&item.ChatJID, &item.MessageID, &item.SenderJID, &item.Timestamp,
			&item.IsFromMe, &item.MediaType, &item.MimeType, &item.FileName,
			&item.FileSize, &item.DirectPath, &item.Caption, &item.URL,
			&item.Title, &item.Description, &item.Width, &item.Height, &gif,
		); err != nil {
			return nil, fmt.Errorf("scan media hub row: %w", err)
		}
		item.GifPlayback = gif != 0
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate media hub rows: %w", err)
	}
	return out, nil
}
