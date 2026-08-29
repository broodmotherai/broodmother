// Package tools is what a conversation can do, as the model sees it.
//
// Most of these are the things a conversation about a folder of markdown does constantly, and they
// are typed so that asking for one is one obvious call. The last is every other route the app has,
// because the brief already documents them all and a schema per route would be the route registry
// written twice, free to drift.
//
// The two entity tools are typed for a different reason: a record has to be *written*, and a tool
// with a closed schema is what makes that enforceable rather than requested. There is deliberately
// no tool taking free-form content and filing it — what comes back from `entity_record` is what it
// just wrote and the path it wrote it under, which is what makes "cite the record" something the
// app holds you to rather than something the prompt asks for. Reading one back is `read_doc`,
// because a record is an ordinary document.
//
// A description says *when* to reach for a tool and not only what it does — that is what a model
// reads to choose between them, and it is the difference between a tool that gets used correctly
// and one that gets used instead of thinking.
//
// Expected failures come back as text rather than as errors: a model reads "no such document" and
// tries something else, where an exception ends the turn.
package tools

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apicall"
	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entities"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entity"
	"github.com/broodmotherai/broodmother/daemon-go/internal/git"
	"github.com/broodmotherai/broodmother/daemon-go/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon-go/internal/llm"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tree"
)

const (
	// maxDoc is how much of a document is worth handing over whole. Past this the model is reading
	// something it asked for by mistake and paying for it by the token.
	maxDoc = 60_000
	// maxMatches is enough matches to answer a question with; more is a different question.
	maxMatches = 40
	// maxEntries is enough of a tree to see its shape.
	maxEntries = 400
)

// Deps is what the tools reach through.
type Deps struct {
	// Tree is one root's tree, for the reads that would be silly to make over HTTP.
	Tree func(root doc.Root) *tree.Tree
	// Call is everything else: the app's own routes, allowlisted.
	Call apicall.Call
	// By is what to write in a record's `by:` — `chat/<id>`, `agent/<name>`. Filled in where the
	// app builds these deps and so knows; unsaid where it does not, since the route has no caller
	// to ask and a guess would be worse than a blank.
	By string
}

// object is one JSON Schema object, written the way a provider wants it.
func object(properties map[string]any, required ...string) map[string]any {
	held := map[string]any{"type": "object", "properties": properties}
	if len(required) > 0 {
		held["required"] = required
	}
	return held
}

func field(kind, description string) map[string]any {
	return map[string]any{"type": kind, "description": description}
}

func rootField() map[string]any {
	return field("string", "which tree: 'project', or 'repo:<name>' — the brief lists what there is")
}

