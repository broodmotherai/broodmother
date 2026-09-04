// Package entities is what the project has written down, and the one rule that makes it worth
// writing.
//
// The rule is provenance, and it is the whole of the idea: a record is what a tool *wrote*, not
// what a model said. So there is no free-form writer here — [Store.Record] takes a kind, the keys
// that kind needs, what it came from, and prose, and answers with the path it wrote. A design
// that only exists in a message does not exist, and nothing can read a message back.
//
// There is no store behind it. A record is a markdown document, so git is its history, the editor
// is its viewer, the link index is its edges, and sync is its transport. What that costs is the
// uniqueness index: "have I written this before" is a scan and a digest rather than a lookup. At
// project scale that is a walk of the same tree the sidebar already walks, and if it ever stops
// being fine the answer is a cache keyed on the tree event, not a database.
package entities

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/entity"
	"github.com/broodmotherai/broodmother/daemon/internal/jstext"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon/internal/links"
	"github.com/broodmotherai/broodmother/daemon/internal/markdown"
	"github.com/broodmotherai/broodmother/daemon/internal/tree"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

type Deps struct {
	// Tree is the open project's, asked each time. Nil is no project, which is no records —
	// entities are a project idea, for the same reason wikilinks and sync are.
	Tree func() *tree.Tree
	// Links is the project's wikilinks. What a record came from is a link like any other, so the
	// index that already resolves them is the index that answers an ancestry.
	Links func() *links.Index
	// WriteDoc writes a document the way the app writes one: the index updated, the sync timer
	// nudged, the sidebar told, the ledger given whoever wrote it. Never the tree's own write,
	// which does none of that.
	WriteDoc func(path, markdown string, by ledger.Actor) (doc.Path, error)
	// Now is the clock, so a test can hold it still.
	Now func() time.Time
}

type Store struct{ deps Deps }

// NewStore is the constructor rather than New, which is the name the input takes here the
// way it does in project, repo and profile.
func NewStore(deps Deps) *Store { return &Store{deps: deps} }

// Source is a source as a reader of the list needs it: how it was written, and where that
// resolves to. The record holds the wikilink the author typed — `[[sync]]` — which is the right
// thing to keep in the file and the wrong thing to navigate on, so the resolution the link index
// already does is done once here rather than guessed at by every caller. Path is nil where
// nothing answers to it: a broken link, which is not a broken record.
type Source struct {
	Relation entity.Relation `json:"relation"`
	Target   string          `json:"target"`
	Path     *doc.Path       `json:"path"`
}

// Summary is one record as a list draws it. A record that will not parse still gets a row — its
// filename, and what is wrong with it — because a broken record hidden is a broken record nobody
// fixes.
type Summary struct {
	Path doc.Path `json:"path"`
	// Name is the record's, or its filename where it will not parse.
	Name string `json:"name"`
	// Kind is nil on a broken one, which is the only thing that has no kind.
	Kind *entity.Kind `json:"kind"`
	// Made is ISO 8601 to the second, or empty where the record does not say.
	Made string `json:"made"`
	By   string `json:"by"`
	// Origin is said where this is where a line of work started, rather than derived from
	// anything.
	Origin bool     `json:"origin"`
	From   []Source `json:"from"`
	// Edited: the digest on disk no longer matches the `sha` the record was written with, so
	// somebody has edited it since. Not broken — edited, which is what a document is for.
	Edited bool `json:"edited"`
	// Broken is why the record would not parse, where it would not.
	Broken string `json:"broken,omitempty"`
}

// New is what [Store.Record] is handed. There is no free-form writer on purpose: a tool that took
// prose and stored it would make "cite the record" something the prompt asks for, where this
// makes it something the route enforces.
type New struct {
	Kind   entity.Kind
	Name   string
	Fields map[string]string
	From   []entity.From
	// Origin is said instead of sources, where this is where the line of work began.
	Origin bool
	Body   string
	// By is what wrote it. A note about where a record came from rather than a claim the app can
	// stand behind — the daemon fills it in for its own tools and takes the caller's word for it
	// everywhere else, because there is no auth here to make it more than that.
	By string
}

type KindInfo struct {
	Kind     entity.Kind `json:"kind"`
	Note     string      `json:"note"`
	Required []string    `json:"required"`
}

type RelationInfo struct {
	Relation entity.Relation `json:"relation"`
	Note     string          `json:"note"`
}

type Catalogue struct {
	Kinds     []KindInfo     `json:"kinds"`
	Relations []RelationInfo `json:"relations"`
}

