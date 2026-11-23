package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"html"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/lugvitc/whats4linux/internal/cache"
	"github.com/lugvitc/whats4linux/internal/misc"
	"github.com/lugvitc/whats4linux/internal/notify"
	"github.com/lugvitc/whats4linux/internal/settings"
	"github.com/lugvitc/whats4linux/internal/store"
	"github.com/lugvitc/whats4linux/internal/wa"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/appstate"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/polymorfa/hypermeow/store/sqlstore"
	"github.com/polymorfa/hypermeow/types"
	"github.com/polymorfa/hypermeow/types/events"
	waLog "github.com/polymorfa/hypermeow/util/log"
	"github.com/purpshell/meowcaller"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// knownBuildTypes are the only trailing suffixes NormalizeUpdateVersion strips.
// They come from main.go's default ("unclassified"), the release workflows
// ("release", "nightly"), and the BuildArgs.BuildType doc ("debug", "snapshot").
// "production" and "dev" are included for build profiles that stamp them.
// Any other suffix is part of the version (e.g. the "beta.1" in "1.2.3-beta.1")
// and is deliberately preserved.
var knownBuildTypes = []string{"production", "release", "nightly", "dev", "debug", "snapshot", "unclassified"}

// NormalizeUpdateVersion converts a build-time version string into the release
// tag form expected by updater.Config.CurrentVersion (no "v" prefix, no build
// type suffix). cmd.GetApp builds ctx.App.Version as "<version>-<buildType>",
// so only a *known* trailing build type is removed; a semver prerelease such as
// "1.2.3-beta.1" survives intact. Development identifiers map to "0.0.0" so a
// dev build is treated as older than any published release.
func NormalizeUpdateVersion(raw string) string {
	v := strings.TrimSpace(raw)
	for _, buildType := range knownBuildTypes {
		if suffix := "-" + buildType; strings.HasSuffix(v, suffix) {
			v = strings.TrimSuffix(v, suffix)
			break
		}
	}
	v = strings.TrimPrefix(v, "v")
	if v == "" || v == "dev" {
		return "0.0.0"
	}
	return v
}

// MarkUpdaterReady records that the GitHub provider and the Wails updater were
// both initialised successfully. It is deliberately a package-level function
// rather than a method on Api: Wails binds every exported method of a service
// to the frontend, and this must not be callable from JavaScript. Called only
// from cmd/run.go.
func MarkUpdaterReady(a *Api) {
	if a != nil {
		a.updaterReady.Store(true)
	}
}

// Api struct
type Api struct {
	ctx                 context.Context
	app                 *application.App
	window              *application.WebviewWindow
	cw                  *wa.AppDatabase
	waClient            *whatsmeow.Client
	messageStore        *store.MessageStore
	imageCache          *cache.ImageCache
	waContainer         *sqlstore.Container
	callClient          *meowcaller.Client
	sessionDB           *sql.DB
	eventHandlerID      uint32
	eventHandlerSet     bool
	startupErr          error
	loginCancel         context.CancelFunc
	lifecycleMu         sync.Mutex
	loginMu             sync.Mutex
	eventMu             sync.RWMutex
	taskMu              sync.Mutex
	backgroundTasks     sync.WaitGroup
	shuttingDown        bool
	windowFocused       atomic.Bool
	groupRepairInFlight atomic.Bool
	appStateResync      atomic.Bool

	// reconnectMu guards the single app-level reconnect loop slot. whatsmeow
	// already auto-reconnects, so at most one app-level fallback loop may be
	// active and a Connected event supersedes it.
	reconnectMu     sync.Mutex
	reconnectGen    uint64
	reconnectActive bool
	reconnectCancel context.CancelFunc
	// reconnectStatus is true while a "reconnecting" status has been emitted
	// and not yet settled by a connected/disconnected transition.
	reconnectStatus atomic.Bool

	// updaterReady is set by cmd/run.go only after the GitHub provider and the
	// Wails updater are both configured. Every Updater call is guarded by it so
	// an uninitialised updater is never touched (offline/dev init failure).
	updaterReady atomic.Bool

	taskCh         chan func()
	workerWg       sync.WaitGroup
	healthCheckCtx context.CancelFunc
	healthCheckWg  sync.WaitGroup
}

// repairGroupNames heals whats4linux_groups rows that are missing or were
// stored with an empty name during early history sync. It runs in the
// background after the client connects (never on the GetChatList hot path,
// which must stay local-only and instant) and tells the frontend to reload
// the chat list once anything was fixed.
func (a *Api) repairGroupNames() {
	if !a.groupRepairInFlight.CompareAndSwap(false, true) {
		return
	}
	defer a.groupRepairInFlight.Store(false)

	repaired := 0
	for _, cm := range a.messageStore.GetChatList() {
		if cm.JID.Server != types.GroupServer {
			continue
		}
		if g, err := a.cw.FetchGroup(cm.JID.String()); err == nil && g.Name != "" {
			continue
		}
		gi, err := a.waClient.GetGroupInfo(a.ctx, cm.JID)
		if err != nil || gi == nil || gi.GroupName.Name == "" {
			continue
		}
		parentJID := ""
		if !gi.LinkedParentJID.IsEmpty() {
			parentJID = gi.LinkedParentJID.String()
		}
		if err := a.cw.StoreGroup(wa.Group{
			JID:              cm.JID.String(),
			Name:             gi.GroupName.Name,
			Topic:            gi.GroupTopic.Topic,
			OwnerJID:         gi.OwnerJID.String(),
			ParticipantCount: len(gi.Participants),
			ParentJID:        parentJID,
			ParentName:       a.cw.ParentCommunityName(parentJID),
			IsParent:         gi.IsParent,
			IsDefaultSub:     gi.IsDefaultSubGroup,
		}); err != nil {
			log.Println("repairGroupNames: failed to persist group:", cm.JID.String(), err)
			continue
		}
		repaired++
	}

	if repaired > 0 {
		log.Printf("repairGroupNames: repaired %d group name(s)", repaired)
		a.app.Event.Emit("wa:chat_list_refresh")
	}
}