// Chat is what the chat page can do.
func Chat(deps Deps) []llm.Tool {
	return []llm.Tool{
		{
			Name: "list_tree",
			Description: "The documents and folders in a tree, as paths. Start here when you do not " +
				"already know what a project holds.",
			Schema: object(map[string]any{
				"root":   rootField(),
				"folder": field("string", "only what is under this folder; unsaid is the whole tree"),
			}, "root"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, Folder string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				paths, err := filesIn(deps, said.Root)
				if err != nil {
					return "", err
				}
				under := paths
				if said.Folder != "" {
					prefix := strings.TrimSuffix(said.Folder, "/") + "/"
					under = nil
					for _, path := range paths {
						if strings.HasPrefix(string(path), prefix) {
							under = append(under, path)
						}
					}
				}
				shown := under
				if len(shown) > maxEntries {
					shown = shown[:maxEntries]
				}
				lines := make([]string, 0, len(shown))
				for _, path := range shown {
					lines = append(lines, string(path))
				}
				said_ := strings.Join(lines, "\n")
				if said_ == "" {
					said_ = "(nothing here)"
				}
				if len(under) > len(shown) {
					said_ += "\n[…and " + strconv.Itoa(len(under)-len(shown)) + " more]"
				}
				return said_, nil
			}),
		},
		{
			Name:        "read_doc",
			Description: "A document's markdown as it is on disk — the source, not what the editor draws.",
			Schema:      object(map[string]any{"root": rootField(), "path": field("string", "")}, "root", "path"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, Path string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				held, err := treeOf(deps, said.Root)
				if err != nil {
					return "", err
				}
				text, err := held.Read(said.Path)
				if err != nil {
					return "", err
				}
				if len(text) <= maxDoc {
					return text, nil
				}
				return text[:maxDoc] + "\n\n[…cut after " + strconv.Itoa(maxDoc) +
					" characters of " + strconv.Itoa(len(text)) + "]", nil
			}),
		},
		{
			Name: "search_docs",
			Description: "Which documents in a tree mention something, with the lines they mention it on. " +
				"There is no grep here; this is it.",
			Schema: object(map[string]any{
				"root":  rootField(),
				"query": field("string", "the text to look for, matched without case"),
			}, "root", "query"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, Query string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				held, err := treeOf(deps, said.Root)
				if err != nil {
					return "", err
				}
				paths, err := filesIn(deps, said.Root)
				if err != nil {
					return "", err
				}
				wanted := strings.ToLower(said.Query)
				found := []string{}
				for _, path := range paths {
					if len(found) >= maxMatches {
						break
					}
					text, err := held.Read(string(path))
					if err != nil {
						continue
					}
					// A file read as text that was never text: skipped rather than reported as a
					// page of replacement characters that happened to contain the query.
					if strings.ContainsRune(text, 0) {
						continue
					}
					for at, line := range strings.Split(text, "\n") {
						if !strings.Contains(strings.ToLower(line), wanted) {
							continue
						}
						found = append(found, string(path)+":"+strconv.Itoa(at+1)+": "+cut(strings.TrimSpace(line), 200))
						if len(found) >= maxMatches {
							break
						}
					}
				}
				if len(found) == 0 {
					return "nothing in " + said.Root + " mentions " + said.Query, nil
				}
				return strings.Join(found, "\n"), nil
			}),
		},
		{
			Name: "edit_doc",
			Description: "Replace one exact stretch of a document. `find` has to appear exactly once, so " +
				"include enough around it to be sure. Prefer this to write_doc: someone may have " +
				"the document open beside you, and writing it whole takes their unsaved work with it.",
			Schema: object(map[string]any{
				"root":    rootField(),
				"path":    field("string", ""),
				"find":    field("string", "the text to replace, exactly as it appears"),
				"replace": field("string", "what goes in its place"),
			}, "root", "path", "find", "replace"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, Path, Find, Replace string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				held, err := treeOf(deps, said.Root)
				if err != nil {
					return "", err
				}
				text, err := held.Read(said.Path)
				if err != nil {
					return "", err
				}
				hits := strings.Count(text, said.Find)
				if hits == 0 {
					return `{"error": "that text is not in ` + said.Path + `"}`, nil
				}
				if hits > 1 {
					return `{"error": "that text is in ` + said.Path + ` ` + strconv.Itoa(hits) +
						` times — say more of it"}`, nil
				}
				_, err = deps.Call("PUT", "/api/doc", map[string]any{
					"root": said.Root, "path": said.Path,
					"markdown": strings.Replace(text, said.Find, said.Replace, 1),
				})
				if err != nil {
					return "", err
				}
				return "edited " + said.Path, nil
			}),
		},
		{
			Name: "write_doc",
			Description: "Write a whole document, replacing whatever was there. Read it first unless you " +
				"are making it. Folders on the way are made for you. A .task or .canvas that will " +
				"not parse is refused rather than written broken.",
			Schema: object(map[string]any{
				"root": rootField(), "path": field("string", ""), "markdown": field("string", ""),
			}, "root", "path", "markdown"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, Path, Markdown string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				if _, err := deps.Call("PUT", "/api/doc", map[string]any{
					"root": said.Root, "path": said.Path, "markdown": said.Markdown,
				}); err != nil {
					return "", err
				}
				return "wrote " + said.Path, nil
			}),
		},
		{
			Name: "move_doc",
			Description: "Move a document, rewriting every wikilink that points at it. Use this rather " +
				"than writing the new one and deleting the old, which leaves those links broken.",
			Schema: object(map[string]any{
				"root": rootField(), "from": field("string", ""), "to": field("string", ""),
			}, "root", "from", "to"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, From, To string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				return deps.Call("POST", "/api/doc/move", map[string]any{
					"root": said.Root, "from": said.From, "to": said.To,
				})
			}),
		},
		{
			Name:        "delete_doc",
			Description: "Take a document off disk. There is no undo but git.",
			Schema:      object(map[string]any{"root": rootField(), "path": field("string", "")}, "root", "path"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, Path string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				if _, err := deps.Call("DELETE", "/api/doc", map[string]any{
					"root": said.Root, "path": said.Path,
				}); err != nil {
					return "", err
				}
				return "deleted " + said.Path, nil
			}),
		},
		{
			Name: "who_did",
			Description: "Who did this — the last few things the app saw done to one document, newest " +
				"first, and whose each was. Reach for it before changing anything somebody else " +
				"may have made: work you did not do belongs to whoever did it, and this is how " +
				"you find out who that is. It answers with what the app watched happen; where it " +
				"watched nothing it says so and offers what git knows instead, which is a " +
				"different and vaguer thing.",
			Schema: object(map[string]any{"root": rootField(), "path": field("string", "")}, "root", "path"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Root, Path string }
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				body, err := deps.Call("GET", "/api/ledger", map[string]any{
					"root": said.Root, "path": said.Path,
				})
				if err != nil {
					return "", err
				}
				var held struct {
					Acts []ledger.Entry   `json:"acts"`
					Git  *git.CommitTouch `json:"git"`
				}
				if err := json.Unmarshal([]byte(body), &held); err != nil {
					return "", err
				}
				now := time.Now().UnixMilli()
				if len(held.Acts) > 0 {
					lines := make([]string, 0, len(held.Acts))
					for _, one := range held.Acts {
						lines = append(lines, ledger.SayAct(one, now))
					}
					return strings.Join(lines, "\n"), nil
				}
				what := "and git has no commit touching it either"
				if held.Git != nil {
					what = ledger.SayCommit(*held.Git, now)
				}
				return "the ledger has nothing for " + said.Path +
					" — the app did not watch this one change\n" + what, nil
			}),
		},
		{
			Name: "entity_list",
			Description: "The records this project has already written down, newest first. Read this before " +
				"proposing anything: what is recorded is what the project knows, and a finding you " +
				"restate is one you did not read. Each row is a path you can cite and open.",
			Schema: object(map[string]any{
				"kind": enumField(kindNames(), "only records of this kind; unsaid is all of them"),
			}),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct{ Kind string }
				json.Unmarshal(input, &said)
				body, err := deps.Call("GET", "/api/entities", nil)
				if err != nil {
					return "", err
				}
				var held struct {
					Entities []entities.Summary `json:"entities"`
				}
				if err := json.Unmarshal([]byte(body), &held); err != nil {
					return "", err
				}
				wanted := held.Entities
				if said.Kind != "" {
					wanted = nil
					for _, one := range held.Entities {
						if one.Kind != nil && string(*one.Kind) == said.Kind {
							wanted = append(wanted, one)
						}
					}
				}
				shown := wanted
				if len(shown) > maxEntries {
					shown = shown[:maxEntries]
				}
				if len(shown) == 0 {
					if said.Kind != "" {
						return "no " + said.Kind + " has been recorded", nil
					}
					return "nothing has been recorded yet", nil
				}
				lines := make([]string, 0, len(shown))
				for _, one := range shown {
					lines = append(lines, entityLine(one))
				}
				return strings.Join(lines, "\n"), nil
			}),
		},
		{
			Name: "entity_record",
			Description: "Write a record down. This is the only way something you worked out becomes part of " +
				"the project: a claim in a message is not a record, and nothing can read a message " +
				"back. Say what it came from — `from` is a relation and a document that exists, or " +
				"`origin: true` where this is where the line of work started. Answers with the path " +
				"it wrote, which is what you cite afterwards. Recording the same thing twice writes " +
				"nothing and hands back the record that already says it.",
			Schema: object(map[string]any{
				"kind": enumField(kindNames(), "what sort of record this is"),
				"name": field("string", "what to call it — one line, how it will be referred to"),
				"fields": map[string]any{
					"type":                 "object",
					"additionalProperties": map[string]any{"type": "string"},
					"description":          "the keys this kind needs: " + requiredSaid(),
				},
				"from": map[string]any{
					"type":        "array",
					"description": "what this came from; leave empty only with origin",
					"items": object(map[string]any{
						"relation": enumField(relationNames(), ""),
						"target":   field("string", "a document in the project, as a wikilink writes it"),
					}, "relation", "target"),
				},
				"origin": field("boolean", "this is where a line of work started and came from nothing"),
				"body":   field("string", "the prose a person will read"),
			}, "kind", "name", "fields", "from", "body"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said map[string]any
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				if deps.By != "" {
					said["by"] = deps.By
				}
				body, err := deps.Call("POST", "/api/entities", said)
				if err != nil {
					return "", err
				}
				var held struct {
					Entity struct {
						Path string `json:"path"`
					} `json:"entity"`
					Created bool `json:"created"`
				}
				if err := json.Unmarshal([]byte(body), &held); err != nil {
					return "", err
				}
				if held.Created {
					return "recorded as " + held.Entity.Path + " — cite it by that path", nil
				}
				return "already recorded as " + held.Entity.Path +
					", unchanged — cite it by that path", nil
			}),
		},
		{
			Name: "api",
			Description: "Everything else the app can do — branches, sync, tasks, diagrams, personas, " +
				"links, and the routes that read back the state you were told about. The brief " +
				"above lists them and what each one takes. Put every parameter in `params`; where " +
				"it goes on the wire is not your problem.",
			Schema: object(map[string]any{
				"method": enumField([]string{"GET", "POST", "PUT", "DELETE"}, ""),
				"route":  field("string", "the path, starting /api/"),
				"params": map[string]any{"type": "object"},
			}, "method", "route"),
			Run: answering(func(input json.RawMessage) (string, error) {
				var said struct {
					Method string         `json:"method"`
					Route  string         `json:"route"`
					Params map[string]any `json:"params"`
				}
				if err := json.Unmarshal(input, &said); err != nil {
					return "", err
				}
				return deps.Call(said.Method, said.Route, said.Params)
			}),
		},
	}
}

