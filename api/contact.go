package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/nyaruka/phonenumbers"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
)

type Contact struct {
	Phno       string `json:"phno"`
	JID        string `json:"jid"`
	Short      string `json:"short"`
	FullName   string `json:"full_name"`
	PushName   string `json:"push_name"`
	IsBusiness bool   `json:"is_business"`
	AvatarURL  string `json:"avatar_url"`
}

// isUserJIDServer reports whether a server can host a 1:1 user identity.
// Restricting this keeps a malformed server string from ever reaching
// hypermeow's usync switch, which rejects it with "unknown user server ...".
func isUserJIDServer(server string) bool {
	switch server {
	case types.DefaultUserServer, types.LegacyUserServer, types.HiddenUserServer,
		types.HostedServer, types.HostedLIDServer, types.BotServer:
		return true
	default:
		return false
	}
}

// normalizeUserJIDString is the single input boundary for user identifiers.
// It accepts a full JID (including an LID JID) or a bare/formatted phone
// number (any "+", spaces, dashes or parentheses) and returns a canonical
// user JID with the phone digits in User and the server in Server.
//
// This matters because types.ParseJID treats a string with no "@" as the
// *server*: ParseJID("+91 96770 02037") yields
// JID{User: "", Server: "+91 96770 02037"}, which later fails inside
// hypermeow with "unknown user server '+91 96770 02037'". Normalizing first
// guarantees a formatted phone number never reaches ParseJID as a server.
func normalizeUserJIDString(raw string) (types.JID, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return types.JID{}, fmt.Errorf("empty JID or phone number")
	}

	if strings.Contains(s, "@") {
		jid, err := types.ParseJID(s)
		if err != nil {
			return types.JID{}, fmt.Errorf("invalid JID %q: %w", raw, err)
		}
		if jid.User == "" || jid.Server == "" {
			return types.JID{}, fmt.Errorf("invalid JID %q: missing user or server", raw)
		}
		if !isUserJIDServer(jid.Server) {
			return types.JID{}, fmt.Errorf("invalid JID %q: unknown user server %q", raw, jid.Server)
		}
		return jid.ToNonAD(), nil
	}

	// Bare phone number: retain digits only, then normalize to E164 so that
	// display formatting can never leak into the JID user or server.
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if digits == "" {
		return types.JID{}, fmt.Errorf("invalid phone number %q: no digits", raw)
	}
	if len(digits) < 7 {
		return types.JID{}, fmt.Errorf("invalid phone number %q: too short", raw)
	}
	if num, err := phonenumbers.Parse("+"+digits, ""); err == nil && phonenumbers.IsValidNumber(num) {
		digits = strings.TrimPrefix(phonenumbers.Format(num, phonenumbers.E164), "+")
	}
	return types.NewJID(digits, types.DefaultUserServer), nil
}

func canonicalUserJID(ctx context.Context, client *whatsmeow.Client, jid types.JID) types.JID {
	if jid.ActualAgent() == types.LIDDomain {
		if pn, err := client.Store.LIDs.GetPNForLID(ctx, jid); err == nil {
			jid = pn
		}
	}
	return jid.ToNonAD()
}

func (a *Api) GetContact(jid types.JID) (*Contact, error) {
	// A JID unmarshalled from a formatted phone string can arrive with the
	// number in Server and an empty User (ParseJID's no-"@" behaviour).
	// Re-normalize through the string boundary to repair that shape.
	normalized, err := normalizeUserJIDString(jid.String())
	if err != nil {
		return nil, err
	}
	jid = canonicalUserJID(a.ctx, a.waClient, normalized)

	contact, err := a.waClient.Store.Contacts.GetContact(a.ctx, jid)
	if err != nil {
		return nil, err
	}

	// Best-effort international formatting; a JID user may be an unresolved
	// LID rather than a phone number, which is not a reason to fail the call.
	formattedPhone := "+" + jid.User
	if num, err := phonenumbers.Parse(formattedPhone, ""); err == nil {
		formattedPhone = phonenumbers.Format(num, phonenumbers.INTERNATIONAL)
	}

	// An empty stub is a normal, expected result (e.g. an unknown sender).
	// Return a minimal contact so callers fall back to push name / phone
	// naturally instead of surfacing a binding error.
	if contact.FirstName == "" && contact.FullName == "" && contact.PushName == "" && contact.BusinessName == "" {
		return &Contact{Phno: formattedPhone, JID: jid.String()}, nil
	}

	return &Contact{
		Phno:       formattedPhone,
		JID:        jid.String(),
		FullName:   contact.FullName,
		Short:      contact.FirstName,
		PushName:   contact.PushName,
		IsBusiness: contact.BusinessName != "",
	}, nil
}

