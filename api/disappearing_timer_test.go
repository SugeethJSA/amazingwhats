package api

import (
	"testing"

	waBinary "github.com/polymorfa/hypermeow/binary"
)

// Synthetic usync <list> builders. All tests here are pure/offline: no client,
// no network, no store.
func timerTestList(users ...waBinary.Node) *waBinary.Node {
	return &waBinary.Node{Tag: "list", Content: users}
}

func timerTestUser(children ...waBinary.Node) waBinary.Node {
	return waBinary.Node{Tag: "user", Content: children}
}

func timerTestMode(attrs waBinary.Attrs) waBinary.Node {
	return waBinary.Node{Tag: "disappearing_mode", Attrs: attrs}
}

func TestParseDisappearingModeDuration(t *testing.T) {
	tests := []struct {
		name   string
		list   *waBinary.Node
		want   int64
		wantOK bool
	}{
		{
			name:   "zero means off",
			list:   timerTestList(timerTestUser(timerTestMode(waBinary.Attrs{"duration": "0"}))),
			want:   0,
			wantOK: true,
		},
		{
			name:   "one day",
			list:   timerTestList(timerTestUser(timerTestMode(waBinary.Attrs{"duration": "86400"}))),
			want:   86400,
			wantOK: true,
		},
		{
			name:   "seven days",
			list:   timerTestList(timerTestUser(timerTestMode(waBinary.Attrs{"duration": "604800"}))),
			want:   604800,
			wantOK: true,
		},
		{
			name:   "ninety days",
			list:   timerTestList(timerTestUser(timerTestMode(waBinary.Attrs{"duration": "7776000"}))),
			want:   7776000,
			wantOK: true,
		},
		{
			name:   "missing disappearing_mode child",
			list:   timerTestList(timerTestUser(waBinary.Node{Tag: "contact", Attrs: waBinary.Attrs{"type": "in"}})),
			want:   0,
			wantOK: false,
		},
		{
			name:   "missing duration attribute",
			list:   timerTestList(timerTestUser(timerTestMode(nil))),
			want:   0,
			wantOK: false,
		},
		{
			name:   "negative duration",
			list:   timerTestList(timerTestUser(timerTestMode(waBinary.Attrs{"duration": "-1"}))),
			want:   0,
			wantOK: false,
		},
		{
			name:   "malformed duration string",
			list:   timerTestList(timerTestUser(timerTestMode(waBinary.Attrs{"duration": "seven-days"}))),
			want:   0,
			wantOK: false,
		},
		{
			name:   "numeric int64 duration from binary decoder",
			list:   timerTestList(timerTestUser(timerTestMode(waBinary.Attrs{"duration": int64(86400)}))),
			want:   86400,
			wantOK: true,
		},
		{
			name: "multiple users with only one valid value",
			list: timerTestList(
				timerTestUser(timerTestMode(waBinary.Attrs{"duration": "-5"})),
				timerTestUser(waBinary.Node{Tag: "contact", Attrs: waBinary.Attrs{"type": "in"}}),
				timerTestUser(timerTestMode(waBinary.Attrs{"duration": "604800"})),
				timerTestUser(timerTestMode(waBinary.Attrs{"duration": "bad"})),
			),
			want:   604800,
			wantOK: true,
		},
		{
			name: "non-user siblings are ignored",
			list: timerTestList(
				waBinary.Node{Tag: "sid", Content: []byte("123")},
				timerTestUser(timerTestMode(waBinary.Attrs{"duration": "86400"})),
			),
			want:   86400,
			wantOK: true,
		},
		{
			name:   "empty list",
			list:   timerTestList(),
			want:   0,
			wantOK: false,
		},
		{
			name:   "nil list",
			list:   nil,
			want:   0,
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseDisappearingModeDuration(tt.list)
			if ok != tt.wantOK {
				t.Fatalf("parseDisappearingModeDuration() ok = %v, want %v (value %d)", ok, tt.wantOK, got)
			}
			if got != tt.want {
				t.Fatalf("parseDisappearingModeDuration() = %d, want %d", got, tt.want)
			}
		})
	}
}

// The getter must fail closed before any network work when there is no
// logged-in client. This also proves the nil guards are safe to call.
func TestGetDisappearingTimerDefaultRequiresLogin(t *testing.T) {
	var nilAPI *Api
	if _, err := nilAPI.GetDisappearingTimerDefault(); err == nil {
		t.Fatal("expected error for nil Api")
	}
	if _, err := (&Api{}).GetDisappearingTimerDefault(); err == nil {
		t.Fatal("expected error when waClient is nil")
	}
}
