// Package conformance holds the port to the implementation it replaces.
//
// ../../../../conformance/corpus/*.json is what the TypeScript answers for every case in
// ../../../../conformance/cases/*.json — what it parses to, what it writes back, and the words it
// refuses in. The browser still runs that TypeScript, so these are not old answers kept for
// sentiment: they are the other half of a grammar this daemon has to agree with exactly, or a
// diagram drawn in the editor becomes a diagram the daemon will not save.
package conformance

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/broodmotherai/broodmother/daemon-go/internal/brief"
	"github.com/broodmotherai/broodmother/daemon-go/internal/canvas"
	"github.com/broodmotherai/broodmother/daemon-go/internal/collate"
	"github.com/broodmotherai/broodmother/daemon-go/internal/config"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entity"
	"github.com/broodmotherai/broodmother/daemon-go/internal/git"
	"github.com/broodmotherai/broodmother/daemon-go/internal/github"
	"github.com/broodmotherai/broodmother/daemon-go/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon-go/internal/markdown"
	"github.com/broodmotherai/broodmother/daemon-go/internal/notebook"
	"github.com/broodmotherai/broodmother/daemon-go/internal/personas"
	"github.com/broodmotherai/broodmother/daemon-go/internal/skills"
	"github.com/broodmotherai/broodmother/daemon-go/internal/syncloop"
	"github.com/broodmotherai/broodmother/daemon-go/internal/task"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tasks"
)

type answer struct {
	Name       string `json:"name"`
	Source     string `json:"source"`
	Error      string `json:"error"`
	Serialized string `json:"serialized"`
	// The entity alone: a record is written as a document and hashed as a canonical form, and a
	// port that got the second wrong would write the same file under a different digest.
	Canonical string `json:"canonical"`
	Digest    string `json:"digest"`
	// The config alone: it never refuses, so what it owes is the config it salvaged, the fields
	// it had to throw away, and the bindings it read out of an older layout.
	Reset    []string          `json:"reset"`
	Bindings map[string]string `json:"bindings"`
	// The notebook alone: the merge writes a notebook's cells back and never its kernel, so the
	// language is the one thing it holds that its bytes never show.
	Language string `json:"language"`
}

func load(t *testing.T, name string) []answer {
	t.Helper()
	path := filepath.Join("..", "..", "..", "conformance", "corpus", name+".json")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%s: %v — run `make corpus`", path, err)
	}
	var answers []answer
	if err := json.Unmarshal(body, &answers); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	if len(answers) == 0 {
		t.Fatalf("%s is empty", path)
	}
	return answers
}

