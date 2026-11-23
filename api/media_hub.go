package api

import (
	"errors"
	"fmt"
)

// MediaHubItem is the frontend-safe row returned by GetMediaHubItems.
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

// GetMediaHubItems backs the combined Media / Docs / Links viewer. kind is one
// of "media", "docs", "links" or "all". Results are newest-first, capped at
// 500 rows to keep the Wails event payload bounded.
func (a *Api) GetMediaHubItems(kind string) ([]MediaHubItem, error) {
	if a.messageStore == nil {
		return nil, errors.New("message store is not ready")
	}
	switch kind {
	case "media", "docs", "links", "all":
	default:
		return nil, fmt.Errorf("invalid media hub kind %q", kind)
	}
	rows, err := a.messageStore.GetMediaHubItems(kind, 500)
	if err != nil {
		return nil, err
	}
	out := make([]MediaHubItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, MediaHubItem{
			ChatJID: r.ChatJID, MessageID: r.MessageID, SenderJID: r.SenderJID,
			Timestamp: r.Timestamp, IsFromMe: r.IsFromMe, MediaType: r.MediaType,
			MimeType: r.MimeType, FileName: r.FileName, FileSize: r.FileSize,
			DirectPath: r.DirectPath, Caption: r.Caption, URL: r.URL,
			Title: r.Title, Description: r.Description, Width: r.Width,
			Height: r.Height, GifPlayback: r.GifPlayback,
		})
	}
	return out, nil
}
