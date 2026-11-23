package api

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/polymorfa/hypermeow/types"
)

type OnWhatsAppResult struct {
	Query        string `json:"query"`
	JID          string `json:"jid"`
	IsOnWhatsApp bool   `json:"is_on_whatsapp"`
	VerifiedName string `json:"verified_name,omitempty"`
}

type UserInfoResult struct {
	JID          string   `json:"jid"`
	Status       string   `json:"status,omitempty"`
	PictureID    string   `json:"picture_id,omitempty"`
	Devices      []string `json:"devices,omitempty"`
	VerifiedName string   `json:"verified_name,omitempty"`
}

// A tiny bounded TTL cache shared by the info-query bindings. During
// app-state resync the UI can ask for the same JID many times in quick
// succession; without this, every call issues a fresh usync/biz IQ and the
// server answers 429 rate-overlimit. No external dependencies.
type cachedCall[T any] struct {
	done chan struct{}
	res  cachedResult[T]
}

type cachedResult[T any] struct {
	value     T
	err       error
	expiresAt time.Time
}

type ttlCache[T any] struct {
	mu       sync.Mutex
	entries  map[string]cachedResult[T]
	order    []string // FIFO eviction order
	inFlight map[string]*cachedCall[T]
	max      int
}

func newTTLCache[T any](max int) *ttlCache[T] {
	return &ttlCache[T]{
		entries:  make(map[string]cachedResult[T], max),
		inFlight: make(map[string]*cachedCall[T]),
		max:      max,
	}
}

func (c *ttlCache[T]) removeOrderLocked(key string) {
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			return
		}
	}
}

// getOrLoad returns a fresh-enough cached value, or calls load once and shares
// its result with every concurrent caller asking for the same key. Failures
// are never cached, so a genuine error can be retried on the next call.
func (c *ttlCache[T]) getOrLoad(key string, ttl time.Duration, load func() (T, error)) (T, error) {
	var zero T
	c.mu.Lock()
	if e, ok := c.entries[key]; ok {
		if e.err == nil && time.Now().Before(e.expiresAt) {
			c.mu.Unlock()
			return e.value, nil
		}
		delete(c.entries, key)
		c.removeOrderLocked(key)
	}
	if call, ok := c.inFlight[key]; ok {
		c.mu.Unlock()
		<-call.done
		return call.res.value, call.res.err
	}
	call := &cachedCall[T]{done: make(chan struct{})}
	c.inFlight[key] = call
	c.mu.Unlock()

	value, err := load()
	res := cachedResult[T]{value: value, err: err}

	c.mu.Lock()
	if res.err == nil {
		if _, exists := c.entries[key]; !exists {
			c.order = append(c.order, key)
			for len(c.order) > c.max {
				oldest := c.order[0]
				c.order = c.order[1:]
				delete(c.entries, oldest)
			}
		}
		res.expiresAt = time.Now().Add(ttl)
		c.entries[key] = res
	}
	call.res = res
	delete(c.inFlight, key)
	close(call.done)
	c.mu.Unlock()

	if res.err != nil {
		return zero, res.err
	}
	return res.value, nil
}

const (
	userInfoCacheTTL        = 30 * time.Second
	businessProfileCacheTTL = 5 * time.Minute
	rateLimitLogInterval    = 30 * time.Second
	lookupCacheMaxEntries   = 256
)

var (
	userInfoCache        = newTTLCache[[]UserInfoResult](lookupCacheMaxEntries)
	businessProfileCache = newTTLCache[map[string]any](lookupCacheMaxEntries)

	rateLimitLogMu struct {
		sync.Mutex
		last time.Time
	}
)

// isRateLimitErr matches hypermeow's info-query throttling error, e.g.
// "info query returned status 429: rate-overlimit".
func isRateLimitErr(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "status 429") || strings.Contains(msg, "rate-overlimit")
}

