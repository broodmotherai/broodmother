// The entity document, read and written. Parsing refuses anything it cannot vouch for, and says
// which line was wrong; writing is canonical, so a load–save round trip changes no bytes.
//
// The header is YAML to look at — so the vault opens the same in Obsidian or anything else that
// reads frontmatter — but it is parsed here by hand, because there is no YAML in this app and
// this is not the feature to add one for. That makes the subset part of the spec rather than an
// accident: `key: value` with a plain scalar, and a `from:` list of `  - <relation> [[target]]`
// lines. Quoted and block scalars, inline lists, nested mappings, comments and tabbed indents
// are refused by name, so a hand-edit that strays out of the subset says so instead of being
// read as something it does not say.
//
// Refusal here is never a refused write — a `.md` is left alone on purpose, since an entity is a
// document somebody may be halfway through editing. A record the codec will not take reads as
// broken in the list, the way a `.canvas` that will not open does.

package entity

import (
	"regexp"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/jstext"
	"github.com/broodmotherai/broodmother/daemon/internal/markdown"
)

func fail(format string, args ...any) error { return apperr.Entityf(format, args...) }

// own is the keys the codec owns. Every other key in the header is the kind's own.
var own = map[string]bool{"entity": true, "name": true, "made": true, "by": true, "sha": true, "from": true}

// dot is what `.` means in the regular expressions this is ported from: every character except
// the four JavaScript counts as a line terminator. Go's `.` stops at the newline alone, so a
// header typed on Windows would keep the carriage return the browser refuses to read past.
const dot = `[^\n\r\x{2028}\x{2029}]`

var (
	keyLine    = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(` + dot + `*)$`)
	itemLine   = regexp.MustCompile(`^ {2}- (` + dot + `*)$`)
	sourceLine = regexp.MustCompile(`^([a-z][a-z-]*) \[\[([^\]|]+)\]\]$`)
	madeStamp  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`)
)

// checkScalar is what a line may not be, in the order a stray one is most likely to be it. The
// header is a subset of YAML and these are the parts of YAML it is not.
func checkScalar(key, value string, line int) error {
	switch {
	case strings.HasPrefix(value, `"`), strings.HasPrefix(value, "'"):
		return fail("line %d: %s is quoted — write the value plainly", line, key)
	case strings.HasPrefix(value, "|"), strings.HasPrefix(value, ">"):
		return fail("line %d: %s is a block scalar, which this header cannot hold", line, key)
	case strings.HasPrefix(value, "["):
		return fail(`line %d: %s is an inline list — write one "  - " line each`, line, key)
	case strings.HasPrefix(value, "{"):
		return fail("line %d: %s is an inline mapping, which this header cannot hold", line, key)
	}
	return nil
}

// header is the scalars in the order they were written, and the `from:` list where there was
// one — nil and empty differ, since a record with no from is refused and one with an empty from
// is refused in different words.
type header struct {
	scalars []Field
	at      map[string]int
	from    []string
	hasFrom bool
}

func (h *header) get(key string) string {
	if index, found := h.at[key]; found {
		return h.scalars[index].Value
	}
	return ""
}

// comment is `/^\s*#/`, with JavaScript's idea of space rather than Go's.
func comment(line string) bool {
	return strings.HasPrefix(jstext.TrimLeft(line), "#")
}

// tabbed is `/^[ ]*\t/`: spaces then a tab, which is the indent that looks right and is not.
func tabbed(line string) bool { return strings.HasPrefix(strings.TrimLeft(line, " "), "\t") }

