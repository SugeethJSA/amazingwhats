package api

import (
	"fmt"
	"log/slog"
	"net/mail"
	"net/url"

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
