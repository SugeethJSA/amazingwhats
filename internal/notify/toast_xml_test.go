package notify

import (
	"encoding/xml"
	"testing"
)

func TestXMLAttributeEscaping(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "plain", "plain"},
		{"ampersand", "a&b", "a&amp;b"},
		{"markup characters", `a<b>c"d'e`, "a&lt;b&gt;c&quot;d&apos;e"},
		{"url encoded args", "action=open&chatJid=1203630%40g.us&messageId=A%26B", "action=open&amp;chatJid=1203630%40g.us&amp;messageId=A%26B"},
		{"invalid controls", "a\x00b\x01c", "abc"},
		{"legal whitespace", "a\nb\rc\td", "a\nb\rc\td"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := xmlAttribute(tc.in); got != tc.want {
				t.Fatalf("xmlAttribute(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
	if isXMLAttributeSafe("C:\\safe\\icon.png") != true {
		t.Fatal("plain path should be already safe")
	}
	if isXMLAttributeSafe("C:\\a&b\\icon.png") != false {
		t.Fatal("path with an ampersand must be reported as unsafe")
	}
}

func TestXMLCDATARoundTrip(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "hello world", "hello world"},
		{"markup characters", `Alice & Bob said <hi> "there"`, `Alice & Bob said <hi> "there"`},
		{"cdata terminator", "a]]>b", "a]]>b"},
		{"repeated terminator", "a]]]>b", "a]]]>b"},
		{"only terminator", "]]>", "]]>"},
		{"invalid control", "a\x00b]]>c", "ab]]>c"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			doc := "<text><![CDATA[" + xmlCDATA(tc.in) + "]]></text>"
			var parsed struct {
				Text string `xml:",chardata"`
			}
			if err := xml.Unmarshal([]byte(doc), &parsed); err != nil {
				t.Fatalf("CDATA %q is not valid XML: %v\n%s", tc.in, err, doc)
			}
			if parsed.Text != tc.want {
				t.Fatalf("CDATA round trip = %q, want %q (xml: %s)", parsed.Text, tc.want, doc)
			}
		})
	}
}
