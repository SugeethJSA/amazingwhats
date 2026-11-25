package api

// D-ID WIRE-001: thin, safe bindings for the remaining unwired HyperMeow
// Client APIs. Every exported method below is prefixed Wire* so it cannot
// collide with an existing Api binding. Inputs and outputs are limited to
// simple types and small JSON-tagged DTOs defined in this file; no upstream
// protobuf, waBinary.Node, or raw interface value crosses the Wails boundary.
//
// Four upstream calls are deliberately NOT bound; the reasons are recorded in
// the "Deliberate omissions" section at the bottom of this file.
//
// Startup behaviour is intentionally unchanged: no method here is called from
// cmd/run.go or internal/wa/client.go. In particular the history-sync policy
// and proxy setters are pre-Connect-only, and there is no persisted setting in
// internal/settings that would justify applying them by default.

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	whatsmeow "github.com/polymorfa/hypermeow"
	waBinary "github.com/polymorfa/hypermeow/binary"
	"github.com/polymorfa/hypermeow/types"
)

// ---------------------------------------------------------------------------
// DTOs (owned by this file; safe to serialise to the frontend)
// ---------------------------------------------------------------------------

type WireUsernameResolution struct {
	LID         string `json:"lid"`
	Username    string `json:"username"`
	KeyRequired bool   `json:"key_required"`
}

type WireGroupInviteInfo struct {
	JID               string `json:"jid"`
	OwnerJID          string `json:"owner_jid"`
	Name              string `json:"name"`
	Topic             string `json:"topic"`
	TopicDeleted      bool   `json:"topic_deleted"`
	ParticipantCount  int    `json:"participant_count"`
	IsParent          bool   `json:"is_parent"`
	IsDefaultSubGroup bool   `json:"is_default_sub_group"`
	LinkedParentJID   string `json:"linked_parent_jid,omitempty"`
	Suspended         bool   `json:"suspended"`
}

type WireIdentityVerificationCodes struct {
	UserID             string `json:"user_id"`
	PhoneNumber        string `json:"phone_number"`
	Username           string `json:"username,omitempty"`
	NumericCode        string `json:"numeric_code"`
	DisplayQRCode      []byte `json:"display_qr_code,omitempty"`
	VerificationQRCode []byte `json:"verification_qr_code,omitempty"`
}

// WirePushNotificationConfig is a lossy, JSON-safe projection of the
// waBinary.Node returned by Client.GetServerPushNotificationConfig. Only
// scalar string/int/bool/JID attributes and immediate child tags are exposed;
// binary content and nested nodes are intentionally dropped.
type WirePushNotificationConfig struct {
	Attrs     map[string]string `json:"attrs"`
	ChildTags []string          `json:"child_tags"`
}

type WireSendResponse struct {
	ID            string `json:"id"`
	ServerID      int    `json:"server_id,omitempty"`
	Timestamp     int64  `json:"timestamp,omitempty"`
	Sender        string `json:"sender,omitempty"`
	Chat          string `json:"chat,omitempty"`
	PHashMismatch bool   `json:"p_hash_mismatch"`
}

// ---------------------------------------------------------------------------
// Shared helpers (unexported, so Wails does not bind them)
// ---------------------------------------------------------------------------

