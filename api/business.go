package api

import (
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
)

// businessProfileMap converts a HyperMeow business profile into the flat map
// consumed by the frontend bindings. It is shared by the per-contact lookup in
// contact.go and the self-profile bindings below so every path exposes the
// same fields (description, websites, category and hours were previously
// never returned to the UI).
//
// Slice fields are always non-nil: the generated frontend types treat them as
// arrays, so an absent value must become [] rather than null/undefined.
func businessProfileMap(profile *types.BusinessProfile) map[string]any {
	if profile == nil {
		return map[string]any{}
	}

	categories := make([]string, 0, len(profile.Categories))
	category := ""
	for i, c := range profile.Categories {
		categories = append(categories, c.Name)
		if i == 0 {
			category = c.Name
		}
	}

	websites := make([]string, 0, len(profile.Websites))
	websites = append(websites, profile.Websites...)

	businessHours := make([]map[string]any, 0, len(profile.BusinessHours))
	for _, h := range profile.BusinessHours {
		businessHours = append(businessHours, map[string]any{
			"day_of_week": h.DayOfWeek,
			"mode":        h.Mode,
			"open_time":   h.OpenTime,
			"close_time":  h.CloseTime,
		})
	}

	return map[string]any{
		"jid":                     profile.JID.String(),
		"address":                 profile.Address,
		"email":                   profile.Email,
		"description":             profile.Description,
		"websites":                websites,
		"categories":              categories,
		"category":                category,
		"business_hours":          businessHours,
		"business_hours_timezone": profile.BusinessHoursTimeZone,
		"cover_photo_id":          profile.CoverPhotoID,
		"aea_account_type":        string(profile.AEAAccountType),
		"is_business":             true,
	}
}

// BusinessProfileUpdateInput is the editable subset of a business profile.
// A nil field means "leave unchanged"; a non-nil empty value clears the field.
type BusinessProfileUpdateInput struct {
	Address     *string   `json:"address,omitempty"`
	Email       *string   `json:"email,omitempty"`
	Description *string   `json:"description,omitempty"`
	Websites    *[]string `json:"websites,omitempty"`
}

// GetMyBusinessProfile returns the logged-in account's own business profile.
// It deliberately bypasses businessProfileCache: self data must be fresh,
// especially immediately after an update.
func (a *Api) GetMyBusinessProfile() (map[string]any, error) {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return nil, fmt.Errorf("not logged in")
	}
	profile, err := a.waClient.GetBusinessProfile(a.ctx, *a.waClient.Store.ID)
	if err != nil {
		return nil, err
	}
	return businessProfileMap(profile), nil
}

// BusinessCoverPhotoResult is the bindable result of GetMyBusinessCoverPhoto.
// DataURL is always empty unless State is "ready"; it is a data URL for a
// picture whose ID matched cover_photo_id, not a guaranteed cover download.
// State is one of:
//
//	"not_set"     - the account has no business cover photo
//	"unavailable" - a cover is set on the phone, but this client cannot resolve
//	                it into a downloadable image (no image is fabricated)
//	"ready"       - DataURL holds an image from a matching picture ID
type BusinessCoverPhotoResult struct {
	State    string `json:"state"`
	DataURL  string `json:"dataUrl"`
	MIMEType string `json:"mimeType,omitempty"`
}

// maxBusinessCoverPhotoBytes caps how much of a cover image is read into
// memory. Cover URLs are remote and untrusted, so an unbounded ReadAll would
// be a memory-exhaustion risk.
const maxBusinessCoverPhotoBytes = 10 << 20 // 10 MiB

// GetMyBusinessCoverPhoto resolves the logged-in account's business cover
// photo into an inline, cacheable data URL when a real image is obtainable.
//
// HyperMeow exposes the cover photo ID via GetBusinessProfile but has no
// dedicated cover-image download method. The only real capability available
// is GetProfilePictureInfo, which is documented for profile pictures, not
// business covers. We pass the cover ID as the known picture ID and require
// the returned picture ID to equal cover_photo_id before downloading; that
// ID match is the sole condition for "ready" and prevents an avatar from
// being mislabelled as the cover. It is NOT proven that the server resolves a
// cover through this query, so many accounts will legitimately receive
// "unavailable" and show the "Cover photo set on your phone" fallback. This
// binding must not be described as a verified cover download.
func (a *Api) GetMyBusinessCoverPhoto() (BusinessCoverPhotoResult, error) {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return BusinessCoverPhotoResult{}, fmt.Errorf("not logged in")
	}

	profile, err := a.waClient.GetBusinessProfile(a.ctx, *a.waClient.Store.ID)
	if err != nil || profile == nil {
		return BusinessCoverPhotoResult{}, fmt.Errorf("could not load business profile")
	}
	coverID := strings.TrimSpace(profile.CoverPhotoID)
	if coverID == "" {
		return BusinessCoverPhotoResult{State: "not_set"}, nil
	}

	selfJID := canonicalUserJID(a.ctx, a.waClient, *a.waClient.Store.ID)
	pic, _ := a.waClient.GetProfilePictureInfo(a.ctx, selfJID, &whatsmeow.GetProfilePictureParams{
		ExistingID: coverID,
	})
	if pic == nil || pic.ID != coverID || strings.TrimSpace(pic.URL) == "" {
		return BusinessCoverPhotoResult{State: "unavailable"}, nil
	}

	dataURL, mimeType, err := downloadBusinessCoverImage(pic.URL)
	if err != nil || dataURL == "" {
		return BusinessCoverPhotoResult{State: "unavailable"}, nil
	}
	return BusinessCoverPhotoResult{State: "ready", DataURL: dataURL, MIMEType: mimeType}, nil
}