func TestCanvasParsesWhatTheTypeScriptParses(t *testing.T) {
	for _, one := range load(t, "canvas") {
		t.Run(one.Name, func(t *testing.T) {
			parsed, err := canvas.Parse(one.Source)
			if one.Error != "" {
				if err == nil {
					t.Fatal("accepted what the TypeScript refused")
				}
				if err.Error() != one.Error {
					t.Errorf("refused in different words:\n got %q\nwant %q", err, one.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("refused what the TypeScript accepted: %v", err)
			}
			if got := canvas.Serialize(parsed); got != one.Serialized {
				t.Errorf("wrote different bytes:\n got %q\nwant %q", got, one.Serialized)
			}
		})
	}
}

func TestCanvasRoundTripsTheBytesItWrites(t *testing.T) {
	for _, one := range load(t, "canvas") {
		if one.Error != "" {
			continue
		}
		t.Run(one.Name, func(t *testing.T) {
			again, err := canvas.Parse(one.Serialized)
			if err != nil {
				t.Fatalf("refused its own output: %v", err)
			}
			if got := canvas.Serialize(again); got != one.Serialized {
				t.Errorf("a second save moved bytes:\n got %q\nwant %q", got, one.Serialized)
			}
		})
	}
}

func TestTaskParsesWhatTheTypeScriptParses(t *testing.T) {
	for _, one := range load(t, "task") {
		t.Run(one.Name, func(t *testing.T) {
			parsed, err := task.Parse(one.Source)
			if one.Error != "" {
				if err == nil {
					t.Fatal("accepted what the TypeScript refused")
				}
				if err.Error() != one.Error {
					t.Errorf("refused in different words:\n got %q\nwant %q", err, one.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("refused what the TypeScript accepted: %v", err)
			}
			if got := task.Serialize(parsed); got != one.Serialized {
				t.Errorf("wrote different bytes:\n got %q\nwant %q", got, one.Serialized)
			}
		})
	}
}

func TestTaskRoundTripsTheBytesItWrites(t *testing.T) {
	for _, one := range load(t, "task") {
		if one.Error != "" {
			continue
		}
		t.Run(one.Name, func(t *testing.T) {
			again, err := task.Parse(one.Serialized)
			if err != nil {
				t.Fatalf("refused its own output: %v", err)
			}
			if got := task.Serialize(again); got != one.Serialized {
				t.Errorf("a second save moved bytes:\n got %q\nwant %q", got, one.Serialized)
			}
		})
	}
}

func TestEntityParsesWhatTheTypeScriptParses(t *testing.T) {
	for _, one := range load(t, "entity") {
		t.Run(one.Name, func(t *testing.T) {
			parsed, err := entity.Parse(one.Source)
			if one.Error != "" {
				if err == nil {
					t.Fatal("accepted what the TypeScript refused")
				}
				if err.Error() != one.Error {
					t.Errorf("refused in different words:\n got %q\nwant %q", err, one.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("refused what the TypeScript accepted: %v", err)
			}
			if got := entity.Serialize(parsed); got != one.Serialized {
				t.Errorf("wrote different bytes:\n got %q\nwant %q", got, one.Serialized)
			}
			if got := entity.CanonicalOf(parsed); got != one.Canonical {
				t.Errorf("hashed a different record:\n got %q\nwant %q", got, one.Canonical)
			}
			if got := entity.DigestOf(parsed); got != one.Digest {
				t.Errorf("digest is %s, want %s", got, one.Digest)
			}
		})
	}
}

func TestEntityRoundTripsTheBytesItWrites(t *testing.T) {
	for _, one := range load(t, "entity") {
		if one.Error != "" {
			continue
		}
		t.Run(one.Name, func(t *testing.T) {
			again, err := entity.Parse(one.Serialized)
			if err != nil {
				t.Fatalf("refused its own output: %v", err)
			}
			if got := entity.Serialize(again); got != one.Serialized {
				t.Errorf("a second save moved bytes:\n got %q\nwant %q", got, one.Serialized)
			}
		})
	}
}

// stable is every object key in sorted order — the spelling the corpus holds a config in, since
// two languages that order a map differently still owe each other the same values.
func stable(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var held any
	if err := json.Unmarshal(raw, &held); err != nil {
		t.Fatal(err)
	}
	// An encoder rather than MarshalIndent, for the reason the canvas codec gives: Go escapes
	// `<`, `>` and `&` unless told not to, and JSON.stringify does not — so an email address in
	// angle brackets would read as a difference that is not one.
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(held); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

func readConfig(source string) config.Loaded {
	var raw json.RawMessage
	if json.Unmarshal([]byte(source), &raw) != nil {
		raw = nil
	}
	return config.Repair(raw, config.Default(nil))
}

func TestConfigRepairsWhatTheTypeScriptRepairs(t *testing.T) {
	for _, one := range load(t, "config") {
		t.Run(one.Name, func(t *testing.T) {
			loaded := readConfig(one.Source)
			if got := stable(t, loaded.Config); got != one.Serialized {
				t.Errorf("salvaged a different config:\n got %s\nwant %s", got, one.Serialized)
			}
			if !reflect.DeepEqual(loaded.Reset, one.Reset) {
				t.Errorf("reset %v, want %v", loaded.Reset, one.Reset)
			}
			if !sameBindings(loaded.Bindings, one.Bindings) {
				t.Errorf("bindings %v, want %v", loaded.Bindings, one.Bindings)
			}
		})
	}
}

// An empty map and an absent one are the same answer here: the TypeScript writes `{}` and Go
// unmarshals it to an empty map, but a corpus entry with no bindings at all arrives as nil.
func sameBindings(got, want map[string]string) bool {
	return len(got) == len(want) && (len(got) == 0 || reflect.DeepEqual(got, want))
}

// Repairing a config that needed no repair is a fixed point, which is what keeps the daemon from
// rewriting the file every time it starts.
func TestConfigLeavesAGoodConfigAlone(t *testing.T) {
	for _, one := range load(t, "config") {
		t.Run(one.Name, func(t *testing.T) {
			once := readConfig(one.Source)
			body, err := config.Marshal(once.Config)
			if err != nil {
				t.Fatal(err)
			}
			twice := readConfig(string(body))
			if got := stable(t, twice.Config); got != one.Serialized {
				t.Errorf("a second read moved it:\n got %s\nwant %s", got, one.Serialized)
			}
			if len(twice.Reset) != 0 {
				t.Errorf("a config it wrote itself reset %v", twice.Reset)
			}
		})
	}
}

// The order the browser puts names in, which decides which project opens on a machine whose
// config says nothing.
func TestCollateSortsTheWayTheBrowserSorts(t *testing.T) {
	for _, one := range load(t, "collate") {
		t.Run(one.Name, func(t *testing.T) {
			var names []string
			if err := json.Unmarshal([]byte(one.Source), &names); err != nil {
				t.Fatal(err)
			}
			collate.Sort(names)
			// An encoder rather than Marshal, for the reason the canvas codec gives: Go escapes
			// `<`, `>` and `&` unless told not to, and JSON.stringify does not. Encode's own
			// trailing newline is the one the corpus holds.
			var sorted bytes.Buffer
			encoder := json.NewEncoder(&sorted)
			encoder.SetEscapeHTML(false)
			if err := encoder.Encode(names); err != nil {
				t.Fatal(err)
			}
			if got := sorted.String(); got != one.Serialized {
				t.Errorf("sorted differently:\n got %s\nwant %s", got, one.Serialized)
			}
		})
	}
}

// What git says, read. Porcelain v2 is NUL-separated and positional, so a port that miscounts a
// field reports the wrong path as changed — and the guard against a destructive command is the
// promise rather than the convention.
func TestGitReadsWhatTheTypeScriptReads(t *testing.T) {
	for _, one := range load(t, "git") {
		t.Run(one.Name, func(t *testing.T) {
			what, body, found := strings.Cut(one.Source, "\x01")
			if !found {
				t.Fatalf("case %q names no parser", one.Name)
			}
			got := stable(t, readGit(t, what, body))
			if got != one.Serialized {
				t.Errorf("read differently:\n got %s\nwant %s", got, one.Serialized)
			}
		})
	}
}

func readGit(t *testing.T, what, body string) any {
	t.Helper()
	switch what {
	case "status":
		return git.ParseStatus(body)
	case "changes":
		return git.ParseChanges(body)
	case "name-status":
		return git.ParseNameStatus(body)
	case "classify":
		return git.ClassifyRemoteError(body)
	case "destructive":
		var args []string
		if err := json.Unmarshal([]byte(body), &args); err != nil {
			t.Fatal(err)
		}
		refused := map[string]any{"refused": nil}
		if err := git.AssertNonDestructive(args); err != nil {
			refused["refused"] = err.Error()
		}
		return refused
	}
	t.Fatalf("no parser called %s", what)
	return nil
}

// What a wikilink points at, and what happens to it when its document moves. The browser
// resolves a link to draw it and the daemon resolves the same one to rewrite it.
func TestLinksResolveTheWayTheTypeScriptResolvesThem(t *testing.T) {
	for _, one := range load(t, "links") {
		t.Run(one.Name, func(t *testing.T) {
			got := stable(t, readLinks(t, one.Source))
			if got != one.Serialized {
				t.Errorf("read differently:\n got %s\nwant %s", got, one.Serialized)
			}
		})
	}
}

func readLinks(t *testing.T, source string) any {
	t.Helper()
	parts := strings.Split(source, "\x01")
	switch parts[0] {
	case "extract":
		return markdown.ExtractLinks(strings.Join(parts[1:], "\x01"))
	case "resolve":
		documents := documentList(t, parts[1])
		return map[string]any{
			"target":   parts[2],
			"resolved": orNull(markdown.ResolveTarget(parts[2], documents)),
		}
	case "rewrite":
		documents := documentList(t, parts[1])
		return markdown.RewriteLinks(parts[4], parts[2], parts[3], documents)
	}
	t.Fatalf("no reader called %s", parts[0])
	return nil
}

func documentList(t *testing.T, raw string) []doc.Path {
	t.Helper()
	var documents []doc.Path
	if err := json.Unmarshal([]byte(raw), &documents); err != nil {
		t.Fatal(err)
	}
	return documents
}

// A target nothing answers to is null there and empty here, and the corpus holds the first.
func orNull(resolved doc.Path) any {
	if resolved == "" {
		return nil
	}
	return resolved
}

// What a sync pass commits under. One line, and every project's history is written in it.
func TestCommitMessagesReadTheWayTheTypeScriptWritesThem(t *testing.T) {
	for _, one := range load(t, "commit") {
		t.Run(one.Name, func(t *testing.T) {
			var paths []doc.Path
			if err := json.Unmarshal([]byte(one.Source), &paths); err != nil {
				t.Fatal(err)
			}
			got := stable(t, map[string]string{"message": syncloop.CommitMessage(paths)})
			if got != one.Serialized {
				t.Errorf("committed as:\n got %s\nwant %s", got, one.Serialized)
			}
		})
	}
}

// Who a request says it is, and what a commit says about them afterwards.
func TestLedgerReadsAClaimTheWayTheTypeScriptReadsIt(t *testing.T) {
	for _, one := range load(t, "ledger") {
		t.Run(one.Name, func(t *testing.T) {
			what, body, _ := strings.Cut(one.Source, "\x01")
			var answer any
			switch what {
			case "actor":
				// The corpus spells an absent header as a NUL, since a case is a string either way.
				if body == "\x00" {
					body = ""
				}
				answer = ledger.ParseActor(body)
			case "trailers":
				var acts []ledger.Entry
				if err := json.Unmarshal([]byte(body), &acts); err != nil {
					t.Fatal(err)
				}
				answer = map[string][]string{"lines": ledger.TrailersFor(acts)}
			case "act":
				var held struct {
					Now   int64
					Entry ledger.Entry
				}
				readPair(t, body, &held.Now, &held.Entry)
				answer = map[string]string{"said": ledger.SayAct(held.Entry, held.Now)}
			case "commit":
				var held struct {
					Now   int64
					Touch git.CommitTouch
				}
				readPair(t, body, &held.Now, &held.Touch)
				answer = map[string]string{"said": ledger.SayCommit(held.Touch, held.Now)}
			default:
				t.Fatalf("no reader called %s", what)
			}
			if got := stable(t, answer); got != one.Serialized {
				t.Errorf("read differently:\n got %s\nwant %s", got, one.Serialized)
			}
		})
	}
}

// readPair is a case written as `[now, value]`: the clock is given so that "2 hours ago" is a
// fact both implementations answer the same, rather than one that goes stale between them.
func readPair(t *testing.T, body string, now *int64, value any) {
	t.Helper()
	var pair []json.RawMessage
	if err := json.Unmarshal([]byte(body), &pair); err != nil || len(pair) != 2 {
		t.Fatalf("a case wants [now, value]: %v", err)
	}
	if err := json.Unmarshal(pair[0], now); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(pair[1], value); err != nil {
		t.Fatal(err)
	}
}

// A notebook, which is the one grammar here whose writing is not canonical: a save merges the
// model back into the JSON it was parsed from, so the bytes a case owes depend on what was
// edited as much as on what was read. A case is an edit and the file it is made to, and the
// cases with no edit at all are the ones that prove a notebook nobody changed comes back as the
// very bytes that went in.
func TestNotebookWritesWhatTheTypeScriptWrites(t *testing.T) {
	for _, one := range load(t, "notebook") {
		t.Run(one.Name, func(t *testing.T) {
			edits, source := splitNotebook(t, one.Source)
			parsed, err := notebook.Parse(source)
			if one.Error != "" {
				if err == nil {
					t.Fatal("accepted what the TypeScript refused")
				}
				if err.Error() != one.Error {
					t.Errorf("refused in different words:\n got %q\nwant %q", err, one.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("refused what the TypeScript accepted: %v", err)
			}
			if parsed.Language != one.Language {
				t.Errorf("language is %q, want %q", parsed.Language, one.Language)
			}
			got, err := notebook.Serialize(applyEdits(t, parsed, edits), source)
			if err != nil {
				t.Fatalf("would not write back what it read: %v", err)
			}
			if got != one.Serialized {
				t.Errorf("wrote different bytes:\n got %q\nwant %q", got, one.Serialized)
			}
		})
	}
}

// Saving what a save wrote changes nothing further, which is what keeps a notebook out of a
// diff it did not earn.
func TestNotebookRoundTripsTheBytesItWrites(t *testing.T) {
	for _, one := range load(t, "notebook") {
		if one.Error != "" {
			continue
		}
		t.Run(one.Name, func(t *testing.T) {
			again, err := notebook.Parse(one.Serialized)
			if err != nil {
				t.Fatalf("refused its own output: %v", err)
			}
			got, err := notebook.Serialize(again, one.Serialized)
			if err != nil {
				t.Fatal(err)
			}
			if got != one.Serialized {
				t.Errorf("a second save moved bytes:\n got %q\nwant %q", got, one.Serialized)
			}
		})
	}
}

type notebookEdit struct {
	Op    string            `json:"op"`
	At    int               `json:"at"`
	To    int               `json:"to"`
	Type  notebook.CellType `json:"type"`
	ID    string            `json:"id"`
	Text  string            `json:"text"`
	Count *float64          `json:"count"`
}

func splitNotebook(t *testing.T, source string) ([]notebookEdit, string) {
	t.Helper()
	head, body, found := strings.Cut(source, "\x01")
	if !found {
		t.Fatal("a notebook case is an edit and the file it is made to")
	}
	var edits []notebookEdit
	if err := json.Unmarshal([]byte(head), &edits); err != nil {
		t.Fatal(err)
	}
	return edits, body
}

func applyEdits(t *testing.T, held notebook.Notebook, edits []notebookEdit) notebook.Notebook {
	t.Helper()
	cells := slices.Clone(held.Cells)
	for _, edit := range edits {
		switch edit.Op {
		case "source":
			cells[edit.At].Source = edit.Text
		case "type":
			cells[edit.At].Type = edit.Type
		case "count":
			cells[edit.At].ExecutionCount = edit.Count
		case "clear":
			cells[edit.At].Outputs = nil
		case "keep":
			cells[edit.At].Outputs = cells[edit.At].Outputs[:edit.To]
		case "drop":
			cells = slices.Delete(cells, edit.At, edit.At+1)
		case "add":
			cells = slices.Insert(cells, edit.At, notebook.Cell{
				ID: edit.ID, Type: edit.Type, Source: edit.Text,
			})
		case "move":
			moved := cells[edit.At]
			cells = slices.Insert(slices.Delete(cells, edit.At, edit.At+1), edit.To, moved)
		default:
			t.Fatalf("no edit called %s", edit.Op)
		}
	}
	held.Cells = cells
	return held
}

// The lines a schedule trigger becomes in the user's crontab, and what keeping them does to the
// rest of the file. Cron is a program neither daemon owns: one that spelled a line differently
// would rewrite everybody's crontab on the first beat after a switch, and one that kept the block
// differently would eat the lines somebody put there by hand.
func TestCrontabWritesWhatTheTypeScriptWrites(t *testing.T) {
	for _, one := range load(t, "crontab") {
		t.Run(one.Name, func(t *testing.T) {
			what, body, found := strings.Cut(one.Source, "\x01")
			if !found {
				t.Fatalf("case %q names no reader", one.Name)
			}
			held, err := readCrontab(t, what, body)
			if one.Error != "" {
				if err == nil {
					t.Fatal("accepted what the TypeScript refused")
				}
				if err.Error() != one.Error {
					t.Errorf("refused in different words:\n got %q\nwant %q", err, one.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("refused what the TypeScript took: %v", err)
			}
			if got := stable(t, held); got != one.Serialized {
				t.Errorf("written differently:\n got %s\nwant %s", got, one.Serialized)
			}
		})
	}
}

func readCrontab(t *testing.T, what, body string) (any, error) {
	t.Helper()
	switch what {
	case "lines":
		fields := strings.SplitN(body, "\x01", 4)
		if len(fields) != 4 {
			t.Fatalf("a lines case wants a url, a root, a path and a task")
		}
		held, err := task.Parse(fields[3])
		if err != nil {
			return nil, err
		}
		scheduled := []tasks.Scheduled{{
			Ref:  doc.Ref{Root: doc.Root(fields[1]), Path: doc.Path(fields[2])},
			Task: held,
		}}
		return map[string]any{"lines": tasks.ScheduleLines(scheduled, fields[0])}, nil
	case "merge":
		held, current, found := strings.Cut(body, "\x01")
		if !found {
			t.Fatalf("a merge case wants lines and a crontab")
		}
		var lines []string
		if err := json.Unmarshal([]byte(held), &lines); err != nil {
			t.Fatal(err)
		}
		crontab := &heldCrontab{text: current}
		if err := tasks.NewCrontab(crontab).Sync(lines); err != nil {
			t.Fatal(err)
		}
		return map[string]any{"crontab": crontab.text}, nil
	}
	t.Fatalf("no reader called %s", what)
	return nil, nil
}

// heldCrontab is a crontab that is only a string, the way the corpus was written from one.
type heldCrontab struct{ text string }

func (c *heldCrontab) Read() (string, error)   { return c.text, nil }
func (c *heldCrontab) Write(next string) error { c.text = next; return nil }

// What a checkout's own remote is called on GitHub, and what counts as an address for one. A task
// that names no repository means "this one", so a daemon that read a remote differently would
// comment on somebody else's issue — or on nobody's.
func TestGithubReadsARemoteTheWayTheTypeScriptReadsIt(t *testing.T) {
	for _, one := range load(t, "github") {
		t.Run(one.Name, func(t *testing.T) {
			what, body, found := strings.Cut(one.Source, "\x01")
			if !found {
				t.Fatalf("case %q names no reader", one.Name)
			}
			var held any
			switch what {
			case "slug":
				// Empty here is null there: Go has no third answer to "which repository", and a
				// remote that is not GitHub's is a remote with no slug either way.
				if slug := github.RemoteSlug(body); slug != "" {
					held = map[string]any{"slug": slug}
				} else {
					held = map[string]any{"slug": nil}
				}
			case "is-slug":
				held = map[string]any{"slug": github.IsSlug(body)}
			default:
				t.Fatalf("no reader called %s", what)
			}
			if got := stable(t, held); got != one.Serialized {
				t.Errorf("read differently:\n got %s\nwant %s", got, one.Serialized)
			}
		})
	}
}

// The standing brief: what an agent is told about where it is standing, before anybody tells it
// anything else. It is the longest single thing either daemon writes and the one nobody diffs by
// eye, so a paragraph dropped in the port would be invisible until an agent behaved oddly a week
// later.
func TestBriefSaysWhatTheTypeScriptSays(t *testing.T) {
	for _, one := range load(t, "brief") {
		t.Run(one.Name, func(t *testing.T) {
			var state briefState
			if err := json.Unmarshal([]byte(one.Source), &state); err != nil {
				t.Fatal(err)
			}
			held := map[string]any{"brief": brief.Write(state.state())}
			if got := stable(t, held); got != one.Serialized {
				t.Errorf("wrote a different brief:\n%s", firstDifference(got, one.Serialized))
			}
		})
	}
}

// briefState is the case as it is written down, which is the TypeScript's own shape: the nullable
// fields are pointers there and empty strings here.
type briefState struct {
	API     string `json:"api"`
	Surface string `json:"surface"`
	Profile *string
	Soul    *string
	Project *struct{ Name, Path, Checkout string }
	Repos   []struct{ Name, Path string }
	Skills  []struct{ Name, Description string }
	// Personas is spelled the way the TypeScript spells it; the Go package calls the type a
	// persona and the field a voice, which is the same list.
	Personas []struct{ Name, Description string }
	Scope    string `json:"scope"`
	Cwd      string `json:"cwd"`
	Sync     string `json:"sync"`
}

func (b briefState) state() brief.State {
	held := brief.State{
		API:     b.API,
		Surface: brief.Surface(b.Surface),
		Scope:   doc.Root(b.Scope),
		Cwd:     b.Cwd,
		Sync:    brief.Sync(b.Sync),
	}
	if b.Profile != nil {
		held.Profile = *b.Profile
	}
	if b.Soul != nil {
		held.Soul = *b.Soul
	}
	if b.Project != nil {
		held.Project = &brief.Project{
			Name: b.Project.Name, Path: b.Project.Path, Checkout: b.Project.Checkout,
		}
	}
	for _, repo := range b.Repos {
		held.Repos = append(held.Repos, brief.Repo{Name: repo.Name, Path: repo.Path})
	}
	for _, skill := range b.Skills {
		held.Skills = append(held.Skills, skills.Skill{Name: skill.Name, Description: skill.Description})
	}
	for _, voice := range b.Personas {
		held.Personas = append(held.Personas, personas.Persona{Name: voice.Name, Description: voice.Description})
	}
	return held
}

// firstDifference is where two long texts part company, since a whole brief printed twice is not
// something anybody reads.
func firstDifference(got, want string) string {
	mine, theirs := strings.Split(got, "\\n"), strings.Split(want, "\\n")
	for at := 0; at < len(mine) || at < len(theirs); at++ {
		this, that := "", ""
		if at < len(mine) {
			this = mine[at]
		}
		if at < len(theirs) {
			that = theirs[at]
		}
		if this != that {
			return "line " + strconv.Itoa(at+1) + ":\n got " + strconv.Quote(this) +
				"\nwant " + strconv.Quote(that)
		}
	}
	return "no line differs, but the texts do"
}

// Who an agent is told they are, and who else is in the room. The roster and the two rungs either
// side are a paragraph assembled from names, and a comma placed differently in the port would read
// as a different team.
func TestAgentBriefSaysWhatTheTypeScriptSays(t *testing.T) {
	for _, one := range load(t, "agent-brief") {
		t.Run(one.Name, func(t *testing.T) {
			var held struct {
				Base  string
				Voice struct {
					Name           string
					Persona        string
					PersonaBody    *string
					Profile        *string
					AttachmentsAbs string
					Attachments    string
					Team           *struct {
						Lead     *string
						Reports  []string
						Everyone []struct {
							Name    string
							Purpose string
							Lead    *string
						}
					}
				}
			}
			if err := json.Unmarshal([]byte(one.Source), &held); err != nil {
				t.Fatal(err)
			}
			voice := brief.Voice{
				Name:           held.Voice.Name,
				Persona:        held.Voice.Persona,
				PersonaBody:    text(held.Voice.PersonaBody),
				Profile:        text(held.Voice.Profile),
				AttachmentsAbs: held.Voice.AttachmentsAbs,
				Attachments:    held.Voice.Attachments,
			}
			if said := held.Voice.Team; said != nil {
				team := brief.Team{Lead: text(said.Lead), Reports: said.Reports}
				for _, one := range said.Everyone {
					team.Everyone = append(team.Everyone, brief.Colleague{
						Name: one.Name, Purpose: one.Purpose, Lead: text(one.Lead),
					})
				}
				voice.Team = &team
			}
			answer := map[string]any{"brief": brief.Agent(held.Base, voice)}
			if got := stable(t, answer); got != one.Serialized {
				t.Errorf("wrote a different brief:\n%s", firstDifference(got, one.Serialized))
			}
		})
	}
}

// text is a nullable string as Go holds one: absent and empty are the same answer here, because
// every field this reads means "nothing said" either way.
func text(held *string) string {
	if held == nil {
		return ""
	}
	return *held
}