// resyncAppState fully syncs the regular_low app state collection (archive,
// pin and mute mutations). When the local hash chain is corrupted
// ("mismatching LTHash"), incremental sync fails forever and mutations from
// the phone never arrive — recover by dropping the local version and pulling
// the collection from scratch. Runs in the background after Connected.
func (a *Api) resyncAppState() {
	if !a.appStateResync.CompareAndSwap(false, true) {
		return
	}
	defer a.appStateResync.Store(false)

	// regular_low carries archive/pin mutations, regular_high carries mutes.
	// FetchAppState with fullSync=true resets the local version itself and
	// re-applies the collection from a server snapshot; with
	// EmitAppStateEventsOnFullSync set, every mutation is dispatched to
	// mainEventHandler (FromFullSync=true) and lands in our tables.
	//
	// critical_block and critical_unblock_low are NOT full-synced here —
	// those collections are huge and fullSync destroys the version before the
	// network round-trip completes, so a failure wipes the version entirely.
	// Instead, critical_unblock_low is fetched without fullSync (preserving
	// any existing mutation MACs); if its version was never stored (0), the
	// internal fullSync code path still fetches the full snapshot.
	//
	// This is necessary because whatsmeow's auto-sync in
	// handleAppStateSyncKeyShare only fires during initial pairing or key
	// renewal — NOT on every connect.
	for _, name := range []appstate.WAPatchName{appstate.WAPatchRegularLow, appstate.WAPatchRegularHigh} {
		slog.Info(fmt.Sprintf("Starting app state full sync for %s", name), "source", "appstate")
		if err := a.waClient.FetchAppState(a.ctx, name, true, false); err != nil {
			slog.Error(fmt.Sprintf("App state full sync failed for %s: %v", name, err), "source", "appstate")
			a.emitError(fmt.Sprintf("App state sync failed: %s — %v", name, err))
			continue
		}
		slog.Info(fmt.Sprintf("App state fully synced: %s", name), "source", "appstate")
	}
	slog.Info(fmt.Sprintf("Starting app state sync for %s", appstate.WAPatchCriticalBlock), "source", "appstate")
	if err := a.waClient.FetchAppState(a.ctx, appstate.WAPatchCriticalBlock, false, false); err != nil {
		slog.Error(fmt.Sprintf("Block list sync failed: %v", err), "source", "appstate")
	}
	slog.Info(fmt.Sprintf("Starting app state sync for %s", appstate.WAPatchCriticalUnblockLow), "source", "appstate")
	if err := a.waClient.FetchAppState(a.ctx, appstate.WAPatchCriticalUnblockLow, false, false); err != nil {
		slog.Error(fmt.Sprintf("Contact sync failed: %v", err), "source", "appstate")
		a.emitError(fmt.Sprintf("Contact sync failed: %v", err))
	}
	if versions, _, err := a.waClient.Store.AppState.GetAppStateVersion(a.ctx, string(appstate.WAPatchCriticalUnblockLow)); err == nil && versions > 0 {
		contacts, _ := a.waClient.Store.Contacts.GetAllContacts(a.ctx)
		slog.Info(fmt.Sprintf("Synced %d entries (version %d)", len(contacts), versions), "source", "contacts")
	} else if err != nil {
		slog.Error(fmt.Sprintf("Version check failed: %v", err), "source", "contacts")
	} else {
		slog.Warn("Sync has never completed (version 0)", "source", "contacts")
	}
	slog.Info("Resync complete", "source", "appstate")
	a.app.Event.Emit("wa:chat_list_refresh")
	if a.sessionDB != nil {
		res, err := a.sessionDB.ExecContext(a.ctx,
			`DELETE FROM whatsmeow_contacts
			 WHERE (first_name IS NULL OR first_name = '')
			   AND (full_name IS NULL OR full_name = '')
			   AND (push_name IS NULL OR push_name = '')
			   AND (business_name IS NULL OR business_name = '')`)
		if err != nil {
			slog.Error(fmt.Sprintf("Failed to purge empty stubs: %v", err), "source", "contacts")
		} else if n, _ := res.RowsAffected(); n > 0 {
			slog.Info(fmt.Sprintf("Purged %d empty stubs", n), "source", "contacts")
		}
	}
}

// reconnectLoop is started as a background task after an unexpected
// disconnect. whatsmeow already auto-reconnects on its own, so this loop is a
// fallback that only runs while the socket is genuinely down: each attempt
// checks IsConnected() first, and a Connected event supersedes the loop.
// Stops on logout/shutdown or after maxAttempts failed tries.
func (a *Api) reconnectLoop() {
	// After a logout the device store is deleted (Store.ID == nil). Never
	// start (or keep) a reconnect loop against deleted credentials.
	a.lifecycleMu.Lock()
	clientAtStart := a.waClient
	loggedOut := clientAtStart == nil || clientAtStart.Store.ID == nil
	a.lifecycleMu.Unlock()
	if loggedOut || a.isShuttingDown() {
		return
	}

	loopCtx, gen, cancel, ok := a.beginReconnectLoop()
	if !ok {
		return // another loop already owns the reconnect slot
	}
	outcome := reconnectAborted
	defer func() { a.finishReconnectLoop(gen, cancel, outcome) }()

	// The task waited in the worker queue; whatsmeow may have reconnected in
	// the meantime. Don't announce or retry a reconnect that isn't needed.
	if a.clientIsConnected() {
		outcome = reconnectConnected
		return
	}
	if a.reconnectStatus.CompareAndSwap(false, true) {
		a.app.Event.Emit("wa:status", "reconnecting")
	}

	backoff := 2 * time.Second
	const maxBackoff = 30 * time.Second
	for i := range 8 {
		select {
		case <-loopCtx.Done():
			// A Connected event, logout or shutdown cancelled us. Only claim
			// success when the socket really is back.
			if a.clientIsConnected() {
				outcome = reconnectConnected
			}
			return
		case <-a.ctx.Done():
			return
		case <-time.After(backoff):
		}
		if a.isShuttingDown() {
			return
		}
		slog.Info(fmt.Sprintf("Attempt %d/8...", i+1), "source", "reconnect")
		a.loginMu.Lock()
		client := a.waClient
		if client == nil || client.Store.ID == nil {
			a.loginMu.Unlock()
			return
		}
		// whatsmeow's auto-reconnect can land at any moment. Connect() against
		// a live socket only returns "websocket is already connected" and burns
		// an attempt, so yield to the live connection instead.
		if client.IsConnected() {
			a.loginMu.Unlock()
			slog.Info("Client already connected — stopping reconnect loop", "source", "reconnect")
			outcome = reconnectConnected
			return
		}
		select {
		case <-loopCtx.Done():
			a.loginMu.Unlock()
			if a.clientIsConnected() {
				outcome = reconnectConnected
			}
			return
		default:
		}
		err := client.Connect()
		a.loginMu.Unlock()
		if err != nil {
			if client.IsConnected() {
				// Auto-reconnect won the race while Connect() was in flight.
				slog.Info("Auto-reconnect won the race — stopping reconnect loop", "source", "reconnect")
				outcome = reconnectConnected
				return
			}
			slog.Warn(fmt.Sprintf("Attempt %d failed: %v", i+1, err), "source", "reconnect")
			if backoff < maxBackoff {
				backoff = time.Duration(float64(backoff) * 1.5)
			}
			continue
		}
		slog.Info("Reconnect successful", "source", "reconnect")
		outcome = reconnectConnected
		return
	}
	slog.Error("All attempts exhausted — staying disconnected", "source", "reconnect")
	outcome = reconnectExhausted
}

// reconnectOutcome describes how a reconnect loop ended so the pending
// "reconnecting" status can be settled exactly once.
type reconnectOutcome uint8

const (
	// reconnectAborted is a silent settlement: logout/shutdown/superseded all
	// emit their own status, so no extra "disconnected" toast is wanted.
	reconnectAborted reconnectOutcome = iota
	reconnectConnected
	reconnectExhausted
)

