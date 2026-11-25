package api

// D-ID WIRE-003: Go bindings for the unwired HyperMeow MESSAGING Client APIs.
//
// Every exported method below is prefixed Wire* so it cannot collide with an
// existing Api binding, including the ones added by WIRE-001 (api/hypermeow_wire.go)
// and WIRE-002 (api/hypermeow_media_wire.go). Inputs are limited to primitive
// values (JID/message-ID strings, base64 strings for byte or encoded-protobuf
// fields, bools and string slices); results are small JSON-tagged DTOs. No raw
// protobuf or *events.Message crosses the Wails boundary in either direction.
//
// Methods that consume *types.MessageInfo reconstruct a real one from the
// message store by chat JID + message ID. A missing row is a hard error; no
// message object is ever fabricated. No message body is logged anywhere here.

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	"google.golang.org/protobuf/proto"

	whatsmeow "github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/proto/waCommon"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/types"
)

// ---------------------------------------------------------------------------
// DTOs owned by this file (safe to serialise to the frontend)
// ---------------------------------------------------------------------------

// WireMessageSendResult is the JSON-safe projection of whatsmeow.SendResponse.
type WireMessageSendResult struct {
	ID            string `json:"id"`
	ServerID      int    `json:"serverId,omitempty"`
	Timestamp     int64  `json:"timestamp,omitempty"`
	Sender        string `json:"sender,omitempty"`
	Chat          string `json:"chat,omitempty"`
	PHashMismatch bool   `json:"pHashMismatch"`
}

// WireMessageKeyDTO mirrors waCommon.MessageKey without exposing the protobuf.
type WireMessageKeyDTO struct {
	RemoteJID   string `json:"remoteJid,omitempty"`
	FromMe      bool   `json:"fromMe"`
	ID          string `json:"id,omitempty"`
	Participant string `json:"participant,omitempty"`
}

// WireBuiltMessageDTO is a JSON-safe description of a built message.
// MessageBase64 is the real built waE2E.Message, protobuf-marshaled and then
// base64-encoded (the WIRE-002 transport), so the frontend can actually deliver
// what was built instead of discarding it. No protobuf pointer crosses IPC.
// Type/ProtocolType/TargetKey are scalar projections of that same real message;
// Text stays empty because inventing a human-readable body would be misleading.
// ID is the target message ID from the built key, or the real SendResponse.ID
// when send=true.
type WireBuiltMessageDTO struct {
	Type          string             `json:"type"`
	Text          string             `json:"text,omitempty"`
	ID            string             `json:"id,omitempty"`
	ProtocolType  string             `json:"protocolType,omitempty"`
	TargetKey     *WireMessageKeyDTO `json:"targetKey,omitempty"`
	MessageBase64 string             `json:"message_base64"`
}

// WireHistorySyncDTO is the JSON-safe, metadata-only projection of a parsed
// waHistorySync.HistorySync. No conversation content, push names or contacts
// are returned: the client already stores those through the normal event path.
type WireHistorySyncDTO struct {
	SyncType          string `json:"syncType"`
	ChunkOrder        uint32 `json:"chunkOrder"`
	Progress          uint32 `json:"progress"`
	Conversations     int    `json:"conversations"`
	PushNames         int    `json:"pushNames"`
	InlineContacts    int    `json:"inlineContacts"`
	RecentStickers    int    `json:"recentStickers"`
	CallLogRecords    int    `json:"callLogRecords"`
	HasGlobalSettings bool   `json:"hasGlobalSettings"`
}

// ---------------------------------------------------------------------------
// Shared helpers (unexported, so Wails does not bind them)
// ---------------------------------------------------------------------------

