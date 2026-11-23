//go:build linux

package notify

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"sync"

	"github.com/esiqveland/notify"
	"github.com/godbus/dbus/v5"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	linuxActionOpen  = "open"
	linuxActionReply = "reply"

	// maxTrackedNotifications bounds the ID -> context table. Notification IDs
	// are recycled by servers; old entries are evicted FIFO.
	maxTrackedNotifications = 256
	// inlineImageSize keeps the D-Bus image-data payload small.
	inlineImageSize = 96
)

type notificationContext struct {
	chatJID   string
	messageID string
	senderJID string
}

var (
	notifierMu sync.Mutex
	notifier   notify.Notifier
	dbusConn   *dbus.Conn

	contextsMu   sync.Mutex
	contexts     = make(map[uint32]notificationContext)
	contextOrder []uint32
)

// getNotifier lazily creates the long-lived D-Bus notifier. Creation can fail
// in headless environments (no session bus); callers simply get an error and
// the API layer logs it without ever logging notification payloads.
func getNotifier() (notify.Notifier, error) {
	notifierMu.Lock()
	defer notifierMu.Unlock()
	if notifier != nil {
		return notifier, nil
	}

	conn, err := dbus.SessionBus()
	if err != nil {
		return nil, fmt.Errorf("connect to session bus: %w", err)
	}
	n, err := notify.New(conn, notify.WithOnAction(func(sig *notify.ActionInvokedSignal) {
		if sig == nil {
			return
		}
		handleLinuxAction(sig.ID, sig.ActionKey)
	}))
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("create D-Bus notifier: %w", err)
	}
	dbusConn = conn
	notifier = n
	return n, nil
}

func handleLinuxAction(id uint32, key string) {
	contextsMu.Lock()
	ctx, ok := contexts[id]
	if ok {
		delete(contexts, id)
		for i, tracked := range contextOrder {
			if tracked == id {
				contextOrder = append(contextOrder[:i], contextOrder[i+1:]...)
				break
			}
		}
	}
	contextsMu.Unlock()
	if !ok {
		// The server also emits signals for other applications' notifications.
		return
	}

	switch key {
	case "default", linuxActionOpen:
		dispatch(ActionOpen, ctx.chatJID, ctx.messageID, "")
	case linuxActionReply:
		// The freedesktop notification spec has no inline text input, so the
		// reply action only focuses the chat; text is deliberately empty.
		dispatch(ActionReply, ctx.chatJID, ctx.messageID, "")
	}
}

func trackNotification(id uint32, ctx notificationContext) {
	contextsMu.Lock()
	defer contextsMu.Unlock()
	if len(contextOrder) >= maxTrackedNotifications {
		oldest := contextOrder[0]
		contextOrder = contextOrder[1:]
		delete(contexts, oldest)
	}
	contexts[id] = ctx
	contextOrder = append(contextOrder, id)
}

// Notify sends a freedesktop notification with Open and Reply actions. The
// chat avatar (or, failing that, the message thumbnail) is attached as a
// scaled image-data hint; the embedded app icon is used as app_icon.
func Notify(opts Options) error {
	n, err := getNotifier()
	if err != nil {
		return err
	}
	iconPath, err := resolveIconPath(opts)
	if err != nil {
		return err
	}

	note := notify.Notification{
		AppName: AppName,
		AppIcon: "file://" + iconPath,
		Summary: opts.Title,
		Body:    opts.Body,
		Actions: []notify.Action{
			notify.NewDefaultAction("Open"),
			{Key: linuxActionOpen, Label: "Open"},
			{Key: linuxActionReply, Label: "Reply"},
		},
		// Leave visibility to the notification server's own settings.
		ExpireTimeout: notify.ExpireTimeoutSetByNotificationServer,
	}

	inline := opts.Avatar
	if len(inline) == 0 {
		inline = opts.Image
	}
	if rgba, err := decodeScaledRGBA(inline, inlineImageSize); err == nil {
		note.AddHint(notify.HintImageDataRGBA(rgba))
	}

	id, err := n.SendNotification(note)
	if err != nil {
		return fmt.Errorf("send notification: %w", err)
	}
	if opts.Actions {
		trackNotification(id, notificationContext{
			chatJID:   opts.ChatJID,
			messageID: opts.MessageID,
			senderJID: opts.SenderJID,
		})
	}
	return nil
}

// decodeScaledRGBA decodes common avatar/thumbnail formats and downscales to
// at most maxSide x maxSide, preserving aspect ratio. Errors are intentionally
// swallowed by the caller: a missing inline image must not drop the alert.
func decodeScaledRGBA(data []byte, maxSide int) (*image.RGBA, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("no image data")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("empty image")
	}
	if w > maxSide || h > maxSide {
		if w > h {
			h = h * maxSide / w
			w = maxSide
		} else {
			w = w * maxSide / h
			h = maxSide
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst, nil
}

// Close shuts down the D-Bus signal loop and releases the session connection.
// Safe to call more than once.
func Close() error {
	notifierMu.Lock()
	n := notifier
	conn := dbusConn
	notifier = nil
	dbusConn = nil
	notifierMu.Unlock()

	contextsMu.Lock()
	clear(contexts)
	contextOrder = nil
	contextsMu.Unlock()

	if n == nil {
		return nil
	}
	err := n.Close()
	if conn != nil {
		if cerr := conn.Close(); cerr != nil {
			if err == nil {
				err = cerr
			} else {
				log.Printf("notify: closing D-Bus connection: %v", cerr)
			}
		}
	}
	return err
}
