package wa

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/misc"
	"github.com/lugvitc/amazingwhats/internal/query"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestAppDatabase points misc.ConfigDir at a throwaway directory and
// creates the groups schema. All database I/O is local SQLite: no WhatsApp
// client, socket or network is involved.
//
// ConfigDir is a package-level variable, so tests using this helper must not
// call t.Parallel.
func newTestAppDatabase(t *testing.T) *AppDatabase {
	t.Helper()

	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	adb, err := NewAppDatabase(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { _ = adb.Close() })

	_, err = adb.db.Exec(query.CreateGroupsTable)
	require.NoError(t, err)
	return adb
}

func TestNewAppDatabase(t *testing.T) {
	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	type ctxKey string
	ctx := context.WithValue(context.Background(), ctxKey("test"), "sentinel")

	adb, err := NewAppDatabase(ctx)
	require.NoError(t, err)
	require.NotNil(t, adb)

	is := assert.New(t)
	is.NotNil(adb.db)
	is.Equal("sentinel", adb.ctx.Value(ctxKey("test")), "the supplied context must be retained")
	is.NoError(adb.Close())
}

func TestGroupsSchemaStatements(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		stmt      string
		wantParam int
		contains  []string
	}{
		{
			name:     "create table targets amazingwhats_groups",
			stmt:     query.CreateGroupsTable,
			contains: []string{"CREATE TABLE IF NOT EXISTS amazingwhats_groups", "jid TEXT PRIMARY KEY"},
		},
		{
			name:      "upsert has nine placeholders",
			stmt:      query.InsertOrReplaceGroup,
			wantParam: 9,
			contains:  []string{"INSERT OR REPLACE INTO amazingwhats_groups", "is_default_sub"},
		},
		{
			name:     "select all has no placeholders",
			stmt:     query.SelectAllGroups,
			contains: []string{"FROM amazingwhats_groups", "COALESCE(is_parent, 0)"},
		},
		{
			name:      "select by jid has one placeholder",
			stmt:      query.SelectGroupByJID,
			wantParam: 1,
			contains:  []string{"WHERE jid = ?"},
		},
		{
			name:     "communities filter has no placeholders",
			stmt:     query.SelectCommunities,
			contains: []string{"WHERE is_parent = 1", "ORDER BY name COLLATE NOCASE"},
		},
		{
			name:      "count by parent has one placeholder",
			stmt:      query.CountGroupsByParent,
			wantParam: 1,
			contains:  []string{"SELECT COUNT(*)", "WHERE parent_jid = ?"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			is := assert.New(t)
			is.Equal(tt.wantParam, strings.Count(tt.stmt, "?"))
			for _, fragment := range tt.contains {
				is.Contains(tt.stmt, fragment)
			}
		})
	}
}

func TestGroupsMigrationStatements(t *testing.T) {
	adb := newTestAppDatabase(t) // creates the already-migrated table

	tests := []struct {
		name   string
		stmt   string
		column string
	}{
		{"parent jid", query.AlterGroupsAddParentJID, "parent_jid"},
		{"parent name", query.AlterGroupsAddParentName, "parent_name"},
		{"is parent", query.AlterGroupsAddIsParent, "is_parent"},
		{"is default sub", query.AlterGroupsAddIsDefaultSub, "is_default_sub"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := adb.db.Exec(tt.stmt)
			require.Error(t, err)
			// Initialise treats exactly this error as "already migrated".
			msg := strings.ToLower(err.Error())
			assert.Contains(t, msg, "duplicate column")
			assert.Contains(t, msg, tt.column)
			assert.Contains(t, strings.ToLower(tt.stmt), "alter table amazingwhats_groups add column")
		})
	}
}

// groupScanStub is a minimal database/sql scanner used to exercise scanGroup
// without a query. It mirrors the nine columns emitted by the select queries.
type groupScanStub struct {
	jid, name, topic, ownerJID, parentJID, parentName string
	participantCount, isParent, isDefaultSub          int
	err                                               error
}

func (s *groupScanStub) Scan(dest ...any) error {
	if s.err != nil {
		return s.err
	}
	values := []any{
		&s.jid, &s.name, &s.topic, &s.ownerJID, &s.participantCount,
		&s.parentJID, &s.parentName, &s.isParent, &s.isDefaultSub,
	}
	if len(dest) != len(values) {
		return fmt.Errorf("scanGroup passed %d destinations, want %d", len(dest), len(values))
	}
	for i := range dest {
		switch got := dest[i].(type) {
		case *string:
			want, ok := values[i].(*string)
			if !ok {
				return fmt.Errorf("destination %d is *string but value is %T", i, values[i])
			}
			*got = *want
		case *int:
			want, ok := values[i].(*int)
			if !ok {
				return fmt.Errorf("destination %d is *int but value is %T", i, values[i])
			}
			*got = *want
		default:
			return fmt.Errorf("destination %d has unsupported type %T", i, dest[i])
		}
	}
	return nil
}