// Catalogue is the kinds and relations there are. Static, and served rather than duplicated, so
// the page's rail and the brief's table cannot drift from the catalogue they describe.
func (s *Store) Catalogue() Catalogue {
	held := Catalogue{
		Kinds:     make([]KindInfo, 0, len(entity.Kinds)),
		Relations: make([]RelationInfo, 0, len(entity.Relations)),
	}
	for _, kind := range entity.Kinds {
		required := entity.Required[kind]
		if required == nil {
			required = []string{}
		}
		held.Kinds = append(held.Kinds, KindInfo{Kind: kind, Note: entity.KindNote[kind], Required: required})
	}
	for _, relation := range entity.Relations {
		held.Relations = append(held.Relations, RelationInfo{Relation: relation, Note: entity.RelationNote[relation]})
	}
	return held
}

// found is one record on disk, parsed or not.
type found struct {
	path   doc.Path
	entity *entity.Entity
	broken string
}

// List is every record the project holds, newest first. A broken one gets a row saying what is
// wrong with it rather than being left out — a record nobody can see is a record nobody fixes,
// and the whole point of these is that they are findable.
func (s *Store) List() ([]Summary, error) {
	held := s.deps.Tree()
	if held == nil {
		return []Summary{}, nil
	}
	documents, err := held.Documents()
	if err != nil {
		return nil, err
	}
	records := scan(held, documents)
	summaries := make([]Summary, 0, len(records))
	for _, one := range records {
		summaries = append(summaries, summarize(one, documents))
	}
	sort.SliceStable(summaries, func(a, b int) bool {
		if summaries[a].Made != summaries[b].Made {
			return collate.Before(summaries[b].Made, summaries[a].Made)
		}
		return collate.Before(string(summaries[a].Path), string(summaries[b].Path))
	})
	return summaries, nil
}

// Record writes a record, or answers with the one that already says it.
//
// The idempotence rests on the digest: the same record twice is one record, so a tool can be
// re-run without forking the graph. It compares against the digest recomputed from what is on
// disk rather than the `sha:` line, because somebody may have edited the prose since — and
// answering "already written" with a path to a document that no longer says that would be the
// stalest possible answer, given confidently.
func (s *Store) Record(input New, by ledger.Actor) (Summary, bool, error) {
	held, err := s.requireProject()
	if err != nil {
		return Summary{}, false, err
	}
	draft, err := s.draft(input)
	if err != nil {
		return Summary{}, false, err
	}
	digest := entity.DigestOf(draft)

	documents, err := held.Documents()
	if err != nil {
		return Summary{}, false, err
	}
	records := scan(held, documents)
	for _, one := range records {
		if one.entity != nil && entity.DigestOf(*one.entity) == digest {
			return summarize(one, documents), false, nil
		}
	}

	for _, source := range draft.From {
		if markdown.ResolveTarget(source.Target, documents) == "" {
			return Summary{}, false, apperr.Entityf(
				"nothing in the project answers to [[%s]] — record it first, or point at what does",
				source.Target)
		}
	}

	taken := map[doc.Path]bool{}
	for _, one := range records {
		taken[one.path] = true
	}
	// A record fresh off a tool has nothing pointing at it yet, so it cannot close a loop; Link
	// is the only way an edge lands on a record something already derives from, and that is where
	// the walk lives.
	draft.Sha = digest
	written, err := s.deps.WriteDoc(free(entity.Path(draft.Kind, draft.Name), taken), entity.Serialize(draft), by)
	if err != nil {
		return Summary{}, false, err
	}
	return summarize(found{path: written, entity: &draft}, documents), true, nil
}

// Link adds a source to a record already written.
//
// The one edit that cannot be a re-record: re-recording with an extra source is a different
// digest and so a different record, which is exactly the forking the digest exists to prevent.
// Refused where it would close a loop, over resolved link targets rather than rows — because a
// markdown file cannot see another file any more than a CHECK constraint can see another row.
func (s *Store) Link(path string, relation entity.Relation, target string, by ledger.Actor) (Summary, error) {
	held, err := s.requireProject()
	if err != nil {
		return Summary{}, err
	}
	source, err := held.Read(path)
	if err != nil {
		return Summary{}, apperr.Entityf("there is no %s", path)
	}
	record, err := entity.Parse(source)
	if err != nil {
		return Summary{}, err
	}

	if record.Origin {
		return Summary{}, apperr.Entityf(
			"%s says it is where a line of work began — a record either came from something or began", path)
	}
	for _, one := range record.From {
		if one.Target == target {
			return Summary{}, apperr.Entityf("%s already says it comes from [[%s]]", path, target)
		}
	}

	documents, err := held.Documents()
	if err != nil {
		return Summary{}, err
	}
	resolved := markdown.ResolveTarget(target, documents)
	if resolved == "" {
		return Summary{}, apperr.Entityf("nothing in the project answers to [[%s]]", target)
	}
	if string(resolved) == path {
		return Summary{}, apperr.Entityf("%s cannot come from itself", path)
	}
	if s.reaches(resolved, doc.Path(path)) {
		return Summary{}, apperr.Entityf(
			"%s already comes from %s, so this would close a loop — untangle it first", target, path)
	}

	record.From = append(append([]entity.From{}, record.From...), entity.From{Relation: relation, Target: target})
	record.Sha = entity.DigestOf(record)
	written, err := s.deps.WriteDoc(path, entity.Serialize(record), by)
	if err != nil {
		return Summary{}, err
	}
	return summarize(found{path: written, entity: &record}, append(documents, written)), nil
}

