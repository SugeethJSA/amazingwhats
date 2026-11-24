package query

const (
	// CreateCallLogTable holds structured call history received from WhatsApp
	// (history sync, app state) as well as calls placed locally. The index is
	// created alongside the table so callers need a single Exec to install the
	// schema (matching the pinned_messages pattern).
	CreateCallLogTable = `
	CREATE TABLE IF NOT EXISTS call_log (
		call_id TEXT PRIMARY KEY,
		peer_jid TEXT NOT NULL DEFAULT '',
		group_jid TEXT NOT NULL DEFAULT '',
		is_incoming BOOLEAN NOT NULL DEFAULT FALSE,
		is_video BOOLEAN NOT NULL DEFAULT FALSE,
		result TEXT NOT NULL DEFAULT '',
		started_at INTEGER NOT NULL,
		duration_secs INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX IF NOT EXISTS idx_call_log_started_at ON call_log(started_at DESC);
	`
	UpsertCallLogEntry = `
	INSERT INTO call_log
		(call_id, peer_jid, group_jid, is_incoming, is_video, result, started_at, duration_secs, source)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(call_id) DO UPDATE SET
		peer_jid = excluded.peer_jid,
		group_jid = excluded.group_jid,
		is_incoming = excluded.is_incoming,
		is_video = excluded.is_video,
		result = excluded.result,
		started_at = excluded.started_at,
		duration_secs = excluded.duration_secs,
		source = excluded.source;
	`
	SelectRecentCalls = `
	SELECT call_id, peer_jid, group_jid, is_incoming, is_video, result, started_at, duration_secs, source
	FROM call_log
	ORDER BY started_at DESC
	LIMIT ?;
	`
)