func TestScanGroup(t *testing.T) {
	t.Parallel()

	scanErr := errors.New("scan failed")

	tests := []struct {
		name    string
		stub    groupScanStub
		want    *Group
		wantErr error
	}{
		{
			name: "all fields including parent link",
			stub: groupScanStub{
				jid:              "group@s.whatsapp.net",
				name:             "Family",
				topic:            "Topic",
				ownerJID:         "owner@s.whatsapp.net",
				participantCount: 12,
				parentJID:        "parent@s.whatsapp.net",
				parentName:       "Community",
				isParent:         0,
				isDefaultSub:     1,
			},
			want: &Group{
				JID:              "group@s.whatsapp.net",
				Name:             "Family",
				Topic:            "Topic",
				OwnerJID:         "owner@s.whatsapp.net",
				ParticipantCount: 12,
				ParentJID:        "parent@s.whatsapp.net",
				ParentName:       "Community",
				IsParent:         false,
				IsDefaultSub:     true,
			},
		},
		{
			name: "any non zero integer means true",
			stub: groupScanStub{
				jid:          "parent@s.whatsapp.net",
				isParent:     2,
				isDefaultSub: -1,
			},
			want: &Group{
				JID:          "parent@s.whatsapp.net",
				IsParent:     true,
				IsDefaultSub: true,
			},
		},
		{
			name: "zero integers mean false",
			stub: groupScanStub{jid: "plain@s.whatsapp.net"},
			want: &Group{JID: "plain@s.whatsapp.net"},
		},
		{
			name:    "arbitrary scan error propagates",
			stub:    groupScanStub{err: scanErr},
			wantErr: scanErr,
		},
		{
			name:    "sql.ErrNoRows propagates unchanged",
			stub:    groupScanStub{err: sql.ErrNoRows},
			wantErr: sql.ErrNoRows,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := scanGroup(&tt.stub)
			if tt.wantErr != nil {
				require.Error(t, err)
				assert.ErrorIs(t, err, tt.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestAppDatabase_StoreGroup(t *testing.T) {
	full := Group{
		JID:              "full@s.whatsapp.net",
		Name:             "Full Group",
		Topic:            "A topic",
		OwnerJID:         "owner@s.whatsapp.net",
		ParticipantCount: 7,
		ParentJID:        "parent@s.whatsapp.net",
		ParentName:       "Community",
		IsParent:         true,
		IsDefaultSub:     true,
	}

	tests := []struct {
		name  string
		seed  []Group
		group Group
		want  Group
	}{
		{name: "full group round trip", group: full, want: full},
		{
			name:  "minimal group round trip",
			group: Group{JID: "min@s.whatsapp.net"},
			want:  Group{JID: "min@s.whatsapp.net"},
		},
		{
			name: "quotes are stored literally",
			group: Group{
				JID:  "quote@s.whatsapp.net",
				Name: `O'Reilly "Friends"`,
			},
			want: Group{
				JID:  "quote@s.whatsapp.net",
				Name: `O'Reilly "Friends"`,
			},
		},
		{
			name: "upsert replaces existing row by jid",
			seed: []Group{{JID: "same@s.whatsapp.net", Name: "old", ParticipantCount: 1}},
			group: Group{
				JID:              "same@s.whatsapp.net",
				Name:             "new",
				ParticipantCount: 99,
				IsParent:         true,
			},
			want: Group{
				JID:              "same@s.whatsapp.net",
				Name:             "new",
				ParticipantCount: 99,
				IsParent:         true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adb := newTestAppDatabase(t)
			for _, g := range tt.seed {
				require.NoError(t, adb.StoreGroup(g))
			}

			require.NoError(t, adb.StoreGroup(tt.group))

			got, err := adb.FetchGroup(tt.group.JID)
			require.NoError(t, err)
			assert.Equal(t, &tt.want, got)

			all, err := adb.FetchGroups()
			require.NoError(t, err)
			assert.Len(t, all, 1, "upsert must keep exactly one row per JID")
		})
	}
}

func TestAppDatabase_FetchGroup_NotFound(t *testing.T) {
	adb := newTestAppDatabase(t)

	got, err := adb.FetchGroup("missing@s.whatsapp.net")
	assert.Nil(t, got)
	require.Error(t, err)
	assert.EqualError(t, err, "group with JID missing@s.whatsapp.net not found")
}

func TestAppDatabase_FetchGroups(t *testing.T) {
	groupA := Group{JID: "a@s.whatsapp.net", Name: "A", ParticipantCount: 3}
	groupB := Group{
		JID:       "b@s.whatsapp.net",
		Name:      "B",
		ParentJID: "parent@s.whatsapp.net",
		IsParent:  false,
	}
	groupC := Group{JID: "parent@s.whatsapp.net", Name: "Parent", IsParent: true}

	tests := []struct {
		name string
		seed []Group
		want []Group
	}{
		{name: "empty table returns no groups"},
		{name: "single group", seed: []Group{groupA}, want: []Group{groupA}},
		{name: "all columns round trip", seed: []Group{groupA, groupB, groupC}, want: []Group{groupA, groupB, groupC}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adb := newTestAppDatabase(t)
			for _, g := range tt.seed {
				require.NoError(t, adb.StoreGroup(g))
			}

			got, err := adb.FetchGroups()
			require.NoError(t, err)
			assert.ElementsMatch(t, tt.want, got)
		})
	}
}

func TestAppDatabase_FetchCommunities(t *testing.T) {
	alpha := Group{JID: "a@s.whatsapp.net", Name: "Alpha", IsParent: true}
	beta := Group{JID: "b@s.whatsapp.net", Name: "beta", IsParent: true}
	zebra := Group{JID: "z@s.whatsapp.net", Name: "zebra", IsParent: true}
	child := Group{JID: "c@s.whatsapp.net", Name: "Child", ParentJID: alpha.JID}

	tests := []struct {
		name string
		seed []Group
		want []Group
	}{
		{name: "no communities"},
		{
			name: "only parent rows, ordered case insensitively by name",
			seed: []Group{zebra, child, alpha, beta},
			want: []Group{alpha, beta, zebra},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adb := newTestAppDatabase(t)
			for _, g := range tt.seed {
				require.NoError(t, adb.StoreGroup(g))
			}

			got, err := adb.FetchCommunities()
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestAppDatabase_CountLinkedGroups(t *testing.T) {
	adb := newTestAppDatabase(t)

	seed := []Group{
		{JID: "c1", ParentJID: "parent1"},
		{JID: "c2", ParentJID: "parent1"},
		{JID: "c3", ParentJID: "parent2"},
	}
	for _, g := range seed {
		require.NoError(t, adb.StoreGroup(g))
	}

	tests := []struct {
		name      string
		parentJID string
		want      int
	}{
		{"two linked groups", "parent1", 2},
		{"one linked group", "parent2", 1},
		{"unknown parent", "absent", 0},
		{"empty parent jid", "", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := adb.CountLinkedGroups(tt.parentJID)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestAppDatabase_ParentCommunityName(t *testing.T) {
	tests := []struct {
		name      string
		seed      []Group
		parentJID string
		want      string
	}{
		{name: "empty jid returns empty string", want: ""},
		{
			name:      "stored parent row wins",
			seed:      []Group{{JID: "parent1", Name: "Stored Name", IsParent: true}},
			parentJID: "parent1",
			want:      "Stored Name",
		},
		{
			name:      "child cached name is the fallback",
			seed:      []Group{{JID: "child1", ParentJID: "parent1", ParentName: "Cached Name"}},
			parentJID: "parent1",
			want:      "Cached Name",
		},
		{
			name:      "missing parent returns empty string",
			parentJID: "parent1",
			want:      "",
		},
		{
			name: "blank parent name falls back to child cache",
			seed: []Group{
				{JID: "parent1", IsParent: true},
				{JID: "child1", ParentJID: "parent1", ParentName: "Cached Name"},
			},
			parentJID: "parent1",
			want:      "Cached Name",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adb := newTestAppDatabase(t)
			for _, g := range tt.seed {
				require.NoError(t, adb.StoreGroup(g))
			}
			assert.Equal(t, tt.want, adb.ParentCommunityName(tt.parentJID))
		})
	}
}

func TestAppDatabase_Close(t *testing.T) {
	adb := newTestAppDatabase(t)

	require.NoError(t, adb.Close())
	assert.NoError(t, adb.Close(), "database/sql Close must be idempotent")
}

func TestAppDatabase_StoreGroupConcurrent(t *testing.T) {
	adb := newTestAppDatabase(t)

	const count = 24
	var wg sync.WaitGroup
	errCh := make(chan error, count)

	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errCh <- adb.StoreGroup(Group{
				JID:  fmt.Sprintf("g%d@s.whatsapp.net", i),
				Name: fmt.Sprintf("Group %d", i),
			})
		}(i)
	}
	wg.Wait()
	close(errCh)

	for err := range errCh {
		require.NoError(t, err)
	}

	groups, err := adb.FetchGroups()
	require.NoError(t, err)
	assert.Len(t, groups, count, "the write mutex must serialize all upserts")
}
