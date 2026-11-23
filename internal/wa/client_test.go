package wa

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/lugvitc/whats4linux/internal/misc"
	_ "github.com/mattn/go-sqlite3"
	"github.com/polymorfa/hypermeow/store/sqlstore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestContainer builds a real, fully upgraded whatsmeow store against a
// throwaway local SQLite file. sqlstore.New only performs local schema work;
// it never opens a WhatsApp connection.
//
// ConfigDir is a package-level variable in internal/misc, so this helper (and
// every test that uses it) must stay sequential.
func newTestContainer(t *testing.T, ctx context.Context) *sqlstore.Container {
	t.Helper()

	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	container, err := sqlstore.New(ctx, "sqlite3", misc.GetSQLiteAddress("session.db"), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Close() })
	return container
}

func TestNewClient(t *testing.T) {
	ctx := context.Background()
	container := newTestContainer(t, ctx)

	cli, err := NewClient(ctx, container)
	require.NoError(t, err)
	require.NotNil(t, cli)

	is := assert.New(t)
	is.NotNil(cli.Store, "the first device from the container must be attached")
	is.NotNil(cli.Log, "a logger must always be supplied to whatsmeow")
	is.True(cli.EmitAppStateEventsOnFullSync)
	is.True(cli.EnableAutoReconnect)
	is.True(cli.AutoTrustIdentity)
	is.True(cli.SendReportingTokens)
	is.NotNil(cli.AutoReconnectHook)
	require.NotNil(t, cli.SocketConfig, "socket config must be set before Connect")
	is.Len(cli.SocketConfig.RaceURLs, 2, "both WhatsApp Web endpoints must be raced")
	is.Contains(cli.SocketConfig.RaceURLs[0], "web.whatsapp.com/ws/chat")
	is.Contains(cli.SocketConfig.RaceURLs[1], ":5222/ws/chat")
}

func TestNewClient_DeviceStoreError(t *testing.T) {
	ctx := context.Background()

	oldConfigDir := misc.ConfigDir
	misc.ConfigDir = t.TempDir()
	t.Cleanup(func() { misc.ConfigDir = oldConfigDir })

	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("uninitialised.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	// Deliberately skip sqlstore.Container.Upgrade: GetFirstDevice then fails
	// on the missing whatsmeow_device table, which is the one error path in
	// NewClient that does not need a live client.
	container := sqlstore.NewWithDB(db, "sqlite3", nil)

	cli, err := NewClient(ctx, container)
	assert.Nil(t, cli)
	require.Error(t, err)
	assert.ErrorContains(t, err, "get device store:")
	assert.ErrorContains(t, err, "whatsmeow_device")
}

func TestNewClient_AutoReconnectHook(t *testing.T) {
	ctx := context.Background()
	container := newTestContainer(t, ctx)

	cli, err := NewClient(ctx, container)
	require.NoError(t, err)
	require.NotNil(t, cli)

	hook := cli.AutoReconnectHook
	require.NotNil(t, hook)

	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil error means success", nil, true},
		{"empty error message", errors.New(""), true},
		{"network blip is retryable", errors.New("dial tcp 127.0.0.1:443: connect: connection refused"), true},
		{"server error is retryable", errors.New("500 internal server error"), true},
		{"401 is fatal", errors.New("401 unauthorized"), false},
		{"403 is fatal", errors.New("403 forbidden"), false},
		{"conflict is fatal", errors.New("stream:error conflict"), false},
		{"old version is fatal", errors.New("client is old version"), false},
		{"version is fatal", errors.New("version mismatch"), false},
		{"logout is fatal", errors.New("logout"), false},
		{"fatal keywords are case insensitive", errors.New("LOGOUT and CONFLICT"), false},
		{"fatal keywords match as substrings", errors.New("4011 is still a 401 substring"), false},
		{"non fatal word is retryable", errors.New("temporary congestion"), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// The hook is a pure closure over no mutable state.
			t.Parallel()
			assert.Equal(t, tt.want, hook(tt.err))
		})
	}
}
