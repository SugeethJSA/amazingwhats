package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// StatusPrivacyEntry is the wire DTO returned to the frontend. There is no
// pure status-input adaptation helper in status.go (SetStatusMessage and
// GetStatusPrivacy both go through waClient), so this test locks down the
// observable JSON contract of the DTO instead.
func TestStatusPrivacyEntryJSON(t *testing.T) {
	tests := []struct {
		name    string
		entry   StatusPrivacyEntry
		want    []string
		absent  []string
	}{
		{
			name:   "explicit list and non-default",
			entry:  StatusPrivacyEntry{Type: "contact_blacklist", JIDs: []string{"111@s.whatsapp.net", "222@s.whatsapp.net"}, IsDefault: false},
			want:   []string{`"type":"contact_blacklist"`, `"jids":["111@s.whatsapp.net","222@s.whatsapp.net"]`, `"is_default":false`},
			absent: nil,
		},
		{
			name:   "default with no JIDs omits jids",
			entry:  StatusPrivacyEntry{Type: "all", IsDefault: true},
			want:   []string{`"type":"all"`, `"is_default":true`},
			absent: []string{`"jids"`},
		},
		{
			name:   "empty JID slice is omitted",
			entry:  StatusPrivacyEntry{Type: "none", JIDs: []string{}},
			want:   []string{`"type":"none"`},
			absent: []string{`"jids"`},
		},
		{
			name:   "zero value",
			entry:  StatusPrivacyEntry{},
			want:   []string{`"type":""`, `"is_default":false`},
			absent: []string{`"jids"`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			data, err := json.Marshal(tt.entry)
			if err != nil {
				t.Fatalf("json.Marshal(%+v): %v", tt.entry, err)
			}
			got := string(data)
			for _, want := range tt.want {
				if !strings.Contains(got, want) {
					t.Errorf("marshaled %q missing %q", got, want)
				}
			}
			for _, absent := range tt.absent {
				if strings.Contains(got, absent) {
					t.Errorf("marshaled %q unexpectedly contains %q", got, absent)
				}
			}
		})
	}
}

func TestStatusPrivacyEntryJSONRoundTrip(t *testing.T) {
	t.Parallel()

	in := StatusPrivacyEntry{Type: "whitelist", JIDs: []string{"abc@g.us"}, IsDefault: false}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out StatusPrivacyEntry
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	if out.Type != in.Type || out.IsDefault != in.IsDefault || len(out.JIDs) != 1 || out.JIDs[0] != in.JIDs[0] {
		t.Fatalf("round trip = %+v, want %+v", out, in)
	}
}
