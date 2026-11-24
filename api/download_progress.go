package api

import (
	"os"
	"sync"
	"time"
)

const (
	// Progress events are throttled so a fast transfer cannot flood the Wails
	// event bus. An emit is allowed once either window is exceeded.
	downloadProgressInterval = 100 * time.Millisecond
	downloadProgressBytes    = 64 * 1024
)

// progressFile wraps the temp file used by DownloadMediaToFile and counts the
// REAL bytes the downloader streams into it. HyperMeow's DownloadToFile uses
// io.Copy(TeeReader(resp.Body, hasher), file), so each Write corresponds to
// freshly received ciphertext bytes. Its decryption step uses WriteAt, which
// this wrapper deliberately does NOT count.
//
// The total is derived from msg.Media.GetFileLength(), which is the PLAINTEXT
// length and may be 0/-1 when unknown. It is therefore APPROXIMATE: ciphertext
// bytes can slightly exceed it. The UI must treat the clamped/indeterminate
// percent as authoritative rather than doing its own downloaded/total math.
type progressFile struct {
	*os.File

	messageID  string
	total      int64 // approximate plaintext length, or -1 when unknown
	downloaded int64 // real ciphertext bytes accepted by Write
	percent    int   // clamp(downloaded*100/total, 0, 100); -1 when indeterminate

	mu           sync.Mutex
	lastEmit     time.Time
	lastEmitByte int64

	// emit is injected by the Api so this type has no dependency on the Wails
	// application and can be swapped out in isolation.
	emit func(messageID string, downloaded, total int64, percent int)
}

// Write counts real bytes as they arrive and emits a throttled progress event.
func (p *progressFile) Write(b []byte) (int, error) {
	n, err := p.File.Write(b)
	if n <= 0 {
		return n, err
	}

	p.mu.Lock()
	p.downloaded += int64(n)
	p.percent = calcDownloadPercent(p.downloaded, p.total)
	shouldEmit := p.lastEmit.IsZero() ||
		time.Since(p.lastEmit) >= downloadProgressInterval ||
		p.downloaded-p.lastEmitByte >= downloadProgressBytes
	if shouldEmit {
		p.lastEmit = time.Now()
		p.lastEmitByte = p.downloaded
		messageID, downloaded, total, percent := p.messageID, p.downloaded, p.total, p.percent
		p.mu.Unlock()
		if p.emit != nil {
			p.emit(messageID, downloaded, total, percent)
		}
		return n, err
	}
	p.mu.Unlock()
	return n, err
}

// finish emits one final, unthrottled update so the UI always lands on 100%
// (or the final real byte count for an indeterminate total).
func (p *progressFile) finish() {
	p.mu.Lock()
	p.percent = calcDownloadPercent(p.downloaded, p.total)
	messageID, downloaded, total, percent := p.messageID, p.downloaded, p.total, p.percent
	p.lastEmit = time.Now()
	p.lastEmitByte = p.downloaded
	p.mu.Unlock()
	if p.emit != nil {
		p.emit(messageID, downloaded, total, percent)
	}
}

// calcDownloadPercent clamps the ratio into [0, 100]. A non-positive total
// means the size is unknown, reported as -1 (indeterminate) to the frontend.
func calcDownloadPercent(downloaded, total int64) int {
	if total <= 0 {
		return -1
	}
	percent := downloaded * 100 / total
	if percent < 0 {
		return 0
	}
	if percent > 100 {
		return 100
	}
	return int(percent)
}

// emitDownloadProgress is the only place that builds the download:progress
// payload. It deliberately carries no paths, JIDs or raw backend strings.
func (a *Api) emitDownloadProgress(messageID string, downloaded, total int64, percent int) {
	a.app.Event.Emit("download:progress", map[string]any{
		"messageId":  messageID,
		"downloaded": downloaded,
		"total":      total,
		"percent":    percent,
	})
}
