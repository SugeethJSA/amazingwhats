package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"reflect"

	"github.com/lugvitc/whats4linux/internal/query"
)

// SavePollMetadata stores a poll's question and option names so incoming
// votes (which carry only hashes of option names) can be mapped back to
// option indices.
func (ms *MessageStore) SavePollMetadata(chatJID, messageID, question string, options []string) error {
	opts, err := json.Marshal(options)
	if err != nil {
		return err
	}
	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.InsertPoll, chatJID, messageID, question, string(opts))
		return err
	})
}

// GetPollMetadata returns the poll question and option names. The second
// return value is false when no metadata exists for the poll.
func (ms *MessageStore) GetPollMetadata(chatJID, messageID string) (string, []string, bool, error) {
	var question, optionsJSON string
	err := ms.db.QueryRow(query.SelectPoll, chatJID, messageID).Scan(&question, &optionsJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil, false, nil
		}
		return "", nil, false, err
	}
	var options []string
	if err := json.Unmarshal([]byte(optionsJSON), &options); err != nil {
		return "", nil, false, err
	}
	return question, options, true, nil
}

// UpsertPollVote records (or replaces) one voter's selection for a poll.
// Re-votes replace the previous selection for the same voter.
func (ms *MessageStore) UpsertPollVote(chatJID, pollMessageID, voterJID string, optionIndices []int) error {
	indices, err := json.Marshal(optionIndices)
	if err != nil {
		return err
	}
	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.UpsertPollVote, chatJID, pollMessageID, voterJID, string(indices))
		return err
	})
}

// GetPollVotes returns every stored vote for a poll, keyed by voter JID.
func (ms *MessageStore) GetPollVotes(chatJID, pollMessageID string) (map[string][]int, error) {
	rows, err := ms.db.Query(query.SelectPollVotes, chatJID, pollMessageID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	votes := make(map[string][]int)
	for rows.Next() {
		var voter, indicesJSON string
		if err := rows.Scan(&voter, &indicesJSON); err != nil {
			return nil, err
		}
		var indices []int
		if err := json.Unmarshal([]byte(indicesJSON), &indices); err != nil {
			continue
		}
		votes[voter] = indices
	}
	return votes, rows.Err()
}

// UpdatePollCardText rewrites the stored HTML of a poll card message so
// persisted history and the chat list reflect current vote counts.
func (ms *MessageStore) UpdatePollCardText(messageID, html string) error {
	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.UpdatePollCardText, html, messageID)
		return err
	})
}

// DeletePollVote removes one voter's selection. The fork schema is keyed by
// (chat_jid, poll_message_id, voter_jid), so all three keys are required.
func (ms *MessageStore) DeletePollVote(chatJID, pollMessageID, voterJID string) error {
	return ms.runSync(func(tx *sql.Tx) error {
		_, err := tx.Exec(query.DeletePollVote, chatJID, pollMessageID, voterJID)
		return err
	})
}

const (
	pragmaPollsTableInfo = `SELECT name, pk FROM pragma_table_info('polls') ORDER BY cid`
	pragmaVotesTableInfo = `SELECT name, pk FROM pragma_table_info('poll_votes') ORDER BY cid`
	pollsBackupTable     = "polls__upstream_backup"
	votesBackupTable     = "poll_votes__upstream_backup"
	idxPollVotesPoll     = "idx_poll_votes_poll"
)

// sqlQuerier is implemented by both *sql.DB and *sql.Tx.
type sqlQuerier interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

