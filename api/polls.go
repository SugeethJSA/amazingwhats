package api

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/proto/waCommon"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
	"github.com/polymorfa/hypermeow/util/gcmutil"
	"github.com/polymorfa/hypermeow/util/hkdfutil"
	"go.mau.fi/util/random"
	"google.golang.org/protobuf/proto"
)

// PollOptionVotes is the vote tally for a single poll option.
type PollOptionVotes struct {
	Name  string `json:"name"`
	Votes int    `json:"votes"`
}

// PollVotesResult is the full vote state of a poll: per-option counts, the
// total number of voters and the current user's selection.
type PollVotesResult struct {
	Question      string            `json:"question"`
	Options       []PollOptionVotes `json:"options"`
	TotalVotes    int               `json:"totalVotes"`
	MyVoteIndices []int             `json:"myVoteIndices"`
	HasVoted      bool              `json:"hasVoted"`
}

// GetPollVotes returns the aggregated vote counts for a poll. Polls created
// before vote tracking existed fall back to option names parsed from the
// stored poll card HTML.
func (a *Api) GetPollVotes(chatJID, pollMessageID string) (PollVotesResult, error) {
	res := PollVotesResult{Question: ""}
	question, options, found, err := a.messageStore.GetPollMetadata(chatJID, pollMessageID)
	if err != nil {
		return res, err
	}
	if !found {
		question, options = a.pollOptionsFromCard(chatJID, pollMessageID)
	}
	if len(options) == 0 {
		return res, fmt.Errorf("poll %s not found in %s", pollMessageID, chatJID)
	}

	votes, err := a.messageStore.GetPollVotes(chatJID, pollMessageID)
	if err != nil {
		return res, err
	}

	res.Question = question
	res.Options = make([]PollOptionVotes, len(options))
	for i, name := range options {
		res.Options[i] = PollOptionVotes{Name: name}
	}
	res.TotalVotes = len(votes)

	myJID := ""
	if a.waClient != nil && a.waClient.Store.ID != nil {
		myJID = a.waClient.Store.ID.ToNonAD().String()
	}
	seen := make([]int, len(options))
	for voter, indices := range votes {
		for _, idx := range indices {
			if idx >= 0 && idx < len(seen) {
				seen[idx]++
			}
		}
		if myJID != "" && voter == myJID {
			res.MyVoteIndices = indices
			res.HasVoted = true
		}
	}
	for i := range res.Options {
		res.Options[i].Votes = seen[i]
	}
	return res, nil
}

// pollOptionsFromCard extracts question + option names from the stored poll
// card HTML (used for polls that predate the polls metadata table).
func (a *Api) pollOptionsFromCard(chatJID, pollMessageID string) (string, []string) {
	dm, err := a.messageStore.GetDecodedMessage(chatJID, pollMessageID)
	if err != nil {
		return "", nil
	}
	if dm.Content == nil {
		return "", nil
	}
	return store.ParsePollCardHTML(dm.Content.Conversation)
}