// wireMsgCtx tolerates a nil ServiceStartup context (e.g. in unit tests).
func wireMsgCtx(a *Api) context.Context {
	if a != nil && a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func wireMsgClient(a *Api) (*whatsmeow.Client, error) {
	if a == nil || a.waClient == nil {
		return nil, fmt.Errorf("WhatsApp client is not ready")
	}
	if a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	return a.waClient, nil
}

func wireMsgJID(raw string) (types.JID, error) {
	jid, err := types.ParseJID(raw)
	if err != nil {
		// Do not echo the raw value: it may be a phone number or LID.
		return types.EmptyJID, fmt.Errorf("invalid JID")
	}
	return jid, nil
}

// wireInfoFromStore is the single lookup point for every binding that needs a
// real *types.MessageInfo. It reads the actual row from the message store and
// derives only IsGroup from the chat JID (the store does not persist that flag),
// treating group chats and broadcast lists alike, as WIRE-002 does in
// WireSendMediaRetryReceipt. A missing row returns an error instead of an empty,
// fabricated MessageInfo.
func (a *Api) wireInfoFromStore(chatJID, messageID string) (*types.MessageInfo, error) {
	if chatJID == "" || messageID == "" {
		return nil, fmt.Errorf("chat JID and message ID are required")
	}
	chat, err := wireMsgJID(chatJID)
	if err != nil {
		return nil, err
	}
	if a.messageStore == nil {
		return nil, fmt.Errorf("message store is not ready")
	}
	stored, err := a.messageStore.GetMessageWithMedia(chatJID, messageID)
	if err != nil || stored == nil {
		// Deliberately do not wrap the DB error: it may embed the raw JID.
		return nil, fmt.Errorf("message not found in store for the given chat and ID")
	}
	info := stored.Info
	info.IsGroup = chat.Server == types.GroupServer || chat.IsBroadcastList()
	return &info, nil
}

func wireMessageKeyDTO(key *waCommon.MessageKey) *WireMessageKeyDTO {
	if key == nil {
		return nil
	}
	return &WireMessageKeyDTO{
		RemoteJID:   key.GetRemoteJID(),
		FromMe:      key.GetFromMe(),
		ID:          key.GetID(),
		Participant: key.GetParticipant(),
	}
}

func wireBuiltMessageDTO(kind, protocolType string, key *waCommon.MessageKey) WireBuiltMessageDTO {
	out := WireBuiltMessageDTO{Type: kind, ProtocolType: protocolType}
	if key != nil {
		out.ID = key.GetID()
		out.TargetKey = wireMessageKeyDTO(key)
	}
	return out
}

// wireFinishBuiltMessage mirrors WIRE-002's wireMarshalPeerRequest transport
// (hypermeow_media_wire.go:524): the real built waE2E.Message is
// protobuf-marshaled to base64 so no protobuf pointer crosses IPC. When send is
// true it is delivered through the supplied real send path, and the real
// SendResponse.ID replaces the DTO's target ID. A failed send returns an error
// rather than a fabricated success; with send=false the binding stays a pure
// Build call.
func wireFinishBuiltMessage(dto *WireBuiltMessageDTO, msg *waE2E.Message, send bool, deliver func() (whatsmeow.SendResponse, error)) error {
	raw, err := proto.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to serialize built message: %w", err)
	}
	if send {
		if deliver == nil {
			return fmt.Errorf("no send path configured for built message")
		}
		resp, err := deliver()
		if err != nil {
			return err
		}
		if resp.ID != "" {
			dto.ID = string(resp.ID)
		}
	}
	dto.MessageBase64 = base64.StdEncoding.EncodeToString(raw)
	return nil
}

// wireDecodeProtoBase64 decodes a base64-encoded, protobuf-marshaled message
// and unmarshals it into dst. This is the same transport WIRE-002 uses for
// WireDownloadAny: the wire carries a base64 string only, never a protobuf.
func wireDecodeProtoBase64(field, value string, dst proto.Message) error {
	if value == "" {
		return fmt.Errorf("%s must not be empty", field)
	}
	data, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return fmt.Errorf("invalid base64 in %s", field)
	}
	if err := proto.Unmarshal(data, dst); err != nil {
		return fmt.Errorf("invalid protobuf in %s", field)
	}
	return nil
}

// ---------------------------------------------------------------------------
// 1. Revoke
// ---------------------------------------------------------------------------

// WireRevokeMessage delegates to the pinned module's Client.RevokeMessage
// (send.go:538) and returns its server response. The long-standing
// Api.RevokeMessage (api/message.go:1026) is intentionally left untouched: it
// is owned by a separate change and additionally marks the row deleted locally.
// Upstream marks Client.RevokeMessage deprecated in favour of BuildRevoke; this
// binding deliberately calls the module method as requested.
func (a *Api) WireRevokeMessage(chatJID, messageID string) (WireMessageSendResult, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireMessageSendResult{}, err
	}
	if messageID == "" {
		return WireMessageSendResult{}, fmt.Errorf("missing message ID")
	}
	chat, err := wireMsgJID(chatJID)
	if err != nil {
		return WireMessageSendResult{}, err
	}
	resp, err := cli.RevokeMessage(wireMsgCtx(a), chat, types.MessageID(messageID))
	if err != nil {
		return WireMessageSendResult{}, fmt.Errorf("revoke message: %w", err)
	}
	return WireMessageSendResult{
		ID:            string(resp.ID),
		ServerID:      int(resp.ServerID),
		Timestamp:     resp.Timestamp.UnixMilli(),
		Sender:        resp.Sender.String(),
		Chat:          resp.Chat.String(),
		PHashMismatch: resp.PHashMismatch,
	}, nil
}

