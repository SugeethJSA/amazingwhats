package notify

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
)

// PlaceholderAvatar returns a simple PNG silhouette matching the blank person
// / blank group avatars shown in the chat list. It is used only when a chat has
// no real avatar, so notifications still carry chat identity rather than the
// application icon.
func PlaceholderAvatar(isGroup bool) []byte {
	const size = 96
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	background := color.RGBA{R: 0x2a, G: 0x39, B: 0x42, A: 0xff}
	foreground := color.RGBA{R: 0xd9, G: 0xe2, B: 0xe6, A: 0xff}
	drawRect(img, 0, 0, size, size, background)

	if isGroup {
		fillCircle(img, 30, 40, 12, foreground)
		fillCircle(img, 66, 40, 12, foreground)
		fillCircle(img, 48, 34, 13, foreground)
		fillEllipse(img, 30, 80, 18, 14, foreground)
		fillEllipse(img, 66, 80, 18, 14, foreground)
		fillEllipse(img, 48, 76, 20, 16, foreground)
	} else {
		fillCircle(img, 48, 36, 18, foreground)
		fillEllipse(img, 48, 82, 28, 24, foreground)
	}

	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		return nil
	}
	return out.Bytes()
}

func drawRect(img *image.RGBA, x, y, w, h int, c color.RGBA) {
	for py := y; py < y+h; py++ {
		for px := x; px < x+w; px++ {
			img.Set(px, py, c)
		}
	}
}

func fillCircle(img *image.RGBA, cx, cy, radius int, c color.RGBA) {
	for y := cy - radius; y <= cy+radius; y++ {
		for x := cx - radius; x <= cx+radius; x++ {
			dx, dy := x-cx, y-cy
			if dx*dx+dy*dy <= radius*radius {
				img.Set(x, y, c)
			}
		}
	}
}

func fillEllipse(img *image.RGBA, cx, cy, rx, ry int, c color.RGBA) {
	for y := cy - ry; y <= cy+ry; y++ {
		for x := cx - rx; x <= cx+rx; x++ {
			dx := float64(x-cx) / float64(rx)
			dy := float64(y-cy) / float64(ry)
			if dx*dx+dy*dy <= 1 {
				img.Set(x, y, c)
			}
		}
	}
}