// answering is how every tool reports: an expected failure comes back as text rather than thrown,
// because a model reads `{"error": "..."}` and tries something else where an exception ends the
// turn mid-sentence.
func answering(work func(input json.RawMessage) (string, error)) func(context.Context, string, json.RawMessage) string {
	return func(_ context.Context, _ string, input json.RawMessage) string {
		said, err := work(input)
		if err != nil {
			encoded, _ := json.Marshal(err.Error())
			return `{"error": ` + string(encoded) + `}`
		}
		return said
	}
}

func treeOf(deps Deps, root string) (*tree.Tree, error) {
	held, err := doc.ParseRoot(root)
	if err != nil {
		return nil, err
	}
	found := deps.Tree(held)
	if found == nil {
		return nil, apperr.BadRequestf("there is no %s open", root)
	}
	return found, nil
}

// filesIn is every file in a tree, not only its markdown.
//
// The link index's question is which `.md` files there are, and answering the chat's with it made
// a repo look almost empty: a code repository is the thing the notes are about, and a chat that
// could not see a `.ts` file could not be asked about one. What git ignores is already absent,
// since the walk reads git's own list.
func filesIn(deps Deps, root string) ([]doc.Path, error) {
	held, err := treeOf(deps, root)
	if err != nil {
		return nil, err
	}
	entries, err := held.List()
	if err != nil {
		return nil, err
	}
	found := []doc.Path{}
	var collect func([]doc.Entry)
	collect = func(entries []doc.Entry) {
		for _, entry := range entries {
			if entry.Kind == doc.Dir {
				collect(entry.Children)
				continue
			}
			found = append(found, entry.Path)
		}
	}
	collect(entries)
	return found, nil
}

