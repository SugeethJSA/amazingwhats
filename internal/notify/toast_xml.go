package notify

import "strings"

// go-toast v1.1.2 renders its toast XML with text/template, which copies every
// field verbatim into the template. Title and Body are wrapped in CDATA; every
// other dynamic value is placed inside a double-quoted XML attribute. Windows'
// XmlDocument.LoadXml rejects unescaped metacharacters in attributes (the real
// failure was 0xC00CE50D, XML_E_BADCHARINATTRIBUTE, caused by the "&"
// separators produced by url.Values.Encode in the launch/arguments fields).
//
// These helpers make caller-supplied values safe for the two contexts the
// template actually uses before they are handed to go-toast.

var xmlAttributeEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&quot;",
	"'", "&apos;",
)

// xmlAttribute escapes s for use inside a double-quoted XML attribute. After
// Windows parses the document, the attribute value is decoded back to the
// original string, so activation arguments still round-trip exactly.
func xmlAttribute(s string) string {
	return xmlAttributeEscaper.Replace(xmlValidText(s))
}

// xmlCDATA makes s safe to place between <![CDATA[ ... ]]>. The only sequence
// that can terminate a CDATA section early is "]]>"; splitting it into two
// adjacent sections preserves the exact text after parsing.
func xmlCDATA(s string) string {
	return strings.ReplaceAll(xmlValidText(s), "]]>", "]]]]><![CDATA[>")
}

// isXMLAttributeSafe reports whether s can be written into an attribute
// unchanged. It is used for filesystem paths, which must not be escaped in
// place because go-toast also writes the Icon field to the registry.
func isXMLAttributeSafe(s string) bool {
	return xmlAttribute(s) == s
}

// xmlValidText drops characters that XML 1.0 cannot represent at all. Keeping
// them out prevents LoadXml from failing regardless of the surrounding
// context. Tab, LF and CR are the only C0 controls XML permits.
func xmlValidText(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == '\t' || r == '\n' || r == '\r':
			return r
		case r < 0x20, r == 0xFFFE, r == 0xFFFF,
			r >= 0xD800 && r <= 0xDFFF:
			return -1
		default:
			return r
		}
	}, s)
}