func wireCtx(a *Api) context.Context {
	if a != nil && a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func wireClient(a *Api) (*whatsmeow.Client, error) {
	if a == nil || a.waClient == nil {
		return nil, fmt.Errorf("WhatsApp client is not ready")
	}
	if a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	return a.waClient, nil
}

// wireConfigClient is for pre-Connect settings: they must be callable during
// QR pairing, when Store.ID is still nil.
func wireConfigClient(a *Api) (*whatsmeow.Client, error) {
	if a == nil || a.waClient == nil {
		return nil, fmt.Errorf("WhatsApp client is not ready")
	}
	return a.waClient, nil
}

func wireJID(raw string) (types.JID, error) {
	jid, err := types.ParseJID(raw)
	if err != nil {
		// Do not echo the raw value: it may be a phone number or LID.
		return types.EmptyJID, fmt.Errorf("invalid JID")
	}
	return jid, nil
}

func wireJIDs(raw []string) ([]types.JID, error) {
	out := make([]types.JID, 0, len(raw))
	for _, item := range raw {
		jid, err := wireJID(item)
		if err != nil {
			return nil, err
		}
		out = append(out, jid)
	}
	return out, nil
}

func wireJIDStrings(jids []types.JID) []string {
	out := make([]string, 0, len(jids))
	for _, jid := range jids {
		out = append(out, jid.String())
	}
	return out
}

// wirePreConnect guards settings that upstream documents as pre-Connect-only.
// It cannot detect an in-flight Connect, but it covers the normal case.
func wirePreConnect(cli *whatsmeow.Client) error {
	if cli.IsConnected() {
		return fmt.Errorf("disconnect before changing this connection setting")
	}
	return nil
}

// wireProxyHTTPClient builds a real *http.Client whose transport routes through
// the validated http(s) proxy URL. An empty URL returns nil, which the three
// Set*HTTPClient bindings pass straight to upstream. The client is deliberately
// minimal: no timeouts or extra headers are invented here.
func wireProxyHTTPClient(proxyURL string) (*http.Client, error) {
	if proxyURL == "" {
		return nil, nil
	}
	u, err := url.ParseRequestURI(proxyURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, fmt.Errorf("invalid proxy URL")
	}
	return &http.Client{
		Transport: &http.Transport{Proxy: http.ProxyURL(u)},
	}, nil
}

// ---------------------------------------------------------------------------
// A. Plumbing / configuration
// ---------------------------------------------------------------------------

// WireSetProxy applies an HTTP(S) proxy. The string is parsed and converted by
// the pinned upstream helper Client.SetProxyAddress, which calls
// SetProxy(http.ProxyURL(u)) for http/https schemes (hypermeow/client.go:426).
// Must be called before Connect. The pre-existing Api.SetProxy (account.go:41)
// remains for compatibility and already accepts both http(s) and socks5; this
// variant adds scheme validation and the pre-Connect guard. An empty URL clears
// the proxy (upstream calls SetProxy(nil), restoring env-based defaults).
func (a *Api) WireSetProxy(proxyURL string) error {
	cli, err := wireConfigClient(a)
	if err != nil {
		return err
	}
	if err := wirePreConnect(cli); err != nil {
		return fmt.Errorf("set proxy: %w", err)
	}
	if proxyURL != "" {
		u, err := url.Parse(proxyURL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("invalid HTTP proxy URL")
		}
	}
	if err := cli.SetProxyAddress(proxyURL); err != nil {
		return fmt.Errorf("set proxy: %w", err)
	}
	return nil
}

// WireSetSOCKSProxy applies a SOCKS5 proxy. Client.SetProxyAddress converts a
// socks5:// URL with proxy.FromURL and passes the resulting ContextDialer to
// SetSOCKSProxy (hypermeow/client.go:437). Must be called before Connect. Uses
// the same upstream helper as the existing Api.SetProxy, but rejects non-socks5
// schemes. An empty URL clears the proxy.
func (a *Api) WireSetSOCKSProxy(proxyURL string) error {
	cli, err := wireConfigClient(a)
	if err != nil {
		return err
	}
	if err := wirePreConnect(cli); err != nil {
		return fmt.Errorf("set SOCKS proxy: %w", err)
	}
	if proxyURL != "" {
		u, err := url.Parse(proxyURL)
		if err != nil || u.Host == "" || u.Scheme != "socks5" {
			return fmt.Errorf("invalid SOCKS5 proxy URL")
		}
	}
	if err := cli.SetProxyAddress(proxyURL); err != nil {
		return fmt.Errorf("set SOCKS proxy: %w", err)
	}
	return nil
}

// WireSetMediaHTTPClient sets the client used for media downloads from a
// validated http(s) proxy URL. The URL is converted to
// &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(u)}} and passed
// to the real Client.SetMediaHTTPClient. An empty URL passes nil, matching
// upstream's own nil semantics. This replaces any previously configured custom
// transport (including proxies set via Api.SetProxy) for media; it must be
// called before Connect.
func (a *Api) WireSetMediaHTTPClient(proxyURL string) error {
	cli, err := wireConfigClient(a)
	if err != nil {
		return err
	}
	if err := wirePreConnect(cli); err != nil {
		return fmt.Errorf("set media HTTP client: %w", err)
	}
	h, err := wireProxyHTTPClient(proxyURL)
	if err != nil {
		return fmt.Errorf("set media HTTP client: %w", err)
	}
	cli.SetMediaHTTPClient(h)
	return nil
}

// WireSetWebsocketHTTPClient sets the logged-in websocket client from a
// validated http(s) proxy URL, using the same conversion as
// WireSetMediaHTTPClient and calling the real Client.SetWebsocketHTTPClient.
// An empty URL passes nil. This replaces any previously configured custom
// transport (including proxies set via Api.SetProxy) for the websocket.
func (a *Api) WireSetWebsocketHTTPClient(proxyURL string) error {
	cli, err := wireConfigClient(a)
	if err != nil {
		return err
	}
	if err := wirePreConnect(cli); err != nil {
		return fmt.Errorf("set websocket HTTP client: %w", err)
	}
	h, err := wireProxyHTTPClient(proxyURL)
	if err != nil {
		return fmt.Errorf("set websocket HTTP client: %w", err)
	}
	cli.SetWebsocketHTTPClient(h)
	return nil
}

// WireSetPreLoginHTTPClient sets the pre-login websocket client from a
// validated http(s) proxy URL, using the same conversion as
// WireSetMediaHTTPClient and calling the real Client.SetPreLoginHTTPClient.
// An empty URL passes nil. This replaces any previously configured custom
// transport (including proxies set via Api.SetProxy) for pre-login.
func (a *Api) WireSetPreLoginHTTPClient(proxyURL string) error {
	cli, err := wireConfigClient(a)
	if err != nil {
		return err
	}
	if err := wirePreConnect(cli); err != nil {
		return fmt.Errorf("set pre-login HTTP client: %w", err)
	}
	h, err := wireProxyHTTPClient(proxyURL)
	if err != nil {
		return fmt.Errorf("set pre-login HTTP client: %w", err)
	}
	cli.SetPreLoginHTTPClient(h)
	return nil
}

// WireSetMaxParallelRetryReceiptHandling caps concurrent retry-receipt
// handling. n <= 0 restores the upstream unlimited default. Must be called
// before Connect (upstream warns of data races otherwise).
func (a *Api) WireSetMaxParallelRetryReceiptHandling(n int64) error {
	cli, err := wireConfigClient(a)
	if err != nil {
		return err
	}
	if err := wirePreConnect(cli); err != nil {
		return fmt.Errorf("set retry receipt limit: %w", err)
	}
	cli.SetMaxParallelRetryReceiptHandling(n)
	return nil
}

// WireSetPassive tells the server whether this device is passive. Upstream
// already sends SetPassive(false) after connecting unless
// DisablePostConnectPassiveIQ is set; this binding is for explicit control.
func (a *Api) WireSetPassive(passive bool) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	if err := cli.SetPassive(wireCtx(a), passive); err != nil {
		return fmt.Errorf("set passive mode: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// B. Devices / identity resolution
// ---------------------------------------------------------------------------

func (a *Api) WireResolveUsername(username, key string) (WireUsernameResolution, error) {
	cli, err := wireClient(a)
	if err != nil {
		return WireUsernameResolution{}, err
	}
	res, err := cli.ResolveUsername(wireCtx(a), username, key)
	if err != nil {
		return WireUsernameResolution{}, fmt.Errorf("resolve username: %w", err)
	}
	return WireUsernameResolution{
		LID:         res.LID.String(),
		Username:    res.Username,
		KeyRequired: res.KeyRequired,
	}, nil
}

// WireResolveLID returns the stable @lid JID for a phone-number JID.
func (a *Api) WireResolveLID(phoneJID string) (string, error) {
	cli, err := wireClient(a)
	if err != nil {
		return "", err
	}
	jid, err := wireJID(phoneJID)
	if err != nil {
		return "", err
	}
	lid, err := cli.ResolveLID(wireCtx(a), jid)
	if err != nil {
		return "", fmt.Errorf("resolve LID: %w", err)
	}
	return lid.String(), nil
}

func (a *Api) WireGetUserDevices(jids []string) ([]string, error) {
	cli, err := wireClient(a)
	if err != nil {
		return nil, err
	}
	parsed, err := wireJIDs(jids)
	if err != nil {
		return nil, err
	}
	devices, err := cli.GetUserDevices(wireCtx(a), parsed)
	if err != nil {
		return nil, fmt.Errorf("get user devices: %w", err)
	}
	return wireJIDStrings(devices), nil
}

// WireGetUserDevicesContext is the context-bearing variant of
// WireGetUserDevices (same upstream return type and conversion).
func (a *Api) WireGetUserDevicesContext(jids []string) ([]string, error) {
	cli, err := wireClient(a)
	if err != nil {
		return nil, err
	}
	parsed, err := wireJIDs(jids)
	if err != nil {
		return nil, err
	}
	devices, err := cli.GetUserDevicesContext(wireCtx(a), parsed)
	if err != nil {
		return nil, fmt.Errorf("get user devices: %w", err)
	}
	return wireJIDStrings(devices), nil
}

// ---------------------------------------------------------------------------
// C. History / sync
// ---------------------------------------------------------------------------

// WireSetHistorySyncPolicy sets the five pre-Connect history-sync policy flags
// on the Client struct. It is a binding ONLY: no startup code calls it because
// there is no persisted setting in internal/settings, and changing the defaults
// would alter existing sync behaviour. Set all flags together to avoid a
// half-applied policy.
func (a *Api) WireSetHistorySyncPolicy(manualDownload, disableManualReceipt, disableReceipt, disableStorage, disableMediaDelete bool) error {
	cli, err := wireConfigClient(a)
	if err != nil {
		return err
	}
	if err := wirePreConnect(cli); err != nil {
		return fmt.Errorf("set history sync policy: %w", err)
	}
	cli.ManualHistorySyncDownload = manualDownload
	cli.DisableManualHistorySyncReceipt = disableManualReceipt
	cli.DisableHistorySyncReceipt = disableReceipt
	cli.DisableHistorySyncStorage = disableStorage
	cli.DisableHistorySyncMediaDelete = disableMediaDelete
	return nil
}

// WireSendHistorySyncServerErrorReceipt acknowledges a failed history-sync
// download. mediaKey is the raw key from the notification.
func (a *Api) WireSendHistorySyncServerErrorReceipt(msgID string, mediaKey []byte) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	if msgID == "" {
		return fmt.Errorf("missing message ID")
	}
	if err := cli.SendHistorySyncServerErrorReceipt(wireCtx(a), types.MessageID(msgID), mediaKey); err != nil {
		return fmt.Errorf("send history sync error receipt: %w", err)
	}
	return nil
}

// WireSendProtocolMessageReceipt sends a receipt for a protocol message.
// "delivered" is accepted as a friendly alias for the upstream empty-string
// delivered type. Other values must be one of the upstream ReceiptType
// constants (read, played, hist_sync, peer_msg, ...).
func (a *Api) WireSendProtocolMessageReceipt(msgID, receiptType string) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	if msgID == "" {
		return fmt.Errorf("missing message ID")
	}
	rt := types.ReceiptType(receiptType)
	if receiptType == "delivered" {
		rt = types.ReceiptTypeDelivered
	}
	switch rt {
	case types.ReceiptTypeDelivered, types.ReceiptTypeSender, types.ReceiptTypeRetry,
		types.ReceiptTypeRead, types.ReceiptTypeReadSelf, types.ReceiptTypePlayed,
		types.ReceiptTypePlayedSelf, types.ReceiptTypeServerError, types.ReceiptTypeInactive,
		types.ReceiptTypePeerMsg, types.ReceiptTypeHistorySync:
		// valid
	default:
		return fmt.Errorf("invalid receipt type")
	}
	if err := cli.SendProtocolMessageReceipt(wireCtx(a), types.MessageID(msgID), rt); err != nil {
		return fmt.Errorf("send protocol receipt: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// D. Groups
// ---------------------------------------------------------------------------

func (a *Api) WireGetGroupInfoFromInvite(groupJID, inviterJID, code string, expiration int64) (WireGroupInviteInfo, error) {
	cli, err := wireClient(a)
	if err != nil {
		return WireGroupInviteInfo{}, err
	}
	jid, err := wireJID(groupJID)
	if err != nil {
		return WireGroupInviteInfo{}, err
	}
	inviter, err := wireJID(inviterJID)
	if err != nil {
		return WireGroupInviteInfo{}, err
	}
	info, err := cli.GetGroupInfoFromInvite(wireCtx(a), jid, inviter, code, expiration)
	if err != nil {
		return WireGroupInviteInfo{}, fmt.Errorf("get group invite info: %w", err)
	}
	out := WireGroupInviteInfo{
		JID:               info.JID.String(),
		OwnerJID:          info.OwnerJID.String(),
		Name:              info.GroupName.Name,
		Topic:             info.GroupTopic.Topic,
		TopicDeleted:      info.GroupTopic.TopicDeleted,
		ParticipantCount:  info.ParticipantCount,
		IsParent:          info.IsParent,
		IsDefaultSubGroup: info.IsDefaultSubGroup,
		LinkedParentJID:   info.LinkedParentJID.String(),
		Suspended:         info.Suspended,
	}
	return out, nil
}

func (a *Api) WireJoinGroupWithInvite(groupJID, inviterJID, code string, expiration int64) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	jid, err := wireJID(groupJID)
	if err != nil {
		return err
	}
	inviter, err := wireJID(inviterJID)
	if err != nil {
		return err
	}
	if err := cli.JoinGroupWithInvite(wireCtx(a), jid, inviter, code, expiration); err != nil {
		return fmt.Errorf("join group by invite: %w", err)
	}
	return nil
}

// WireSetGroupDescriptionV2 calls the pinned module's real SetGroupDescription
// API. In the pinned source (group.go:1194-1197) that method is marked Deprecated
// and implemented as `return cli.SetGroupTopic(ctx, jid, "", "", description)`
// — i.e. it is still a thin alias of SetGroupTopic, NOT a distinct protocol
// method. The existing Api.SetGroupDescription (groups_ext.go:235) stays
// unchanged for compatibility; this binding simply exposes that upstream API
// directly without reimplementing it.
func (a *Api) WireSetGroupDescriptionV2(groupJID, description string) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	jid, err := wireJID(groupJID)
	if err != nil {
		return err
	}
	if err := cli.SetGroupDescription(wireCtx(a), jid, description); err != nil {
		return fmt.Errorf("set group description: %w", err)
	}
	return nil
}

// SetGroupDescriptionV2 is the explicitly requested binding name for the
// upstream SetGroupDescription call (D-ID WIRE-001 section D), which is itself
// a thin alias of SetGroupTopic in the pinned module. It delegates to
// WireSetGroupDescriptionV2 so there is a single implementation. The existing
// Api.SetGroupDescription (groups_ext.go:235) is untouched for compatibility.
func (a *Api) SetGroupDescriptionV2(groupJID, description string) error {
	return a.WireSetGroupDescriptionV2(groupJID, description)
}

// ---------------------------------------------------------------------------
// E. Channels / newsletters
// ---------------------------------------------------------------------------

func (a *Api) WireAcceptTOSNotice(noticeID, stage string) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	if err := cli.AcceptTOSNotice(wireCtx(a), noticeID, stage); err != nil {
		return fmt.Errorf("accept channel terms notice: %w", err)
	}
	return nil
}

func (a *Api) WireDeleteNewsletter(jid string) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	parsed, err := wireJID(jid)
	if err != nil {
		return err
	}
	if err := cli.DeleteNewsletter(wireCtx(a), parsed); err != nil {
		return fmt.Errorf("delete channel: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// F. Privacy / security
// ---------------------------------------------------------------------------

// WireGetIdentityVerificationCodes returns safety-number codes for another
// device. Upstream requires an @lid user JID (ErrIdentityVerificationRequiresLID)
// and cannot generate codes for the local user.
func (a *Api) WireGetIdentityVerificationCodes(userJID string) (WireIdentityVerificationCodes, error) {
	cli, err := wireClient(a)
	if err != nil {
		return WireIdentityVerificationCodes{}, err
	}
	jid, err := wireJID(userJID)
	if err != nil {
		return WireIdentityVerificationCodes{}, err
	}
	codes, err := cli.GetIdentityVerificationCodes(wireCtx(a), jid)
	if err != nil {
		return WireIdentityVerificationCodes{}, fmt.Errorf("get identity codes: %w", err)
	}
	return WireIdentityVerificationCodes{
		UserID:             codes.UserID.String(),
		PhoneNumber:        codes.PhoneNumber.String(),
		Username:           codes.Username,
		NumericCode:        codes.NumericCode,
		DisplayQRCode:      codes.DisplayQRCode,
		VerificationQRCode: codes.VerificationQRCode,
	}, nil
}

// ---------------------------------------------------------------------------
// G. Push / pairing
// ---------------------------------------------------------------------------

// WireGetServerPushNotificationConfig projects the upstream waBinary.Node into
// a JSON-safe DTO. Conversion (hypermeow/binary/node.go): Attrs values with
// dynamic type string, types.JID, int, int64 or bool are rendered as strings;
// all other values (binary payloads, nested nodes) are omitted. ChildTags lists
// the immediate children's tag names. No raw node is returned.
func (a *Api) WireGetServerPushNotificationConfig() (WirePushNotificationConfig, error) {
	cli, err := wireClient(a)
	if err != nil {
		return WirePushNotificationConfig{}, err
	}
	node, err := cli.GetServerPushNotificationConfig(wireCtx(a))
	if err != nil {
		return WirePushNotificationConfig{}, fmt.Errorf("get push config: %w", err)
	}
	out := WirePushNotificationConfig{Attrs: map[string]string{}}
	if node == nil {
		return out, nil
	}
	for key, value := range node.Attrs {
		switch typed := value.(type) {
		case string:
			out.Attrs[key] = typed
		case types.JID:
			out.Attrs[key] = typed.String()
		case int:
			out.Attrs[key] = strconv.Itoa(typed)
		case int64:
			out.Attrs[key] = strconv.FormatInt(typed, 10)
		case bool:
			out.Attrs[key] = strconv.FormatBool(typed)
		default:
			// Binary/nested values are deliberately not projected.
		}
	}
	for _, child := range node.GetChildren() {
		out.ChildTags = append(out.ChildTags, child.Tag)
	}
	return out, nil
}

// WireRegisterForPushNotifications registers one of the three concrete upstream
// PushConfig implementations. platform selects "gcm" (FCMPushConfig: token),
// "apple" (APNsPushConfig: token, optional voipToken, optional 32-byte
// MsgIDEncKey passed as msgIDEncKey) or "web" (WebPushConfig: endpoint, auth,
// p256dh). Unused arguments are ignored for the selected platform.
func (a *Api) WireRegisterForPushNotifications(platform, token, voipToken, endpoint string, msgIDEncKey, auth, p256dh []byte) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "gcm", "fcm":
		if token == "" {
			return fmt.Errorf("missing push token")
		}
		err = cli.RegisterForPushNotifications(wireCtx(a), &whatsmeow.FCMPushConfig{Token: token})
	case "apple", "apns":
		if token == "" {
			return fmt.Errorf("missing push token")
		}
		if len(msgIDEncKey) != 0 && len(msgIDEncKey) != 32 {
			return fmt.Errorf("invalid push key length")
		}
		err = cli.RegisterForPushNotifications(wireCtx(a), &whatsmeow.APNsPushConfig{
			Token:       token,
			VoIPToken:   voipToken,
			MsgIDEncKey: msgIDEncKey,
		})
	case "web":
		if endpoint == "" || len(auth) == 0 || len(p256dh) == 0 {
			return fmt.Errorf("incomplete web push config")
		}
		err = cli.RegisterForPushNotifications(wireCtx(a), &whatsmeow.WebPushConfig{
			Endpoint: endpoint,
			Auth:     auth,
			P256DH:   p256dh,
		})
	default:
		return fmt.Errorf("unsupported push platform")
	}
	if err != nil {
		return fmt.Errorf("register for push notifications: %w", err)
	}
	return nil
}

// WireSendPasskeyConfirmation confirms a pending passkey pairing. It takes no
// arguments upstream. Only call it in response to a real passkey challenge.
func (a *Api) WireSendPasskeyConfirmation() error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	if err := cli.SendPasskeyConfirmation(wireCtx(a)); err != nil {
		return fmt.Errorf("confirm passkey: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// H. Raw / advanced
// ---------------------------------------------------------------------------

// WireInjectNode injects a WhatsApp binary-XML node into the client as if it
// arrived from the socket. The input is the exact byte encoding produced by
// waBinary.Marshal; this binding decodes it with waBinary.Unmarshal (the strict
// upstream decoder, which rejects trailing bytes) and never hands raw input to
// the client. Injection can affect protocol state, so it is an advanced API.
func (a *Api) WireInjectNode(node []byte) error {
	cli, err := wireClient(a)
	if err != nil {
		return err
	}
	if len(node) == 0 {
		return fmt.Errorf("empty node")
	}
	parsed, err := waBinary.Unmarshal(node)
	if err != nil {
		return fmt.Errorf("invalid node encoding")
	}
	if parsed == nil {
		return fmt.Errorf("invalid node")
	}
	if err := cli.InjectNode(wireCtx(a), parsed); err != nil {
		return fmt.Errorf("inject node: %w", err)
	}
	return nil
}

// WireSendPrebuiltStanza sends a pre-encoded remote-signal stanza and waits for
// the server ack. The bytes are validated with waBinary.Unmarshal (the same
// strict binary-XML decoder the module uses; it rejects trailing bytes) before
// being handed to upstream, so a malformed stanza is rejected with a plain
// error. Upstream requires a remote signal store (ErrRemoteSignalRequired) and
// a message id inside the stanza. timeoutMs <= 0 waits until the request context
// ends; otherwise it is converted to time.Duration milliseconds.
func (a *Api) WireSendPrebuiltStanza(stanza []byte, phash string, timeoutMs int) (WireSendResponse, error) {
	cli, err := wireClient(a)
	if err != nil {
		return WireSendResponse{}, err
	}
	if len(stanza) == 0 {
		return WireSendResponse{}, fmt.Errorf("empty stanza")
	}
	if _, err := waBinary.Unmarshal(stanza); err != nil {
		return WireSendResponse{}, fmt.Errorf("invalid stanza encoding")
	}
	var timeout time.Duration
	if timeoutMs > 0 {
		timeout = time.Duration(timeoutMs) * time.Millisecond
	}
	resp, err := cli.SendPrebuiltStanza(wireCtx(a), stanza, phash, timeout)
	if err != nil {
		return WireSendResponse{}, fmt.Errorf("send stanza: %w", err)
	}
	return WireSendResponse{
		ID:            string(resp.ID),
		ServerID:      int(resp.ServerID),
		Timestamp:     resp.Timestamp.UnixMilli(),
		Sender:        resp.Sender.String(),
		Chat:          resp.Chat.String(),
		PHashMismatch: resp.PHashMismatch,
	}, nil
}

// ---------------------------------------------------------------------------
// Deliberate omissions (no fake bindings, no fabricated data)
// ---------------------------------------------------------------------------
//
// * AddEventHandlerWithSuccessStatus:
//   the only meaningful callback we have, Api.mainEventHandler, is already
//   registered through AddEventHandler in Login (api/api.go:1119). Forwarding
//   to it here would double-process every event (duplicate messages/receipts).
//   A success-status handler that returns false also aborts dispatch of every
//   later handler (hypermeow/client.go:1241), so a naive wrapper could break
//   core behaviour. There is no persisted setting or distinct real use case
//   that warrants a success-aware handler. Omitted with this reason.
//
// * DownloadHistorySync:
//   NOT unrepresentable and NOT missing — it is already bound by
//   WireDownloadHistorySync in api/hypermeow_message_wire.go:289, which decodes
//   a base64-encoded, protobuf-marshaled waE2E.HistorySyncNotification into a
//   real protobuf and returns only metadata as WireHistorySyncDTO. This file
//   deliberately does not add a duplicate binding for the same upstream call.
//
// * SendPasskeyResponse:
//   takes *types.WebAuthnResponse, whose fields are WebAuthn/jsonbytes values
//   produced by a platform authenticator. This app has no passkey provider or
//   pairing UI, so a string/bytes binding would either fabricate credentials or
//   be a dead control. SendPasskeyConfirmation (no args) is bound above because
//   it has a real, unambiguous call. Omitted.
