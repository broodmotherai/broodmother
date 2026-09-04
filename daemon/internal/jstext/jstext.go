// Package jstext is text measured and trimmed the way the browser measures and trims it.
//
// Three of the ways a port silently disagrees with the implementation it replaces are about
// numbers and field order and HTML escaping, and the canvas codec settles those. This is the
// fourth: a JavaScript string is a sequence of UTF-16 code units, so `text.length` counts an
// emoji as two and a Japanese character as one, and `slice` cuts by the same measure. A Go
// port that reaches for len() counts bytes and cuts a record's prose in a different place —
// and the length is in the message the user reads, so the disagreement is visible.
//
// The whitespace class is the same kind of trap from the other end: JavaScript's `\s` is not
// Go's, and neither is Unicode's. It is the Unicode space separators plus the two line
// separators plus the byte order mark — and, unlike Go's unicode.IsSpace, not U+0085.
package jstext

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// Length is `text.length`: how many UTF-16 code units the string is, which is one for
// everything up to U+FFFF and two above it.
func Length(text string) int {
	units := 0
	for _, r := range text {
		units++
		if r > 0xFFFF {
			units++
		}
	}
	return units
}

// Head is `text.slice(0, units)`, except that a cut landing inside a surrogate pair takes the
// character rather than half of it: JavaScript would hand back a lone surrogate, and Go has no
// string that can hold one.
func Head(text string, units int) string {
	if units <= 0 {
		return ""
	}
	seen := 0
	for at, r := range text {
		width := 1
		if r > 0xFFFF {
			width = 2
		}
		if seen+width > units {
			return text[:at]
		}
		seen += width
		if seen == units {
			return text[:at+utf8.RuneLen(r)]
		}
	}
	return text
}

// IsSpace is JavaScript's `\s`, which is what `trim` trims and what `/\s+/` matches.
func IsSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0xFEFF, 0x2028, 0x2029:
		return true
	}
	// The rest of the class is the Unicode space separators. Not White_Space, which would take
	// U+0085 with it — a character JavaScript does not count as space and Go's unicode.IsSpace
	// does.
	return unicode.Is(unicode.Zs, r)
}

// Trim is `text.trim()`.
func Trim(text string) string { return strings.TrimFunc(text, IsSpace) }

// TrimLeft drops the space at the front, as `replace(/^\s+/, ...)` does.
func TrimLeft(text string) string { return strings.TrimLeftFunc(text, IsSpace) }

// TrimRight drops the space at the end, as `replace(/\s+$/, ...)` does.
func TrimRight(text string) string { return strings.TrimRightFunc(text, IsSpace) }

// Flatten is `text.replace(/\s+/g, ' ').trim()`: every run of space becomes one, and the ends
// lose theirs.
func Flatten(text string) string {
	var out strings.Builder
	out.Grow(len(text))
	spaced := false
	for _, r := range text {
		if IsSpace(r) {
			spaced = true
			continue
		}
		if spaced && out.Len() > 0 {
			out.WriteByte(' ')
		}
		spaced = false
		out.WriteRune(r)
	}
	return out.String()
}