// downloadBusinessCoverImage fetches a cover image URL, enforces a size cap
// and only returns a data URL for a validated image MIME type. It deliberately
// does not touch the avatar cache in a.imageCache: a cover is a different
// picture and must never overwrite a contact's cached avatar.
func downloadBusinessCoverImage(rawURL string) (string, string, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("unexpected cover image status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBusinessCoverPhotoBytes+1))
	if err != nil {
		return "", "", err
	}
	if len(data) == 0 || len(data) > maxBusinessCoverPhotoBytes {
		return "", "", fmt.Errorf("invalid cover image size")
	}

	// Require a positive image signature. Unknown bytes are never assumed to
	// be JPEG: a non-image payload must never become a "ready" cover with a
	// broken <img>. SVG is deliberately not in the allow-list (XSS).
	sniffed := coverImageMIMEFromMagic(data)
	if sniffed == "" {
		return "", "", fmt.Errorf("cover image bytes are not a supported image")
	}

	// A declared Content-Type is used only when it is in the allow-list AND
	// agrees with the sniffed bytes. A missing header falls back to sniffing.
	declared := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
	if declared != "" && !coverImageMIMEMatches(declared, sniffed) {
		return "", "", fmt.Errorf("cover image Content-Type does not match its bytes")
	}
	mimeType := sniffed
	if !isImageMime(mimeType) {
		return "", "", fmt.Errorf("unsupported cover image type")
	}
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data)), mimeType, nil
}

// coverImageMIMEFromMagic identifies a cover image strictly by its magic
// bytes. It returns "" for anything that is not a supported raster image, so
// callers can fail closed instead of emitting a broken data URL. SVG is
// intentionally excluded because inline SVG can execute script.
func coverImageMIMEFromMagic(data []byte) string {
	if len(data) >= 4 &&
		data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 {
		return "image/png"
	}
	if len(data) >= 4 && data[0] == 'G' && data[1] == 'I' && data[2] == 'F' && data[3] == '8' {
		return "image/gif"
	}
	if len(data) >= 12 &&
		data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F' &&
		data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P' {
		return "image/webp"
	}
	if len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
		return "image/jpeg"
	}
	return ""
}

// coverImageMIMEMatches reports whether a declared Content-Type is in the
// narrow allow-list and agrees with the sniffed image signature. Parameter-
// bearing and non-image types (including image/svg+xml) are always rejected.
func coverImageMIMEMatches(declared, sniffed string) bool {
	switch strings.ToLower(strings.TrimSpace(declared)) {
	case "image/jpeg", "image/jpg":
		return sniffed == "image/jpeg"
	case "image/png":
		return sniffed == "image/png"
	case "image/gif":
		return sniffed == "image/gif"
	case "image/webp":
		return sniffed == "image/webp"
	default:
		return false
	}
}

// UpdateMyBusinessProfile validates and applies the supplied profile changes.
// Validation mirrors the backend limits with plain messages so backend error
// strings never reach the frontend verbatim. Failure logs stay generic and
// never include profile bodies.
func (a *Api) UpdateMyBusinessProfile(input BusinessProfileUpdateInput) error {
	if a.waClient == nil || a.waClient.Store == nil || a.waClient.Store.ID == nil {
		return fmt.Errorf("not logged in")
	}
	if input.Address == nil && input.Email == nil && input.Description == nil && input.Websites == nil {
		return fmt.Errorf("no business profile fields to update")
	}

	update := types.BusinessProfileUpdate{}

	if input.Address != nil {
		if len(*input.Address) > 512 {
			return fmt.Errorf("business address exceeds 512 bytes")
		}
		update.Address = input.Address
	}
	if input.Email != nil {
		if len(*input.Email) > 320 {
			return fmt.Errorf("business email exceeds 320 bytes")
		}
		// An empty value clears the email; the backend accepts it as such.
		if *input.Email != "" {
			parsed, err := mail.ParseAddress(*input.Email)
			if err != nil || parsed.Address != *input.Email {
				return fmt.Errorf("business email is invalid")
			}
		}
		update.Email = input.Email
	}
	if input.Description != nil {
		if len(*input.Description) > 1024 {
			return fmt.Errorf("business description exceeds 1024 bytes")
		}
		update.Description = input.Description
	}
	if input.Websites != nil {
		if len(*input.Websites) > 2 {
			return fmt.Errorf("business profile must contain at most 2 websites")
		}
		for _, website := range *input.Websites {
			if len(website) > 2048 {
				return fmt.Errorf("business website exceeds 2048 bytes")
			}
			parsed, err := url.ParseRequestURI(website)
			if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
				return fmt.Errorf("business website must be an absolute http or https URL")
			}
		}
		update.Websites = input.Websites
	}

	if err := a.waClient.UpdateBusinessProfile(a.ctx, update); err != nil {
		slog.Error("Business profile update failed", "source", "business")
		return fmt.Errorf("could not update business profile")
	}

	a.app.Event.Emit("wa:business_profile_updated")
	return nil
}
