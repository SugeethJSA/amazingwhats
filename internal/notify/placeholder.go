package notify

import (
	"bytes"
	"crypto/sha1"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"sort"
	"strconv"
)

// ChatFallbackAvatar renders the exact same default avatar the chat-list pane
// uses when a chat has no photo: a pastel background chosen by hashing the
// chat's JID and a dark person/group silhouette. It is only used as a
// notification fallback when neither a real avatar nor a thumbnail exists.
func ChatFallbackAvatar(jid string, isGroup bool) []byte {
	const size = 96

	img := image.NewRGBA(image.Rect(0, 0, size, size))
	fillBackground(img, avatarColor(jid))

	if isGroup {
		// ChatScreen PeopleIcon: viewBox 0 0 24 24, rendered at 26px in a
		// 48px chat avatar (52px when scaled to the 96px notification PNG).
		rasterizeIcon(img, groupAvatarPath, 24, 52)
	} else {
		// ChatScreen contact silhouette: viewBox 0 0 48 48, rendered with
		// p-1.5 (6px of a 48px avatar = 12px at 96px) padding.
		rasterizeIcon(img, personAvatarPath, 48, 72)
	}

	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		return nil
	}
	return out.Bytes()
}

// PlaceholderAvatar keeps the old no-seed behaviour for compatibility. New
// callers should use ChatFallbackAvatar with the real chat/sender JID so the
// colour matches the chat list.
func PlaceholderAvatar(isGroup bool) []byte {
	return ChatFallbackAvatar("", isGroup)
}

// avatarColor mirrors frontend/src/lib/utils.ts getAvatarColor(jid, false):
// SHA-1 of the JID bytes, first four bytes big-endian as uint32, modulo the
// light palette length. An empty seed uses index 0, matching colorIndex().
// The TS sha1Bytes uses charCodeAt(i)&0xff (UTF-16 code unit truncated to a
// byte); this is byte-identical to the UTF-8 encoding below for every real
// WhatsApp JID, which is ASCII. Non-ASCII seeds could diverge, but they never
// occur here (JIDs are digits plus @s.whatsapp.net / @g.us / @lid).
func avatarColor(jid string) color.RGBA {
	return avatarColorsLight[avatarColorIndex(jid)]
}

func avatarColorIndex(jid string) uint32 {
	if jid == "" {
		return 0
	}
	sum := sha1.Sum([]byte(jid))
	return binary.BigEndian.Uint32(sum[:4]) % uint32(len(avatarColorsLight))
}

// avatarColorsLight is AVATAR_COLORS_LIGHT from frontend/src/lib/utils.ts.
// Notifications are light-themed toasts, so the dark palette is not used.
var avatarColorsLight = [...]color.RGBA{
	{R: 0xE5, G: 0xCD, B: 0xB0, A: 0xff}, // #E5CDB0 beige / tan
	{R: 0xA8, G: 0xE0, B: 0xB8, A: 0xff}, // #A8E0B8 mint green
	{R: 0x7E, G: 0xC4, B: 0xE8, A: 0xff}, // #7EC4E8 sky blue
	{R: 0xF0, G: 0xB4, B: 0xB4, A: 0xff}, // #F0B4B4 soft coral
	{R: 0xC9, G: 0xB8, B: 0xE8, A: 0xff}, // #C9B8E8 soft lavender
	{R: 0xF5, G: 0xD0, B: 0x8A, A: 0xff}, // #F5D08A soft gold
	{R: 0x9D, G: 0xD9, B: 0xD0, A: 0xff}, // #9DD9D0 soft teal
	{R: 0xE8, G: 0xB8, B: 0xD0, A: 0xff}, // #E8B8D0 soft pink
	{R: 0xB8, G: 0xD4, B: 0xA8, A: 0xff}, // #B8D4A8 soft sage
	{R: 0xA8, G: 0xC8, B: 0xE8, A: 0xff}, // #A8C8E8 soft periwinkle
	{R: 0xE8, G: 0xC8, B: 0xA0, A: 0xff}, // #E8C8A0 warm sand
	{R: 0xD0, G: 0xE8, B: 0xA8, A: 0xff}, // #D0E8A8 lime mist
	{R: 0xD8, G: 0xB8, B: 0xE0, A: 0xff}, // #D8B8E0 soft orchid
	{R: 0xA8, G: 0xD8, B: 0xE8, A: 0xff}, // #A8D8E8 powder blue
	{R: 0xE8, G: 0xD0, B: 0xB8, A: 0xff}, // #E8D0B8 peach sand
	{R: 0xB8, G: 0xE0, B: 0xD0, A: 0xff}, // #B8E0D0 seafoam
}

