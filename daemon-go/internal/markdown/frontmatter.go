// Package markdown is the two things this app reads out of a `.md` without parsing markdown:
// the fenced header at the top, and what a wikilink in the prose points at.
package markdown

import (
	"regexp"
	"strings"
)

// One line between two `---` fences is a regex, not a parser. The fences are allowed their
// trailing spaces and a CRLF, because a document typed on Windows has both.
var fence = regexp.MustCompile(`(?s)^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)`)

// Field is what a `key:` line in the frontmatter says, or empty when the document has neither.
func Field(text, key string) string {
	header, _, found := Split(text)
	if !found {
		return ""
	}
	for line := range strings.SplitSeq(header, "\n") {
		if rest, cut := strings.CutPrefix(line, key+":"); cut {
			return strings.TrimSpace(rest)
		}
	}
	return ""
}

// Split is both halves at once, and whether there was a fence at all. Field reads one line out
// of the first and Strip throws it away; a codec that owns the whole header needs to see it,
// and should not carry a second copy of the fence to get it.
func Split(text string) (header, body string, found bool) {
	match := fence.FindStringSubmatchIndex(text)
	if match == nil {
		return "", "", false
	}
	return text[match[2]:match[3]], leading(text[match[1]:]), true
}

// Strip is the body on its own: the frontmatter taken off, and the blank lines it left behind.
func Strip(text string) string {
	match := fence.FindStringIndex(text)
	if match == nil {
		return leading(text)
	}
	return leading(text[match[1]:])
}

// leading is `replace(/^\n+/, ...)` — newlines alone, not whitespace: the indentation of a first
// line that is a code block is part of the body.
func leading(text string) string { return strings.TrimLeft(text, "\n") }