func parseHeader(source string) (*header, error) {
	held := &header{at: map[string]int{}}
	last := ""
	said := false

	for index, line := range strings.Split(source, "\n") {
		at := index + 1
		if jstext.Trim(line) == "" {
			continue
		}
		if comment(line) {
			return nil, fail("line %d: a comment, which this header keeps out", at)
		}
		if tabbed(line) {
			return nil, fail("line %d: indented with a tab — use two spaces", at)
		}

		if item := itemLine.FindStringSubmatch(line); item != nil {
			if last != "from" {
				return nil, fail(`line %d: a list item under %s, and only from takes one`, at, orNothing(said, last))
			}
			held.from = append(held.from, jstext.Trim(item[1]))
			continue
		}
		if strings.HasPrefix(line, " ") {
			return nil, fail(`line %d: indented, and the only indented line is a "  - " source`, at)
		}

		key := keyLine.FindStringSubmatch(line)
		if key == nil {
			return nil, fail(`line %d: neither a "key: value" nor a "  - source"`, at)
		}
		name, value := key[1], key[2]
		if _, twice := held.at[name]; twice || (name == "from" && held.hasFrom) {
			return nil, fail("line %d: %s is said twice", at, name)
		}
		if err := checkScalar(name, value, at); err != nil {
			return nil, err
		}
		if name == "from" {
			if value != "" {
				return nil, fail(`line %d: from is a list — write one "  - " line under it`, at)
			}
			held.hasFrom = true
		} else {
			held.at[name] = len(held.scalars)
			held.scalars = append(held.scalars, Field{Key: name, Value: value})
		}
		last = name
		said = true
	}

	return held, nil
}

// orNothing names the key a stray list item was written under, and the word the TypeScript uses
// where there was no key before it at all.
func orNothing(said bool, last string) string {
	if !said {
		return "nothing"
	}
	return last
}

// readSource is one line of the `from:` list: a source, or the one word that says there is no
// source at all.
func readSource(written string, index int) (*From, error) {
	if written == Origin {
		return nil, nil
	}
	match := sourceLine.FindStringSubmatch(written)
	if match == nil {
		return nil, fail(`from %d: not a "<relation> [[document]]"`, index+1)
	}
	if !IsRelation(match[1]) {
		return nil, fail("from %d: %s is not a relation", index+1, match[1])
	}
	wanted := jstext.Trim(match[2])
	if wanted == "" {
		return nil, fail("from %d: points at nothing", index+1)
	}
	return &From{Relation: Relation(match[1]), Target: wanted}, nil
}

// RelationOf is the relation a link index entry was written under, or empty where the line it
// sat on was not a source at all.
//
// A backlink is a from, a to and a context, and has no room for a relation — but the context is
// the whole trimmed line, which for a source is `- derives-from [[notes/sync]]`. So an ancestry
// reads the relation back out of the line the index already kept, rather than opening every
// document again to ask.
func RelationOf(context string) Relation {
	written, found := strings.CutPrefix(context, "- ")
	if !found {
		return ""
	}
	match := sourceLine.FindStringSubmatch(written)
	if match == nil || !IsRelation(match[1]) {
		return ""
	}
	return Relation(match[1])
}

func Parse(markdownSource string) (Entity, error) {
	rawHeader, body, found := markdown.Split(markdownSource)
	if !found {
		return Entity{}, fail("no frontmatter — an entity is a fenced header and prose under it")
	}
	held, err := parseHeader(rawHeader)
	if err != nil {
		return Entity{}, err
	}

	kind := held.get("entity")
	if kind == "" {
		return Entity{}, fail("no entity: line, so this is not a record")
	}
	if !IsKind(kind) {
		return Entity{}, fail("%s is not a kind this app knows", kind)
	}

	name := FlatName(held.get("name"))
	if name == "" {
		return Entity{}, fail("no name: line, and a record nobody can refer to is not one")
	}

	made := held.get("made")
	if made != "" && !madeStamp.MatchString(made) {
		return Entity{}, fail("made is not an ISO time like 2026-08-24T14:02:11Z")
	}

	origin := false
	kept := []From{}
	for index, written := range held.from {
		one, err := readSource(written, index)
		if err != nil {
			return Entity{}, err
		}
		if one == nil {
			origin = true
			continue
		}
		kept = append(kept, *one)
	}
	if !held.hasFrom || len(held.from) == 0 {
		return Entity{}, fail(`no from: — say what this came from, or "  - origin" where it came from nothing`)
	}
	if origin && len(kept) > 0 {
		return Entity{}, fail("from says origin as well as a source — a record either came from something or began")
	}

	body = jstext.TrimRight(body)
	if length := jstext.Length(body); length > MaxBody {
		return Entity{}, fail("the prose is %d characters, over the %d a record holds", length, MaxBody)
	}

	fields, err := fieldsOf(Kind(kind), held)
	if err != nil {
		return Entity{}, err
	}
	return Entity{
		Kind:   Kind(kind),
		Name:   name,
		Made:   made,
		By:     held.get("by"),
		Sha:    held.get("sha"),
		Origin: origin,
		From:   kept,
		Fields: fields,
		Body:   body,
	}, nil
}

