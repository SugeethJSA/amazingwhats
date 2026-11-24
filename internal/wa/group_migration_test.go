package wa

import (
	"context"
	"testing"

	"github.com/lugvitc/amazingwhats/internal/misc"
	"github.com/lugvitc/amazingwhats/internal/query"
	"github.com/stretchr/testify/require"
)

func newMigrationTestDB(t *testing.T) *AppDatabase {
	t.Helper()
	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })
	adb, err := NewAppDatabase(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { _ = adb.Close() })
	return adb
}

func TestMigrateGroupsTableNameLegacyOnly(t *testing.T) {
	adb := newMigrationTestDB(t)
	_, err := adb.db.Exec(`CREATE TABLE whats4linux_groups (jid TEXT PRIMARY KEY, name TEXT)`)
	require.NoError(t, err)
	_, err = adb.db.Exec(`INSERT INTO whats4linux_groups (jid, name) VALUES ('123@g.us', 'Old group')`)
	require.NoError(t, err)

	require.NoError(t, adb.migrateGroupsTableName())
	require.NoError(t, adb.migrateGroupsTableName()) // idempotent after renaming

	// The rename happens before CreateGroupsTable in Initialise; simulate that
	// ordering here and confirm the row survives.
	_, err = adb.db.Exec(query.CreateGroupsTable)
	require.NoError(t, err)

	legacyExists, err := adb.tableExists("whats4linux_groups")
	require.NoError(t, err)
	require.False(t, legacyExists, "legacy table should be renamed away")
	newExists, err := adb.tableExists("amazingwhats_groups")
	require.NoError(t, err)
	require.True(t, newExists)

	var name string
	err = adb.db.QueryRow(`SELECT name FROM amazingwhats_groups WHERE jid = '123@g.us'`).Scan(&name)
	require.NoError(t, err)
	require.Equal(t, "Old group", name)
}

func TestMigrateGroupsTableNameBothExist(t *testing.T) {
	adb := newMigrationTestDB(t)
	_, err := adb.db.Exec(`CREATE TABLE whats4linux_groups (jid TEXT PRIMARY KEY)`)
	require.NoError(t, err)
	_, err = adb.db.Exec(`INSERT INTO whats4linux_groups (jid) VALUES ('legacy@g.us')`)
	require.NoError(t, err)
	_, err = adb.db.Exec(`CREATE TABLE amazingwhats_groups (jid TEXT PRIMARY KEY)`)
	require.NoError(t, err)
	_, err = adb.db.Exec(`INSERT INTO amazingwhats_groups (jid) VALUES ('current@g.us')`)
	require.NoError(t, err)

	require.NoError(t, adb.migrateGroupsTableName())
	require.NoError(t, adb.migrateGroupsTableName()) // idempotent

	var legacyJID, currentJID string
	require.NoError(t, adb.db.QueryRow(`SELECT jid FROM whats4linux_groups`).Scan(&legacyJID))
	require.NoError(t, adb.db.QueryRow(`SELECT jid FROM amazingwhats_groups`).Scan(&currentJID))
	require.Equal(t, "legacy@g.us", legacyJID, "legacy data must remain untouched")
	require.Equal(t, "current@g.us", currentJID, "current data must remain untouched")
}

func TestMigrateGroupsTableNameNeitherExistsIsNoOp(t *testing.T) {
	adb := newMigrationTestDB(t)
	require.NoError(t, adb.migrateGroupsTableName())
	for _, name := range []string{"whats4linux_groups", "amazingwhats_groups"} {
		exists, err := adb.tableExists(name)
		require.NoError(t, err)
		require.False(t, exists, "%s should not be created by migration", name)
	}
}