// entityLine is one record as a list draws it: what it is, what it is called, and the two things
// worth knowing before opening it — where it came from, and whether it still says what it said.
func entityLine(one entities.Summary) string {
	if one.Broken != "" {
		return string(one.Path) + " — broken: " + one.Broken
	}
	from := "origin"
	if !one.Origin {
		said := make([]string, 0, len(one.From))
		for _, source := range one.From {
			said = append(said, string(source.Relation)+" "+source.Target)
		}
		from = strings.Join(said, ", ")
	}
	kind := "?"
	if one.Kind != nil {
		kind = string(*one.Kind)
	}
	edited := ""
	if one.Edited {
		edited = "  (edited since)"
	}
	return kind + "  " + one.Name + "  [" + string(one.Path) + "]  from: " + from + edited
}

// kindNames and relationNames are the catalogues as a schema's enum wants them: strings.
func kindNames() []string {
	held := make([]string, 0, len(entity.Kinds))
	for _, one := range entity.Kinds {
		held = append(held, string(one))
	}
	return held
}

func relationNames() []string {
	held := make([]string, 0, len(entity.Relations))
	for _, one := range entity.Relations {
		held = append(held, string(one))
	}
	return held
}

func enumField(values []string, description string) map[string]any {
	held := map[string]any{"type": "string", "enum": values}
	if description != "" {
		held["description"] = description
	}
	return held
}