// AVATAR_ICON_COLOR from ChatScreen.tsx.
var avatarIconColor = color.RGBA{R: 0x11, G: 0x1b, B: 0x21, A: 0xff}

// Exact path data from frontend/src/screens/ChatScreen.tsx (MemoizedChatAvatar).
const (
	groupAvatarPath  = "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
	personAvatarPath = "M24 23q-1.857 0-3.178-1.322Q19.5 20.357 19.5 18.5t1.322-3.178T24 14t3.178 1.322Q28.5 16.643 28.5 18.5t-1.322 3.178T24 23m-6.75 10q-.928 0-1.59-.66-.66-.662-.66-1.59v-.9q0-.956.492-1.758A3.3 3.3 0 0 1 16.8 26.87a16.7 16.7 0 0 1 3.544-1.308q1.8-.435 3.656-.436 1.856 0 3.656.436T31.2 26.87q.816.422 1.308 1.223T33 29.85v.9q0 .928-.66 1.59-.662.66-1.59.66z"
)

func fillBackground(img *image.RGBA, c color.RGBA) {
	for y := 0; y < img.Bounds().Dy(); y++ {
		for x := 0; x < img.Bounds().Dx(); x++ {
			img.Set(x, y, c)
		}
	}
}

func rasterizeIcon(img *image.RGBA, path string, viewBox, iconSize float64) {
	subpaths := (&avatarIconPath{s: path}).parse()
	scale := iconSize / viewBox
	offset := (float64(img.Bounds().Dx()) - iconSize) / 2
	for _, pts := range subpaths {
		scaled := make([]point, len(pts))
		for i, p := range pts {
			scaled[i] = point{x: p.x*scale + offset, y: p.y*scale + offset}
		}
		fillPolygon(img, scaled, avatarIconColor)
	}
}

type point struct{ x, y float64 }

// avatarIconPath is a minimal SVG path parser supporting exactly the commands used
// by the two chat-list silhouettes (M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t,
// A/a, Z/z, including implicit repeated commands). Curves and arcs are
// flattened to line segments and then filled with a scanline pass.
type avatarIconPath struct {
	s        string
	i        int
	cmd      byte
	cx, cy   float64
	sx, sy   float64
	lastC    point
	lastQ    point
	haveC    bool
	haveQ    bool
	subpaths [][]point
}

func (p *avatarIconPath) parse() [][]point {
	for {
		p.skipSpace()
		if p.i >= len(p.s) {
			break
		}
		c := p.s[p.i]
		if isLetter(c) {
			p.cmd = c
			p.i++
		} else if p.cmd == 0 {
			break
		}
		upper := p.cmd
		if upper >= 'a' && upper <= 'z' {
			upper -= 'a' - 'A'
		}
		rel := p.cmd != upper

		switch upper {
		case 'M':
			x, ok1 := p.number()
			y, ok2 := p.number()
			if !ok1 || !ok2 {
				return p.subpaths
			}
			if rel {
				x, y = x+p.cx, y+p.cy
			}
			p.moveTo(x, y)
			for {
				x1, o1 := p.number()
				y1, o2 := p.number()
				if !o1 || !o2 {
					break
				}
				if rel {
					x1, y1 = x1+p.cx, y1+p.cy
				}
				p.lineTo(x1, y1)
			}
			if rel {
				p.cmd = 'l'
			} else {
				p.cmd = 'L'
			}
		case 'L':
			for {
				x, o1 := p.number()
				y, o2 := p.number()
				if !o1 || !o2 {
					break
				}
				if rel {
					x, y = x+p.cx, y+p.cy
				}
				p.lineTo(x, y)
			}
		case 'H':
			for {
				x, ok := p.number()
				if !ok {
					break
				}
				if rel {
					x += p.cx
				}
				p.lineTo(x, p.cy)
			}
		case 'V':
			for {
				y, ok := p.number()
				if !ok {
					break
				}
				if rel {
					y += p.cy
				}
				p.lineTo(p.cx, y)
			}
		case 'C':
			for {
				x1, o1 := p.number()
				y1, o2 := p.number()
				x2, o3 := p.number()
				y2, o4 := p.number()
				x, o5 := p.number()
				y, o6 := p.number()
				if !(o1 && o2 && o3 && o4 && o5 && o6) {
					break
				}
				if rel {
					x1, y1 = x1+p.cx, y1+p.cy
					x2, y2 = x2+p.cx, y2+p.cy
					x, y = x+p.cx, y+p.cy
				}
				p.cubicTo(point{x1, y1}, point{x2, y2}, point{x, y})
			}
		case 'S':
			for {
				x2, o1 := p.number()
				y2, o2 := p.number()
				x, o3 := p.number()
				y, o4 := p.number()
				if !(o1 && o2 && o3 && o4) {
					break
				}
				if rel {
					x2, y2 = x2+p.cx, y2+p.cy
					x, y = x+p.cx, y+p.cy
				}
				c1 := point{p.cx, p.cy}
				if p.haveC {
					c1 = point{2*p.cx - p.lastC.x, 2*p.cy - p.lastC.y}
				}
				p.cubicTo(c1, point{x2, y2}, point{x, y})
			}
		case 'Q':
			for {
				x1, o1 := p.number()
				y1, o2 := p.number()
				x, o3 := p.number()
				y, o4 := p.number()
				if !(o1 && o2 && o3 && o4) {
					break
				}
				if rel {
					x1, y1 = x1+p.cx, y1+p.cy
					x, y = x+p.cx, y+p.cy
				}
				p.quadTo(point{x1, y1}, point{x, y})
			}
		case 'T':
			for {
				x, o1 := p.number()
				y, o2 := p.number()
				if !o1 || !o2 {
					break
				}
				if rel {
					x, y = x+p.cx, y+p.cy
				}
				c1 := point{p.cx, p.cy}
				if p.haveQ {
					c1 = point{2*p.cx - p.lastQ.x, 2*p.cy - p.lastQ.y}
				}
				p.quadTo(c1, point{x, y})
			}
		case 'A':
			for {
				rx, o1 := p.number()
				ry, o2 := p.number()
				rot, o3 := p.number()
				large, o4 := p.number()
				sweep, o5 := p.number()
				x, o6 := p.number()
				y, o7 := p.number()
				if !(o1 && o2 && o3 && o4 && o5 && o6 && o7) {
					break
				}
				if rel {
					x, y = x+p.cx, y+p.cy
				}
				p.arcTo(rx, ry, rot, large != 0, sweep != 0, point{x, y})
			}
		case 'Z':
			p.closePath()
			p.cmd = 0
		default:
			// Unsupported command: stop parsing rather than reinterpreting the
			// following numbers as an implicit repeat and looping forever.
			p.cmd = 0
		}
	}
	return p.subpaths
}