// beginReconnectLoop claims the single app-level reconnect slot. A second
// caller gets ok=false and must not run a loop. The returned context is
// cancelled by a Connected event (supersedeReconnectLoop), by shutdown, or by
// finishReconnectLoop.
func (a *Api) beginReconnectLoop() (context.Context, uint64, context.CancelFunc, bool) {
	if a.isShuttingDown() {
		return nil, 0, nil, false
	}
	a.reconnectMu.Lock()
	defer a.reconnectMu.Unlock()
	if a.reconnectActive {
		return nil, 0, nil, false
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.reconnectGen++
	a.reconnectActive = true
	a.reconnectCancel = cancel
	return ctx, a.reconnectGen, cancel, true
}

// finishReconnectLoop releases the slot only if this generation still owns it,
// then settles the pending "reconnecting" status once. A superseded loop owns
// nothing, so it cannot clobber the status of the loop that replaced it.
func (a *Api) finishReconnectLoop(gen uint64, cancel context.CancelFunc, outcome reconnectOutcome) {
	cancel()
	a.reconnectMu.Lock()
	owns := a.reconnectActive && a.reconnectGen == gen
	if owns {
		a.reconnectActive = false
		a.reconnectCancel = nil
	}
	a.reconnectMu.Unlock()
	if !owns || !a.reconnectStatus.CompareAndSwap(true, false) {
		return
	}
	switch outcome {
	case reconnectConnected:
		// "logged_in" is the connected status the frontend uses to dismiss the
		// reconnecting toast (it accepts "success" as well).
		a.app.Event.Emit("wa:status", "logged_in")
	case reconnectExhausted:
		a.app.Event.Emit("wa:status", "disconnected")
		a.app.Event.Emit("wa:error", "Could not reconnect to WhatsApp after 8 attempts.")
	}
	// reconnectAborted clears the flag above but emits nothing: logout /
	// shutdown already emit their own status.
}

// supersedeReconnectLoop cancels any running loop and frees the slot. Called
// when a Connected event shows whatsmeow already restored the connection.
func (a *Api) supersedeReconnectLoop() {
	a.reconnectMu.Lock()
	cancel := a.reconnectCancel
	a.reconnectCancel = nil
	a.reconnectActive = false
	a.reconnectMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// emitConnectedStatus settles a pending reconnect status when a Connected
// event arrives without the app-level loop having finished yet.
func (a *Api) emitConnectedStatus() {
	if a.reconnectStatus.CompareAndSwap(true, false) {
		a.app.Event.Emit("wa:status", "logged_in")
	}
}

// clearReconnectStatus drops a pending reconnect status without emitting a new
// one; used on logout/shutdown where another status event explains the state.
func (a *Api) clearReconnectStatus() {
	a.reconnectStatus.Store(false)
}

// clientIsConnected reports whether the current whatsmeow client owns a live
// websocket. Safe to call from any goroutine.
func (a *Api) clientIsConnected() bool {
	a.lifecycleMu.Lock()
	client := a.waClient
	a.lifecycleMu.Unlock()
	return client != nil && client.IsConnected()
}

func (a *Api) emitError(msg string) {
	slog.Error(msg, "source", "app")
	a.app.Event.Emit("wa:error", msg)
}

// htmlTagRE strips HTML tags from message previews so desktop notifications
// show plain text rather than markup.
var htmlTagRE = regexp.MustCompile(`<[^>]*>`)

// registerNotifyHandlerOnce keeps exactly one notification callback installed
// for the process. api.New is called once by the app, but Wails tests may build
// more than one service; the first registration owns the callback.
var registerNotifyHandlerOnce sync.Once

// SetWindowFocused is called by the frontend on window focus/blur so the
// backend only raises notifications while the window is in the background.
func (a *Api) SetWindowFocused(focused bool) {
	a.windowFocused.Store(focused)
}

// notificationSenderJID resolves a LID sender to its phone number before any
// contact lookup so the name shown in a notification matches the chat list.
func (a *Api) notificationSenderJID(v *events.Message) types.JID {
	sender := v.Info.Sender
	if sender.IsEmpty() || a.waClient == nil || a.waClient.Store == nil {
		return sender
	}
	return canonicalUserJID(a.ctx, a.waClient, sender)
}

// notificationChatName returns the group name for groups and the contact name
// for direct chats. PushName alone is wrong for groups: it is the sender's
// display name, not the conversation title.
func (a *Api) notificationChatName(chatJID types.JID, sender types.JID, pushName string) string {
	if chatJID.Server == types.GroupServer && a.cw != nil {
		if g, err := a.cw.FetchGroup(chatJID.String()); err == nil && g != nil && g.Name != "" {
			return g.Name
		}
	}
	if !sender.IsEmpty() {
		if name := a.contactNameForJID(sender); name != "" {
			return name
		}
	}
	if !chatJID.IsEmpty() && a.waClient != nil && a.waClient.Store != nil {
		if name := a.contactNameForJID(chatJID); name != "" {
			return name
		}
	}
	if pushName != "" {
		return pushName
	}
	return "New message"
}

// notifyIncoming raises a desktop notification for an incoming message when the
// window isn't focused.
func (a *Api) notifyIncoming(v *events.Message, parsedHTML string) {
	chatJID := v.Info.Chat
	sender := a.notificationSenderJID(v)
	title := a.notificationChatName(chatJID, sender, v.Info.PushName)

	// Strip markup and decode entities: the notification body must contain
	// display text only, never raw backend/protobuf text.
	body := strings.TrimSpace(html.UnescapeString(htmlTagRE.ReplaceAllString(parsedHTML, "")))
	if body == "" {
		body = "Sent you a message"
	}
	if chatJID.Server == types.GroupServer {
		if name := a.contactNameForJID(sender); name != "" && name != title {
			body = name + ": " + body
		}
	}

	opts := notify.Options{
		ChatJID:   chatJID.String(),
		MessageID: v.Info.ID,
		SenderJID: sender.String(),
		Title:     title,
		Body:      body,
		Actions:   true,
	}
	if a.imageCache != nil {
		if avatar, _, err := a.imageCache.ReadAvatarByJID(chatJID.String()); err == nil {
			opts.Avatar = avatar
		}
	}
	if a.messageStore != nil {
		opts.Image = a.messageStore.GetThumbnail(v.Info.ID)
	}

	if err := notify.Notify(opts); err != nil {
		// Log only the error, never the notification payload.
		log.Println("notify failed:", err)
	}
}

// handleNotificationAction restores the window, then emits the exact events
// the frontend listens for. Lookup work happens before InvokeAsync so no disk
// or network I/O runs on the UI thread.
func (a *Api) handleNotificationAction(action, chatJID, messageID, text string) {
	if a.app == nil || chatJID == "" {
		return
	}

	name := "New message"
	avatar := ""
	if parsed, err := types.ParseJID(chatJID); err == nil {
		lookup := parsed
		if a.waClient != nil && a.waClient.Store != nil {
			lookup = canonicalUserJID(a.ctx, a.waClient, parsed)
		}
		name = a.notificationChatName(parsed, lookup, "")
	}
	if a.imageCache != nil {
		avatar, _ = a.GetCachedAvatar(chatJID, false)
	}

	senderJID := chatJID
	if action == notify.ActionReply && a.messageStore != nil {
		if msg, err := a.messageStore.GetMessageWithMediaByID(messageID); err == nil && msg != nil && !msg.Info.Sender.IsEmpty() {
			senderJID = msg.Info.Sender.String()
		}
	}

	application.InvokeAsync(func() {
		if a.window != nil {
			a.window.UnMinimise()
			a.window.Show()
			a.window.Focus()
		}
		switch action {
		case notify.ActionOpen:
			a.app.Event.Emit("wa:open_chat", map[string]any{
				"chatJid": chatJID,
				"name":    name,
				"avatar":  avatar,
			})
		case notify.ActionReply:
			a.app.Event.Emit("wa:notification_reply", map[string]any{
				"chatJid":   chatJID,
				"messageId": messageID,
				"senderJid": senderJID,
				"name":      name,
				"avatar":    avatar,
				"text":      text,
			})
		}
	})
}

// New creates a new Api service with the Wails application and its main
// window injected. Wails v3 services receive dependencies explicitly; there
// is no implicit runtime context.
func New(app *application.App, window *application.WebviewWindow) *Api {
	a := &Api{app: app, window: window}
	a.startWorkerPool()
	registerNotifyHandlerOnce.Do(func() {
		notify.SetActionHandler(a.handleNotificationAction)
	})
	return a
}

const workerPoolSize = 8
const workerQueueSize = 256

func (a *Api) startWorkerPool() {
	a.taskCh = make(chan func(), workerQueueSize)
	a.workerWg.Add(workerPoolSize)
	for range workerPoolSize {
		go func() {
			defer a.workerWg.Done()
			for task := range a.taskCh {
				if task == nil {
					return
				}
				task()
			}
		}()
	}
}

func (a *Api) startBackground(task func()) bool {
	if task == nil {
		return false
	}
	a.taskMu.Lock()
	shuttingDown := a.shuttingDown
	a.taskMu.Unlock()
	if shuttingDown {
		return false
	}
	select {
	case a.taskCh <- task:
		return true
	default:
		// Queue full — drop the task to avoid blocking the event loop.
		log.Println("[bg] worker queue full, dropping task")
		return false
	}
}

func (a *Api) isShuttingDown() bool {
	a.taskMu.Lock()
	defer a.taskMu.Unlock()
	return a.shuttingDown
}

// startConnectionHealthCheck begins periodic connection health monitoring.
// It sends a ping every 30 seconds and triggers reconnection if the connection appears stale.
func (a *Api) startConnectionHealthCheck() {
	a.lifecycleMu.Lock()
	if a.healthCheckCtx != nil {
		a.lifecycleMu.Unlock()
		return
	}
	// A stale Connected event must not restart monitoring after logout.
	if a.waClient == nil || a.waClient.Store.ID == nil {
		a.lifecycleMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.healthCheckCtx = cancel
	a.lifecycleMu.Unlock()

	a.healthCheckWg.Add(1)
	go func() {
		defer a.healthCheckWg.Done()
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		consecutiveFailures := 0
		const maxFailures = 3

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if a.isShuttingDown() {
					return
				}

				a.lifecycleMu.Lock()
				client := a.waClient
				a.lifecycleMu.Unlock()

				if client == nil {
					continue
				}

				if !client.IsConnected() {
					consecutiveFailures++
					slog.Warn(fmt.Sprintf("Health check: client not connected (failures: %d/%d)", consecutiveFailures, maxFailures), "source", "health")
					if consecutiveFailures >= maxFailures {
						slog.Error("Health check: max failures reached, triggering reconnect", "source", "health")
						a.emitError("Connection lost — reconnecting...")
						a.startBackground(a.reconnectLoop)
						return
					}
					continue
				}

				// whatsmeow's internal keepalive (keepAliveLoop) already
				// detects dead links, dispatches events.KeepAliveTimeout and
				// forces an auto-reconnect after KeepAliveMaxFailTime, so no
				// app-level ping is needed here.
				consecutiveFailures = 0
			}
		}
	}()
}

func (a *Api) stopConnectionHealthCheck() {
	a.lifecycleMu.Lock()
	cancel := a.healthCheckCtx
	a.healthCheckCtx = nil
	a.lifecycleMu.Unlock()

	if cancel != nil {
		cancel()
		a.healthCheckWg.Wait()
	}
}

// clearLoginState cancels and clears an in-flight login context so no QR
// waiter can outlive a logout. The caller may hold loginMu; only lifecycleMu
// is taken here, so it is safe to call from Logout and from event handling.
func (a *Api) clearLoginState() {
	a.lifecycleMu.Lock()
	cancel := a.loginCancel
	a.loginCancel = nil
	a.lifecycleMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *Api) ServiceShutdown() error {
	a.stopConnectionHealthCheck()
	// Release any reconnect loop waiting out its backoff so shutdown never
	// blocks on it; the status is settled by the final logged_out/close path.
	a.supersedeReconnectLoop()
	a.clearReconnectStatus()

	a.taskMu.Lock()
	a.shuttingDown = true
	a.taskMu.Unlock()

	a.lifecycleMu.Lock()
	client := a.waClient
	loginCancel := a.loginCancel
	if client != nil && a.eventHandlerSet {
		client.RemoveEventHandler(a.eventHandlerID)
		a.eventHandlerSet = false
	}
	a.lifecycleMu.Unlock()

	if loginCancel != nil {
		loginCancel()
	}
	if client != nil {
		client.Disconnect()
	}
	// Login may be waiting on the QR channel or finishing Connect. Cancellation
	// releases the QR wait; the second disconnect catches a Connect that raced
	// with shutdown after the first disconnect.
	a.loginMu.Lock()
	a.loginMu.Unlock()
	if client != nil {
		client.Disconnect()
	}
	// Wait for an event that entered before RemoveEventHandler and every
	// background task it launched before closing their stores.
	a.eventMu.Lock()
	a.eventMu.Unlock()
	close(a.taskCh)
	a.workerWg.Wait()

	closeErr := a.closeResources()
	if err := store.CloseSettings(); err != nil {
		log.Println("failed to close settings:", err)
		closeErr = errors.Join(closeErr, err)
	}
	if closeErr != nil {
		log.Println("shutdown cleanup failed:", closeErr)
	}
	return closeErr
}

func (a *Api) closeResources() error {
	var closeErr error
	// The Linux notifier owns a D-Bus session connection and signal loop;
	// release it before tearing the rest of the services down.
	closeErr = errors.Join(closeErr, notify.Close())
	a.cleanupMeowcaller()
	if a.messageStore != nil {
		closeErr = errors.Join(closeErr, a.messageStore.Close())
		a.messageStore = nil
	}
	if a.imageCache != nil {
		closeErr = errors.Join(closeErr, a.imageCache.Close())
		a.imageCache = nil
	}
	if a.cw != nil {
		closeErr = errors.Join(closeErr, a.cw.Close())
		a.cw = nil
	}
	if a.waContainer != nil {
		closeErr = errors.Join(closeErr, a.waContainer.Close())
		a.waContainer = nil
	}
	if a.sessionDB != nil {
		closeErr = errors.Join(closeErr, a.sessionDB.Close())
		a.sessionDB = nil
	}
	return closeErr
}

func (a *Api) failStartup(err error) {
	a.lifecycleMu.Lock()
	a.startupErr = err
	a.lifecycleMu.Unlock()
	log.Println("startup failed:", err)
	if closeErr := a.closeResources(); closeErr != nil {
		log.Println("startup cleanup failed:", closeErr)
	}
}

// ServiceStartup is called by Wails v3 when the app starts. The context is
// the whatsmeow/SQLite request context and is kept for the whole app lifetime.
func (a *Api) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	// Keep the settings file handle open for the whole app lifetime; the
	// matching CloseSettings lives in ServiceShutdown.
	store.LoadSettings()

	// The window is focused when the app launches; the frontend keeps this in
	// sync via SetWindowFocused so we don't notify while the user is looking.
	a.windowFocused.Store(true)
	// Keep the request context before anything that may emit an event (the
	// in-process system tray listens for wa:notifications_toggled).
	a.ctx = ctx
	var err error

	dbLog := waLog.Stdout("Database", settings.GetLogLevel(), true)
	a.cw, err = wa.NewAppDatabase(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("open application database: %w", err))
		return nil
	}
	db, err := sql.Open("sqlite3", misc.GetSQLiteAddress("session.wa"))
	if err != nil {
		a.failStartup(fmt.Errorf("open WhatsApp session database: %w", err))
		return nil
	}
	a.sessionDB = db
	container := sqlstore.NewWithDB(db, "sqlite3", dbLog)
	a.waContainer = container
	// A DB created by upstream whatsmeow already contains wasa_root_secret_id,
	// which HyperMeow's v18->v19 migration tries to add again. Reconcile that
	// known divergence before upgrading so existing logins keep working.
	if err := wa.ReconcileUpstreamSessionSchema(ctx, db); err != nil {
		a.failStartup(fmt.Errorf("reconcile WhatsApp session schema: %w", err))
		return nil
	}
	err = container.Upgrade(ctx)
	if err != nil {
		a.failStartup(fmt.Errorf("upgrade WhatsApp session database: %w", err))
		return nil
	}
	// The session DB holds long-lived WhatsApp credentials. Restrict it once
	// the file exists, tightening older installs on every start as well.
	misc.RestrictFile(filepath.Join(misc.ConfigDir, "session.wa"))
	a.waClient, err = wa.NewClient(ctx, container)
	if err != nil {
		a.failStartup(fmt.Errorf("create WhatsApp client: %w", err))
		return nil
	}
	a.messageStore, err = store.NewMessageStore()
	if err != nil {
		a.failStartup(fmt.Errorf("open message store: %w", err))
		return nil
	}
	a.imageCache, err = cache.NewImageCache()
	if err != nil {
		a.failStartup(fmt.Errorf("open image cache: %w", err))
		return nil
	}

	// Initialize VoIP extension
	a.initMeowcaller()

	// Silent, lightweight update check on startup. This never downloads and
	// never opens an update window: Check() only queries the provider. Network
	// failures are logged and swallowed so the app still starts offline. The
	// updater emits its own wails:updater:* events for the frontend; this
	// custom event carries just the discovered version. Frontend listeners for
	// these events are added in D-PKG-004. The ServiceStartup ctx is cancelled
	// on shutdown, so this cannot hold up ServiceShutdown.
	a.startBackground(func() {
		if !a.updaterReady.Load() {
			slog.Warn("Skipping startup update check: updater is not configured", "source", "updater")
			return
		}
		rel, err := a.app.Updater.Check(ctx)
		if err != nil {
			slog.Warn(fmt.Sprintf("Startup update check failed: %v", err), "source", "updater")
			return
		}
		if rel == nil {
			return
		}
		a.app.Event.Emit("wa:update_available", map[string]any{
			"version": rel.Version,
		})
	})

	// Startup failures are surfaced by failStartup through the existing
	// startupErr/Login path. Returning an error here would abort app.Run and
	// cause ServiceShutdown to run against a half-built service.
	return nil
}

