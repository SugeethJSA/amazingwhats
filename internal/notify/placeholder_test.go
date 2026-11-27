package notify

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

// Expected indices are computed from the TS algorithm in utils.ts:
// SHA-1(UTF-8 jid) first four bytes big-endian % 16 (AVATAR_COLORS_LIGHT len),
// with an empty jid short-circuiting to index 0.
func TestAvatarColorIndexMatchesTSAlgorithm(t *testing.T) {
	for _, tc := range []struct {
		jid  string
		want uint32
	}{
		{"", 0},
		{"1234567890@s.whatsapp.net", 10},
		{"120363012345678901@g.us", 12},
		{"hello@example.com", 1},
		{"5544999888888@s.whatsapp.net", 3},
		{"123@g.us", 14},
	} {
		if got := avatarColorIndex(tc.jid); got != tc.want {
			t.Errorf("avatarColorIndex(%q) = %d, want %d", tc.jid, got, tc.want)
		}
	}
}

func TestChatFallbackAvatarBackgroundColor(t *testing.T) {
	for _, tc := range []struct {
		jid     string
		isGroup bool
		want    color.RGBA
	}{
		{"1234567890@s.whatsapp.net", false, color.RGBA{R: 0xE8, G: 0xC8, B: 0xA0, A: 0xff}},    // #E8C8A0
		{"120363012345678901@g.us", true, color.RGBA{R: 0xD8, G: 0xB8, B: 0xE0, A: 0xff}},       // #D8B8E0
		{"hello@example.com", false, color.RGBA{R: 0xA8, G: 0xE0, B: 0xB8, A: 0xff}},            // #A8E0B8
		{"5544999888888@s.whatsapp.net", false, color.RGBA{R: 0xF0, G: 0xB4, B: 0xB4, A: 0xff}}, // #F0B4B4
		{"123@g.us", true, color.RGBA{R: 0xE8, G: 0xD0, B: 0xB8, A: 0xff}},                      // #E8D0B8
		{"", false, color.RGBA{R: 0xE5, G: 0xCD, B: 0xB0, A: 0xff}},                             // #E5CDB0
	} {
		img := decodeAvatar(t, ChatFallbackAvatar(tc.jid, tc.isGroup))
		got := color.RGBAModel.Convert(img.At(2, 2)).(color.RGBA)
		if got != tc.want {
			t.Errorf("background for %q group=%v = %v, want %v", tc.jid, tc.isGroup, got, tc.want)
		}
	}
}

func TestChatFallbackAvatarIconsDifferAndDecode(t *testing.T) {
	personPNG := ChatFallbackAvatar("1234567890@s.whatsapp.net", false)
	groupPNG := ChatFallbackAvatar("1234567890@s.whatsapp.net", true)
	if bytes.Equal(personPNG, groupPNG) {
		t.Fatal("person and group fallback avatars must render different PNGs")
	}

	person := decodeAvatar(t, personPNG)
	group := decodeAvatar(t, groupPNG)

	// Same JID => same pastel background in both variants.
	if got, want := color.RGBAModel.Convert(person.At(2, 2)), color.RGBAModel.Convert(group.At(2, 2)); got != want {
		t.Fatalf("group/person background mismatch: %v vs %v", got, want)
	}

	// Contact silhouette head sits at the centre of the 48-unit viewBox;
	// the group icon leaves that point empty between its two heads.
	centre := image.Pt(48, 40)
	if got := color.RGBAModel.Convert(person.At(centre.X, centre.Y)).(color.RGBA); got != avatarIconColor {
		t.Errorf("person centre pixel = %v, want icon colour %v", got, avatarIconColor)
	}
	if got := color.RGBAModel.Convert(group.At(centre.X, centre.Y)).(color.RGBA); got != color.RGBAModel.Convert(person.At(2, 2)).(color.RGBA) {
		t.Errorf("group centre pixel = %v, want background", got)
	}
	if got := color.RGBAModel.Convert(group.At(57, 39)).(color.RGBA); got != avatarIconColor {
		t.Errorf("group head pixel = %v, want icon colour %v", got, avatarIconColor)
	}
}

func TestChatFallbackAvatarDeterministicAndEmptySeed(t *testing.T) {
	jid := "1234567890@s.whatsapp.net"
	a := ChatFallbackAvatar(jid, false)
	b := ChatFallbackAvatar(jid, false)
	if !bytes.Equal(a, b) {
		t.Fatal("same JID must produce identical PNG bytes")
	}

	emptyA := ChatFallbackAvatar("", false)
	emptyB := ChatFallbackAvatar("", false)
	if !bytes.Equal(emptyA, emptyB) {
		t.Fatal("empty seed must be stable")
	}
	if !bytes.Equal(PlaceholderAvatar(false), emptyA) {
		t.Fatal("PlaceholderAvatar(false) must delegate to the empty seed")
	}
	if !bytes.Equal(PlaceholderAvatar(true), ChatFallbackAvatar("", true)) {
		t.Fatal("PlaceholderAvatar(true) must delegate to the empty seed")
	}
	if bytes.Equal(emptyA, a) {
		t.Fatal("different seeds must produce different avatars")
	}
}

func decodeAvatar(t *testing.T, data []byte) image.Image {
	t.Helper()
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("PNG decode failed: %v", err)
	}
	if img.Bounds() != image.Rect(0, 0, 96, 96) {
		t.Fatalf("unexpected PNG bounds: %v", img.Bounds())
	}
	return img
}