// SearchContacts searches contacts by name or phone number (case-insensitive).
func (a *Api) SearchContacts(query string) ([]Contact, error) {
	all, err := a.FetchContacts()
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(query)
	var out []Contact
	for _, c := range all {
		if strings.Contains(strings.ToLower(c.FullName), q) ||
			strings.Contains(strings.ToLower(c.Short), q) ||
			strings.Contains(strings.ToLower(c.PushName), q) ||
			strings.Contains(c.Phno, q) ||
			strings.Contains(c.JID, q) {
			out = append(out, c)
		}
	}
	return out, nil
}

func (a *Api) FetchContacts() ([]Contact, error) {
	rawContacts, err := a.waClient.Store.Contacts.GetAllContacts(a.ctx)
	if err != nil {
		return nil, err
	}
	contacts := make([]Contact, 0, len(rawContacts))
	for jid, c := range rawContacts {
		// Only return contacts that have valid phone numbers (skip LID-only entries)
		if jid.Server != types.DefaultUserServer {
			continue
		}
		rawNum := "+" + jid.User
		num, err := phonenumbers.Parse(rawNum, "")
		if err != nil || !phonenumbers.IsValidNumber(num) {
			continue
		}
		// Skip empty stubs that have no name data at all
		if c.FirstName == "" && c.FullName == "" && c.PushName == "" && c.BusinessName == "" {
			continue
		}

		contacts = append(contacts, Contact{
			Phno:       phonenumbers.Format(num, phonenumbers.INTERNATIONAL),
			JID:        jid.String(),
			FullName:   c.FullName,
			Short:      c.FirstName,
			PushName:   c.PushName,
			IsBusiness: c.BusinessName != "",
		})
	}
	return contacts, nil
}

func (a *Api) GetBusinessProfile(jidStr string) (map[string]any, error) {
	if a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	jid, err := normalizeUserJIDString(jidStr)
	if err != nil {
		// Missing/placeholder JID: nothing to look up. The UI treats an empty
		// map as "no business profile", so this is a benign result.
		return map[string]any{}, nil
	}
	key := jid.String()

	return businessProfileCache.getOrLoad(key, businessProfileCacheTTL, func() (map[string]any, error) {
		profile, err := a.waClient.GetBusinessProfile(a.ctx, jid)
		if err != nil {
			if isRateLimitErr(err) {
				logRateLimited("GetBusinessProfile")
				// Brief no-data result prevents a burst of retries from
				// provoking the same 429 again.
				return map[string]any{}, nil
			}
			var missing *whatsmeow.ElementMissingError
			if errors.As(err, &missing) || strings.Contains(err.Error(), "missing jid in business profile") {
				// Not a business account, or the server omitted the jid
				// attribute: expected for regular contacts, not a failure.
				return map[string]any{}, nil
			}
			return nil, err
		}
		if profile == nil {
			return map[string]any{}, nil
		}
		result := map[string]any{"jid": key}
		if profile.Address != "" {
			result["address"] = profile.Address
		}
		if profile.Email != "" {
			result["email"] = profile.Email
		}
		if len(profile.Categories) > 0 {
			cats := make([]string, len(profile.Categories))
			for i, c := range profile.Categories {
				cats[i] = c.Name
			}
			result["categories"] = cats
		}
		return result, nil
	})
}
