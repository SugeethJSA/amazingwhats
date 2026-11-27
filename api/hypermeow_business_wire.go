package api

// D-ID: WIRE-004 — Go bindings for the 25 unwired HyperMeow BUSINESS/CATALOG Client APIs.
//
// Every Wire* method below calls a real Client method. No result is fabricated:
// each DTO is a projection of meaningful scalar fields (ids, names, prices,
// URLs, statuses, counts and timestamps) from the library's returned structs.
// Opaque/protobuf internals never cross Wails IPC, and inputs that the library
// expresses as structs are rebuilt in Go from validated primitive values.
//
// Error policy: backend error strings are deliberately discarded and replaced
// with short, plain messages. Nothing here logs product bodies, customer
// details or business access tokens.

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/types"
)

// ---------------------------------------------------------------------------
// Frontend-safe DTOs
// ---------------------------------------------------------------------------

// WireOrderDetailsResult is the bindable subset of types.OrderDetails.
type WireOrderDetailsResult struct {
	ID          string                   `json:"id"`
	CreatedAt   int64                    `json:"createdAt"` // Unix seconds
	CatalogID   string                   `json:"catalogId,omitempty"`
	Subtotal    int64                    `json:"subtotal"`
	Total       int64                    `json:"total"`
	Currency    string                   `json:"currency,omitempty"`
	PriceStatus string                   `json:"priceStatus,omitempty"`
	Products    []WireOrderProductResult `json:"products"`
}

// WireOrderProductResult is one line item of WireOrderDetailsResult.
type WireOrderProductResult struct {
	ID                string `json:"id"`
	Name              string `json:"name,omitempty"`
	ImageID           string `json:"imageId,omitempty"`
	ImageURL          string `json:"imageUrl,omitempty"`
	Price             int64  `json:"price"`
	Currency          string `json:"currency,omitempty"`
	Quantity          int    `json:"quantity"`
	VariantProperties string `json:"variantProperties,omitempty"`
}

// WireBusinessLinkedAccountsResult mirrors types.BusinessLinkedAccounts. Absent
// accounts stay nil so the UI can distinguish "not linked" from empty strings.
type WireBusinessLinkedAccountsResult struct {
	FacebookPage          *WireBusinessFacebookPageResult     `json:"facebookPage,omitempty"`
	FacebookBusiness      *WireBusinessFacebookBusinessResult `json:"facebookBusiness,omitempty"`
	InstagramProfessional *WireBusinessInstagramResult        `json:"instagramProfessional,omitempty"`
	WhatsAppAdIdentity    *WireBusinessAdIdentityResult       `json:"whatsappAdIdentity,omitempty"`
}

type WireBusinessFacebookPageResult struct {
	ID                   string `json:"id"`
	DisplayName          string `json:"displayName,omitempty"`
	ProfileSync          string `json:"profileSync,omitempty"`
	ProfilePictureURL    string `json:"profilePictureUrl,omitempty"`
	ShowOnProfile        bool   `json:"showOnProfile"`
	WhatsAppAsPageButton bool   `json:"whatsappAsPageButton"`
	HasActiveCTWAAd      bool   `json:"hasActiveCtwaAd"`
	HasCreatedAd         bool   `json:"hasCreatedAd"`
}

type WireBusinessFacebookBusinessResult struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName,omitempty"`
	CatalogID    string `json:"catalogId,omitempty"`
	CatalogState string `json:"catalogState,omitempty"`
}

type WireBusinessInstagramResult struct {
	Handle            string `json:"handle,omitempty"`
	DisplayName       string `json:"displayName,omitempty"`
	ProfilePictureURL string `json:"profilePictureUrl,omitempty"`
	ShowOnProfile     bool   `json:"showOnProfile"`
}

type WireBusinessAdIdentityResult struct {
	ID              string `json:"id"`
	HasActiveCTWAAd bool   `json:"hasActiveCtwaAd"`
	HasCreatedAd    bool   `json:"hasCreatedAd"`
}

// WireBusinessEligibilityResult mirrors types.BusinessEligibility.
type WireBusinessEligibilityResult struct {
	Features []WireBusinessFeatureEligibilityResult `json:"features"`
}

type WireBusinessFeatureEligibilityResult struct {
	Feature                 string `json:"feature"`
	Status                  string `json:"status"`
	Expiration              int64  `json:"expiration,omitempty"`
	AdditionalParams        string `json:"additionalParams,omitempty"`
	ShowPrivacyInterstitial *bool  `json:"showPrivacyInterstitial,omitempty"`
	V1Enabled               *bool  `json:"v1Enabled,omitempty"`
}

// WireBusinessCatalogPageResult is a page of products with cursor tokens.
type WireBusinessCatalogPageResult struct {
	Next     string                      `json:"next,omitempty"`
	Previous string                      `json:"previous,omitempty"`
	Products []WireBusinessProductResult `json:"products"`
}

// WireBusinessProductResult is the bindable subset of types.BusinessProduct.
// Nested compliance/variant structures are intentionally omitted; the scalar
// compliance category and review status are preserved.
type WireBusinessProductResult struct {
	ID                 string                  `json:"id"`
	RetailerID         string                  `json:"retailerId,omitempty"`
	BelongsTo          string                  `json:"belongsTo,omitempty"`
	Name               string                  `json:"name,omitempty"`
	Description        string                  `json:"description,omitempty"`
	Price              string                  `json:"price,omitempty"`
	Currency           string                  `json:"currency,omitempty"`
	URL                string                  `json:"url,omitempty"`
	ShimmedURL         string                  `json:"shimmedUrl,omitempty"`
	Hidden             bool                    `json:"hidden"`
	Sanctioned         bool                    `json:"sanctioned"`
	MaxAvailable       int                     `json:"maxAvailable,omitempty"`
	Availability       string                  `json:"availability,omitempty"`
	ComplianceCategory string                  `json:"complianceCategory,omitempty"`
	Status             string                  `json:"status,omitempty"`
	CanAppeal          bool                    `json:"canAppeal"`
	Images             []WireBusinessMediaItem `json:"images"`
	Videos             []WireBusinessMediaItem `json:"videos"`
	SalePrice          string                  `json:"salePrice,omitempty"`
	SaleStart          string                  `json:"saleStart,omitempty"`
	SaleEnd            string                  `json:"saleEnd,omitempty"`
}