// SendPollVote votes in a poll from the app's own UI. The vote is sent via
// WhatsApp's msgsecret encryption and also recorded locally so the tally
// updates instantly.
func (a *Api) SendPollVote(chatJID, pollMessageID string, selectedOptions []string) (string, error) {
	if len(selectedOptions) == 0 {
		return "", fmt.Errorf("no poll options selected")
	}
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("not logged in")
	}
	chat, err := types.ParseJID(chatJID)
	if err != nil {
		return "", err
	}
	original, err := a.messageStore.GetDecodedMessage(chatJID, pollMessageID)
	if err != nil {
		return "", fmt.Errorf("poll message not found: %w", err)
	}
	senderJID, err := types.ParseJID(original.Info.Sender)
	if err != nil {
		return "", fmt.Errorf("invalid poll sender JID: %w", err)
	}
	pollTS, err := time.Parse(time.RFC3339, original.Info.Timestamp)
	if err != nil {
		pollTS = time.Now()
	}
	pollInfo := &types.MessageInfo{
		MessageSource: types.MessageSource{
			Chat:     chat,
			Sender:   senderJID.ToNonAD(),
			IsFromMe: original.Info.IsFromMe,
			IsGroup:  chat.Server == types.GroupServer,
		},
		ID:        pollMessageID,
		PushName:  "",
		Timestamp: pollTS,
	}
	voteMsg, err := a.buildPollVoteLID(a.ctx, pollInfo, selectedOptions)
	if err != nil {
		return "", fmt.Errorf("failed to build poll vote: %w", err)
	}

	// Record our own vote locally BEFORE sending so the tally reflects it
	// immediately and a failed store is never silently swallowed.
	_, options, found, err := a.messageStore.GetPollMetadata(chatJID, pollMessageID)
	if err != nil {
		return "", fmt.Errorf("failed to load poll options for own vote: %w", err)
	}
	if !found {
		_, options = a.pollOptionsFromCard(chatJID, pollMessageID)
	}
	if len(options) == 0 {
		return "", fmt.Errorf("poll options unknown, cannot record own vote")
	}
	indices := a.matchVoteHashes(options, whatsmeow.HashPollOptions(selectedOptions))
	if len(indices) == 0 {
		return "", fmt.Errorf("none of the selected poll options matched stored options")
	}
	ownJID := canonicalUserJID(a.ctx, a.waClient, *a.waClient.Store.ID).String()
	if err := a.messageStore.UpsertPollVote(chatJID, pollMessageID, ownJID, indices); err != nil {
		return "", fmt.Errorf("failed to store own poll vote: %w", err)
	}
	a.refreshPollCard(chatJID, pollMessageID)

	resp, err := a.waClient.SendMessage(a.ctx, chat, &waE2E.Message{PollUpdateMessage: voteMsg})
	if err != nil {
		if derr := a.messageStore.DeletePollVote(chatJID, pollMessageID, ownJID); derr != nil {
			slog.Warn("DeletePollVote failed during poll vote rollback", "source", "polls", "error", derr)
		}
		a.refreshPollCard(chatJID, pollMessageID)
		return "", fmt.Errorf("failed to send poll vote: %w", err)
	}

	slog.Info(fmt.Sprintf("Voted in poll %s in %s (%d options selected)", pollMessageID, chatJID, len(selectedOptions)), "source", "messages")
	a.app.Event.Emit("wa:poll_vote_submitted", map[string]any{
		"chatId":    chatJID,
		"messageID": pollMessageID,
		"options":   selectedOptions,
	})
	a.refreshPollCard(chatJID, pollMessageID)
	return resp.ID, nil
}

// buildPollVoteLID builds a poll vote message using the LID (falling back to
// the plain JID when no LID migration has happened) as the modification
// sender. whatsmeow's BuildPollVote uses the plain JID whenever the poll
// creator is a non-LID user, which breaks decryption on LID-migrated devices
// that see our message sender as our LID. Reactions always use the LID, so we
// mirror that here.
func (a *Api) buildPollVoteLID(ctx context.Context, pollInfo *types.MessageInfo, optionNames []string) (*waE2E.PollUpdateMessage, error) {
	plaintext, err := proto.Marshal(&waE2E.PollVoteMessage{
		SelectedOptions: whatsmeow.HashPollOptions(optionNames),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal poll vote protobuf: %w", err)
	}
	ownID := a.waClient.Store.GetLID()
	if ownID.IsEmpty() {
		ownID = a.waClient.Store.GetJID()
	}
	baseEncKey, storedOrigSender, err := a.waClient.Store.MsgSecrets.GetMessageSecret(ctx, pollInfo.Chat, pollInfo.Sender, pollInfo.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get original message secret key: %w", err)
	}
	if baseEncKey == nil {
		return nil, whatsmeow.ErrOriginalMessageSecretNotFound
	}
	secretKey, additionalData := generatePollVoteSecretKey(ownID, pollInfo.ID, storedOrigSender, baseEncKey)
	iv := random.Bytes(12)
	ciphertext, err := gcmutil.Encrypt(secretKey, iv, plaintext, additionalData)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt poll vote: %w", err)
	}
	return &waE2E.PollUpdateMessage{
		PollCreationMessageKey: pollCreationMessageKey(pollInfo),
		Vote: &waE2E.PollEncValue{
			EncPayload: ciphertext,
			EncIV:      iv,
		},
		SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
	}, nil
}

