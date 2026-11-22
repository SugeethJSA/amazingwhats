package query

const (
	CreateMessageMediaTable = `
	CREATE TABLE IF NOT EXISTS message_media (
		message_id TEXT PRIMARY KEY,
		type INTEGER NOT NULL,
		url TEXT,
		mimetype TEXT,
		direct_path TEXT,
		media_key BLOB,
		file_sha256 BLOB,
		file_enc_sha256 BLOB,
		width INTEGER,
		height INTEGER,
		file_name TEXT,
		gif_playback INTEGER DEFAULT 0,
		thumbnail BLOB,
		ptt INTEGER DEFAULT 0,
		seconds INTEGER DEFAULT 0,
		waveform BLOB,
		file_length INTEGER DEFAULT 0
	);
	`

	// AddGifPlaybackColumn / AddThumbnailColumn / AddPTAColumns / AddFileLengthColumn
	// migrate existing message_media tables that predate those columns. SQLite has no
	// ADD COLUMN IF NOT EXISTS, so the caller ignores the "duplicate column"
	// error on subsequent runs.
	AddGifPlaybackColumn = `
	ALTER TABLE message_media ADD COLUMN gif_playback INTEGER DEFAULT 0;
	`

	AddThumbnailColumn = `
	ALTER TABLE message_media ADD COLUMN thumbnail BLOB;
	`

	AddPTAColumns = `
	ALTER TABLE message_media ADD COLUMN ptt INTEGER DEFAULT 0;
	ALTER TABLE message_media ADD COLUMN seconds INTEGER DEFAULT 0;
	ALTER TABLE message_media ADD COLUMN waveform BLOB;
	`

	AddFileLengthColumn = `
	ALTER TABLE message_media ADD COLUMN file_length INTEGER DEFAULT 0;
	`

	// InsertMessageMedia uses ON CONFLICT rather than REPLACE so a re-sync that
	// arrives without a thumbnail cannot erase one already cached for the row.
	// All 17 fork columns are preserved; COALESCE keeps existing values when the
	// incoming row has NULL for the optional playback/PTT/thumbnail fields.
	InsertMessageMedia = `
	INSERT INTO message_media
	(message_id, type, url, mimetype, direct_path, media_key, file_sha256, file_enc_sha256, width, height, file_name, gif_playback, thumbnail, ptt, seconds, waveform, file_length)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(message_id) DO UPDATE SET
		type = excluded.type,
		url = excluded.url,
		mimetype = excluded.mimetype,
		direct_path = excluded.direct_path,
		media_key = excluded.media_key,
		file_sha256 = excluded.file_sha256,
		file_enc_sha256 = excluded.file_enc_sha256,
		width = excluded.width,
		height = excluded.height,
		file_name = excluded.file_name,
		gif_playback = COALESCE(excluded.gif_playback, message_media.gif_playback),
		thumbnail = COALESCE(excluded.thumbnail, message_media.thumbnail),
		ptt = COALESCE(excluded.ptt, message_media.ptt),
		seconds = COALESCE(excluded.seconds, message_media.seconds),
		waveform = COALESCE(excluded.waveform, message_media.waveform),
		file_length = COALESCE(excluded.file_length, message_media.file_length);
	`

	SelectGifPlaybackByMessageID = `
	SELECT gif_playback FROM message_media WHERE message_id = ?;
	`

	SelectDimensionsByMessageID = `
	SELECT width, height FROM message_media WHERE message_id = ?;
	`

	SelectThumbnailByMessageID = `
	SELECT thumbnail FROM message_media WHERE message_id = ?;
	`

	UpdateMessageMediaByMessageID = `
	UPDATE message_media
	SET type = ?, url = ?, mimetype = ?, direct_path = ?, media_key = ?, file_sha256 = ?, file_enc_sha256 = ?, width = ?, height = ?, file_name = ?, ptt = ?, seconds = ?, waveform = ?
	WHERE message_id = ?;
	`

	SelectMessageMediaByMessageID = `
	SELECT type, url, mimetype, direct_path, media_key, file_sha256, file_enc_sha256, width, height, file_name, file_length
	FROM message_media
	WHERE message_id = ?;
	`

	SelectMediaMetaByMessageID = `
	SELECT direct_path, file_enc_sha256 FROM message_media WHERE message_id = ?;
	`

	UpdateThumbnailByMessageID = `
	UPDATE message_media SET thumbnail = ? WHERE message_id = ?;
	`
)
