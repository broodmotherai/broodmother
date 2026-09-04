// What a wikilink points at. The pure half — a target as it was written, and a list of
// documents, and no way to reach a disk — so the browser can resolve a link the same way the
// server does rather than keeping a second guess at the rules.

package markdown

import (
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

// LinkKind is how a link was written: the vault's own brackets, or markdown's.
type LinkKind string

const (
	Wiki LinkKind = "wiki"
	MD   LinkKind = "md"
)

type Link struct {
	Kind LinkKind `json:"kind"`
	// Target is exactly as written, before resolution.
	Target string `json:"target"`
	// Raw is the whole link as it stands in the prose, which is what a rewrite replaces.
	Raw string `json:"raw"`
	// Context is the trimmed line it sat on, which is what a backlink shows.
	Context string `json:"context"`
}

var (
	wikiLink = regexp.MustCompile(`\[\[([^\]|]+)(?:\|([^\]]*))?\]\]`)
	mdLink   = regexp.MustCompile(`\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)`)
	scheme   = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)
)

func StripExtension(path string) string {
	if len(path) >= 3 && strings.EqualFold(path[len(path)-3:], ".md") {
		return path[:len(path)-3]
	}
	return path
}

// decodeTarget is `decodeURIComponent`, which throws on a half-written escape — and a `%` is an
// ordinary thing to type in a link. Escapes are a convenience here, so one that does not decode
// is a literal.
func decodeTarget(href string) string {
	decoded, err := url.PathUnescape(href)
	if err != nil {
		return href
	}
	return decoded
}

// ExtractLinks is every link in the prose, in the order they were written. A heading or a block
// reference after the target is not part of it: `[[notes/sync#today]]` points at the note.
func ExtractLinks(source string) []Link {
	links := []Link{}
	for line := range strings.SplitSeq(source, "\n") {
		context := strings.TrimSpace(line)
		for _, match := range wikiLink.FindAllStringSubmatch(line, -1) {
			target := strings.TrimSpace(cutAt(match[1], "#", "^"))
			if target != "" {
				links = append(links, Link{Kind: Wiki, Target: target, Raw: match[0], Context: context})
			}
		}
		for _, match := range mdLink.FindAllStringSubmatch(line, -1) {
			href := match[1]
			// A link to somewhere else entirely, or to a place on this page, points at no document.
			if scheme.MatchString(href) || strings.HasPrefix(href, "#") {
				continue
			}
			if target := decodeTarget(cutAt(href, "#")); target != "" {
				links = append(links, Link{Kind: MD, Target: target, Raw: match[0], Context: context})
			}
		}
	}
	return links
}

func cutAt(value string, separators ...string) string {
	for _, separator := range separators {
		value, _, _ = strings.Cut(value, separator)
	}
	return value
}

// ResolveTarget is Obsidian's resolution: exact path, then filename, then filename without
// extension. Shortest first, so the least surprising document wins where more than one answers
// to a bare name.
func ResolveTarget(target string, documents []doc.Path) doc.Path {
	candidates := append([]doc.Path(nil), documents...)
	sortByLengthThenName(candidates)

	for _, path := range candidates {
		if path == target || path == target+".md" {
			return path
		}
	}
	for _, path := range candidates {
		if utils.Base(path) == target {
			return path
		}
	}
	bare := StripExtension(target)
	for _, path := range candidates {
		if StripExtension(utils.Base(path)) == bare {
			return path
		}
	}
	return ""
}

// sortByLengthThenName is `a.length - b.length || a.localeCompare(b)`: the shortest path wins,
// so the least surprising document answers to a bare name, and the browser's order breaks a tie.
func sortByLengthThenName(paths []doc.Path) {
	sort.SliceStable(paths, func(i, j int) bool {
		if len(paths[i]) != len(paths[j]) {
			return len(paths[i]) < len(paths[j])
		}
		return collate.Before(paths[i], paths[j])
	})
}

// RewriteLinks points every link that resolved to `from` at `to`, leaving the shape the author
// wrote: a bare filename stays a bare filename, and an encoded href stays encoded.
func RewriteLinks(source string, from, to doc.Path, documents []doc.Path) string {
	result := source
	for _, link := range ExtractLinks(source) {
		if ResolveTarget(link.Target, documents) != from {
			continue
		}
		var replacement string
		if link.Kind == Wiki {
			replacement = strings.Replace(link.Raw, link.Target, wikiTarget(link.Target, to), 1)
		} else {
			replacement = mdHref.ReplaceAllString(link.Raw, "("+encodeURI(to))
		}
		result = strings.ReplaceAll(result, link.Raw, replacement)
	}
	return result
}

var mdHref = regexp.MustCompile(`\(([^)\s]+)`)

// wikiTarget keeps the shape the author wrote: a bare filename stays a bare filename.
func wikiTarget(oldTarget string, to doc.Path) string {
	if strings.Contains(oldTarget, "/") {
		return StripExtension(to)
	}
	return StripExtension(utils.Base(to))
}

// encodeURI is JavaScript's, which leaves the characters a path is made of alone — `/`, `:`, and
// the sub-delimiters — and escapes the rest. Go's url escaping has no mode that matches it, so
// the set is written out.
func encodeURI(path string) string {
	const keep = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
		"-_.!~*'();/?:@&=+$,#"
	var out strings.Builder
	for index := 0; index < len(path); index++ {
		c := path[index]
		if strings.IndexByte(keep, c) >= 0 {
			out.WriteByte(c)
			continue
		}
		out.WriteString("%")
		out.WriteString(strings.ToUpper(hex[c>>4 : c>>4+1]))
		out.WriteString(strings.ToUpper(hex[c&0xf : c&0xf+1]))
	}
	return out.String()
}

const hex = "0123456789ABCDEF"