func isLetter(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func (p *avatarIconPath) skipSpace() {
	for p.i < len(p.s) {
		switch p.s[p.i] {
		case ' ', '\t', '\n', '\r', ',':
			p.i++
		default:
			return
		}
	}
}

// number parses one SVG number, handling signs, leading dots and adjacent
// numbers such as "1.16.84" (two values: 1.16 and 0.84).
func (p *avatarIconPath) number() (float64, bool) {
	p.skipSpace()
	start := p.i
	if p.i < len(p.s) && (p.s[p.i] == '+' || p.s[p.i] == '-') {
		p.i++
	}
	dot, digits := false, 0
	for p.i < len(p.s) {
		c := p.s[p.i]
		if c >= '0' && c <= '9' {
			digits++
			p.i++
			continue
		}
		if c == '.' && !dot {
			dot = true
			p.i++
			continue
		}
		break
	}
	if digits == 0 {
		p.i = start
		return 0, false
	}
	v, err := strconv.ParseFloat(p.s[start:p.i], 64)
	if err != nil {
		p.i = start
		return 0, false
	}
	return v, true
}

func (p *avatarIconPath) moveTo(x, y float64) {
	p.subpaths = append(p.subpaths, []point{{x, y}})
	p.cx, p.cy = x, y
	p.sx, p.sy = x, y
	p.haveC, p.haveQ = false, false
}

func (p *avatarIconPath) appendPoint(pt point) {
	if len(p.subpaths) == 0 {
		p.moveTo(pt.x, pt.y)
		return
	}
	n := len(p.subpaths) - 1
	p.subpaths[n] = append(p.subpaths[n], pt)
}

func (p *avatarIconPath) lineTo(x, y float64) {
	p.appendPoint(point{x, y})
	p.cx, p.cy = x, y
	p.haveC, p.haveQ = false, false
}

func (p *avatarIconPath) closePath() {
	if n := len(p.subpaths); n > 0 && len(p.subpaths[n-1]) > 0 {
		sub := p.subpaths[n-1]
		first := sub[0]
		last := sub[len(sub)-1]
		if last != first {
			p.subpaths[n-1] = append(sub, first)
		}
	}
	p.cx, p.cy = p.sx, p.sy
	p.haveC, p.haveQ = false, false
}

func (p *avatarIconPath) cubicTo(c1, c2, end point) {
	p0 := point{p.cx, p.cy}
	const steps = 24
	for i := 1; i <= steps; i++ {
		t := float64(i) / steps
		u := 1 - t
		p.appendPoint(point{
			x: u*u*u*p0.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*end.x,
			y: u*u*u*p0.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*end.y,
		})
	}
	p.cx, p.cy = end.x, end.y
	p.lastC, p.haveC = c2, true
	p.haveQ = false
}

func (p *avatarIconPath) quadTo(c1, end point) {
	p0 := point{p.cx, p.cy}
	const steps = 20
	for i := 1; i <= steps; i++ {
		t := float64(i) / steps
		u := 1 - t
		p.appendPoint(point{
			x: u*u*p0.x + 2*u*t*c1.x + t*t*end.x,
			y: u*u*p0.y + 2*u*t*c1.y + t*t*end.y,
		})
	}
	p.cx, p.cy = end.x, end.y
	p.lastQ, p.haveQ = c1, true
	p.haveC = false
}

// arcTo implements the SVG endpoint-to-centre arc conversion and samples the
// resulting ellipse into line segments (the contact silhouette uses two arcs).
func (p *avatarIconPath) arcTo(rx, ry, rot float64, large, sweep bool, end point) {
	x1, y1 := p.cx, p.cy
	x2, y2 := end.x, end.y
	if rx == 0 || ry == 0 || (x1 == x2 && y1 == y2) {
		p.lineTo(x2, y2)
		return
	}
	phi := rot * math.Pi / 180
	cosPhi, sinPhi := math.Cos(phi), math.Sin(phi)
	dx, dy := (x1-x2)/2, (y1-y2)/2
	x1p := cosPhi*dx + sinPhi*dy
	y1p := -sinPhi*dx + cosPhi*dy

	rx, ry = math.Abs(rx), math.Abs(ry)
	if lambda := x1p*x1p/(rx*rx) + y1p*y1p/(ry*ry); lambda > 1 {
		s := math.Sqrt(lambda)
		rx, ry = rx*s, ry*s
	}
	num := rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p
	den := rx*rx*y1p*y1p + ry*ry*x1p*x1p
	coef := 0.0
	if den > 0 {
		coef = math.Sqrt(math.Max(0, num/den))
	}
	if large == sweep {
		coef = -coef
	}
	cxp := coef * rx * y1p / ry
	cyp := -coef * ry * x1p / rx
	cx := cosPhi*cxp - sinPhi*cyp + (x1+x2)/2
	cy := sinPhi*cxp + cosPhi*cyp + (y1+y2)/2

	ux, uy := (x1p-cxp)/rx, (y1p-cyp)/ry
	vx, vy := (-x1p-cxp)/rx, (-y1p-cyp)/ry
	theta1 := math.Atan2(uy, ux)
	delta := math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy)
	if !sweep && delta > 0 {
		delta -= 2 * math.Pi
	}
	if sweep && delta < 0 {
		delta += 2 * math.Pi
	}
	const steps = 24
	for i := 1; i <= steps; i++ {
		theta := theta1 + delta*float64(i)/steps
		ct, st := math.Cos(theta), math.Sin(theta)
		p.appendPoint(point{
			x: cosPhi*rx*ct - sinPhi*ry*st + cx,
			y: sinPhi*rx*ct + cosPhi*ry*st + cy,
		})
	}
	p.cx, p.cy = x2, y2
	p.haveC, p.haveQ = false, false
}