func pollCreationMessageKey(msgInfo *types.MessageInfo) *waCommon.MessageKey {
	creationKey := &waCommon.MessageKey{
		RemoteJID: proto.String(msgInfo.Chat.String()),
		FromMe:    proto.Bool(msgInfo.IsFromMe),
		ID:        proto.String(msgInfo.ID),
	}
	if msgInfo.IsGroup {
		creationKey.Participant = proto.String(msgInfo.Sender.String())
	}
	return creationKey
}

// generatePollVoteSecretKey mirrors whatsmeow's generateMsgSecretKey for the
// "Poll Vote" modification type: HKDF-SHA256 over the original message ID,
// original sender, modification sender and use case.
func generatePollVoteSecretKey(modificationSender types.JID, origMsgID types.MessageID, origMsgSender types.JID, origMsgSecret []byte) ([]byte, []byte) {
	const modificationType = "Poll Vote"
	origMsgSenderStr := origMsgSender.ToNonAD().String()
	modificationSenderStr := modificationSender.ToNonAD().String()

	useCaseSecret := make([]byte, 0, len(origMsgID)+len(origMsgSenderStr)+len(modificationSenderStr)+len(modificationType))
	useCaseSecret = append(useCaseSecret, origMsgID...)
	useCaseSecret = append(useCaseSecret, origMsgSenderStr...)
	useCaseSecret = append(useCaseSecret, modificationSenderStr...)
	useCaseSecret = append(useCaseSecret, modificationType...)

	secretKey := hkdfutil.SHA256(origMsgSecret, nil, useCaseSecret, 32)
	additionalData := fmt.Appendf(nil, "%s\x00%s", origMsgID, modificationSenderStr)
	return secretKey, additionalData
}

// pollVoteSelfJID reports whether sender is one of our own identities
// (canonical PN, LID lookalike, or reversed LID→PN lookup) and returns our
// canonical PN JID so own-vote echoes always overwrite the same row. Returns
// "" when the sender is someone else or we aren't logged in.
func (a *Api) pollVoteSelfJID(sender types.JID) string {
	if a.waClient.Store.ID == nil {
		return ""
	}
	ownJID := canonicalUserJID(a.ctx, a.waClient, a.waClient.Store.GetJID()).String()
	if canonicalUserJID(a.ctx, a.waClient, sender).String() == ownJID {
		return ownJID
	}
	agent := sender.ActualAgent()
	if agent != types.LIDDomain && agent != types.HostedLIDDomain {
		return ""
	}
	ownLID := a.waClient.Store.GetLID()
	if ownLID.User != "" && ownLID.User == sender.User && ownLID.Server == sender.Server {
		return ownJID
	}
	if senderPN, err := a.waClient.Store.LIDs.GetPNForLID(a.ctx, sender); err == nil && senderPN.User == a.waClient.Store.GetJID().ToNonAD().User {
		return ownJID
	}
	return ""
}

