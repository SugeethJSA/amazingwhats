package api

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"reflect"
	"testing"

	"github.com/lugvitc/whats4linux/internal/misc"
	messagestore "github.com/lugvitc/whats4linux/internal/store"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	wastore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/util/gcmutil"
	"google.golang.org/protobuf/proto"
)

// pollVoteTestLIDStore is the minimum LIDStore needed by the poll helpers.
type pollVoteTestLIDStore struct {
	byLID map[types.JID]types.JID
}

func (s *pollVoteTestLIDStore) PutManyLIDMappings(_ context.Context, mappings []wastore.LIDMapping) error {
	for _, m := range mappings {
		s.byLID[m.LID.ToNonAD()] = m.PN.ToNonAD()
	}
	return nil
}

func (s *pollVoteTestLIDStore) PutLIDMapping(_ context.Context, lid, jid types.JID) error {
	s.byLID[lid.ToNonAD()] = jid.ToNonAD()
	return nil
}

func (s *pollVoteTestLIDStore) GetPNForLID(_ context.Context, lid types.JID) (types.JID, error) {
	if pn, ok := s.byLID[lid.ToNonAD()]; ok {
		return pn, nil
	}
	return types.EmptyJID, errors.New("no PN for LID")
}

func (s *pollVoteTestLIDStore) GetLIDForPN(_ context.Context, pn types.JID) (types.JID, error) {
	for lid, mapped := range s.byLID {
		if mapped == pn.ToNonAD() {
			return lid, nil
		}
	}
	return types.EmptyJID, errors.New("no LID for PN")
}

func (s *pollVoteTestLIDStore) GetManyLIDsForPNs(ctx context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	out := make(map[types.JID]types.JID)
	for _, pn := range pns {
		if lid, err := s.GetLIDForPN(ctx, pn); err == nil {
			out[pn.ToNonAD()] = lid
		}
	}
	return out, nil
}

// pollVoteTestSecrets supplies a deterministic original message secret so the
// derived vote encryption key can be checked independently.
type pollVoteTestSecrets struct {
	secret []byte
	sender types.JID
}

func (s *pollVoteTestSecrets) PutMessageSecrets(context.Context, []wastore.MessageSecretInsert) error {
	return nil
}

func (*pollVoteTestSecrets) PutMessageSecret(context.Context, types.JID, types.JID, types.MessageID, []byte) error {
	return nil
}

func (s *pollVoteTestSecrets) GetMessageSecret(context.Context, types.JID, types.JID, types.MessageID) ([]byte, types.JID, error) {
	if s.secret == nil {
		return nil, types.EmptyJID, errors.New("message secret not found")
	}
	return s.secret, s.sender, nil
}

func newPollVoteTestAPI(lids *pollVoteTestLIDStore, secrets *pollVoteTestSecrets) (*Api, types.JID, types.JID) {
	ownPN := types.JID{User: "1111111111", Server: types.DefaultUserServer}
	ownLID := types.JID{User: "2222222222", Server: types.HiddenUserServer}
	if lids == nil {
		lids = &pollVoteTestLIDStore{byLID: map[types.JID]types.JID{ownLID: ownPN}}
	}
	if secrets == nil {
		secrets = &pollVoteTestSecrets{
			secret: []byte("0123456789abcdef0123456789abcdef"),
			sender: ownPN,
		}
	}
	device := &wastore.Device{ID: &ownPN, LID: ownLID, LIDs: lids, MsgSecrets: secrets}
	return &Api{ctx: context.Background(), waClient: whatsmeow.NewClient(device, nil)}, ownPN, ownLID
}

