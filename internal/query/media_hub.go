package query

// MediaHubSelect is the base cross-chat query for the combined Media / Docs /
// Links viewer. message_media and link_previews have no chat column, so both
// are joined through messages. Kind filters are appended by the store method.
const MediaHubSelect = `
SELECT m.chat_jid, m.message_id, m.sender_jid, m.timestamp, m.is_from_me,
       COALESCE(mm.type, 0), COALESCE(mm.mimetype, ''), COALESCE(mm.file_name, ''),
       COALESCE(mm.file_length, 0), COALESCE(mm.direct_path, ''),
       COALESCE(m.text, ''), COALESCE(lp.url, ''), COALESCE(lp.title, ''),
       COALESCE(lp.description, ''), COALESCE(mm.width, 0), COALESCE(mm.height, 0),
       COALESCE(mm.gif_playback, 0)
FROM messages m
LEFT JOIN message_media mm ON mm.message_id = m.message_id
LEFT JOIN link_previews lp ON lp.message_id = m.message_id
WHERE 1 = 1
`