// handlePollVoteEvent processes an incoming encrypted poll vote: decrypts it,
// maps the option hashes back to option indices, stores the vote and re-
// renders the poll card so counts appear for everyone.
func (a *Api) handlePollVoteEvent(v *events.Message) {
	pollUpdate := v.Message.GetPollUpdateMessage()
	if pollUpdate == nil {
		return
	}
	key := pollUpdate.GetPollCreationMessageKey()
	if key == nil || key.GetID() == "" {
		return
	}
	chatJID := v.Info.Chat.String()
	pollMessageID := key.GetID()

	decrypted, err := a.waClient.DecryptPollVote(a.ctx, v)
	if err != nil {
		slog.Warn("Failed to decrypt poll vote", "source", "polls", "error", err)
		return
	}
	selected := decrypted.GetSelectedOptions()

	_, options, found, err := a.messageStore.GetPollMetadata(chatJID, pollMessageID)
	if err != nil {
		slog.Warn("GetPollMetadata failed", "source", "polls", "error", err)
		return
	}
	if !found {
		_, options = a.pollOptionsFromCard(chatJID, pollMessageID)
	}
	if len(options) == 0 {
		slog.Warn("Poll options unknown, cannot record vote", "source", "polls", "poll", pollMessageID)
		return
	}

	indices := a.matchVoteHashes(options, selected)
	if len(indices) == 0 {
		slog.Warn("No matching poll options for vote", "source", "polls", "poll", pollMessageID)
		return
	}

	// Own votes echo back with our LID or PN depending on the device. Always
	// store them under the canonical PN JID used by GetPollVotes so HasVoted
	// and re-votes keep matching the same row.
	voter := canonicalUserJID(a.ctx, a.waClient, v.Info.Sender).String()
	if own := a.pollVoteSelfJID(v.Info.Sender); own != "" {
		voter = own
	}
	if err := a.messageStore.UpsertPollVote(chatJID, pollMessageID, voter, indices); err != nil {
		slog.Warn("UpsertPollVote failed", "source", "polls", "error", err)
		return
	}

	a.refreshPollCard(chatJID, pollMessageID)
}

// matchVoteHashes maps the SHA-256 hashes carried by a vote back to option
// indices by comparing against hashes of the poll's option names.
func (a *Api) matchVoteHashes(options []string, voteHashes [][]byte) []int {
	optionHashes := whatsmeow.HashPollOptions(options)
	seen := make(map[int]bool)
	var indices []int
	for _, voteHash := range voteHashes {
		for i, optHash := range optionHashes {
			if bytes.Equal(voteHash, optHash) && !seen[i] {
				seen[i] = true
				indices = append(indices, i)
			}
		}
	}
	return indices
}

// refreshPollCard recomputes the poll's vote tally, re-renders its HTML card
// with counts, persists it and pushes the update to every open window.
func (a *Api) refreshPollCard(chatJID, pollMessageID string) {
	question, options, found, err := a.messageStore.GetPollMetadata(chatJID, pollMessageID)
	if err != nil {
		slog.Warn("GetPollMetadata failed during refresh", "source", "polls", "error", err)
		return
	}
	if !found {
		question, options = a.pollOptionsFromCard(chatJID, pollMessageID)
	}
	if len(options) == 0 {
		return
	}

	votes, err := a.messageStore.GetPollVotes(chatJID, pollMessageID)
	if err != nil {
		slog.Warn("GetPollVotes failed during refresh", "source", "polls", "error", err)
		return
	}
	counts := make([]int, len(options))
	for _, indices := range votes {
		for _, idx := range indices {
			if idx >= 0 && idx < len(counts) {
				counts[idx]++
			}
		}
	}
	var myIndices []int
	if a.waClient != nil && a.waClient.Store.ID != nil {
		myJID := a.waClient.Store.ID.ToNonAD().String()
		if my, ok := votes[myJID]; ok {
			myIndices = my
		}
	}

	html := store.RenderPollCard(question, options, counts, myIndices)
	if err := a.messageStore.UpdatePollCardText(pollMessageID, html); err != nil {
		slog.Warn("UpdatePollCardText failed", "source", "polls", "error", err)
		return
	}

	a.app.Event.Emit("wa:poll_vote_update", map[string]any{
		"chatId":    chatJID,
		"messageID": pollMessageID,
	})

	if dm, derr := a.messageStore.GetDecodedMessage(chatJID, pollMessageID); derr == nil {
		pollTS, perr := time.Parse(time.RFC3339, dm.Info.Timestamp)
		if perr != nil {
			pollTS = time.Now()
		}
		a.app.Event.Emit("wa:new_message", map[string]any{
			"chatId":      chatJID,
			"message":     dm,
			"messageText": html,
			"timestamp":   pollTS.Unix(),
			"sender":      dm.Info.PushName,
			"pollUpdate":  true,
		})
	}
	a.app.Event.Emit("wa:chat_list_refresh")
}