// Golden vector, independently computed outside Go with RFC 5869 HKDF-SHA256:
//
//	IKM    = "0123456789abcdef0123456789abcdef"
//	salt   = 32 zero bytes (hkdfutil.SHA256 passes nil; hkdf.New substitutes zeros)
//	info   = "MSGID123" + "2222222222@s.whatsapp.net" + "1111111111@s.whatsapp.net" + "Poll Vote"
//	L      = 32, so the single-block output is HMAC(HMAC(salt, IKM), info||0x01)[:32]
//	AD     = "MSGID123" + 0x00 + "1111111111@s.whatsapp.net"
//
// The constants below are those computed values, not values copied from the
// implementation under test.
func TestGeneratePollVoteSecretKeyGoldenVector(t *testing.T) {
	modificationSender := types.JID{User: "1111111111", Server: types.DefaultUserServer}
	origMsgSender := types.JID{User: "2222222222", Server: types.DefaultUserServer}
	secret := []byte("0123456789abcdef0123456789abcdef")

	key, additionalData := generatePollVoteSecretKey(modificationSender, "MSGID123", origMsgSender, secret)

	const wantKey = "b0f3aba28fc285f812cda7a3f3d7f4c115463c6253671ba3fa208d8bcd5685cf"
	const wantAD = "4d53474944313233003131313131313131313140732e77686174736170702e6e6574"
	if got := hex.EncodeToString(key); got != wantKey {
		t.Fatalf("secret key = %s, want %s", got, wantKey)
	}
	if got := hex.EncodeToString(additionalData); got != wantAD {
		t.Fatalf("additional data = %s, want %s", got, wantAD)
	}
}

func TestPollCreationMessageKey(t *testing.T) {
	group := types.JID{User: "120363000000000001", Server: types.GroupServer}
	sender := types.JID{User: "3333333333", Server: types.DefaultUserServer}

	groupKey := pollCreationMessageKey(&types.MessageInfo{
		MessageSource: types.MessageSource{Chat: group, Sender: sender, IsFromMe: true, IsGroup: true},
		ID:            "POLL1",
	})
	if got := groupKey.GetRemoteJID(); got != group.String() {
		t.Fatalf("group RemoteJID = %q, want %q", got, group.String())
	}
	if !groupKey.GetFromMe() {
		t.Fatal("group FromMe = false, want true")
	}
	if got := groupKey.GetID(); got != "POLL1" {
		t.Fatalf("group ID = %q, want POLL1", got)
	}
	if got := groupKey.GetParticipant(); got != sender.String() {
		t.Fatalf("group Participant = %q, want %q", got, sender.String())
	}

	dm := types.JID{User: "4444444444", Server: types.DefaultUserServer}
	dmKey := pollCreationMessageKey(&types.MessageInfo{
		MessageSource: types.MessageSource{Chat: dm, Sender: sender, IsFromMe: false},
		ID:            "POLL2",
	})
	if got := dmKey.GetParticipant(); got != "" {
		t.Fatalf("DM Participant = %q, want empty", got)
	}
	if dmKey.GetFromMe() {
		t.Fatal("DM FromMe = true, want false")
	}
	if got := dmKey.GetRemoteJID(); got != dm.String() {
		t.Fatalf("DM RemoteJID = %q, want %q", got, dm.String())
	}
}