// reaches is whether from reaches to by sources alone. Level-order with a depth cap: a graph with
// a cycle is refused at the write, but a graph merely very deep is somebody's real work and
// should end an answer rather than a process.
func (s *Store) reaches(from, to doc.Path) bool {
	index := s.deps.Links()
	if index == nil {
		return false
	}
	level := []doc.Path{from}
	seen := map[doc.Path]bool{from: true}
	for depth := 0; depth < entity.Depth && len(level) > 0; depth++ {
		var next []doc.Path
		for _, here := range level {
			for _, link := range index.Outbound(here) {
				if entity.RelationOf(link.Context) == "" {
					continue
				}
				if link.To == to {
					return true
				}
				if seen[link.To] {
					continue
				}
				seen[link.To] = true
				next = append(next, link.To)
			}
		}
		level = next
	}
	return false
}

// draft is what the caller asked for, as a record the codec will vouch for. Built and then read
// back through the codec, so a tool, a route and a hand-written file are all refused by the same
// sentences rather than by three near-copies of the same checks.
func (s *Store) draft(input New) (entity.Entity, error) {
	name := entity.FlatName(input.Name)
	if name == "" {
		return entity.Entity{}, apperr.Entityf("a record needs a name")
	}
	// Counted the way the browser counts it, since the count is in the sentence a person reads.
	if held := jstext.Length(input.Body); held > entity.MaxBody {
		return entity.Entity{}, apperr.Entityf("the prose is %s characters, over the %s a record holds",
			strconv.Itoa(held), strconv.Itoa(entity.MaxBody))
	}
	fields := make([]entity.Field, 0, len(input.Fields))
	for key, value := range input.Fields {
		fields = append(fields, entity.Field{Key: key, Value: value})
	}
	// A map has no order and the codec gives the header one of its own, so the only thing this
	// settles is that two runs of the same request write the same bytes.
	collate.SortBy(fields, func(field entity.Field) string { return field.Key })

	draft := entity.Entity{
		Kind:   input.Kind,
		Name:   name,
		Made:   iso(s.now()),
		By:     input.By,
		Origin: input.Origin,
		From:   input.From,
		Fields: fields,
		Body:   jstext.TrimRight(input.Body),
	}
	return entity.Parse(entity.Serialize(draft))
}

func (s *Store) now() time.Time {
	if s.deps.Now != nil {
		return s.deps.Now()
	}
	return time.Now()
}

func (s *Store) requireProject() (*tree.Tree, error) {
	if held := s.deps.Tree(); held != nil {
		return held, nil
	}
	return nil, apperr.NoProjectf("no project is open")
}

// scan is every `.md` in the project that says it is a record, read once.
func scan(held *tree.Tree, documents []doc.Path) []found {
	records := []found{}
	for _, path := range documents {
		source, err := held.Read(string(path))
		if err != nil || !entity.IsEntity(source) {
			continue
		}
		record, err := entity.Parse(source)
		if err != nil {
			records = append(records, found{path: path, broken: err.Error()})
			continue
		}
		records = append(records, found{path: path, entity: &record})
	}
	return records
}

func summarize(one found, documents []doc.Path) Summary {
	if one.entity == nil {
		return Summary{
			Path:   one.path,
			Name:   strings.TrimSuffix(utils.Base(string(one.path)), ".md"),
			From:   []Source{},
			Broken: one.broken,
		}
	}
	record := *one.entity
	sources := make([]Source, 0, len(record.From))
	for _, source := range record.From {
		held := Source{Relation: source.Relation, Target: source.Target}
		if resolved := markdown.ResolveTarget(source.Target, documents); resolved != "" {
			held.Path = &resolved
		}
		sources = append(sources, held)
	}
	kind := record.Kind
	return Summary{
		Path:   one.path,
		Name:   record.Name,
		Kind:   &kind,
		Made:   record.Made,
		By:     record.By,
		Origin: record.Origin,
		From:   sources,
		Edited: record.Sha != "" && record.Sha != entity.DigestOf(record),
	}
}

// free is the first path under `entities/` nothing has taken. Two records that deserve the same
// filename are two records: the digest already proved they are not the same one.
func free(wanted string, taken map[doc.Path]bool) string {
	if !taken[doc.Path(wanted)] {
		return wanted
	}
	stem := strings.TrimSuffix(wanted, ".md")
	for n := 2; ; n++ {
		next := stem + "-" + strconv.Itoa(n) + ".md"
		if !taken[doc.Path(next)] {
			return next
		}
	}
}

// iso is to the second, in UTC, which is what the header holds and what sorts as text.
func iso(at time.Time) string { return at.UTC().Format("2006-01-02T15:04:05") + "Z" }