// CheckForUpdates starts the interactive update flow in the background so the
// UI thread is never blocked. The Wails updater opens its own update window.
// Failures are logged and surfaced as a short wa:update_error event; the call
// returns immediately. Frontend listeners for these events are added in
// D-PKG-004.
func (a *Api) CheckForUpdates() error {
	if !a.updaterReady.Load() {
		slog.Warn("Update check requested but updater is not configured", "source", "updater")
		a.app.Event.Emit("wa:update_error", "Updates are unavailable in this build.")
		return nil
	}
	go func() {
		if err := a.app.Updater.CheckAndInstall(context.Background()); err != nil {
			slog.Warn(fmt.Sprintf("Update check failed: %v", err), "source", "updater")
			a.app.Event.Emit("wa:update_error", "Could not check for updates.")
		}
	}()
	return nil
}

func (a *Api) Login() error {
	a.loginMu.Lock()
	defer a.loginMu.Unlock()

	if a.isShuttingDown() {
		return context.Canceled
	}
	a.lifecycleMu.Lock()
	if a.startupErr != nil {
		err := a.startupErr
		a.lifecycleMu.Unlock()
		return err
	}
	if a.waClient == nil {
		a.lifecycleMu.Unlock()
		return errors.New("WhatsApp client is not ready")
	}
	if !a.eventHandlerSet {
		a.eventHandlerID = a.waClient.AddEventHandler(a.mainEventHandler)
		a.eventHandlerSet = true
	}
	client := a.waClient
	a.lifecycleMu.Unlock()

	if client.Store.ID == nil {
		loginCtx, cancel := context.WithCancel(a.ctx)
		a.lifecycleMu.Lock()
		a.loginCancel = cancel
		a.lifecycleMu.Unlock()
		defer func() {
			cancel()
			a.lifecycleMu.Lock()
			a.loginCancel = nil
			a.lifecycleMu.Unlock()
		}()

		qrChan, err := client.GetQRChannel(loginCtx)
		if err != nil {
			return fmt.Errorf("create QR login channel: %w", err)
		}
		if a.isShuttingDown() {
			return context.Canceled
		}

		err = client.Connect()
		if err != nil {
			return err
		}

		for {
			select {
			case <-loginCtx.Done():
				return loginCtx.Err()
			case evt, ok := <-qrChan:
				if !ok {
					return nil
				}
				if evt.Event == "code" {
					a.app.Event.Emit("wa:qr", evt.Code)
				} else {
					a.app.Event.Emit("wa:status", evt.Event)
				}
			}
		}
	} else {
		// Already logged in, connect before announcing readiness.
		err := client.Connect()
		if err != nil {
			return err
		}
		if a.isShuttingDown() {
			return context.Canceled
		}
		a.app.Event.Emit("wa:status", "logged_in")
	}
	return nil
}

