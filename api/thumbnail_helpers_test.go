package api

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"testing"
)

// thumbnail_test.go already exists, so the pure-helper tests for thumbnail.go
// live in this source-derived split file rather than modifying that file.

func TestIsUnavailableThumbnail(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want bool
	}{
		{"nil", nil, false},
		{"empty", []byte{}, false},
		{"sentinel", []byte{0}, true},
		{"two zero bytes", []byte{0, 0}, false},
		{"single one byte", []byte{1}, false},
		{"real jpeg prefix", []byte{0xFF, 0xD8}, false},
		{"sentinel with trailing byte", []byte{0, 0xFF}, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isUnavailableThumbnail(tt.data); got != tt.want {
				t.Fatalf("isUnavailableThumbnail(%v) = %v, want %v", tt.data, got, tt.want)
			}
		})
	}
}

func TestThumbnailConstants(t *testing.T) {
	t.Parallel()

	if thumbnailMaxDim != 320 {
		t.Errorf("thumbnailMaxDim = %d, want 320", thumbnailMaxDim)
	}
	if thumbnailMaxSourceBytes != 8<<20 {
		t.Errorf("thumbnailMaxSourceBytes = %d, want %d (8 MiB)", thumbnailMaxSourceBytes, 8<<20)
	}
	if thumbnailMaxPixels != 4096*4096 {
		t.Errorf("thumbnailMaxPixels = %d, want %d", thumbnailMaxPixels, 4096*4096)
	}
	if thumbnailJPEGQuality != 60 {
		t.Errorf("thumbnailJPEGQuality = %d, want 60", thumbnailJPEGQuality)
	}
	if len(thumbnailUnavailable) != 1 || thumbnailUnavailable[0] != 0 {
		t.Errorf("thumbnailUnavailable = %v, want a single zero byte", thumbnailUnavailable)
	}
	if !isUnavailableThumbnail(thumbnailUnavailable) {
		t.Error("thumbnailUnavailable sentinel is not recognised by isUnavailableThumbnail")
	}
}

// pureTestTIFF builds a minimal TIFF header with exactly one IFD0 entry so the
// orientation parser can be exercised without any image decoding.
func pureTestTIFF(orientation int, bigEndian bool, fieldType, tag uint16, count uint32) []byte {
	var order binary.ByteOrder = binary.LittleEndian
	marker := "II"
	if bigEndian {
		order = binary.BigEndian
		marker = "MM"
	}

	var buf bytes.Buffer
	buf.WriteString(marker)
	write16 := func(v uint16) {
		var b [2]byte
		order.PutUint16(b[:], v)
		buf.Write(b[:])
	}
	write32 := func(v uint32) {
		var b [4]byte
		order.PutUint32(b[:], v)
		buf.Write(b[:])
	}

	write16(0x2A) // TIFF magic
	write32(8)    // IFD0 offset
	write16(1)    // entry count
	write16(tag)
	write16(fieldType)
	write32(count)
	if fieldType == 4 {
		write32(uint32(orientation))
	} else {
		write16(uint16(orientation))
		write16(0) // padding for a SHORT value
	}
	write32(0) // no next IFD
	return buf.Bytes()
}

func TestTIFFOrientation(t *testing.T) {
	badIfd := pureTestTIFF(6, true, 3, 0x0112, 1)
	badIfd[4], badIfd[5], badIfd[6], badIfd[7] = 0xFF, 0xFF, 0xFF, 0xFF
	noEntries := pureTestTIFF(6, true, 3, 0x0112, 1)
	noEntries[8], noEntries[9] = 0x00, 0x00

	tests := []struct {
		name string
		tiff []byte
		want int
	}{
		{"too short", []byte{0x4D, 0x4D}, 0},
		{"unknown byte order", []byte{'Z', 'Z', 0, 0x2A, 0, 0, 0, 8, 0, 1}, 0},
		{"big endian short", pureTestTIFF(6, true, 3, 0x0112, 1), 6},
		{"little endian short", pureTestTIFF(8, false, 3, 0x0112, 1), 8},
		{"big endian long", pureTestTIFF(3, true, 4, 0x0112, 1), 3},
		{"little endian long", pureTestTIFF(2, false, 4, 0x0112, 1), 2},
		{"zero is invalid", pureTestTIFF(0, true, 3, 0x0112, 1), 0},
		{"nine is invalid", pureTestTIFF(9, true, 3, 0x0112, 1), 0},
		{"wrong tag", pureTestTIFF(6, true, 3, 0x0100, 1), 0},
		{"zero count", pureTestTIFF(6, true, 3, 0x0112, 0), 0},
		{"ifd offset out of range", badIfd, 0},
		{"no entries", noEntries, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := tiffOrientation(tt.tiff); got != tt.want {
				t.Fatalf("tiffOrientation(%v) = %d, want %d", tt.tiff, got, tt.want)
			}
		})
	}
}

