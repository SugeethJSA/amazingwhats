package wa

import (
	"testing"

	"github.com/lugvitc/amazingwhats/internal/types"
	"github.com/polymorfa/hypermeow"
	"github.com/polymorfa/hypermeow/proto/waE2E"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Compile-time contracts. Whatsmeow's DownloadableMessage is the four-method
// interface declared in download.go; MediaTypeable is the GetMediaType()
// interface used by whatsmeow.GetMediaType. Keeping these assertions here makes
// an upstream interface change fail at the exact contract boundary.
var (
	_ whatsmeow.DownloadableMessage = (*Media)(nil)
	_ whatsmeow.MediaTypeable       = (*Media)(nil)
	_ MediaContent                  = (*Media)(nil)
)

// extendedMediaContentStub adds the ContextInfo getter to Media so the
// ExtendedMediaContent contract can be exercised without a live protobuf
// message. Media itself intentionally does not implement that interface.
type extendedMediaContentStub struct {
	*Media
	contextInfo *waE2E.ContextInfo
}

func (s *extendedMediaContentStub) GetContextInfo() *waE2E.ContextInfo {
	return s.contextInfo
}

var (
	_ ExtendedMediaContent    = (*extendedMediaContentStub)(nil)
	_ whatsmeow.MediaTypeable = (*extendedMediaContentStub)(nil)
)

func TestNewMedia(t *testing.T) {
	t.Parallel()

	mediaKey := []byte{0x01, 0x02, 0x03}
	fileSHA256 := []byte{0x04, 0x05, 0x06}
	fileEncSHA256 := []byte{0x07, 0x08, 0x09}

	tests := []struct {
		name          string
		directPath    string
		mediaKey      []byte
		fileSHA256    []byte
		fileEncSHA256 []byte
		url           string
		mimetype      string
		width         int
		height        int
		mediaType     types.MediaType
		fileName      string
	}{
		{
			name:          "image with all metadata",
			directPath:    "/abc/def",
			mediaKey:      mediaKey,
			fileSHA256:    fileSHA256,
			fileEncSHA256: fileEncSHA256,
			url:           "https://example.invalid/abc",
			mimetype:      "image/jpeg",
			width:         1280,
			height:        720,
			mediaType:     types.MediaTypeImage,
			fileName:      "photo.jpg",
		},
		{
			name:      "nil hashes and empty strings",
			mediaType: types.MediaTypeDocument,
		},
		{
			name:       "audio with zero dimensions",
			directPath: "/audio",
			mimetype:   "audio/ogg; codecs=opus",
			mediaType:  types.MediaTypeAudio,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			is := assert.New(t)

			m := NewMedia(tt.directPath, tt.mediaKey, tt.fileSHA256, tt.fileEncSHA256,
				tt.url, tt.mimetype, tt.width, tt.height, tt.mediaType, tt.fileName)
			require.NotNil(t, m)

			is.Equal(tt.directPath, m.GetDirectPath())
			is.Equal(tt.mediaKey, m.GetMediaKey())
			is.Equal(tt.fileSHA256, m.GetFileSHA256())
			is.Equal(tt.fileEncSHA256, m.GetFileEncSHA256())
			is.Equal(tt.url, m.GetURL())
			is.Equal(tt.mimetype, m.GetMimetype())
			width, height := m.GetDimensions()
			is.Equal(tt.width, width)
			is.Equal(tt.height, height)
			is.Equal(tt.fileName, m.GetFileName())
			is.Equal(tt.mediaType, m.GetMediaGeneralType())
			is.Equal(int64(-1), m.GetFileLength(), "a freshly constructed Media has no known file length")
		})
	}
}

func TestMedia_GetMediaType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		mediaType types.MediaType
		want      whatsmeow.MediaType
	}{
		{"image", types.MediaTypeImage, whatsmeow.MediaImage},
		{"video", types.MediaTypeVideo, whatsmeow.MediaVideo},
		{"audio", types.MediaTypeAudio, whatsmeow.MediaAudio},
		{"document", types.MediaTypeDocument, whatsmeow.MediaDocument},
		{"sticker uses image keys", types.MediaTypeSticker, whatsmeow.MediaImage},
		{"sticker metadata uses image keys", types.MediaTypeStickerMetadata, whatsmeow.MediaImage},
		{"sticker pack", types.MediaTypeStickerPack, whatsmeow.MediaStickerPack},
		{"history sync", types.MediaTypeHistorySync, whatsmeow.MediaHistory},
		{"app state", types.MediaTypeAppState, whatsmeow.MediaAppState},
		{"none maps to zero value", types.MediaTypeNone, whatsmeow.MediaType("")},
		{"unmapped value maps to zero value", types.MediaType(99), whatsmeow.MediaType("")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			m := NewMedia("", nil, nil, nil, "", "", 0, 0, tt.mediaType, "")
			assert.Equal(t, tt.want, m.GetMediaType())
		})
	}
}