func (a *Api) mainEventHandler(evt any) {
	a.eventMu.RLock()
	defer a.eventMu.RUnlock()
	if a.isShuttingDown() {
		return
	}
	switch v := evt.(type) {
	case *events.Message:
		// Poll vote messages: insert a system message and skip normal processing
		if v.Message.GetPollUpdateMessage() != nil {
			a.startBackground(func() { a.handlePollVoteEvent(v) })
			return
		}

		parsedHTML := a.processMessageText(v.Message)

		// Handle message edits: re-parse the edited content
		if protoMsg := v.Message.GetProtocolMessage(); protoMsg != nil && protoMsg.GetType() == waE2E.ProtocolMessage_MESSAGE_EDIT {
			newContent := protoMsg.GetEditedMessage()
			if newContent != nil {
				parsedHTML = a.processMessageText(newContent)
			}
		}

		messageID := a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, v, parsedHTML)

		// If a message was processed (inserted or updated), emit the decoded message from DB
		if messageID != "" {
			updatedMsg, err := a.messageStore.GetDecodedMessage(v.Info.Chat.String(), messageID)
			if err == nil {
				a.app.Event.Emit("wa:new_message", map[string]any{
					"chatId":      v.Info.Chat.String(),
					"message":     updatedMsg,
					"messageText": parsedHTML, // Text field contains HTML now, but better than nothing or we can use updatedMsg.Text
					"timestamp":   v.Info.Timestamp.Unix(),
					"sender":      v.Info.PushName,
					"isFromMe":    v.Info.IsFromMe,
				})
			} else if !errors.Is(err, sql.ErrNoRows) {
				log.Println("Failed to get decoded message after processing:", err)
			}
		}

		// Raise a desktop notification for genuine incoming messages (not our
		// own, not reactions, not channel/broadcast posts) while backgrounded.
		// Respects the global notification switch, per-chat mutes
		// (including mutes synced from the phone) and archived chats.
		isFeed := v.Info.Chat.Server == types.NewsletterServer || v.Info.Chat.Server == types.BroadcastServer
		if messageID != "" && !v.Info.IsFromMe && !isFeed && v.Message.GetReactionMessage() == nil && !a.windowFocused.Load() &&
			store.GetNotificationsEnabled() && !a.messageStore.IsChatMuted(v.Info.Chat.String()) &&
			!a.messageStore.IsChatArchived(v.Info.Chat.String()) {
			a.startBackground(func() { a.notifyIncoming(v, parsedHTML) })
		}

		if reaction := v.Message.GetReactionMessage(); reaction != nil {
			a.startBackground(func() {
				targetID := reaction.GetKey().GetID()
				targetMsg, err := a.messageStore.GetMessageWithMedia(v.Info.Chat.String(), targetID)
				if err != nil {
					log.Println("Failed", err)
					return
				}

				targetText := targetMsg.Text
				senderName := v.Info.PushName
				if senderName == "" && v.Info.Sender.User != "" {
					senderName = v.Info.Sender.User
				}
				if v.Info.IsFromMe {
					senderName = "You"
				}

				a.app.Event.Emit("wa:new_message", map[string]any{
					"chatId":      v.Info.Chat.String(),
					"message":     nil,
					"messageText": targetText,
					"reaction":    reaction.GetText(),
					"timestamp":   v.Info.Timestamp.Unix(),
					"sender":      senderName,
				})
			})
		}

	case *events.Picture:
		a.startBackground(func() { _, _ = a.GetCachedAvatar(v.JID.String(), true) })

		a.app.Event.Emit("wa:picture_update", v.JID.String())

	case *events.Blocklist:
		a.handleBlocklistEvent(v)

	case *events.PrivacySettings:
		a.app.Event.Emit("wa:privacy_settings_changed", map[string]any{
			"groupAddChanged":     v.GroupAddChanged,
			"lastSeenChanged":     v.LastSeenChanged,
			"statusChanged":       v.StatusChanged,
			"profileChanged":      v.ProfileChanged,
			"readReceiptsChanged": v.ReadReceiptsChanged,
			"onlineChanged":       v.OnlineChanged,
			"callAddChanged":      v.CallAddChanged,
		})

	case *events.JoinedGroup:
		slog.Info(fmt.Sprintf("Joined group %s (%s)", v.GroupInfo.Name, v.JID), "source", "groups")
		a.app.Event.Emit("wa:chat_list_refresh")

	case *events.LabelEdit:
		a.app.Event.Emit("wa:label_edit", map[string]any{
			"labelId": v.LabelID,
		})

	case *events.LabelAssociationChat:
		a.app.Event.Emit("wa:label_chat", map[string]any{
			"jid":     v.JID.String(),
			"labelId": v.LabelID,
		})

	case *events.LabelAssociationMessage:
		a.app.Event.Emit("wa:label_message", map[string]any{
			"jid":       v.JID.String(),
			"labelId":   v.LabelID,
			"messageId": v.MessageID,
		})

	case *events.NewsletterJoin:
		a.app.Event.Emit("wa:newsletter_joined", v.ID.String())
		a.app.Event.Emit("wa:chat_list_refresh")

	case *events.NewsletterLeave:
		a.app.Event.Emit("wa:newsletter_left", v.ID.String())
		a.app.Event.Emit("wa:chat_list_refresh")

	case *events.NewsletterLiveUpdate:
		a.app.Event.Emit("wa:newsletter_update", map[string]any{
			"jid": v.JID.String(),
		})
		// The live-update event carries no channel name or metadata, so ask
		// the frontend to reload the chat list instead of fabricating fields.
		a.app.Event.Emit("wa:chat_list_refresh")

	case *events.Mute:
		// Emitted for mutes set on other devices (e.g. the phone), including
		// during app-state full sync. Persist so notifications stay quiet.
		muted := v.Action.GetMuted()
		a.handleMuteEvent(v.JID, muted, v.Action.GetMuteEndTimestamp())

	case *events.Connected:
		// whatsmeow may have reconnected on its own (or our loop succeeded)
		// while the app-level loop was still backing off. Settle the status
		// first, then cancel the loop so it cannot keep retrying over a live
		// websocket. No status is emitted when no reconnect was pending.
		a.emitConnectedStatus()
		a.supersedeReconnectLoop()
		// For new logins, there might be a problem where the whatsmeow client
		// gets a 515 code which gets resolved internally by auto-reconnecting
		// in a separate goroutine. In that case, the Initialise call below for
		// the AppDatabase will be executed first without the client even logging
		// in (which is the reason why the groups fetch fails and there are no
		// groups in the app until a manual reinitialize is done). To avoid that,
		// wait here until logged in.
		if err := a.cw.Initialise(a.waClient); err != nil {
			slog.Error(fmt.Sprintf("Database init failed: %v", err), "source", "groups")
			a.emitError(fmt.Sprintf("Group init failed: %v", err))
		}
		// Heal group rows with missing/empty names in the background now
		// that the client can reach the server.
		a.startBackground(a.repairGroupNames)
		// Recover archive/pin/mute sync if the local app state is corrupted.
		a.startBackground(a.resyncAppState)
		if err := a.waClient.SendPresence(a.ctx, types.PresenceAvailable); err != nil {
			slog.Warn(fmt.Sprintf("Failed to send available: %v", err), "source", "presence")
		}
		// Run migration for messages.db
		err := a.messageStore.MigrateLIDToPN(a.ctx, a.waClient.Store.LIDs)
		if err != nil {
			slog.Error(fmt.Sprintf("LID migration failed: %v", err), "source", "migration")
			a.emitError(fmt.Sprintf("LID migration failed: %v", err))
		} else {
			slog.Info("LID migration completed", "source", "migration")
			a.app.Event.Emit("wa:chat_list_refresh")
		}
		// Start connection health monitoring
		a.startConnectionHealthCheck()
	case *events.HistorySync:
		// whatsmeow delivers past conversations here after linking. Process
		// in a background goroutine so thousands of messages don't block the
		// event loop (which would delay live messages, QR rendering, etc.).
		a.startBackground(func() { a.processHistorySync(v) })
	case *events.Archive:
		// Chat archived/unarchived from another device (or app state sync).
		if err := a.messageStore.SetChatArchived(v.JID.String(), v.Action.GetArchived(), v.Timestamp.Unix()); err != nil {
			log.Println("Failed to store chat archive state:", err)
		}
		a.app.Event.Emit("wa:chat_list_refresh")
	case *events.Pin:
		// Chat pinned/unpinned from another device (or during app state sync).
		if err := a.messageStore.SetChatPinned(v.JID.String(), v.Action.GetPinned(), v.Timestamp.Unix()); err != nil {
			log.Println("Failed to store chat pin:", err)
		}
		a.app.Event.Emit("wa:chat_list_refresh")
	case *events.Disconnected:
		if !a.isShuttingDown() {
			a.emitError("Disconnected from WhatsApp — reconnecting...")
			a.startBackground(a.reconnectLoop)
		}
	case *events.Receipt:
		a.app.Event.Emit("wa:message_receipt", map[string]any{
			"chatId":     v.Chat.String(),
			"status":     v.Type.GoString(),
			"messageIDs": v.MessageIDs,
		})
	case *events.Contact:
		action := v.Action
		fullName := ""
		if action != nil {
			fullName = action.GetFullName()
		}
		slog.Info(fmt.Sprintf("Contact event for %s: fullName=%q", v.JID, fullName), "source", "contacts")
		a.app.Event.Emit("wa:chat_list_refresh")
	case *events.PushName, *events.BusinessName:
		a.app.Event.Emit("wa:chat_list_refresh")
	case *events.ChatPresence:
		a.app.Event.Emit("wa:chat_presence", map[string]any{
			"chatId": v.Chat.String(),
			"state":  string(v.State),
			"media":  string(v.Media),
		})
	case *events.IdentityChange:
		// AutoTrustIdentity stays enabled for WhatsApp-Web parity, but the
		// change must never be silent: surface a dedicated, user-visible
		// security warning (frontend shows it through the toast path).
		slog.Info(fmt.Sprintf("Identity change for %s (implicit=%t)", v.JID, v.Implicit), "source", "security")
		a.app.Event.Emit("wa:identity_change", fmt.Sprintf(
			"Security warning: identity verification failed for %s — their encryption key changed. If unexpected, verify this contact out of band.",
			v.JID.String(),
		))
	case *events.Presence:
		a.app.Event.Emit("wa:presence", map[string]any{
			"jid":         v.From.String(),
			"unavailable": v.Unavailable,
			"lastSeen":    v.LastSeen.UnixMilli(),
		})

	case *events.GroupInfo:
		a.startBackground(func() { a.handleGroupInfoEvent(v) })

	case *events.AppStateSyncComplete:
		slog.Info(fmt.Sprintf("App state sync complete: %s", v.Name), "source", "appstate")
		a.app.Event.Emit("wa:appstate_sync_complete", map[string]any{
			"name": string(v.Name),
		})

	case *events.StreamReplaced:
		slog.Warn("Stream replaced — another device took over", "source", "connection")
		a.emitError("Another device took over the connection")
		a.startBackground(a.reconnectLoop)

	case *events.PushNameSetting:
		newName := ""
		if v.Action != nil {
			newName = v.Action.GetName()
		}
		slog.Info(fmt.Sprintf("Own push name changed: %q", newName), "source", "profile")
		a.app.Event.Emit("wa:push_name_changed", newName)

	case *events.KeepAliveTimeout:
		slog.Warn(fmt.Sprintf("Keepalive failing (errors: %d, last success: %s)", v.ErrorCount, v.LastSuccess.Format(time.RFC3339)), "source", "connection")
		a.app.Event.Emit("wa:connection_unstable", map[string]any{
			"errorCount": v.ErrorCount,
		})

	case *events.KeepAliveRestored:
		slog.Info("Keepalive restored", "source", "connection")
		a.app.Event.Emit("wa:connection_stable")

	case *events.LoggedOut:
		slog.Warn("Logged out from another device", "source", "connection")
		// Same teardown as an explicit Logout(): no health checks, no pending
		// login, no reconnect against a session that no longer exists.
		a.supersedeReconnectLoop()
		a.clearReconnectStatus()
		a.stopConnectionHealthCheck()
		a.clearLoginState()
		a.app.Event.Emit("wa:logged_out")           // legacy listeners
		a.app.Event.Emit("wa:status", "logged_out") // handled status for the UI

	case *events.ConnectFailure:
		slog.Error(fmt.Sprintf("Connection attempt failed: %s", v.Reason), "source", "connection")
		a.emitError("Failed to connect to WhatsApp")

	case *events.ClientOutdated:
		slog.Error("WhatsApp blocked this client version", "source", "connection")
		a.emitError("WhatsApp no longer supports this client — update the app")

	default:
		// Ignore other events for now
	}

}