// WireBusinessMediaItem is one product image or video. The URL is the original
// media URL; product images fall back to the request URL when the original is
// absent, while videos carry no request URL and may also expose a thumbnail URL.
// Nothing is synthesized.
type WireBusinessMediaItem struct {
	ID           string `json:"id"`
	URL          string `json:"url,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
}

// WireBusinessCollectionPageResult is a page of collections with a cursor.
type WireBusinessCollectionPageResult struct {
	Next        string                         `json:"next,omitempty"`
	Collections []WireBusinessCollectionResult `json:"collections"`
}

// WireBusinessCollectionResult is a collection plus its products and review info.
type WireBusinessCollectionResult struct {
	ID           string                      `json:"id"`
	Name         string                      `json:"name,omitempty"`
	Next         string                      `json:"next,omitempty"`
	Previous     string                      `json:"previous,omitempty"`
	Status       string                      `json:"status,omitempty"`
	CanAppeal    bool                        `json:"canAppeal"`
	CommerceURL  string                      `json:"commerceUrl,omitempty"`
	RejectReason string                      `json:"rejectReason,omitempty"`
	Products     []WireBusinessProductResult `json:"products"`
}

// WireBusinessCollectionMutationResult is returned by create/update collection.
type WireBusinessCollectionMutationResult struct {
	ID           string `json:"id"`
	ReviewStatus string `json:"reviewStatus,omitempty"`
}

// WireBusinessMerchantComplianceResult is the bindable subset of
// types.BusinessMerchantCompliance (contact details are flattened scalars).
type WireBusinessMerchantComplianceResult struct {
	EntityName       string                            `json:"entityName,omitempty"`
	EntityType       string                            `json:"entityType,omitempty"`
	IsRegistered     bool                              `json:"isRegistered"`
	EntityTypeCustom string                            `json:"entityTypeCustom,omitempty"`
	CustomerCare     WireBusinessMerchantContactResult `json:"customerCare"`
	GrievanceOfficer WireBusinessMerchantOfficerResult `json:"grievanceOfficer"`
}

type WireBusinessMerchantContactResult struct {
	Email          string `json:"email,omitempty"`
	LandlineNumber string `json:"landlineNumber,omitempty"`
	MobileNumber   string `json:"mobileNumber,omitempty"`
}

type WireBusinessMerchantOfficerResult struct {
	Name           string `json:"name,omitempty"`
	Email          string `json:"email,omitempty"`
	LandlineNumber string `json:"landlineNumber,omitempty"`
	MobileNumber   string `json:"mobileNumber,omitempty"`
}

// WireBusinessDeleteProductsResult reports the server-confirmed delete count.
type WireBusinessDeleteProductsResult struct {
	DeletedCount int `json:"deletedCount"`
}

// WireBusinessImageUploadResult carries the URL returned by the product-image
// upload endpoint. No media key or upload token is exposed.
type WireBusinessImageUploadResult struct {
	URL string `json:"url"`
}

// WireBusinessCoverPhotoResult carries the server-assigned cover photo ID.
type WireBusinessCoverPhotoResult struct {
	ID string `json:"id"`
}

// ---------------------------------------------------------------------------
// Bindable inputs
// ---------------------------------------------------------------------------

// WireBusinessProductInput is the primitive-only form of
// types.BusinessProductInput. Empty optional strings are treated as unset by
// the library, so no sentinel pointers are needed at the IPC boundary.
type WireBusinessProductInput struct {
	Name               string                       `json:"name"`
	Description        string                       `json:"description,omitempty"`
	Currency           string                       `json:"currency,omitempty"`
	Price              string                       `json:"price,omitempty"`
	SalePrice          string                       `json:"salePrice,omitempty"`
	URL                string                       `json:"url,omitempty"`
	RetailerID         string                       `json:"retailerId,omitempty"`
	Hidden             bool                         `json:"hidden,omitempty"`
	ImageURLs          []string                     `json:"imageUrls"`
	VideoURLs          []string                     `json:"videoUrls,omitempty"`
	ComplianceCategory string                       `json:"complianceCategory,omitempty"`
	Compliance         *WireBusinessComplianceInput `json:"compliance,omitempty"`
}

// WireBusinessComplianceInput is the bindable subset of
// types.BusinessComplianceInfo.
type WireBusinessComplianceInput struct {
	CountryCodeOrigin string                    `json:"countryCodeOrigin,omitempty"`
	ImporterName      string                    `json:"importerName,omitempty"`
	ImporterAddress   *WireBusinessAddressInput `json:"importerAddress,omitempty"`
}

type WireBusinessAddressInput struct {
	Street1     string `json:"street1,omitempty"`
	Street2     string `json:"street2,omitempty"`
	City        string `json:"city,omitempty"`
	Region      string `json:"region,omitempty"`
	PostalCode  string `json:"postalCode,omitempty"`
	CountryCode string `json:"countryCode,omitempty"`
}

// WireBusinessCollectionUpdateInput is the editable subset of
// types.BusinessCollectionUpdate. An empty Name means "leave unchanged" (the
// library rejects an empty collection name, so it cannot be used to clear it).
type WireBusinessCollectionUpdateInput struct {
	Name             string   `json:"name,omitempty"`
	AddProductIDs    []string `json:"addProductIds,omitempty"`
	RemoveProductIDs []string `json:"removeProductIds,omitempty"`
}

// WireBusinessCollectionMoveInput is one reorder move.
type WireBusinessCollectionMoveInput struct {
	CollectionID string `json:"collectionId"`
	FromIndex    int    `json:"fromIndex"`
	ToIndex      int    `json:"toIndex"`
}

// WireBusinessMerchantComplianceInput is a flattened, primitive-only form of
// types.BusinessMerchantCompliance.
type WireBusinessMerchantComplianceInput struct {
	EntityName               string `json:"entityName"`
	EntityType               string `json:"entityType"`
	IsRegistered             bool   `json:"isRegistered,omitempty"`
	EntityTypeCustom         string `json:"entityTypeCustom,omitempty"`
	CustomerCareEmail        string `json:"customerCareEmail,omitempty"`
	CustomerCareLandline     string `json:"customerCareLandline,omitempty"`
	CustomerCareMobile       string `json:"customerCareMobile,omitempty"`
	GrievanceOfficerName     string `json:"grievanceOfficerName,omitempty"`
	GrievanceOfficerEmail    string `json:"grievanceOfficerEmail,omitempty"`
	GrievanceOfficerLandline string `json:"grievanceOfficerLandline,omitempty"`
	GrievanceOfficerMobile   string `json:"grievanceOfficerMobile,omitempty"`
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const (
	wireBusinessMaxIDBytes       = 256
	wireBusinessMaxCursorBytes   = 2048
	wireBusinessMaxImageURLBytes = 4096
	wireBusinessMaxReasonBytes   = 4096
	wireBusinessMaxImageBytes    = 10 * 1024 * 1024 // 10 MB at the IPC boundary
	wireBusinessMaxItems         = 100
	wireBusinessMaxMoves         = 100
)

// wireBusinessOpError replaces a backend error string with a plain message so
// token/body details from the GraphQL transport can never reach the frontend.
// The error is intentionally not logged for the same reason.
func wireBusinessOpError(what string) error {
	return fmt.Errorf("could not %s", what)
}

// wireBusinessReady requires a client with a stored account JID. Mutations rely
// on the library's ownBusinessJID(), so an unpaired client cannot perform them.
func (a *Api) wireBusinessReady() (*whatsmeow.Client, error) {
	cli, err := a.wireClient()
	if err != nil {
		return nil, err
	}
	if cli.Store == nil || cli.Store.ID == nil {
		return nil, errors.New("not logged in")
	}
	return cli, nil
}

// wireBusinessJID resolves an optional JID string to the library's JID type.
// An empty value means the logged-in account's own JID; a supplied value is
// parsed with types.ParseJID and restricted to user/LID servers exactly as the
// library's business JID validator does.
func (a *Api) wireBusinessJID(raw string) (types.JID, error) {
	cli, err := a.wireBusinessReady()
	if err != nil {
		return types.EmptyJID, err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return cli.Store.ID.ToNonAD(), nil
	}
	jid, err := types.ParseJID(raw)
	if err != nil || jid.IsEmpty() || jid.User == "" ||
		(jid.Server != types.DefaultUserServer && jid.Server != types.HiddenUserServer) {
		return types.EmptyJID, errors.New("invalid business JID: expected a user or LID JID")
	}
	return jid.ToNonAD(), nil
}

// wireBusinessID validates a product/collection/order-style identifier.
func wireBusinessID(kind, id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return "", fmt.Errorf("%s ID must not be empty", kind)
	}
	if len(id) > wireBusinessMaxIDBytes {
		return "", fmt.Errorf("%s ID exceeds %d bytes", kind, wireBusinessMaxIDBytes)
	}
	return id, nil
}

// wireBusinessIDList validates a non-empty list of unique IDs.
func wireBusinessIDList(kind string, ids []string, min int) ([]string, error) {
	if len(ids) < min || len(ids) > wireBusinessMaxItems {
		return nil, fmt.Errorf("%s list must contain between %d and %d IDs", kind, min, wireBusinessMaxItems)
	}
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, raw := range ids {
		id, err := wireBusinessID(kind, raw)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[id]; exists {
			return nil, fmt.Errorf("duplicate %s ID", kind)
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

// wireBusinessOptionalIDList validates a list that may be empty.
func wireBusinessOptionalIDList(kind string, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return []string{}, nil
	}
	return wireBusinessIDList(kind, ids, 1)
}

// wireBusinessLimit mirrors the library's page-size defaults and bounds.
func wireBusinessLimit(value, max int, name string) (int, error) {
	if value == 0 {
		return 50, nil
	}
	if value < 1 || value > max {
		return 0, fmt.Errorf("%s must be between 1 and %d", name, max)
	}
	return value, nil
}

func wireBusinessCursor(after string) error {
	if len(after) > wireBusinessMaxCursorBytes {
		return errors.New("page cursor exceeds 2048 bytes")
	}
	return nil
}

func wireBusinessReason(reason string) (string, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return "", errors.New("appeal reason must not be empty")
	}
	if len(reason) > wireBusinessMaxReasonBytes {
		return "", errors.New("appeal reason exceeds 4096 bytes")
	}
	return reason, nil
}

// wireBusinessImage decodes a base64 image and enforces a sane wire-level size
// cap before the library performs its own JPEG/PNG and per-endpoint checks.
func wireBusinessImage(imageBase64 string) ([]byte, error) {
	// base64 expands by roughly 4/3, so reject oversized input before decoding
	// the whole payload into memory. The decoded-size cap below remains the
	// authoritative limit.
	if len(imageBase64) > 14*1024*1024 {
		return nil, errors.New("image exceeds 10 MB")
	}
	data, err := wireDecodeBase64("image", imageBase64, false)
	if err != nil {
		return nil, err
	}
	if len(data) > wireBusinessMaxImageBytes {
		return nil, errors.New("image exceeds 10 MB")
	}
	return data, nil
}

// wireBusinessDecimal mirrors the library's unsigned thousandths amount check.
func wireBusinessDecimal(value string) bool {
	if value == "" || len(value) > 18 {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func wireBusinessCurrency(value string) bool {
	if len(value) != 3 {
		return false
	}
	for _, r := range value {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Result projection helpers
// ---------------------------------------------------------------------------

func wireBusinessProduct(p *types.BusinessProduct) WireBusinessProductResult {
	var out WireBusinessProductResult
	if p == nil {
		return out
	}
	out = WireBusinessProductResult{
		ID:                 p.ID,
		RetailerID:         p.RetailerID,
		BelongsTo:          p.BelongsTo,
		Name:               p.Name,
		Description:        p.Description,
		Price:              p.Price,
		Currency:           p.Currency,
		URL:                p.URL,
		ShimmedURL:         p.ShimmedURL,
		Hidden:             p.Hidden,
		Sanctioned:         p.Sanctioned,
		MaxAvailable:       p.MaxAvailable,
		Availability:       p.Availability,
		ComplianceCategory: p.ComplianceCategory,
		Status:             p.Status.Status,
		CanAppeal:          p.Status.CanAppeal,
		Images:             make([]WireBusinessMediaItem, 0, len(p.Media.Images)),
		Videos:             make([]WireBusinessMediaItem, 0, len(p.Media.Videos)),
	}
	for _, img := range p.Media.Images {
		item := WireBusinessMediaItem{ID: img.ID, URL: img.OriginalURL}
		if item.URL == "" {
			item.URL = img.RequestURL
		}
		out.Images = append(out.Images, item)
	}
	for _, vid := range p.Media.Videos {
		item := WireBusinessMediaItem{ID: vid.ID, URL: vid.OriginalURL, ThumbnailURL: vid.ThumbnailURL}
		out.Videos = append(out.Videos, item)
	}
	if p.SalePrice != nil {
		out.SalePrice = p.SalePrice.Price
		out.SaleStart = p.SalePrice.StartDate
		out.SaleEnd = p.SalePrice.EndDate
	}
	return out
}

func wireBusinessProducts(products []types.BusinessProduct) []WireBusinessProductResult {
	out := make([]WireBusinessProductResult, 0, len(products))
	for i := range products {
		out = append(out, wireBusinessProduct(&products[i]))
	}
	return out
}

func wireBusinessCollection(c *types.BusinessCollection) WireBusinessCollectionResult {
	var out WireBusinessCollectionResult
	if c == nil {
		return out
	}
	out = WireBusinessCollectionResult{
		ID:           c.ID,
		Name:         c.Name,
		Next:         c.Next,
		Previous:     c.Previous,
		Status:       c.Status.Status,
		CanAppeal:    c.Status.CanAppeal,
		CommerceURL:  c.Status.CommerceURL,
		RejectReason: c.Status.RejectReason,
		Products:     wireBusinessProducts(c.Products),
	}
	return out
}

func wireBusinessLinkedAccounts(src *types.BusinessLinkedAccounts) WireBusinessLinkedAccountsResult {
	var out WireBusinessLinkedAccountsResult
	if src == nil {
		return out
	}
	if v := src.FacebookPage; v != nil {
		out.FacebookPage = &WireBusinessFacebookPageResult{
			ID:                   v.ID,
			DisplayName:          v.DisplayName,
			ProfileSync:          v.ProfileSync,
			ProfilePictureURL:    v.ProfilePictureURL,
			ShowOnProfile:        v.ShowOnProfile,
			WhatsAppAsPageButton: v.WhatsAppAsPageButton,
			HasActiveCTWAAd:      v.HasActiveCTWAAd,
			HasCreatedAd:         v.HasCreatedAd,
		}
	}
	if v := src.FacebookBusiness; v != nil {
		out.FacebookBusiness = &WireBusinessFacebookBusinessResult{
			ID:           v.ID,
			DisplayName:  v.DisplayName,
			CatalogID:    v.CatalogID,
			CatalogState: v.CatalogState,
		}
	}
	if v := src.InstagramProfessional; v != nil {
		out.InstagramProfessional = &WireBusinessInstagramResult{
			Handle:            v.Handle,
			DisplayName:       v.DisplayName,
			ProfilePictureURL: v.ProfilePictureURL,
			ShowOnProfile:     v.ShowOnProfile,
		}
	}
	if v := src.WhatsAppAdIdentity; v != nil {
		out.WhatsAppAdIdentity = &WireBusinessAdIdentityResult{
			ID:              v.ID,
			HasActiveCTWAAd: v.HasActiveCTWAAd,
			HasCreatedAd:    v.HasCreatedAd,
		}
	}
	return out
}

func wireBusinessEligibility(src *types.BusinessEligibility) WireBusinessEligibilityResult {
	out := WireBusinessEligibilityResult{Features: []WireBusinessFeatureEligibilityResult{}}
	if src == nil {
		return out
	}
	for _, f := range src.Features {
		out.Features = append(out.Features, WireBusinessFeatureEligibilityResult{
			Feature:                 string(f.Feature),
			Status:                  f.Status,
			Expiration:              f.Expiration,
			AdditionalParams:        f.AdditionalParams,
			ShowPrivacyInterstitial: f.ShowPrivacyInterstitial,
			V1Enabled:               f.V1Enabled,
		})
	}
	return out
}

func wireBusinessMerchant(src *types.BusinessMerchantCompliance) WireBusinessMerchantComplianceResult {
	var out WireBusinessMerchantComplianceResult
	if src == nil {
		return out
	}
	out = WireBusinessMerchantComplianceResult{
		EntityName:       src.EntityName,
		EntityType:       string(src.EntityType),
		IsRegistered:     src.IsRegistered,
		EntityTypeCustom: src.EntityTypeCustom,
		CustomerCare: WireBusinessMerchantContactResult{
			Email:          src.CustomerCare.Email,
			LandlineNumber: src.CustomerCare.LandlineNumber,
			MobileNumber:   src.CustomerCare.MobileNumber,
		},
		GrievanceOfficer: WireBusinessMerchantOfficerResult{
			Name:           src.GrievanceOfficer.Name,
			Email:          src.GrievanceOfficer.Email,
			LandlineNumber: src.GrievanceOfficer.LandlineNumber,
			MobileNumber:   src.GrievanceOfficer.MobileNumber,
		},
	}
	return out
}

// ---------------------------------------------------------------------------
// Input conversion helpers
// ---------------------------------------------------------------------------

var wireBusinessFeatures = map[string]types.BusinessFeature{
	"meta_verified":      types.BusinessFeatureMetaVerified,
	"marketing_messages": types.BusinessFeatureMarketingMessages,
	"genai":              types.BusinessFeatureGenAI,
	"genai_image":        types.BusinessFeatureGenAIImage,
	"meta_one":           types.BusinessFeatureMetaOne,
	"bb_pro":             types.BusinessFeatureBBPro,
}

func wireBusinessFeatureList(features []string) ([]types.BusinessFeature, error) {
	if len(features) == 0 {
		return nil, nil // library defaults to all supported features
	}
	out := make([]types.BusinessFeature, 0, len(features))
	seen := map[string]struct{}{}
	for _, raw := range features {
		key := strings.ToLower(strings.TrimSpace(raw))
		feature, ok := wireBusinessFeatures[key]
		if !ok {
			return nil, fmt.Errorf("unsupported business feature %q", raw)
		}
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate business feature %q", raw)
		}
		seen[key] = struct{}{}
		out = append(out, feature)
	}
	return out, nil
}

func wireBusinessComplianceInput(in *WireBusinessComplianceInput) (types.BusinessComplianceInfo, error) {
	var out types.BusinessComplianceInfo
	if len(in.CountryCodeOrigin) > 3 || len(in.ImporterName) > 256 {
		return out, errors.New("product compliance information is invalid")
	}
	out.CountryCodeOrigin = in.CountryCodeOrigin
	out.ImporterName = in.ImporterName
	if addr := in.ImporterAddress; addr != nil {
		if len(addr.Street1) > 512 || len(addr.Street2) > 512 || len(addr.City) > 256 ||
			len(addr.Region) > 256 || len(addr.PostalCode) > 64 || len(addr.CountryCode) > 3 {
			return out, errors.New("product importer address is invalid")
		}
		out.ImporterAddress = &types.BusinessAddress{
			Street1:     addr.Street1,
			Street2:     addr.Street2,
			City:        addr.City,
			Region:      addr.Region,
			PostalCode:  addr.PostalCode,
			CountryCode: addr.CountryCode,
		}
	}
	return out, nil
}

// wireBusinessProductInput converts and validates a bindable product input.
// Library limits (name, description, retailer ID, image/video counts, URL and
// price/currency rules) are mirrored here so callers get plain messages.
func wireBusinessProductInput(in WireBusinessProductInput) (types.BusinessProductInput, error) {
	var out types.BusinessProductInput
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return out, errors.New("product name must not be empty")
	}
	if len(name) > 256 {
		return out, errors.New("product name exceeds 256 bytes")
	}
	if len(in.Description) > 4096 {
		return out, errors.New("product description exceeds 4096 bytes")
	}
	if len(in.RetailerID) > 256 {
		return out, errors.New("product retailer ID exceeds 256 bytes")
	}
	if len(in.ImageURLs) < 1 || len(in.ImageURLs) > 10 {
		return out, errors.New("product must contain between 1 and 10 images")
	}
	for _, raw := range in.ImageURLs {
		if strings.TrimSpace(raw) == "" || len(raw) > wireBusinessMaxImageURLBytes {
			return out, errors.New("product image URL is invalid")
		}
	}
	if len(in.VideoURLs) > 10 {
		return out, errors.New("product cannot contain more than 10 videos")
	}
	for _, raw := range in.VideoURLs {
		if strings.TrimSpace(raw) == "" || len(raw) > wireBusinessMaxImageURLBytes {
			return out, errors.New("product video URL is invalid")
		}
	}
	if in.URL != "" {
		parsed, err := url.ParseRequestURI(in.URL)
		if len(in.URL) > 2048 || err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return out, errors.New("product URL must be an absolute HTTPS URL of at most 2048 bytes")
		}
	}
	if in.Price == "" {
		if in.Currency != "" || in.SalePrice != "" {
			return out, errors.New("product currency and sale price require a price")
		}
	} else {
		if !wireBusinessCurrency(in.Currency) {
			return out, errors.New("product currency must be a three-letter uppercase code")
		}
		if !wireBusinessDecimal(in.Price) {
			return out, errors.New("product price must be an integer amount in thousandths")
		}
		if in.SalePrice != "" && !wireBusinessDecimal(in.SalePrice) {
			return out, errors.New("product sale price must be an integer amount in thousandths")
		}
	}
	if len(in.ComplianceCategory) > 128 {
		return out, errors.New("product compliance category exceeds 128 bytes")
	}
	if in.Compliance != nil {
		compliance, err := wireBusinessComplianceInput(in.Compliance)
		if err != nil {
			return out, err
		}
		out.Compliance = &compliance
	}
	out.Name = name
	out.Description = in.Description
	out.Currency = in.Currency
	out.Price = in.Price
	out.SalePrice = in.SalePrice
	out.URL = in.URL
	out.RetailerID = in.RetailerID
	out.Hidden = in.Hidden
	out.ImageURLs = append([]string(nil), in.ImageURLs...)
	out.VideoURLs = append([]string(nil), in.VideoURLs...)
	out.ComplianceCategory = in.ComplianceCategory
	return out, nil
}

func wireBusinessMerchantInput(in WireBusinessMerchantComplianceInput) (types.BusinessMerchantCompliance, error) {
	var out types.BusinessMerchantCompliance
	name := strings.TrimSpace(in.EntityName)
	if name == "" {
		return out, errors.New("merchant entity name must not be empty")
	}
	if len(name) > 256 {
		return out, errors.New("merchant entity name exceeds 256 bytes")
	}
	entityType := types.BusinessMerchantEntityType(strings.ToUpper(strings.TrimSpace(in.EntityType)))
	switch entityType {
	case types.BusinessMerchantEntitySoleProprietorship,
		types.BusinessMerchantEntityPartnership,
		types.BusinessMerchantEntityPrivateCompany,
		types.BusinessMerchantEntityPublicCompany,
		types.BusinessMerchantEntityLimitedLiabilityPartnership,
		types.BusinessMerchantEntityOther:
	default:
		return out, errors.New("unsupported merchant entity type")
	}
	custom := strings.TrimSpace(in.EntityTypeCustom)
	if entityType == types.BusinessMerchantEntityOther && custom == "" {
		return out, errors.New("custom merchant entity type must not be empty")
	}
	fields := []struct {
		name  string
		value string
		limit int
	}{
		{"custom entity type", custom, 256},
		{"customer care email", in.CustomerCareEmail, 254},
		{"customer care landline", in.CustomerCareLandline, 64},
		{"customer care mobile", in.CustomerCareMobile, 64},
		{"grievance officer name", in.GrievanceOfficerName, 256},
		{"grievance officer email", in.GrievanceOfficerEmail, 254},
		{"grievance officer landline", in.GrievanceOfficerLandline, 64},
		{"grievance officer mobile", in.GrievanceOfficerMobile, 64},
	}
	for _, field := range fields {
		if len(field.value) > field.limit {
			return out, fmt.Errorf("merchant %s exceeds %d bytes", field.name, field.limit)
		}
	}
	out = types.BusinessMerchantCompliance{
		EntityName:       name,
		EntityType:       entityType,
		IsRegistered:     in.IsRegistered,
		EntityTypeCustom: custom,
		CustomerCare: types.BusinessMerchantContact{
			Email:          in.CustomerCareEmail,
			LandlineNumber: in.CustomerCareLandline,
			MobileNumber:   in.CustomerCareMobile,
		},
		GrievanceOfficer: types.BusinessMerchantOfficer{
			Name:           in.GrievanceOfficerName,
			Email:          in.GrievanceOfficerEmail,
			LandlineNumber: in.GrievanceOfficerLandline,
			MobileNumber:   in.GrievanceOfficerMobile,
		},
	}
	return out, nil
}

// ===========================================================================
// READS (9)
// ===========================================================================

// WireGetOrderDetails binds Client.GetOrderDetails. orderID and token are the
// values carried by an incoming OrderMessage; both are echoed by the server.
func (a *Api) WireGetOrderDetails(orderID, token string) (WireOrderDetailsResult, error) {
	var out WireOrderDetailsResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	orderID, err := wireBusinessID("order", orderID)
	if err != nil {
		return out, err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return out, errors.New("order token must not be empty")
	}
	if len(token) > 8192 {
		return out, errors.New("order token exceeds 8192 bytes")
	}
	details, err := a.waClient.GetOrderDetails(a.wireCtx(), orderID, token)
	if err != nil {
		return out, wireBusinessOpError("get order details")
	}
	out.ID = details.ID
	out.CreatedAt = details.CreatedAt.Unix()
	out.CatalogID = details.CatalogID
	out.Subtotal = details.Price.Subtotal
	out.Total = details.Price.Total
	out.Currency = details.Price.Currency
	out.PriceStatus = details.Price.PriceStatus
	out.Products = make([]WireOrderProductResult, 0, len(details.Products))
	for _, p := range details.Products {
		out.Products = append(out.Products, WireOrderProductResult{
			ID:                p.ID,
			Name:              p.Name,
			ImageID:           p.ImageID,
			ImageURL:          p.ImageURL,
			Price:             p.Price,
			Currency:          p.Currency,
			Quantity:          p.Quantity,
			VariantProperties: p.VariantInfo.Properties,
		})
	}
	return out, nil
}

// WireGetBusinessLinkedAccounts binds Client.GetBusinessLinkedAccounts.
func (a *Api) WireGetBusinessLinkedAccounts() (WireBusinessLinkedAccountsResult, error) {
	var out WireBusinessLinkedAccountsResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	accounts, err := a.waClient.GetBusinessLinkedAccounts(a.wireCtx())
	if err != nil {
		return out, wireBusinessOpError("get linked business accounts")
	}
	return wireBusinessLinkedAccounts(accounts), nil
}

// WireGetBusinessEligibility binds Client.GetBusinessEligibility. features is
// optional; supported values are meta_verified, marketing_messages, genai,
// genai_image, meta_one and bb_pro (empty means all).
func (a *Api) WireGetBusinessEligibility(features []string) (WireBusinessEligibilityResult, error) {
	var out WireBusinessEligibilityResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	parsed, err := wireBusinessFeatureList(features)
	if err != nil {
		return out, err
	}
	eligibility, err := a.waClient.GetBusinessEligibility(a.wireCtx(), parsed...)
	if err != nil {
		return out, wireBusinessOpError("get business eligibility")
	}
	return wireBusinessEligibility(eligibility), nil
}

// WireGetCatalog binds Client.GetCatalog. businessJID is optional and defaults
// to the logged-in account; limit 0 applies the library default of 50.
func (a *Api) WireGetCatalog(businessJID, after string, limit int) (WireBusinessCatalogPageResult, error) {
	var out WireBusinessCatalogPageResult
	jid, err := a.wireBusinessJID(businessJID)
	if err != nil {
		return out, err
	}
	if err := wireBusinessCursor(after); err != nil {
		return out, err
	}
	limit, err = wireBusinessLimit(limit, 100, "catalog limit")
	if err != nil {
		return out, err
	}
	page, err := a.waClient.GetCatalog(a.wireCtx(), jid, whatsmeow.GetCatalogParams{After: after, Limit: limit})
	if err != nil {
		return out, wireBusinessOpError("get catalog")
	}
	out = WireBusinessCatalogPageResult{
		Next:     page.Next,
		Previous: page.Previous,
		Products: wireBusinessProducts(page.Products),
	}
	return out, nil
}

// WireGetCatalogProduct binds Client.GetCatalogProduct.
func (a *Api) WireGetCatalogProduct(businessJID, productID string) (WireBusinessProductResult, error) {
	var out WireBusinessProductResult
	jid, err := a.wireBusinessJID(businessJID)
	if err != nil {
		return out, err
	}
	productID, err = wireBusinessID("product", productID)
	if err != nil {
		return out, err
	}
	product, err := a.waClient.GetCatalogProduct(a.wireCtx(), jid, productID)
	if err != nil {
		return out, wireBusinessOpError("get catalog product")
	}
	return wireBusinessProduct(product), nil
}

// WireGetProductCollections binds Client.GetProductCollections. collectionLimit
// defaults to 20 (max 20) and itemLimit defaults to 50 (max 100).
func (a *Api) WireGetProductCollections(businessJID, after string, collectionLimit, itemLimit int) (WireBusinessCollectionPageResult, error) {
	var out WireBusinessCollectionPageResult
	jid, err := a.wireBusinessJID(businessJID)
	if err != nil {
		return out, err
	}
	if err := wireBusinessCursor(after); err != nil {
		return out, err
	}
	if collectionLimit == 0 {
		collectionLimit = 20
	}
	if collectionLimit < 1 || collectionLimit > 20 {
		return out, errors.New("collection limit must be between 1 and 20")
	}
	itemLimit, err = wireBusinessLimit(itemLimit, 100, "collection item limit")
	if err != nil {
		return out, err
	}
	page, err := a.waClient.GetProductCollections(a.wireCtx(), jid, whatsmeow.GetCollectionsParams{
		After:           after,
		CollectionLimit: collectionLimit,
		ItemLimit:       itemLimit,
	})
	if err != nil {
		return out, wireBusinessOpError("get product collections")
	}
	out = WireBusinessCollectionPageResult{
		Next:        page.Next,
		Collections: make([]WireBusinessCollectionResult, 0, len(page.Collections)),
	}
	for i := range page.Collections {
		out.Collections = append(out.Collections, wireBusinessCollection(&page.Collections[i]))
	}
	return out, nil
}

// WireGetProductCollection binds Client.GetProductCollection.
func (a *Api) WireGetProductCollection(businessJID, collectionID, after string, limit int) (WireBusinessCollectionResult, error) {
	var out WireBusinessCollectionResult
	jid, err := a.wireBusinessJID(businessJID)
	if err != nil {
		return out, err
	}
	collectionID, err = wireBusinessID("collection", collectionID)
	if err != nil {
		return out, err
	}
	if err := wireBusinessCursor(after); err != nil {
		return out, err
	}
	limit, err = wireBusinessLimit(limit, 100, "collection item limit")
	if err != nil {
		return out, err
	}
	collection, err := a.waClient.GetProductCollection(a.wireCtx(), jid, collectionID, whatsmeow.GetCatalogParams{After: after, Limit: limit})
	if err != nil {
		return out, wireBusinessOpError("get product collection")
	}
	return wireBusinessCollection(collection), nil
}

// WireGetCatalogProducts binds Client.GetCatalogProducts for 1..100 unique IDs.
func (a *Api) WireGetCatalogProducts(businessJID string, productIDs []string) ([]WireBusinessProductResult, error) {
	jid, err := a.wireBusinessJID(businessJID)
	if err != nil {
		return nil, err
	}
	ids, err := wireBusinessIDList("product", productIDs, 1)
	if err != nil {
		return nil, err
	}
	products, err := a.waClient.GetCatalogProducts(a.wireCtx(), jid, ids)
	if err != nil {
		return nil, wireBusinessOpError("get catalog products")
	}
	return wireBusinessProducts(products), nil
}

// WireGetBusinessMerchantCompliance binds Client.GetBusinessMerchantCompliance.
// The library always queries the logged-in account's own business.
func (a *Api) WireGetBusinessMerchantCompliance() (WireBusinessMerchantComplianceResult, error) {
	var out WireBusinessMerchantComplianceResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	info, err := a.waClient.GetBusinessMerchantCompliance(a.wireCtx())
	if err != nil {
		return out, wireBusinessOpError("get merchant compliance")
	}
	return wireBusinessMerchant(info), nil
}

// ===========================================================================
// MUTATIONS (16) — all operate on the logged-in account's own business JID,
// which the library resolves internally via ownBusinessJID().
// ===========================================================================

// WireCreateBusinessCollection binds Client.CreateBusinessCollection.
func (a *Api) WireCreateBusinessCollection(name string, productIDs []string) (WireBusinessCollectionMutationResult, error) {
	var out WireBusinessCollectionMutationResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return out, errors.New("collection name must not be empty")
	}
	if len(name) > 256 {
		return out, errors.New("collection name exceeds 256 bytes")
	}
	ids, err := wireBusinessIDList("product", productIDs, 1)
	if err != nil {
		return out, err
	}
	result, err := a.waClient.CreateBusinessCollection(a.wireCtx(), name, ids)
	if err != nil {
		return out, wireBusinessOpError("create business collection")
	}
	if result != nil {
		out.ID = result.ID
		out.ReviewStatus = result.ReviewStatus
	}
	return out, nil
}

// WireUpdateBusinessCollection binds Client.UpdateBusinessCollection.
func (a *Api) WireUpdateBusinessCollection(collectionID string, input WireBusinessCollectionUpdateInput) (WireBusinessCollectionMutationResult, error) {
	var out WireBusinessCollectionMutationResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	collectionID, err := wireBusinessID("collection", collectionID)
	if err != nil {
		return out, err
	}
	update := types.BusinessCollectionUpdate{}
	if input.Name != "" {
		name := strings.TrimSpace(input.Name)
		if name == "" || len(name) > 256 {
			return out, errors.New("collection name is invalid")
		}
		update.Name = &name
	}
	add, err := wireBusinessOptionalIDList("product", input.AddProductIDs)
	if err != nil {
		return out, err
	}
	remove, err := wireBusinessOptionalIDList("product", input.RemoveProductIDs)
	if err != nil {
		return out, err
	}
	update.AddProductIDs = add
	update.RemoveProductIDs = remove
	if update.Name == nil && len(add) == 0 && len(remove) == 0 {
		return out, errors.New("collection update must change a name or product list")
	}
	removed := map[string]struct{}{}
	for _, id := range remove {
		removed[id] = struct{}{}
	}
	for _, id := range add {
		if _, exists := removed[id]; exists {
			return out, errors.New("a product cannot be added and removed together")
		}
	}
	result, err := a.waClient.UpdateBusinessCollection(a.wireCtx(), collectionID, update)
	if err != nil {
		return out, wireBusinessOpError("update business collection")
	}
	if result != nil {
		out.ID = result.ID
		out.ReviewStatus = result.ReviewStatus
	}
	return out, nil
}

// WireDeleteBusinessCollections binds Client.DeleteBusinessCollections.
func (a *Api) WireDeleteBusinessCollections(collectionIDs []string) error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	ids, err := wireBusinessIDList("collection", collectionIDs, 1)
	if err != nil {
		return err
	}
	if err := a.waClient.DeleteBusinessCollections(a.wireCtx(), ids); err != nil {
		return wireBusinessOpError("delete business collections")
	}
	return nil
}

// WireReorderBusinessCollections binds Client.ReorderBusinessCollections.
func (a *Api) WireReorderBusinessCollections(moves []WireBusinessCollectionMoveInput) error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	if len(moves) < 1 || len(moves) > wireBusinessMaxMoves {
		return fmt.Errorf("collection reorder must contain between 1 and %d moves", wireBusinessMaxMoves)
	}
	parsed := make([]types.BusinessCollectionMove, 0, len(moves))
	seen := make(map[string]struct{}, len(moves))
	for _, move := range moves {
		id, err := wireBusinessID("collection", move.CollectionID)
		if err != nil {
			return err
		}
		if move.FromIndex < 0 || move.ToIndex < 0 || move.FromIndex >= wireBusinessMaxMoves || move.ToIndex >= wireBusinessMaxMoves {
			return errors.New("collection move index must be between 0 and 99")
		}
		if _, exists := seen[id]; exists {
			return errors.New("duplicate collection move")
		}
		seen[id] = struct{}{}
		parsed = append(parsed, types.BusinessCollectionMove{CollectionID: id, FromIndex: move.FromIndex, ToIndex: move.ToIndex})
	}
	if err := a.waClient.ReorderBusinessCollections(a.wireCtx(), parsed); err != nil {
		return wireBusinessOpError("reorder business collections")
	}
	return nil
}

// WireCreateBusinessCatalog binds Client.CreateBusinessCatalog.
func (a *Api) WireCreateBusinessCatalog() error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	if err := a.waClient.CreateBusinessCatalog(a.wireCtx()); err != nil {
		return wireBusinessOpError("create business catalog")
	}
	return nil
}

// WireSetBusinessCartEnabled binds Client.SetBusinessCartEnabled.
func (a *Api) WireSetBusinessCartEnabled(enabled bool) error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	if err := a.waClient.SetBusinessCartEnabled(a.wireCtx(), enabled); err != nil {
		return wireBusinessOpError("update business cart setting")
	}
	return nil
}

// WireSetBusinessProductVisibility binds Client.SetBusinessProductVisibility.
func (a *Api) WireSetBusinessProductVisibility(productID string, hidden bool) error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	id, err := wireBusinessID("product", productID)
	if err != nil {
		return err
	}
	if err := a.waClient.SetBusinessProductVisibility(a.wireCtx(), id, hidden); err != nil {
		return wireBusinessOpError("update product visibility")
	}
	return nil
}

// WireAppealBusinessProduct binds Client.AppealBusinessProduct.
func (a *Api) WireAppealBusinessProduct(productID, reason string) error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	id, err := wireBusinessID("product", productID)
	if err != nil {
		return err
	}
	reason, err = wireBusinessReason(reason)
	if err != nil {
		return err
	}
	if err := a.waClient.AppealBusinessProduct(a.wireCtx(), id, reason); err != nil {
		return wireBusinessOpError("appeal business product")
	}
	return nil
}

// WireAppealBusinessCollection binds Client.AppealBusinessCollection.
func (a *Api) WireAppealBusinessCollection(collectionID, reason string) error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	id, err := wireBusinessID("collection", collectionID)
	if err != nil {
		return err
	}
	reason, err = wireBusinessReason(reason)
	if err != nil {
		return err
	}
	if err := a.waClient.AppealBusinessCollection(a.wireCtx(), id, reason); err != nil {
		return wireBusinessOpError("appeal business collection")
	}
	return nil
}

// WireSetBusinessMerchantCompliance binds Client.SetBusinessMerchantCompliance.
func (a *Api) WireSetBusinessMerchantCompliance(input WireBusinessMerchantComplianceInput) (WireBusinessMerchantComplianceResult, error) {
	var out WireBusinessMerchantComplianceResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	info, err := wireBusinessMerchantInput(input)
	if err != nil {
		return out, err
	}
	result, err := a.waClient.SetBusinessMerchantCompliance(a.wireCtx(), info)
	if err != nil {
		return out, wireBusinessOpError("set merchant compliance")
	}
	if result == nil {
		return WireBusinessMerchantComplianceResult{}, fmt.Errorf("set merchant compliance returned no result")
	}
	return wireBusinessMerchant(result), nil
}

// WireCreateBusinessProduct binds Client.CreateBusinessProduct. Thumbnail
// dimensions are fixed to the library's 100x100 default; no opaque width/height
// control is exposed.
func (a *Api) WireCreateBusinessProduct(input WireBusinessProductInput) (WireBusinessProductResult, error) {
	var out WireBusinessProductResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	productInput, err := wireBusinessProductInput(input)
	if err != nil {
		return out, err
	}
	product, err := a.waClient.CreateBusinessProduct(a.wireCtx(), productInput, 100, 100)
	if err != nil {
		return out, wireBusinessOpError("create business product")
	}
	if product == nil {
		return WireBusinessProductResult{}, fmt.Errorf("create business product returned no result")
	}
	return wireBusinessProduct(product), nil
}

// WireUpdateBusinessProduct binds Client.UpdateBusinessProduct.
func (a *Api) WireUpdateBusinessProduct(productID string, input WireBusinessProductInput) (WireBusinessProductResult, error) {
	var out WireBusinessProductResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	id, err := wireBusinessID("product", productID)
	if err != nil {
		return out, err
	}
	productInput, err := wireBusinessProductInput(input)
	if err != nil {
		return out, err
	}
	product, err := a.waClient.UpdateBusinessProduct(a.wireCtx(), id, productInput, 100, 100)
	if err != nil {
		return out, wireBusinessOpError("update business product")
	}
	if product == nil {
		return WireBusinessProductResult{}, fmt.Errorf("update business product returned no result")
	}
	return wireBusinessProduct(product), nil
}

// WireDeleteBusinessProducts binds Client.DeleteBusinessProducts and reports the
// server-confirmed deleted count.
func (a *Api) WireDeleteBusinessProducts(productIDs []string) (WireBusinessDeleteProductsResult, error) {
	var out WireBusinessDeleteProductsResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	ids, err := wireBusinessIDList("product", productIDs, 1)
	if err != nil {
		return out, err
	}
	count, err := a.waClient.DeleteBusinessProducts(a.wireCtx(), ids)
	if err != nil {
		return out, wireBusinessOpError("delete business products")
	}
	out.DeletedCount = count
	return out, nil
}

// WireUploadBusinessProductImage binds Client.UploadBusinessProductImage.
// imageBase64 is decoded and size-checked here; the library then enforces its
// JPEG/PNG requirement and returns the hosted URL.
func (a *Api) WireUploadBusinessProductImage(imageBase64 string) (WireBusinessImageUploadResult, error) {
	var out WireBusinessImageUploadResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	image, err := wireBusinessImage(imageBase64)
	if err != nil {
		return out, err
	}
	imageURL, err := a.waClient.UploadBusinessProductImage(a.wireCtx(), image)
	if err != nil {
		return out, wireBusinessOpError("upload business product image")
	}
	out.URL = imageURL
	return out, nil
}

// WireSetBusinessCoverPhoto binds Client.SetBusinessCoverPhoto. The returned
// DTO carries only the server-assigned cover photo ID, never upload tokens.
func (a *Api) WireSetBusinessCoverPhoto(imageBase64 string) (WireBusinessCoverPhotoResult, error) {
	var out WireBusinessCoverPhotoResult
	if _, err := a.wireBusinessReady(); err != nil {
		return out, err
	}
	image, err := wireBusinessImage(imageBase64)
	if err != nil {
		return out, err
	}
	coverID, err := a.waClient.SetBusinessCoverPhoto(a.wireCtx(), image)
	if err != nil {
		return out, wireBusinessOpError("set business cover photo")
	}
	out.ID = coverID
	return out, nil
}

// WireDeleteBusinessCoverPhoto binds Client.DeleteBusinessCoverPhoto.
func (a *Api) WireDeleteBusinessCoverPhoto(coverID string) error {
	if _, err := a.wireBusinessReady(); err != nil {
		return err
	}
	id, err := wireBusinessID("cover photo", coverID)
	if err != nil {
		return err
	}
	if err := a.waClient.DeleteBusinessCoverPhoto(a.wireCtx(), id); err != nil {
		return wireBusinessOpError("delete business cover photo")
	}
	return nil
}
