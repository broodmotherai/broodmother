// Package entity is what a record is: something an agent had to write down rather than merely
// say, and the documents it says it came from. The shape only — reading and writing one is the
// codec's, walking the sources is the feature's.
//
// Unlike a task or a diagram, an entity has no extension of its own: it is a `.md` file so that
// it opens in the editor, is carried by git, and is linked to like any other note. What makes
// one an entity is the `entity:` key in its frontmatter, which is why IsEntity reads the text
// rather than the path — a record filed beside the note it is about is still a record.
package entity

import (
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/jstext"
	"github.com/broodmotherai/broodmother/daemon-go/internal/markdown"
)

// Folder is where a new record is filed. A default and a tidy habit, not the definition:
// nothing stops an entity living elsewhere, and moving one does not stop it being an entity.
const Folder = "entities"

// IsEntity reports whether a document says it is a record. The cheapest possible read — one line
// out of the frontmatter — because this runs over every `.md` in the tree on each list.
func IsEntity(source string) bool { return markdown.Field(source, "entity") != "" }

// Kind is one of the kinds there are. Closed, and in code rather than in the project, because a
// kind withdrawn from a catalogue leaves the records that wore it perfectly readable — they just
// stop being listed under a heading nothing else uses — where a kind the project could mint
// would have to be reconciled with every document already written.
type Kind string

const (
	Person   Kind = "person"
	Org      Kind = "org"
	Source   Kind = "source"
	Term     Kind = "term"
	Decision Kind = "decision"
	Finding  Kind = "finding"
	Question Kind = "question"
	Artifact Kind = "artifact"
)

var Kinds = []Kind{Person, Org, Source, Term, Decision, Finding, Question, Artifact}

func IsKind(value string) bool {
	for _, one := range Kinds {
		if string(one) == value {
			return true
		}
	}
	return false
}

// Required is what every reader of a kind will look for, so a record that leaves it out is
// refused while whoever wrote it is still listening. These are frontmatter keys of their own,
// beside the ones the codec owns; the prose below the fence is everything else there is to say.
//
// A source asks for `cite` rather than a URL, because the thing worth citing is as often a book
// or a conversation as a link.
var Required = map[Kind][]string{
	Person:   {"role"},
	Org:      {"what"},
	Source:   {"cite"},
	Term:     {"definition"},
	Decision: {"choice", "because"},
	Finding:  {"claim", "evidence"},
	Question: {"asks"},
	Artifact: {"path"},
}

// KindNote is what each kind is for, in the one line the brief and the catalogue have room for.
var KindNote = map[Kind]string{
	Person:   "somebody, and what they do here",
	Org:      "a company, a lab, a team",
	Source:   "something worth citing — a link, a paper, a conversation",
	Term:     "a word this project uses in a particular way",
	Decision: "a choice made, and what made it",
	Finding:  "something learned, and what says so",
	Question: "something open, written down so it stops being forgotten",
	Artifact: "a thing that exists — a file, a build, a document",
}

// Relation is how one record says it came from another. Trimmed from the source's eight to the
// six that mean something without a laboratory around them.
type Relation string

const (
	DerivesFrom Relation = "derives-from"
	Cites       Relation = "cites"
	Contains    Relation = "contains"
	Revises     Relation = "revises"
	Answers     Relation = "answers"
	Contradicts Relation = "contradicts"
)

var Relations = []Relation{DerivesFrom, Cites, Contains, Revises, Answers, Contradicts}

func IsRelation(value string) bool {
	for _, one := range Relations {
		if string(one) == value {
			return true
		}
	}
	return false
}

var RelationNote = map[Relation]string{
	DerivesFrom: "this was worked out from that",
	Cites:       "this quotes or leans on that",
	Contains:    "that is a part of this",
	Revises:     "this supersedes that",
	Answers:     "this settles that question",
	Contradicts: "this and that cannot both be right",
}

// Origin is the one word a `from:` list may hold instead of a source: this is where a line of
// work started, and it came from nothing. The source expresses it as an entity with no incoming
// edges; said out loud, it is harder to leave out by accident.
const Origin = "origin"

// From is where a record came from: how, and which document.
type From struct {
	Relation Relation
	// Target is as written between the brackets, before resolution — the link index resolves it
	// the way it resolves every other wikilink, and a target nothing answers to is a broken link
	// rather than a broken record.
	Target string
}

// Field is one of the kind's own keys. A slice rather than a map because the order is the
// record: the required keys as the catalogue lists them, then whatever else was said, and the
// file is written back in that order.
type Field struct {
	Key   string
	Value string
}

type Entity struct {
	Kind Kind
	Name string
	// Made is when it was written, ISO 8601 to the second in UTC.
	Made string
	// By is what wrote it: `chat/<id>`, `agent/<name>`, `task/<run>`, or whoever says so.
	By string
	// Sha is the digest as it stood when the record was written. Advisory afterwards — see the
	// codec, which is where the reason lives.
	Sha string
	// Origin is said where the `from:` list is the bare word `origin`, and never together with
	// sources: a record either came from something or is where something began.
	Origin bool
	From   []From
	Fields []Field
	// Body is the prose under the fence: what a person reads.
	Body string
}

// Get is what the record says under a key, or empty where it says nothing.
func (e Entity) Get(key string) string {
	for _, field := range e.Fields {
		if field.Key == key {
			return field.Value
		}
	}
	return ""
}

// MaxBody is how much prose is worth keeping in a record, counted the way the browser counts it.
// Past this it is a document that wants writing as a document, with an `artifact` entity
// pointing at it.
const MaxBody = 8000

// MaxName is a label long enough to say what the record is and short enough to sit in a list.
// Over this it is cut rather than refused — the source's argument, and a good one: a caller
// handed back trimmed text can carry on, where one handed a refusal has lost the work.
const MaxName = 200

// Depth is how far an ancestry walks before it stops. The source's depth cap, for the source's
// reason: a graph with a cycle in it is refused at the write, but a graph merely very deep is
// somebody's real work and should end an answer rather than a process.
const Depth = 32

// FlatName is a name as it is written down: one line, no runs of space, cut rather than refused.
func FlatName(raw string) string {
	flat := jstext.Flatten(raw)
	if jstext.Length(flat) <= MaxName {
		return flat
	}
	return jstext.TrimRight(jstext.Head(flat, MaxName-1)) + "…"
}

// Path is where a record of this kind is filed, given a name to make a filename out of.
// Lowercase, spaces to dashes, punctuation dropped — the shape a wikilink is comfortable
// pointing at.
func Path(kind Kind, name string) string {
	var out strings.Builder
	dashed := false
	for _, r := range strings.ToLower(FlatName(name)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if dashed && out.Len() > 0 {
				out.WriteByte('-')
			}
			dashed = false
			out.WriteRune(r)
			continue
		}
		dashed = true
	}
	slug := out.String()
	// Cut after the dashes at the ends are gone, not before, which is how a slug can still end
	// on one: the TypeScript strips and then slices, and the two orders answer differently.
	if len(slug) > 80 {
		slug = slug[:80]
	}
	if slug == "" {
		slug = "untitled"
	}
	return Folder + "/" + string(kind) + "/" + slug + ".md"
}