// contactNameForJID looks up a human-readable display name for a JID from the
// contact store, falling back to the JID user portion.
func (a *Api) contactNameForJID(jid types.JID) string {
	myJID := a.waClient.Store.ID
	if myJID != nil {
		if jid.ToNonAD() == myJID.ToNonAD() {
			return "You"
		}
	}
	contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, jid.ToNonAD())
	if err == nil {
		if contact.FullName != "" {
			return contact.FullName
		}
		if contact.PushName != "" {
			return contact.PushName
		}
	}
	return jid.User
}

// formatEphemeralTimer converts a disappearing-timer value in seconds to a
// short human-readable string (e.g. "24h", "7d", "90d").
func formatEphemeralTimer(secs uint32) string {
	switch {
	case secs <= 0:
		return "off"
	case secs < 60:
		return fmt.Sprintf("%ds", secs)
	case secs < 3600:
		return fmt.Sprintf("%dm", secs/60)
	case secs < 86400:
		return fmt.Sprintf("%dh", secs/3600)
	default:
		return fmt.Sprintf("%dd", secs/86400)
	}
}

// handleGroupInfoEvent stores system messages for all group configuration
// changes (name, topic, locked, announce, disappearing timer, membership
// approval, delete, community links, invite link, suspend, and participant
// changes) so the UI can display descriptive event cards.
func (a *Api) handleGroupInfoEvent(v *events.GroupInfo) {
	groupJID := v.JID.String()
	ts := v.Timestamp.Unix()
	now := time.Now().UnixNano()
	changed := false

	ins := func(text string) {
		msgID := fmt.Sprintf("system_%s_%d", groupJID, now)
		now++
		if err := a.messageStore.InsertSystemMessage(groupJID, msgID, text, ts); err != nil {
			slog.Warn(fmt.Sprintf("Failed to store system message: %v", err), "source", "groups")
		}
		changed = true
	}

	// Resolve who triggered the change (if available)
	senderName := ""
	if v.Sender != nil {
		senderName = a.contactNameForJID(*v.Sender)
	}
	senderPrefix := ""
	if senderName != "" {
		senderPrefix = senderName + " "
	}

	if v.Name != nil && v.Name.Name != "" {
		ins("[system]✏️ " + senderPrefix + "changed the group name to \"" + v.Name.Name + "\"")
	}
	if v.Topic != nil {
		if v.Topic.TopicDeleted {
			ins("[system]✏️ " + senderPrefix + "removed the group description")
		} else if v.Topic.Topic != "" {
			ins("[system]✏️ " + senderPrefix + "changed the group description")
		}
	}
	if v.Locked != nil {
		if v.Locked.IsLocked {
			ins("[system]🔒 " + senderPrefix + "restricted group info editing to admins")
		} else {
			ins("[system]🔓 " + senderPrefix + "opened group info editing to all members")
		}
	}
	if v.Announce != nil {
		if v.Announce.IsAnnounce {
			ins("[system]🔇 " + senderPrefix + "set the group to announcement mode — only admins can send messages")
		} else {
			ins("[system]🔊 " + senderPrefix + "opened the group — all members can send messages")
		}
	}
	if v.Ephemeral != nil {
		if v.Ephemeral.IsEphemeral {
			ins("[system]⏳ " + senderPrefix + "set disappearing messages to " + formatEphemeralTimer(v.Ephemeral.DisappearingTimer))
		} else {
			ins("[system]⏳ " + senderPrefix + "turned off disappearing messages")
		}
	}
	if v.MembershipApprovalMode != nil {
		if v.MembershipApprovalMode.IsJoinApprovalRequired {
			ins("[system]🔐 " + senderPrefix + "enabled membership approval — new join requests require admin approval")
		} else {
			ins("[system]🔓 " + senderPrefix + "disabled membership approval — anyone can join freely")
		}
	}
	if v.Delete != nil && v.Delete.Deleted {
		ins("[system]🗑️ " + senderPrefix + "deleted the group")
	}
	if v.Link != nil {
		groupName := v.Link.Group.Name
		if groupName == "" {
			ins("[system]🔗 " + senderPrefix + "linked this group to a community")
		} else {
			ins("[system]🔗 " + senderPrefix + "linked this group to the community \"" + groupName + "\"")
		}
	}
	if v.Unlink != nil {
		ins("[system]🔗 " + senderPrefix + "unlinked this group from its community")
	}
	if v.NewInviteLink != nil && *v.NewInviteLink != "" {
		ins("[system]🔗 " + senderPrefix + "reset the group invite link")
	}
	if v.Suspended {
		ins("[system]🚫 Group has been suspended")
	}
	if v.Unsuspended {
		ins("[system]✅ Group has been unsuspended")
	}

	// Participant changes
	for _, jid := range v.Join {
		ins("[system]👋 " + a.contactNameForJID(jid) + " joined the group")
	}
	for _, jid := range v.Leave {
		ins("[system]👋 " + a.contactNameForJID(jid) + " left the group")
	}
	for _, jid := range v.Promote {
		ins("[system]⭐ " + a.contactNameForJID(jid) + " was promoted to admin")
	}
	for _, jid := range v.Demote {
		ins("[system]⭐ " + a.contactNameForJID(jid) + " was demoted")
	}

	if changed {
		a.app.Event.Emit("wa:chat_list_refresh")
	}
}