func TestBuildPollVoteLIDEncryptsWithOwnLID(t *testing.T) {
	origSender := types.JID{User: "3333333333", Server: types.DefaultUserServer}
	secrets := &pollVoteTestSecrets{
		secret: []byte("0123456789abcdef0123456789abcdef"),
		sender: origSender,
	}
	a, ownPN, ownLID := newPollVoteTestAPI(nil, secrets)

	chat := types.JID{User: "120363000000000001", Server: types.GroupServer}
	pollInfo := &types.MessageInfo{
		MessageSource: types.MessageSource{Chat: chat, Sender: origSender, IsGroup: true},
		ID:            "POLLMSG1",
	}
	vote, err := a.buildPollVoteLID(context.Background(), pollInfo, []string{"Beta"})
	if err != nil {
		t.Fatal(err)
	}
	if got := vote.GetPollCreationMessageKey().GetRemoteJID(); got != chat.String() {
		t.Fatalf("creation key RemoteJID = %q, want %q", got, chat.String())
	}
	if got := vote.GetPollCreationMessageKey().GetParticipant(); got != origSender.String() {
		t.Fatalf("creation key Participant = %q, want %q", got, origSender.String())
	}
	if len(vote.GetVote().GetEncIV()) != 12 {
		t.Fatalf("EncIV length = %d, want 12", len(vote.GetVote().GetEncIV()))
	}
	if vote.GetSenderTimestampMS() <= 0 {
		t.Fatalf("SenderTimestampMS = %d, want > 0", vote.GetSenderTimestampMS())
	}

	lidKey, lidAD := generatePollVoteSecretKey(ownLID, "POLLMSG1", origSender, secrets.secret)
	pnKey, _ := generatePollVoteSecretKey(ownPN, "POLLMSG1", origSender, secrets.secret)
	if bytes.Equal(lidKey, pnKey) {
		t.Fatal("LID-derived key equals PN-derived key; builder did not use the LID")
	}
	plaintext, err := gcmutil.Decrypt(lidKey, vote.GetVote().GetEncIV(), vote.GetVote().GetEncPayload(), lidAD)
	if err != nil {
		t.Fatalf("decrypting poll vote with LID key: %v", err)
	}
	var decoded waE2E.PollVoteMessage
	if err := proto.Unmarshal(plaintext, &decoded); err != nil {
		t.Fatal(err)
	}
	want := whatsmeow.HashPollOptions([]string{"Beta"})
	if len(decoded.GetSelectedOptions()) != len(want) {
		t.Fatalf("selected options = %d, want %d", len(decoded.GetSelectedOptions()), len(want))
	}
	for i := range want {
		if !bytes.Equal(decoded.GetSelectedOptions()[i], want[i]) {
			t.Fatalf("selected option %d hash mismatch", i)
		}
	}
}

func TestPollVoteSelfJID(t *testing.T) {
	a, ownPN, ownLID := newPollVoteTestAPI(nil, nil)
	otherPN := types.JID{User: "4444444444", Server: types.DefaultUserServer}
	otherLID := types.JID{User: "5555555555", Server: types.HiddenUserServer}
	ownPNAD := types.JID{User: ownPN.User, Server: types.DefaultUserServer, Device: 1}

	cases := []struct {
		name   string
		sender types.JID
		want   string
	}{
		{"own pn", ownPN, ownPN.String()},
		{"own pn with device", ownPNAD, ownPN.String()},
		{"own lid with mapping", ownLID, ownPN.String()},
		{"other pn", otherPN, ""},
		{"other lid", otherLID, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := a.pollVoteSelfJID(tc.sender); got != tc.want {
				t.Fatalf("pollVoteSelfJID(%s) = %q, want %q", tc.sender.String(), got, tc.want)
			}
		})
	}

	// Own LID without a PN mapping still matches via the direct LID compare.
	unmapped, unmappedPN, unmappedLID := newPollVoteTestAPI(
		&pollVoteTestLIDStore{byLID: map[types.JID]types.JID{}}, nil,
	)
	if got := unmapped.pollVoteSelfJID(unmappedLID); got != unmappedPN.String() {
		t.Fatalf("unmapped own LID = %q, want %q", got, unmappedPN.String())
	}

	// A foreign LID that resolves to our PN is also one of our identities.
	reverse := &pollVoteTestLIDStore{byLID: map[types.JID]types.JID{otherLID: unmappedPN}}
	reverseAPI, reversePN, _ := newPollVoteTestAPI(reverse, nil)
	if got := reverseAPI.pollVoteSelfJID(otherLID); got != reversePN.String() {
		t.Fatalf("reversed LID = %q, want %q", got, reversePN.String())
	}

	// Not logged in: no own identity to compare against.
	loggedOut := &Api{ctx: context.Background(), waClient: whatsmeow.NewClient(
		&wastore.Device{LIDs: &pollVoteTestLIDStore{byLID: map[types.JID]types.JID{}}}, nil,
	)}
	if got := loggedOut.pollVoteSelfJID(ownPN); got != "" {
		t.Fatalf("logged-out pollVoteSelfJID = %q, want empty", got)
	}
}