// pollTableShape returns ordered column names and 1-based primary-key
// positions reported by pragma_table_info for one poll table.
func pollTableShape(q sqlQuerier, pragma string) ([]string, []int, error) {
	rows, err := q.Query(pragma)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = rows.Close() }()
	var columns []string
	var pkPositions []int
	for rows.Next() {
		var name string
		var pk int
		if err := rows.Scan(&name, &pk); err != nil {
			return nil, nil, err
		}
		columns = append(columns, name)
		if pk > 0 {
			pkPositions = append(pkPositions, pk)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return columns, pkPositions, nil
}

func columnIn(columns []string, names ...string) bool {
	for _, col := range columns {
		for _, name := range names {
			if col == name {
				return true
			}
		}
	}
	return false
}

// pollTablesHaveUpstreamShape reports which poll tables use the incompatible
// upstream schema: polls.name/selectable_count or poll_votes.sender_jid/updated_at.
func pollTablesHaveUpstreamShape(tx *sql.Tx) (pollsUpstream, votesUpstream bool, err error) {
	pollsCols, _, err := pollTableShape(tx, pragmaPollsTableInfo)
	if err != nil {
		return false, false, err
	}
	votesCols, _, err := pollTableShape(tx, pragmaVotesTableInfo)
	if err != nil {
		return false, false, err
	}
	return columnIn(pollsCols, "name", "selectable_count"),
		columnIn(votesCols, "sender_jid", "updated_at"), nil
}

// assertPollSchemaShape fails fast if the fork DDL was not actually installed
// (CREATE TABLE IF NOT EXISTS can silently retain an upstream-shaped table).
func assertPollSchemaShape(q sqlQuerier) error {
	pollsCols, pollsPK, err := pollTableShape(q, pragmaPollsTableInfo)
	if err != nil {
		return fmt.Errorf("inspect polls schema: %w", err)
	}
	if !reflect.DeepEqual(pollsCols, []string{"chat_jid", "message_id", "question", "options_json"}) ||
		!reflect.DeepEqual(pollsPK, []int{1, 2}) {
		return fmt.Errorf("polls schema mismatch: columns=%v pk=%v; want [chat_jid message_id question options_json] pk [1 2]", pollsCols, pollsPK)
	}

	votesCols, votesPK, err := pollTableShape(q, pragmaVotesTableInfo)
	if err != nil {
		return fmt.Errorf("inspect poll_votes schema: %w", err)
	}
	if !reflect.DeepEqual(votesCols, []string{"chat_jid", "poll_message_id", "voter_jid", "option_indices_json"}) ||
		!reflect.DeepEqual(votesPK, []int{1, 2, 3}) {
		return fmt.Errorf("poll_votes schema mismatch: columns=%v pk=%v; want [chat_jid poll_message_id voter_jid option_indices_json] pk [1 2 3]", votesCols, votesPK)
	}

	for _, col := range append(append([]string{}, pollsCols...), votesCols...) {
		switch col {
		case "updated_at", "name", "sender_jid", "selectable_count":
			return fmt.Errorf("poll schema still contains upstream-only column %q", col)
		}
	}

	var indexCount int
	if err := q.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?`, idxPollVotesPoll).Scan(&indexCount); err != nil {
		return fmt.Errorf("inspect %s: %w", idxPollVotesPoll, err)
	}
	if indexCount != 1 {
		return fmt.Errorf("%s: found %d indexes, want exactly 1", idxPollVotesPoll, indexCount)
	}
	return nil
}

func tableExists(q sqlQuerier, table string) (bool, error) {
	var count int
	if err := q.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func messageChatJID(q sqlQuerier, messageID string) (string, bool, error) {
	var chatJID string
	err := q.QueryRow(`SELECT chat_jid FROM messages WHERE message_id = ? LIMIT 1`, messageID).Scan(&chatJID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", false, nil
		}
		return "", false, err
	}
	return chatJID, true, nil
}

type upstreamPollBackupRow struct {
	messageID   string
	name        string
	optionsJSON string
}

type upstreamVoteBackupRow struct {
	pollMessageID string
	senderJID     string
	optionsJSON   string
}

// maybeBackfillPollTables restores data from upstream-shaped poll tables that
// the startup migration moved aside. Backups are dropped ONLY when every row
// was restored; if any row had to be skipped (missing messages row or poll
// metadata, unknown option name), the backups are retained so the skipped data
// is not irreversibly lost and a later retry can pick it up. It is a no-op on
// fresh or already-fork-shaped databases.
func (ms *MessageStore) maybeBackfillPollTables() error {
	pollsBackup, err := tableExists(ms.db, pollsBackupTable)
	if err != nil {
		return err
	}
	votesBackup, err := tableExists(ms.db, votesBackupTable)
	if err != nil {
		return err
	}
	if !pollsBackup && !votesBackup {
		return nil
	}

	var polls []upstreamPollBackupRow
	if pollsBackup {
		rows, err := ms.db.Query(`SELECT message_id, name, options_json FROM ` + pollsBackupTable)
		if err != nil {
			return err
		}
		for rows.Next() {
			var row upstreamPollBackupRow
			if err := rows.Scan(&row.messageID, &row.name, &row.optionsJSON); err != nil {
				_ = rows.Close()
				return err
			}
			polls = append(polls, row)
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return err
		}
	}

	var votes []upstreamVoteBackupRow
	if votesBackup {
		rows, err := ms.db.Query(`SELECT poll_message_id, sender_jid, options_json FROM ` + votesBackupTable)
		if err != nil {
			return err
		}
		for rows.Next() {
			var row upstreamVoteBackupRow
			if err := rows.Scan(&row.pollMessageID, &row.senderJID, &row.optionsJSON); err != nil {
				_ = rows.Close()
				return err
			}
			votes = append(votes, row)
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return err
		}
	}

	var pollsRestored, pollsSkipped, votesRestored, votesSkipped int

	for _, row := range polls {
		chatJID, found, err := messageChatJID(ms.db, row.messageID)
		if err != nil {
			return err
		}
		if !found {
			log.Printf("poll schema upgrade: skipping poll %q: no messages row for message_id", row.messageID)
			pollsSkipped++
			continue
		}
		var options []string
		if err := json.Unmarshal([]byte(row.optionsJSON), &options); err != nil {
			return fmt.Errorf("decode upstream poll options for %q: %w", row.messageID, err)
		}
		if err := ms.SavePollMetadata(chatJID, row.messageID, row.name, options); err != nil {
			return fmt.Errorf("backfill poll metadata for %q: %w", row.messageID, err)
		}
		pollsRestored++
	}

	for _, row := range votes {
		chatJID, found, err := messageChatJID(ms.db, row.pollMessageID)
		if err != nil {
			return err
		}
		if !found {
			log.Printf("poll schema upgrade: skipping vote for %q: no messages row for poll_message_id", row.pollMessageID)
			votesSkipped++
			continue
		}
		_, options, found, err := ms.GetPollMetadata(chatJID, row.pollMessageID)
		if err != nil {
			return err
		}
		if !found {
			log.Printf("poll schema upgrade: skipping vote for %q: no restored poll options", row.pollMessageID)
			votesSkipped++
			continue
		}
		var selected []string
		if err := json.Unmarshal([]byte(row.optionsJSON), &selected); err != nil {
			return fmt.Errorf("decode upstream vote options for %q: %w", row.pollMessageID, err)
		}
		indexByName := make(map[string]int, len(options))
		for i, name := range options {
			indexByName[name] = i
		}
		indices := make([]int, 0, len(selected))
		valid := true
		for _, name := range selected {
			idx, exists := indexByName[name]
			if !exists {
				log.Printf("poll schema upgrade: skipping vote for %q: unknown option %q", row.pollMessageID, name)
				valid = false
				break
			}
			indices = append(indices, idx)
		}
		if !valid {
			votesSkipped++
			continue
		}
		if err := ms.UpsertPollVote(chatJID, row.pollMessageID, row.senderJID, indices); err != nil {
			return fmt.Errorf("backfill poll vote for %q: %w", row.pollMessageID, err)
		}
		votesRestored++
	}

	log.Printf("poll schema upgrade: restored %d polls / %d votes; skipped %d polls / %d votes",
		pollsRestored, votesRestored, pollsSkipped, votesSkipped)

	// Never destroy the source data while rows remain unrecoverable. The
	// backfill is idempotent (INSERT OR REPLACE), so a later startup retries
	// the skipped rows against the retained backups.
	if pollsSkipped > 0 || votesSkipped > 0 {
		log.Printf("poll schema upgrade: retaining %s and %s because rows were skipped",
			pollsBackupTable, votesBackupTable)
		return nil
	}

	return ms.runSync(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DROP TABLE IF EXISTS ` + pollsBackupTable); err != nil {
			return err
		}
		if _, err := tx.Exec(`DROP TABLE IF EXISTS ` + votesBackupTable); err != nil {
			return err
		}
		return nil
	})
}

// LogPollMetadataError is a small helper to keep call sites terse.
func LogPollMetadataError(action string, err error) {
	if err != nil {
		log.Println("poll store:", action, "failed:", err)
	}
}