func requiredSaid() string {
	said := make([]string, 0, len(entity.Kinds))
	for _, kind := range entity.Kinds {
		said = append(said, string(kind)+" — "+strings.Join(entity.Required[kind], ", "))
	}
	return strings.Join(said, "; ")
}

func cut(text string, at int) string {
	if len(text) <= at {
		return text
	}
	return text[:at]
}

// Title is the line a step wears in the thread: what was asked of the tool, not what came back.
func Title(name string, input json.RawMessage) string {
	var said map[string]any
	json.Unmarshal(input, &said)
	text := func(key string) string {
		held, _ := said[key].(string)
		return held
	}
	where := strings.TrimSpace(text("root") + " " + text("path"))
	if text("root") == "" {
		where = ""
	}
	switch name {
	case "list_tree":
		return strings.TrimSpace("list " + text("root") + folderSaid(text("folder")))
	case "read_doc":
		return "read " + where
	case "search_docs":
		return "search " + text("root") + " for “" + text("query") + "”"
	case "edit_doc":
		return "edit " + where
	case "write_doc":
		return "write " + where
	case "move_doc":
		return "move " + text("from") + " → " + text("to")
	case "delete_doc":
		return "delete " + where
	case "who_did":
		return "who did " + where
	case "entity_list":
		if text("kind") != "" {
			return "list " + text("kind") + " records"
		}
		return "list records"
	case "entity_record":
		return "record " + text("kind") + " “" + firstLine(text("name"), noteMax) + "”"
	case "api":
		return strings.TrimSpace(text("method") + " " + text("route"))
	// An agent's hands, which the chat has not got but the thread draws the same way.
	case "claude_code":
		return "claude: " + firstLine(text("task"), noteMax)
	case "shell":
		return "$ " + firstLine(text("command"), noteMax)
	case "list_attachments":
		return "list attachments"
	case "agent_message":
		return strings.TrimSpace("message " + text("to"))
	default:
		return name
	}
}

func folderSaid(folder string) string {
	if folder == "" {
		return ""
	}
	return " " + folder
}

// noteMax is enough of a task or a command to know which one it was.
const noteMax = 80

// firstLine is a line of it, cut where a line would be too long to read at a glance.
func firstLine(text string, at int) string {
	line := strings.TrimSpace(text)
	if to := strings.IndexByte(line, '\n'); to >= 0 {
		line = line[:to]
	}
	line = strings.TrimSpace(line)
	runes := []rune(line)
	if len(runes) <= at {
		return line
	}
	return strings.TrimRight(string(runes[:at-1]), " \t") + "…"
}