// ---------------------------------------------------------------------------
// 2. Message keys and protocol-message drafts
// ---------------------------------------------------------------------------

// WireBuildMessageKey mirrors Client.BuildMessageKey. An empty senderJID means
// "from me"; a real sender JID is required to address someone else's message
// in a group.
func (a *Api) WireBuildMessageKey(chatJID, senderJID, messageID string) (WireMessageKeyDTO, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireMessageKeyDTO{}, err
	}
	if messageID == "" {
		return WireMessageKeyDTO{}, fmt.Errorf("missing message ID")
	}
	chat, err := wireMsgJID(chatJID)
	if err != nil {
		return WireMessageKeyDTO{}, err
	}
	sender := types.EmptyJID
	if senderJID != "" {
		sender, err = wireMsgJID(senderJID)
		if err != nil {
			return WireMessageKeyDTO{}, err
		}
	}
	key := cli.BuildMessageKey(chat, sender, types.MessageID(messageID))
	dto := wireMessageKeyDTO(key)
	if dto == nil {
		return WireMessageKeyDTO{}, fmt.Errorf("failed to build message key")
	}
	return *dto, nil
}

// WireBuildUnavailableMessageRequest builds the placeholder-message-resend
// request via Client.BuildUnavailableMessageRequest. The real built message is
// returned as message_base64; with send=true it is also delivered through the
// documented SendPeerMessage path and its real response ID is returned.
func (a *Api) WireBuildUnavailableMessageRequest(chatJID, senderJID, messageID string, send bool) (WireBuiltMessageDTO, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	if messageID == "" {
		return WireBuiltMessageDTO{}, fmt.Errorf("missing message ID")
	}
	chat, err := wireMsgJID(chatJID)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	sender := types.EmptyJID
	if senderJID != "" {
		sender, err = wireMsgJID(senderJID)
		if err != nil {
			return WireBuiltMessageDTO{}, err
		}
	}
	msg := cli.BuildUnavailableMessageRequest(chat, sender, messageID)
	protocolMsg := msg.GetProtocolMessage()
	if protocolMsg == nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("built request has no protocol message")
	}
	var key *waCommon.MessageKey
	if requests := protocolMsg.GetPeerDataOperationRequestMessage().GetPlaceholderMessageResendRequest(); len(requests) > 0 {
		key = requests[0].GetMessageKey()
	}
	dto := wireBuiltMessageDTO("protocolMessage", protocolMsg.GetType().String(), key)
	if err := wireFinishBuiltMessage(&dto, msg, send, func() (whatsmeow.SendResponse, error) {
		return cli.SendPeerMessage(wireMsgCtx(a), msg)
	}); err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("send unavailable message request: %w", err)
	}
	return dto, nil
}

// ---------------------------------------------------------------------------
// 3. History sync
// ---------------------------------------------------------------------------

// WireDownloadHistorySync downloads and parses a history-sync blob using the
// real Client.DownloadHistorySync. notifBase64 is a base64-encoded,
// protobuf-marshaled waE2E.HistorySyncNotification; it is decoded into a real
// protobuf inside Go. Only metadata is returned — conversation content and
// contacts are already stored by the normal event handler.
func (a *Api) WireDownloadHistorySync(notifBase64 string, synchronousStorage bool) (WireHistorySyncDTO, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireHistorySyncDTO{}, err
	}
	var notif waE2E.HistorySyncNotification
	if err := wireDecodeProtoBase64("notification", notifBase64, &notif); err != nil {
		return WireHistorySyncDTO{}, err
	}
	hs, err := cli.DownloadHistorySync(wireMsgCtx(a), &notif, synchronousStorage)
	if err != nil {
		return WireHistorySyncDTO{}, fmt.Errorf("download history sync: %w", err)
	}
	if hs == nil {
		return WireHistorySyncDTO{}, fmt.Errorf("history sync returned no data")
	}
	return WireHistorySyncDTO{
		SyncType:          hs.GetSyncType().String(),
		ChunkOrder:        hs.GetChunkOrder(),
		Progress:          hs.GetProgress(),
		Conversations:     len(hs.GetConversations()),
		PushNames:         len(hs.GetPushnames()),
		InlineContacts:    len(hs.GetInlineContacts()),
		RecentStickers:    len(hs.GetRecentStickers()),
		CallLogRecords:    len(hs.GetCallLogRecords()),
		HasGlobalSettings: hs.GetGlobalSettings() != nil,
	}, nil
}