// processHistorySync stores the messages contained in a whatsmeow HistorySync
// event. WhatsApp sends these in several batches after a device is linked
// (bootstrap, recent, full). Each conversation's WebMessageInfo entries are
// converted into the same *events.Message shape that live messages use, then
// persisted through the existing MessageStore so the chat list and history
// render exactly like incoming messages do.
func (a *Api) processHistorySync(v *events.HistorySync) {
	conversations := v.Data.GetConversations()
	if len(conversations) == 0 {
		return
	}
	stored := 0
	failed := 0
	totalConvs := len(conversations)
	a.app.Event.Emit("wa:history_progress", map[string]any{
		"type":                   v.Data.GetSyncType().String(),
		"totalConversations":     totalConvs,
		"processedConversations": 0,
		"totalMessages":          0,
		"processedMessages":      0,
	})
	for _, conv := range conversations {
		chatJID, err := types.ParseJID(conv.GetID())
		if err != nil {
			failed++
			continue
		}
		for _, histMsg := range conv.GetMessages() {
			webMsg := histMsg.GetMessage()
			if webMsg == nil {
				continue
			}
			parsedMsg, err := a.waClient.ParseWebMessage(chatJID, webMsg)
			if err != nil || parsedMsg.Message == nil {
				failed++
				continue
			}
			// ParseWebMessage doesn't unwrap containers (ephemeral/view-once)
			// like the live path does, so do it here or the content is lost.
			parsedMsg.Message = store.UnwrapMessage(parsedMsg.Message)
			if parsedMsg.Message == nil {
				failed++
				continue
			}
			parsedHTML := a.processMessageText(parsedMsg.Message)
			if a.messageStore.ProcessMessageEvent(a.ctx, a.waClient.Store.LIDs, parsedMsg, parsedHTML) != "" {
				stored++
			}
		}
	}
	progress := map[string]any{
		"type":                   v.Data.GetSyncType().String(),
		"totalConversations":     totalConvs,
		"processedConversations": totalConvs,
		"totalMessages":          0,
		"processedMessages":      stored,
		"done":                   true,
	}
	if stored == 0 && failed > 0 {
		// The frontend never renders diagnostic strings; it only needs the flag.
		progress["failed"] = true
		progress["error"] = "none_stored"
	}
	a.app.Event.Emit("wa:history_progress", progress)
	slog.Info(fmt.Sprintf("Stored %d messages from %d conversations", stored, len(conversations)), "source", "history")
	a.app.Event.Emit("wa:chat_list_refresh")
}