// logRateLimited emits at most one warning per episode, no matter how many
// bindings are throttled in the same burst.
func logRateLimited(source string) {
	rateLimitLogMu.Lock()
	defer rateLimitLogMu.Unlock()
	if time.Since(rateLimitLogMu.last) < rateLimitLogInterval {
		return
	}
	rateLimitLogMu.last = time.Now()
	slog.Warn("WhatsApp info query rate-limited; serving cached/empty results", "source", source)
}

func (a *Api) IsOnWhatsApp(phoneNumbers []string) ([]OnWhatsAppResult, error) {
	if a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	// Normalize each identifier to E164 digits so a formatted phone number
	// (+, spaces, dashes) is never sent as-is in the usync contact query.
	cleaned := make([]string, 0, len(phoneNumbers))
	for _, p := range phoneNumbers {
		jid, err := normalizeUserJIDString(p)
		if err != nil || jid.User == "" {
			continue // skip empty/placeholder entries
		}
		cleaned = append(cleaned, "+"+jid.User)
	}
	if len(cleaned) == 0 {
		return []OnWhatsAppResult{}, nil
	}
	results, err := a.waClient.IsOnWhatsApp(a.ctx, cleaned)
	if err != nil {
		if isRateLimitErr(err) {
			logRateLimited("IsOnWhatsApp")
			return []OnWhatsAppResult{}, nil
		}
		return nil, err
	}
	out := make([]OnWhatsAppResult, 0, len(results))
	for _, r := range results {
		res := OnWhatsAppResult{
			Query:        r.Query,
			JID:          r.JID.String(),
			IsOnWhatsApp: r.IsIn,
		}
		if r.VerifiedName != nil {
			res.VerifiedName = r.VerifiedName.Details.GetVerifiedName()
		}
		out = append(out, res)
	}
	if len(results) > 0 {
		slog.Info(fmt.Sprintf("Checked %d numbers on WhatsApp", len(results)), "source", "contacts")
	}
	return out, nil
}

func (a *Api) GetUserInfo(jidStrs []string) ([]UserInfoResult, error) {
	if a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	// Normalize, skip placeholders and dedupe repeated JIDs before any network
	// work. A formatted phone passed straight to ParseJID lands in the Server
	// field and fails inside usync with "unknown user server".
	jids := make([]types.JID, 0, len(jidStrs))
	seen := make(map[string]struct{}, len(jidStrs))
	keys := make([]string, 0, len(jidStrs))
	for _, s := range jidStrs {
		if strings.TrimSpace(s) == "" {
			continue // benign: no user to look up
		}
		jid, err := normalizeUserJIDString(s)
		if err != nil {
			return nil, fmt.Errorf("invalid user identifier %q: %w", s, err)
		}
		key := jid.String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		jids = append(jids, jid.ToNonAD())
		keys = append(keys, key)
	}
	if len(jids) == 0 {
		return []UserInfoResult{}, nil
	}
	sort.Strings(keys) // order-independent cache key
	cacheKey := strings.Join(keys, ",")

	return userInfoCache.getOrLoad(cacheKey, userInfoCacheTTL, func() ([]UserInfoResult, error) {
		infoMap, err := a.waClient.GetUserInfo(a.ctx, jids)
		if err != nil {
			if isRateLimitErr(err) {
				logRateLimited("GetUserInfo")
				// No-data is not an error for the UI; cache it briefly so a
				// burst of retries cannot re-trigger the same 429.
				return []UserInfoResult{}, nil
			}
			return nil, err
		}
		out := make([]UserInfoResult, 0, len(infoMap))
		for jid, info := range infoMap {
			res := UserInfoResult{
				JID:       jid.String(),
				Status:    info.Status,
				PictureID: info.PictureID,
			}
			if info.VerifiedName != nil {
				res.VerifiedName = info.VerifiedName.Details.GetVerifiedName()
			}
			for _, d := range info.Devices {
				res.Devices = append(res.Devices, d.String())
			}
			out = append(out, res)
		}
		return out, nil
	})
}

func (a *Api) GetContactQRLink(revoke bool) (string, error) {
	if a.waClient.Store.ID == nil {
		return "", fmt.Errorf("not logged in")
	}
	return a.waClient.GetContactQRLink(a.ctx, revoke)
}
