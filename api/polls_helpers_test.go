package api

import (
	"reflect"
	"testing"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

// polls_test.go already exists, so the additional pure-helper tests for
// polls.go live in this source-derived split file rather than modifying it.

func TestMatchVoteHashes(t *testing.T) {
	options := []string{"Alpha", "Beta", "Gamma"}
	hashes := whatsmeow.HashPollOptions(options)
	if len(hashes) != len(options) {
		t.Fatalf("HashPollOptions returned %d hashes for %d options", len(hashes), len(options))
	}
	unknown := []byte("not a real option hash")

	tests := []struct {
		name    string
		options []string
		votes   [][]byte
		want    []int
	}{
		{"no vote hashes", options, nil, nil},
		{"empty vote hashes", options, [][]byte{}, nil},
		{"single match", options, [][]byte{hashes[1]}, []int{1}},
		{"multiple matches follow vote order", options, [][]byte{hashes[2], hashes[0]}, []int{2, 0}},
		{"duplicate hash counted once", options, [][]byte{hashes[0], hashes[0]}, []int{0}},
		{"duplicate among multiple votes", options, [][]byte{hashes[1], hashes[0], hashes[1]}, []int{1, 0}},
		{"unknown hash ignored", options, [][]byte{unknown}, nil},
		{"mixed known and unknown", options, [][]byte{unknown, hashes[1], hashes[0]}, []int{1, 0}},
		{"no options with a vote", nil, [][]byte{unknown}, nil},
		{"no options and no votes", nil, nil, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := (&Api{}).matchVoteHashes(tt.options, tt.votes)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("matchVoteHashes(%v, %v) = %v, want %v", tt.options, tt.votes, got, tt.want)
			}
		})
	}
}

// TestPollCreationMessageKeyFromMeVariants complements the existing
// TestPollCreationMessageKey with the group/not-from-me and DM/from-me cases.
func TestPollCreationMessageKeyFromMeVariants(t *testing.T) {
	group := types.JID{User: "120363000000000001", Server: types.GroupServer}
	dm := types.JID{User: "4444444444", Server: types.DefaultUserServer}
	sender := types.JID{User: "3333333333", Server: types.DefaultUserServer}

	tests := []struct {
		name            string
		info            types.MessageInfo
		wantParticipant string
		wantFromMe      bool
	}{
		{
			name: "group from me",
			info: types.MessageInfo{
				MessageSource: types.MessageSource{Chat: group, Sender: sender, IsFromMe: true, IsGroup: true},
				ID:            "P1",
			},
			wantParticipant: sender.String(),
			wantFromMe:      true,
		},
		{
			name: "group from someone else",
			info: types.MessageInfo{
				MessageSource: types.MessageSource{Chat: group, Sender: sender, IsFromMe: false, IsGroup: true},
				ID:            "P2",
			},
			wantParticipant: sender.String(),
			wantFromMe:      false,
		},
		{
			name: "direct message from me",
			info: types.MessageInfo{
				MessageSource: types.MessageSource{Chat: dm, Sender: sender, IsFromMe: true, IsGroup: false},
				ID:            "P3",
			},
			wantParticipant: "",
			wantFromMe:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := pollCreationMessageKey(&tt.info)
			if got == nil {
				t.Fatal("pollCreationMessageKey returned nil")
			}
			if got.GetRemoteJID() != tt.info.Chat.String() {
				t.Errorf("RemoteJID = %q, want %q", got.GetRemoteJID(), tt.info.Chat.String())
			}
			if got.GetID() != tt.info.ID {
				t.Errorf("ID = %q, want %q", got.GetID(), tt.info.ID)
			}
			if got.GetFromMe() != tt.wantFromMe {
				t.Errorf("FromMe = %v, want %v", got.GetFromMe(), tt.wantFromMe)
			}
			if got.GetParticipant() != tt.wantParticipant {
				t.Errorf("Participant = %q, want %q", got.GetParticipant(), tt.wantParticipant)
			}
			if tt.info.IsGroup && got.Participant == nil {
				t.Error("group creation key has no Participant field set")
			}
			if !tt.info.IsGroup && got.Participant != nil {
				t.Error("DM creation key unexpectedly has a Participant field set")
			}
		})
	}
}

func TestGeneratePollVoteSecretKeyIsDeterministicAndLengthStable(t *testing.T) {
	t.Parallel()

	modificationSender := types.JID{User: "1111111111", Server: types.HiddenUserServer}
	origSender := types.JID{User: "2222222222", Server: types.DefaultUserServer, Device: 1}
	secret := []byte("0123456789abcdef0123456789abcdef")

	key, ad := generatePollVoteSecretKey(modificationSender, "MSGID", origSender, secret)
	if len(key) != 32 {
		t.Fatalf("derived key length = %d, want 32", len(key))
	}
	wantAD := "MSGID\x00" + modificationSender.ToNonAD().String()
	if string(ad) != wantAD {
		t.Fatalf("additional data = %q, want %q", ad, wantAD)
	}

	key2, ad2 := generatePollVoteSecretKey(modificationSender, "MSGID", origSender, secret)
	if !reflect.DeepEqual(key, key2) || !reflect.DeepEqual(ad, ad2) {
		t.Fatal("generatePollVoteSecretKey is not deterministic for identical inputs")
	}

	otherKey, _ := generatePollVoteSecretKey(modificationSender, "OTHER", origSender, secret)
	if reflect.DeepEqual(key, otherKey) {
		t.Fatal("different message IDs produced the same derived key")
	}
}