// ---------------------------------------------------------------------------
// 4. Poll votes
// ---------------------------------------------------------------------------

// WireBuildPollVote looks up the real poll message by chat JID + message ID and
// calls Client.BuildPollVote with the reconstructed MessageInfo. optionNames are
// the human-readable selected option names; upstream hashes them internally.
// The real built message is returned as message_base64; with send=true it is
// sent to the poll's chat via Client.SendMessage and its real ID is returned.
func (a *Api) WireBuildPollVote(chatJID, pollMessageID string, optionNames []string, send bool) (WireBuiltMessageDTO, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	if len(optionNames) == 0 {
		return WireBuiltMessageDTO{}, fmt.Errorf("no poll options selected")
	}
	info, err := a.wireInfoFromStore(chatJID, pollMessageID)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	msg, err := cli.BuildPollVote(wireMsgCtx(a), info, optionNames)
	if err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("build poll vote: %w", err)
	}
	dto := wireBuiltMessageDTO("pollUpdate", "", msg.GetPollUpdateMessage().GetPollCreationMessageKey())
	if err := wireFinishBuiltMessage(&dto, msg, send, func() (whatsmeow.SendResponse, error) {
		return cli.SendMessage(wireMsgCtx(a), info.Chat, msg)
	}); err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("send poll vote: %w", err)
	}
	return dto, nil
}

// WireEncryptPollVote is the lower-level variant: it builds a real
// PollVoteMessage from the supplied option names (using upstream's own
// HashPollOptions) and calls Client.EncryptPollVote with the stored MessageInfo.
// The encrypted update is wrapped in a real waE2E.Message, returned as
// message_base64 and, with send=true, sent to the poll's chat via SendMessage.
func (a *Api) WireEncryptPollVote(chatJID, pollMessageID string, optionNames []string, send bool) (WireBuiltMessageDTO, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	if len(optionNames) == 0 {
		return WireBuiltMessageDTO{}, fmt.Errorf("no poll options selected")
	}
	info, err := a.wireInfoFromStore(chatJID, pollMessageID)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	vote := &waE2E.PollVoteMessage{SelectedOptions: whatsmeow.HashPollOptions(optionNames)}
	update, err := cli.EncryptPollVote(wireMsgCtx(a), info, vote)
	if err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("encrypt poll vote: %w", err)
	}
	built := &waE2E.Message{PollUpdateMessage: update}
	dto := wireBuiltMessageDTO("pollUpdate", "", update.GetPollCreationMessageKey())
	if err := wireFinishBuiltMessage(&dto, built, send, func() (whatsmeow.SendResponse, error) {
		return cli.SendMessage(wireMsgCtx(a), info.Chat, built)
	}); err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("send encrypted poll vote: %w", err)
	}
	return dto, nil
}

// ---------------------------------------------------------------------------
// 5. Encrypted comment / reaction
// ---------------------------------------------------------------------------

// WireEncryptComment encrypts a real comment protobuf supplied as base64
// against the stored root message. The DTO's text field stays empty; the real
// encrypted message is exposed only as message_base64 and, with send=true, is
// delivered to the chat via Client.SendMessage with its real ID returned.
func (a *Api) WireEncryptComment(chatJID, rootMessageID, commentBase64 string, send bool) (WireBuiltMessageDTO, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	info, err := a.wireInfoFromStore(chatJID, rootMessageID)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	var comment waE2E.Message
	if err := wireDecodeProtoBase64("comment", commentBase64, &comment); err != nil {
		return WireBuiltMessageDTO{}, err
	}
	msg, err := cli.EncryptComment(wireMsgCtx(a), info, &comment)
	if err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("encrypt comment: %w", err)
	}
	dto := wireBuiltMessageDTO("encComment", "", msg.GetEncCommentMessage().GetTargetMessageKey())
	if err := wireFinishBuiltMessage(&dto, msg, send, func() (whatsmeow.SendResponse, error) {
		return cli.SendMessage(wireMsgCtx(a), info.Chat, msg)
	}); err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("send encrypted comment: %w", err)
	}
	return dto, nil
}