// The full SendPollVote path cannot be unit-tested here: refreshPollCard calls
// a.app.Event.Emit, and Wails v3 needs a real *application.App injected into
// the service. This test instead verifies
// the exact store keys used for the pre-store and the send-failure rollback.
func TestPollVotePreStoreAndRollbackKeys(t *testing.T) {
	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	ms, err := messagestore.NewMessageStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ms.Close() })

	const chatJID = "120363000000000001@g.us"
	const pollID = "POLL1"
	options := []string{"Alpha", "Beta"}
	if err := ms.SavePollMetadata(chatJID, pollID, "Question?", options); err != nil {
		t.Fatal(err)
	}

	indices := (&Api{}).matchVoteHashes(options, whatsmeow.HashPollOptions([]string{"Beta"}))
	if !reflect.DeepEqual(indices, []int{1}) {
		t.Fatalf("indices = %v, want [1]", indices)
	}

	const ownJID = "1111111111@s.whatsapp.net"
	const otherJID = "4444444444@s.whatsapp.net"
	if err := ms.UpsertPollVote(chatJID, pollID, otherJID, []int{0}); err != nil {
		t.Fatal(err)
	}
	if err := ms.UpsertPollVote(chatJID, pollID, ownJID, indices); err != nil {
		t.Fatal(err)
	}
	votes, err := ms.GetPollVotes(chatJID, pollID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(votes[ownJID], indices) {
		t.Fatalf("own vote = %v, want %v", votes[ownJID], indices)
	}

	if err := ms.DeletePollVote(chatJID, pollID, ownJID); err != nil {
		t.Fatal(err)
	}
	rollback, err := ms.GetPollVotes(chatJID, pollID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := rollback[ownJID]; ok {
		t.Fatal("rollback left the own poll vote stored")
	}
	if !reflect.DeepEqual(rollback[otherJID], []int{0}) {
		t.Fatalf("rollback removed another voter's vote: %v", rollback)
	}
}

// Full send/rollback integration through SendPollVote is blocked by the Wails
// runtime seam described above. This test at least drives the real
// SendPollVote entry point for the empty-selection case, which previously
// wrote an empty vote row and inflated GetPollVotes.TotalVotes.
func TestSendPollVoteRejectsEmptySelection(t *testing.T) {
	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	ms, err := messagestore.NewMessageStore()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ms.Close() })

	const chatJID = "120363000000000001@g.us"
	const pollID = "POLL1"
	if err := ms.SavePollMetadata(chatJID, pollID, "Question?", []string{"Alpha", "Beta"}); err != nil {
		t.Fatal(err)
	}

	a, _, _ := newPollVoteTestAPI(nil, nil)
	a.messageStore = ms

	for _, selection := range [][]string{nil, []string{}} {
		if _, err := a.SendPollVote(chatJID, pollID, selection); err == nil || err.Error() != "no poll options selected" {
			t.Fatalf("SendPollVote(%v) error = %v, want no poll options selected", selection, err)
		}

		votes, err := ms.GetPollVotes(chatJID, pollID)
		if err != nil {
			t.Fatal(err)
		}
		if len(votes) != 0 {
			t.Fatalf("empty selection stored %d vote rows: %v", len(votes), votes)
		}

		res, err := a.GetPollVotes(chatJID, pollID)
		if err != nil {
			t.Fatal(err)
		}
		if res.TotalVotes != 0 || res.HasVoted {
			t.Fatalf("empty selection produced phantom vote: total=%d hasVoted=%v", res.TotalVotes, res.HasVoted)
		}
	}
}

// Seam missing for a full SendPollVote send/rollback test:
//   - Api.waClient is a concrete *whatsmeow.Client and Api.messageStore is a
//     concrete *store.MessageStore, so neither can be swapped for a fake.
//   - refreshPollCard calls a.app.Event.Emit(...) unconditionally on both the
//     pre-store and the rollback path. Wails v3 emits through the injected
//     *application.App, and there is no exported seam to inject a no-op event
//     sink into a bare test Api, so a test process cannot reach SendMessage
//     without constructing a full application.
// The store-key and empty-selection tests above are the strongest feasible
// coverage without changing files outside this D-ID's scope.