func pureTestJPEG(t *testing.T, tiff []byte, withExif bool) []byte {
	t.Helper()

	payload := tiff
	if withExif {
		payload = append([]byte("Exif\x00\x00"), tiff...)
	}
	out := []byte{0xFF, 0xD8, 0xFF, 0xE1}
	var seglen [2]byte
	binary.BigEndian.PutUint16(seglen[:], uint16(2+len(payload)))
	out = append(out, seglen[:]...)
	out = append(out, payload...)
	return append(out, 0xFF, 0xD9)
}

func TestJPEGOrientation(t *testing.T) {
	shortPayload := pureTestJPEG(t, []byte{0x4D}, true)

	tests := []struct {
		name string
		data []byte
		want int
	}{
		{"nil", nil, 1},
		{"too short", []byte{0xFF}, 1},
		{"no SOI marker", []byte("not an image at all"), 1},
		{"invalid marker after SOI", []byte{0xFF, 0xD8, 0x00, 0x01}, 1},
		{"start of scan before APP1", []byte{0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02}, 1},
		{"truncated segment length", []byte{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x01}, 1},
		{"APP1 without Exif", pureTestJPEG(t, pureTestTIFF(6, true, 3, 0x0112, 1), false), 1},
		{"APP1 with Exif orientation 6", pureTestJPEG(t, pureTestTIFF(6, true, 3, 0x0112, 1), true), 6},
		{"APP1 with Exif orientation 1", pureTestJPEG(t, pureTestTIFF(1, true, 3, 0x0112, 1), true), 1},
		{"APP1 with invalid TIFF orientation", pureTestJPEG(t, pureTestTIFF(9, true, 3, 0x0112, 1), true), 1},
		{"APP1 with truncated TIFF", shortPayload, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := jpegOrientation(tt.data); got != tt.want {
				t.Fatalf("jpegOrientation(%v) = %d, want %d", tt.data, got, tt.want)
			}
		})
	}
}

func pureTestSourceImage() *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, 2, 3))
	for y := 0; y < 3; y++ {
		for x := 0; x < 2; x++ {
			img.Set(x, y, color.RGBA{R: uint8(10 + x), G: uint8(20 + y), B: uint8(30 + 2*y), A: 255})
		}
	}
	return img
}

func pureExpectedPixel(x, y int) [4]uint8 {
	return [4]uint8{uint8(10 + x), uint8(20 + y), uint8(30 + 2*y), 255}
}

func purePixelAt(img image.Image, x, y int) [4]uint8 {
	r, g, b, a := img.At(x, y).RGBA()
	return [4]uint8{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)}
}

func TestApplyOrientation(t *testing.T) {
	type sample struct {
		dx, dy int
		sx, sy int
	}

	tests := []struct {
		name        string
		orientation int
		wantW       int
		wantH       int
		points      []sample
	}{
		{"orientation 0 is identity", 0, 2, 3, []sample{{0, 0, 0, 0}, {1, 2, 1, 2}}},
		{"orientation 1 is identity", 1, 2, 3, []sample{{0, 0, 0, 0}, {1, 2, 1, 2}}},
		{"orientation 9 is identity", 9, 2, 3, []sample{{0, 0, 0, 0}, {1, 2, 1, 2}}},
		{"orientation 2 mirrors horizontally", 2, 2, 3, []sample{{0, 0, 1, 0}, {1, 2, 0, 2}}},
		{"orientation 3 rotates 180", 3, 2, 3, []sample{{0, 0, 1, 2}, {1, 2, 0, 0}}},
		{"orientation 4 mirrors vertically", 4, 2, 3, []sample{{0, 0, 0, 2}, {1, 2, 1, 0}}},
		{"orientation 5 transposes", 5, 3, 2, []sample{{0, 0, 0, 0}, {2, 1, 1, 2}}},
		{"orientation 6 rotates 90 clockwise", 6, 3, 2, []sample{{0, 0, 0, 2}, {2, 1, 1, 0}}},
		{"orientation 7 transverses", 7, 3, 2, []sample{{0, 0, 1, 2}, {2, 1, 0, 0}}},
		{"orientation 8 rotates 270 clockwise", 8, 3, 2, []sample{{0, 0, 1, 0}, {2, 1, 0, 2}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := applyOrientation(pureTestSourceImage(), tt.orientation)
			b := got.Bounds()
			if b.Min.X != 0 || b.Min.Y != 0 || b.Dx() != tt.wantW || b.Dy() != tt.wantH {
				t.Fatalf("bounds = %v, want 0,0 to %d,%d", b, tt.wantW, tt.wantH)
			}
			for _, p := range tt.points {
				want := pureExpectedPixel(p.sx, p.sy)
				if pixel := purePixelAt(got, p.dx, p.dy); pixel != want {
					t.Errorf("pixel at (%d,%d) = %v, want %v (source %d,%d)", p.dx, p.dy, pixel, want, p.sx, p.sy)
				}
			}
		})
	}
}