// fillPolygon fills one closed subpath with an even-odd scanline rule. Each
// icon subpath is filled independently so overlapping parts (e.g. the two
// group bodies) form a union rather than a hole.
func fillPolygon(img *image.RGBA, pts []point, c color.RGBA) {
	if len(pts) < 3 {
		return
	}
	minY, maxY := pts[0].y, pts[0].y
	for _, pt := range pts[1:] {
		if pt.y < minY {
			minY = pt.y
		}
		if pt.y > maxY {
			maxY = pt.y
		}
	}
	bounds := img.Bounds()
	for py := int(math.Floor(minY)); py <= int(math.Ceil(maxY)); py++ {
		if py < bounds.Min.Y || py >= bounds.Max.Y {
			continue
		}
		sampleY := float64(py) + 0.5
		crossings := make([]float64, 0, len(pts))
		for i := range pts {
			a, b := pts[i], pts[(i+1)%len(pts)]
			if (a.y <= sampleY && b.y > sampleY) || (b.y <= sampleY && a.y > sampleY) {
				crossings = append(crossings, a.x+(sampleY-a.y)*(b.x-a.x)/(b.y-a.y))
			}
		}
		if len(crossings) < 2 {
			continue
		}
		sort.Float64s(crossings)
		for i := 0; i+1 < len(crossings); i += 2 {
			start := int(math.Ceil(crossings[i] - 0.5))
			end := int(math.Ceil(crossings[i+1] - 0.5))
			for px := start; px < end; px++ {
				if px >= bounds.Min.X && px < bounds.Max.X {
					img.Set(px, py, c)
				}
			}
		}
	}
}