func TestMedia_GetMediaGeneralType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		mediaType types.MediaType
	}{
		{"none", types.MediaTypeNone},
		{"image", types.MediaTypeImage},
		{"sticker pack", types.MediaTypeStickerPack},
		{"app state", types.MediaTypeAppState},
		{"unmapped value is preserved", types.MediaType(200)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			m := NewMedia("", nil, nil, nil, "", "", 0, 0, tt.mediaType, "")
			assert.Equal(t, tt.mediaType, m.GetMediaGeneralType(),
				"the general type must round-trip independently of the whatsmeow mapping")
		})
	}
}

func TestMedia_Getters(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		directPath string
		mediaKey   []byte
		sha256     []byte
		encSHA256  []byte
		url        string
		mimetype   string
		width      int
		height     int
		fileName   string
	}{
		{
			name:       "all fields populated",
			directPath: "/path/to/media",
			mediaKey:   []byte{1},
			sha256:     []byte{2},
			encSHA256:  []byte{3},
			url:        "https://example.invalid/media",
			mimetype:   "video/mp4",
			width:      1920,
			height:     1080,
			fileName:   "clip.mp4",
		},
		{
			name:   "zero values",
			width:  -1,
			height: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			is := assert.New(t)

			m := NewMedia(tt.directPath, tt.mediaKey, tt.sha256, tt.encSHA256,
				tt.url, tt.mimetype, tt.width, tt.height, types.MediaTypeImage, tt.fileName)

			is.Equal(tt.directPath, m.GetDirectPath())
			is.Equal(tt.mediaKey, m.GetMediaKey())
			is.Equal(tt.sha256, m.GetFileSHA256())
			is.Equal(tt.encSHA256, m.GetFileEncSHA256())
			is.Equal(tt.url, m.GetURL())
			is.Equal(tt.mimetype, m.GetMimetype())
			width, height := m.GetDimensions()
			is.Equal(tt.width, width)
			is.Equal(tt.height, height)
			is.Equal(tt.fileName, m.GetFileName())
		})
	}
}

func TestMedia_ZeroValue(t *testing.T) {
	t.Parallel()

	m := &Media{}
	is := assert.New(t)

	is.Empty(m.GetDirectPath())
	is.Nil(m.GetMediaKey())
	is.Nil(m.GetFileSHA256())
	is.Nil(m.GetFileEncSHA256())
	is.Empty(m.GetURL())
	is.Empty(m.GetMimetype())
	width, height := m.GetDimensions()
	is.Zero(width)
	is.Zero(height)
	is.Empty(m.GetFileName())
	is.Equal(types.MediaTypeNone, m.GetMediaGeneralType())
	is.Equal(whatsmeow.MediaType(""), m.GetMediaType())
	is.Equal(int64(-1), m.GetFileLength())

	// The zero value still satisfies every interface the production code needs.
	var downloadable whatsmeow.DownloadableMessage = m
	var typeable whatsmeow.MediaTypeable = m
	var content MediaContent = m
	is.NotNil(downloadable)
	is.NotNil(typeable)
	is.NotNil(content)
}

func TestMedia_FileLength(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		sets []int64
		want int64
	}{
		{name: "never set reports unknown", want: -1},
		{name: "positive length", sets: []int64{1024}, want: 1024},
		{name: "single byte", sets: []int64{1}, want: 1},
		{name: "zero means unknown", sets: []int64{0}, want: -1},
		{name: "negative means unknown", sets: []int64{-5}, want: -1},
		{name: "reset to zero after a known length", sets: []int64{2048, 0}, want: -1},
		{name: "last set wins", sets: []int64{10, 20, 30}, want: 30},
		{name: "negative after a known length", sets: []int64{10, -1}, want: -1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			m := &Media{}
			for _, v := range tt.sets {
				m.SetFileLength(v)
			}
			assert.Equal(t, tt.want, m.GetFileLength())
		})
	}
}

func TestExtendedMediaContent(t *testing.T) {
	t.Parallel()

	info := &waE2E.ContextInfo{}
	stub := &extendedMediaContentStub{
		Media:       NewMedia("", nil, nil, nil, "", "", 0, 0, types.MediaTypeImage, ""),
		contextInfo: info,
	}

	var ext ExtendedMediaContent = stub
	assert.Same(t, info, ext.GetContextInfo())
	assert.Equal(t, "", ext.GetURL())
	// ExtendedMediaContent only declares the DownloadableMessage methods plus
	// GetURL/GetMimetype/GetContextInfo; media type is resolved by whatsmeow
	// through the separate MediaTypeable interface (GetMediaType).
	assert.Equal(t, whatsmeow.MediaImage, whatsmeow.GetMediaType(ext),
		"the extended content must still resolve its media type via whatsmeow's MediaTypeable path")
}