// WireEncryptReaction builds a real ReactionMessage from the supplied text and
// the stored root message key, then encrypts it via Client.EncryptReaction. The
// encrypted reaction is wrapped in a real waE2E.Message, returned as
// message_base64 and, with send=true, sent to the chat via SendMessage.
func (a *Api) WireEncryptReaction(chatJID, rootMessageID, reactionText string, send bool) (WireBuiltMessageDTO, error) {
	cli, err := wireMsgClient(a)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	if reactionText == "" {
		return WireBuiltMessageDTO{}, fmt.Errorf("missing reaction text")
	}
	info, err := a.wireInfoFromStore(chatJID, rootMessageID)
	if err != nil {
		return WireBuiltMessageDTO{}, err
	}
	key := cli.BuildMessageKey(info.Chat, info.Sender, info.ID)
	reaction := &waE2E.ReactionMessage{
		Key:               key,
		Text:              &reactionText,
		SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
	}
	enc, err := cli.EncryptReaction(wireMsgCtx(a), info, reaction)
	if err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("encrypt reaction: %w", err)
	}
	built := &waE2E.Message{EncReactionMessage: enc}
	dto := wireBuiltMessageDTO("encReaction", "", enc.GetTargetMessageKey())
	if err := wireFinishBuiltMessage(&dto, built, send, func() (whatsmeow.SendResponse, error) {
		return cli.SendMessage(wireMsgCtx(a), info.Chat, built)
	}); err != nil {
		return WireBuiltMessageDTO{}, fmt.Errorf("send encrypted reaction: %w", err)
	}
	return dto, nil
}

// ---------------------------------------------------------------------------
// 6. Calls
// ---------------------------------------------------------------------------

// WireRejectCall is HyperMeow's Client.RejectCall (call.go:106), which takes the
// caller JID explicitly. It is distinct from the existing Api.RejectCall
// (api/calls.go:803) which drives the meowcaller client; that binding is left
// untouched. This method sends the protocol reject node directly and does not
// mutate meowcaller's call state.
func (a *Api) WireRejectCall(callFromJID, callID string) error {
	cli, err := wireMsgClient(a)
	if err != nil {
		return err
	}
	if callID == "" {
		return fmt.Errorf("missing call ID")
	}
	callFrom, err := wireMsgJID(callFromJID)
	if err != nil {
		return err
	}
	if err := cli.RejectCall(wireMsgCtx(a), callFrom, callID); err != nil {
		return fmt.Errorf("reject call: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Deliberate omissions (no duplicate bindings, no fabricated responses)
// ---------------------------------------------------------------------------
//
// * WireSendHistorySyncServerErrorReceipt / WireSendProtocolMessageReceipt:
//   already exported by WIRE-001 (api/hypermeow_wire.go:331 and :349). Adding
//   the same method names here would be a duplicate declaration and would not
//   compile; a differently named wrapper would only add a second frontend
//   binding for the same call. Both are intentionally not re-bound.
//
// * WireSendPrebuiltStanza: already exported by WIRE-001 (hypermeow_wire.go:656)
//   and is a raw-stanza injection path that requires a remote-signal store.
//   Not re-bound here.
//
// * WireBuildStickerReuploadRequest / WireBuildRecentStickerBootstrapRequest:
//   already exported by WIRE-002 (api/hypermeow_media_wire.go:528 and :558).
//   Not re-bound here.
//
// * WireSendFBMessage: the upstream signature takes an
//   armadillo.RealMessageApplicationSub (a protobuf interface implemented by
//   consumer/armadillo message types) plus a *waMsgApplication.Metadata. There
//   is no simple-type representation: any string/bytes input would have to
//   invent a protocol message, and returning a fake response would be a dead
//   binding. Omitted.
//
// * WireDecryptReaction / WireDecryptComment / WireDecryptSecretEncryptedMessage:
//   all three take *events.Message and read the encrypted payload from
//   msg.Message (GetEncReactionMessage / GetEncCommentMessage /
//   GetSecretEncryptedMessage) together with msg.Info. store.MessageStore
//   persists only Info, display text, media metadata and flags — it never
//   stores the raw waE2E.Message. A store lookup therefore cannot reconstruct a
//   real encrypted event: binding it would always fail with
//   ErrNotEncryptedReactionMessage / ErrNotEncryptedCommentMessage /
//   ErrNotSecretEncryptedMessage, i.e. a guaranteed-dead binding. Accepting a
//   caller-supplied protobuf instead would push raw protobuf across the Wails
//   boundary. Omitted rather than fabricate an events.Message.
