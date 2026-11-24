package api

import (
	"context"
	"testing"

	"github.com/polymorfa/hypermeow/types"
)

// HM-005 / D-AUD-008f: a group participant's stable identity is its LID; a PN
// is only a display fallback. These tests cover the pure selection policy and
// the no-client path of the resolver, so no live whatsmeow client or LID store
// is required.
func TestCanonicalGroupParticipantJID(t *testing.T) {
	t.Parallel()

	lid := types.JID{User: "123456789012345", Server: types.HiddenUserServer}
	pn := types.JID{User: "919676700203", Server: types.DefaultUserServer}
	hostedLID := types.JID{User: "987654321098765", Server: types.HostedLIDServer}
	lidWithDevice := types.JID{User: lid.User, Server: types.HiddenUserServer, Device: 2}

	tests := []struct {
		name          string
		lid, pn       types.JID
		wantCanonical types.JID
		wantDisplay   types.JID
	}{
		{
			name:          "LID and PN keeps LID canonical and PN for display",
			lid:           lid,
			pn:            pn,
			wantCanonical: lid,
			wantDisplay:   pn,
		},
		{
			name:          "LID only falls back to LID for display",
			lid:           lid,
			pn:            types.EmptyJID,
			wantCanonical: lid,
			wantDisplay:   lid,
		},
		{
			name:          "PN only is kept as both identities",
			lid:           types.EmptyJID,
			pn:            pn,
			wantCanonical: pn,
			wantDisplay:   pn,
		},
		{
			name:          "neither form is empty",
			lid:           types.EmptyJID,
			pn:            types.EmptyJID,
			wantCanonical: types.EmptyJID,
			wantDisplay:   types.EmptyJID,
		},
		{
			name:          "hosted LID is still the stable identity",
			lid:           hostedLID,
			pn:            pn,
			wantCanonical: hostedLID,
			wantDisplay:   pn,
		},
		{
			name:          "AD device fields are stripped from the canonical identity",
			lid:           lidWithDevice,
			pn:            pn,
			wantCanonical: lid,
			wantDisplay:   pn,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			canonical, display := canonicalGroupParticipantJID(tt.lid, tt.pn)
			if canonical != tt.wantCanonical {
				t.Errorf("canonical = %v (%s), want %v (%s)", canonical, canonical.String(), tt.wantCanonical, tt.wantCanonical.String())
			}
			if display != tt.wantDisplay {
				t.Errorf("display = %v (%s), want %v (%s)", display, display.String(), tt.wantDisplay, tt.wantDisplay.String())
			}
		})
	}
}

func TestGroupParticipantIdentitiesWithoutClient(t *testing.T) {
	t.Parallel()

	lid := types.JID{User: "123456789012345", Server: types.HiddenUserServer}
	pn := types.JID{User: "919676700203", Server: types.DefaultUserServer}

	// With no client/store the resolver degrades to the pure policy instead of
	// panicking: the reported form is the only identity available.
	for _, reported := range []types.JID{lid, pn} {
		canonical, display := groupParticipantIdentities(context.Background(), nil, reported)
		if canonical != reported || display != reported {
			t.Errorf("groupParticipantIdentities(nil client, %s) = (%s, %s), want (%s, %s)",
				reported.String(), canonical.String(), display.String(), reported.String(), reported.String())
		}
	}
}
