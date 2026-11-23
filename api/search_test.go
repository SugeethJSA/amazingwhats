package api

import (
	"strings"
	"testing"
)

// Both search entry points short-circuit on an empty query or a non-positive
// limit before touching messageStore, so those branches are unit-testable with
// a zero-value Api (no live client, store, Wails context or network).
func TestSearchMessagesValidationOnBareAPI(t *testing.T) {
	tests := []struct {
		name    string
		params  SearchParams
		wantErr bool
	}{
		{"empty query short-circuits", SearchParams{}, false},
		{"empty query ignores zero limit", SearchParams{Limit: 0}, false},
		{"empty query ignores negative limit", SearchParams{Query: "", Limit: -5, Offset: -1}, false},
		{"zero limit rejected", SearchParams{Query: "hello", Limit: 0}, true},
		{"negative limit rejected", SearchParams{Query: "hello", Limit: -1}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := (&Api{}).SearchMessages(tt.params)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), "limit must be positive") {
					t.Fatalf("SearchMessages(%+v) error = %v, want limit must be positive", tt.params, err)
				}
				if got != nil {
					t.Fatalf("SearchMessages(%+v) results = %v, want nil on error", tt.params, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("SearchMessages(%+v) unexpected error: %v", tt.params, err)
			}
			if got != nil {
				t.Fatalf("SearchMessages(%+v) = %v, want nil for empty query", tt.params, got)
			}
		})
	}
}

func TestGetSearchSuggestionsValidationOnBareAPI(t *testing.T) {
	tests := []struct {
		name    string
		query   string
		limit   int
		wantErr bool
	}{
		{"empty query short-circuits", "", 10, false},
		{"empty query ignores zero limit", "", 0, false},
		{"zero limit rejected", "abc", 0, true},
		{"negative limit rejected", "abc", -3, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := (&Api{}).GetSearchSuggestions(tt.query, tt.limit)
			if tt.wantErr {
				if err == nil || !strings.Contains(err.Error(), "limit must be positive") {
					t.Fatalf("GetSearchSuggestions(%q, %d) error = %v, want limit must be positive", tt.query, tt.limit, err)
				}
				if got != nil {
					t.Fatalf("GetSearchSuggestions(%q, %d) = %v, want nil on error", tt.query, tt.limit, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("GetSearchSuggestions(%q, %d) unexpected error: %v", tt.query, tt.limit, err)
			}
			if got != nil {
				t.Fatalf("GetSearchSuggestions(%q, %d) = %v, want nil for empty query", tt.query, tt.limit, got)
			}
		})
	}
}

// The clamping itself (min(limit, maxPageSize)) happens immediately before the
// messageStore call and cannot be observed without a store. Lock down the cap
// constant here; the execution path is reported as unverified.
func TestMaxPageSizeCapValue(t *testing.T) {
	t.Parallel()

	if maxPageSize != 200 {
		t.Fatalf("maxPageSize = %d, want 200", maxPageSize)
	}
}