// fieldsOf is everything in the header that is not the codec's, with the kind's own keys proved
// present. A key the catalogue does not ask for is kept rather than refused: a record that says
// one more true thing about itself is not a broken record.
func fieldsOf(kind Kind, held *header) ([]Field, error) {
	var rest []Field
	for _, field := range held.scalars {
		if !own[field.Key] {
			rest = append(rest, field)
		}
	}
	required := Required[kind]
	for _, key := range required {
		if held.get(key) == "" {
			return nil, fail("a %s needs a %s: line, and this one has none", kind, key)
		}
	}

	fields := make([]Field, 0, len(rest))
	for _, key := range required {
		fields = append(fields, Field{Key: key, Value: held.get(key)})
	}
	var extra []Field
	for _, field := range rest {
		if !contains(required, field.Key) {
			extra = append(extra, field)
		}
	}
	sortKeys(extra)
	return append(fields, extra...), nil
}

// sortKeys puts the keys the catalogue does not ask for in the order the browser puts them,
// which is not byte order — see internal/collate, which is where that order lives now that three
// listings want it.
func sortKeys(fields []Field) {
	collate.SortBy(fields, func(field Field) string { return field.Key })
}

func contains(keys []string, key string) bool {
	for _, one := range keys {
		if one == key {
			return true
		}
	}
	return false
}

// headerLines is the header as lines, canonically ordered: what the record is, when and by what,
// what proves it, the kind's own keys, and last what it came from — which is the part that reads
// as a list and so belongs at the bottom.
func headerLines(e Entity, omit ...string) []string {
	var lines []string
	said := func(key, value string) {
		if value != "" && !contains(omit, key) {
			lines = append(lines, key+": "+value)
		}
	}
	said("entity", string(e.Kind))
	said("name", e.Name)
	said("made", e.Made)
	said("by", e.By)
	said("sha", e.Sha)
	for _, field := range e.Fields {
		said(field.Key, field.Value)
	}
	if contains(omit, "from") {
		return lines
	}
	lines = append(lines, "from:")
	if e.Origin {
		return append(lines, "  - "+Origin)
	}
	for _, one := range e.From {
		lines = append(lines, "  - "+string(one.Relation)+" [["+one.Target+"]]")
	}
	return lines
}

func Serialize(e Entity) string {
	head := "---\n" + strings.Join(headerLines(e), "\n") + "\n---\n"
	if e.Body == "" {
		return head
	}
	return head + "\n" + e.Body + "\n"
}

// CanonicalOf is the record as the digest sees it: without the two parts of it that are about
// the writing rather than about the record — when it was written, and the digest itself.
//
// By is inside on purpose. Two agents reaching the same finding are two records that agree, and
// flattening them would lose which of them said it — which is the one thing an entity exists to
// keep.
func CanonicalOf(e Entity) string {
	return strings.Join(headerLines(e, "made", "sha"), "\n") + "\n" + e.Body
}
