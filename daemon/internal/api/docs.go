package api

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/browser"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon/internal/links"
	"github.com/broodmotherai/broodmother/daemon/internal/relay"
	"github.com/broodmotherai/broodmother/daemon/internal/tree"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

// GetTree is every tree at once: they are one sidebar, and they change together. The repos'
// are read fresh off their checkouts per call, the way a repo is opened everywhere else in
// this daemon.
type GetTree struct {
	Project        []doc.Entry     `json:"project"`
	ProjectChanges git.TreeChanges `json:"projectChanges"`
	Repos          []RepoTree      `json:"repos"`
}

type RepoTree struct {
	Name    string          `json:"name"`
	Entries []doc.Entry     `json:"entries"`
	Changes git.TreeChanges `json:"changes"`
}

// repoTrees is every repo's tree, each standing on whichever checkout the config has it open on.
// A repo whose folder will not read files an empty tree rather than failing the route: the
// project's documents are still worth drawing without it.
func repoTrees(ctx *app.Context) []RepoTree {
	held := ctx.Workspace.Project()
	if held == nil {
		return []RepoTree{}
	}
	found := []RepoTree{}
	for _, one := range ctx.Workspace.Repos() {
		branch := tree.New(ctx.Workspace.RepoCheckout(held.Path, one.Name))
		entries, err := branch.List()
		if err != nil {
			entries = []doc.Entry{}
		}
		found = append(found, RepoTree{Name: one.Name, Entries: entries, Changes: branch.Changes()})
	}
	return found
}

type GetLinks struct {
	Backlinks []links.Backlink `json:"backlinks"`
	Outbound  []links.Backlink `json:"outbound"`
}

type MovedDoc struct {
	To doc.Path `json:"to"`
	// LinksRewritten is how many other documents had to be edited to keep pointing at this one,
	// which is the whole reason moving a document is a route rather than `mv`.
	LinksRewritten int `json:"linksRewritten"`
}

var docsTable = Table{
	"GET /api/tree": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		open, err := ctx.Root(doc.Project)
		if err != nil {
			return nil, err
		}
		entries, err := open.Tree.List()
		if err != nil {
			return nil, err
		}
		return GetTree{Project: entries, ProjectChanges: open.Tree.Changes(), Repos: repoTrees(ctx)}, nil
	},

	"GET /api/doc": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		open, path, err := where(r, ctx)
		if err != nil {
			return nil, err
		}
		markdown, err := open.Tree.Read(path)
		if err != nil {
			return nil, err
		}
		return map[string]any{"markdown": markdown}, nil
	},

	"PUT /api/doc": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		body, err := parse(r, docBody)
		if err != nil {
			return nil, err
		}
		if _, err := ctx.WriteDoc(body.Root, body.Path, body.Markdown, actorOf(r)); err != nil {
			return nil, err
		}
		return okAnswer{true}, nil
	},

	// An empty folder. Nothing is written into it, so there is no link index to update and
	// nothing for a commit to carry — git does not track a directory, only the files in one. The
	// tree still hears about it, because the sidebar draws the disk rather than the repo.
	"POST /api/folder": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		body, err := parse(r, folderBody)
		if err != nil {
			return nil, err
		}
		open, err := ctx.Root(body.Root)
		if err != nil {
			return nil, err
		}
		made, err := open.Tree.Mkdir(body.Path)
		if err != nil {
			return nil, err
		}
		ctx.Broadcast(relay.TreeEvent(body.Root, doc.Event{Type: doc.Created, Path: made}))
		return okAnswer{true}, nil
	},

	"POST /api/doc/move": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		body, err := parse(r, moveBody)
		if err != nil {
			return nil, err
		}
		open, err := ctx.Root(body.Root)
		if err != nil {
			return nil, err
		}
		open.Suppress(body.From, body.To)
		from, to, err := open.Tree.Move(body.From, body.To)
		if err != nil {
			return nil, err
		}
		// Wikilinks are a project idea, so only a project has links to put right afterwards.
		rewritten := 0
		if body.Root == doc.Project {
			if rewritten, err = open.Links.RewriteForMove(from, to); err != nil {
				return nil, err
			}
			ctx.NoteEdit()
		}
		// Filed against where it landed, saying where it came from: a path is how the ledger is
		// asked, and after a move the only path anybody has is the new one.
		ctx.RecordAct(ledger.New{Root: body.Root, Path: to, Action: ledger.Move,
			Actor: actorOf(r), Note: from})
		ctx.Broadcast(relay.TreeEvent(body.Root, doc.Event{Type: doc.Moved, From: from, To: to}))
		return MovedDoc{To: to, LinksRewritten: rewritten}, nil
	},

	"DELETE /api/doc": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		open, path, err := where(r, ctx)
		if err != nil {
			return nil, err
		}
		open.Suppress(path)
		removed, err := open.Tree.Remove(path)
		if err != nil {
			return nil, err
		}
		root, _ := rootOf(r)
		if root == doc.Project {
			open.Links.Forget(removed)
			ctx.NoteEdit()
		}
		ctx.RecordAct(ledger.New{Root: root, Path: removed, Action: ledger.Delete, Actor: actorOf(r)})
		ctx.Broadcast(relay.TreeEvent(root, doc.Event{Type: doc.Removed, Path: removed}))
		return okAnswer{true}, nil
	},

	// The bytes of a file, for the things in a tree that are not text. `/api/doc` reads as UTF-8,
	// which turns a PNG into replacement characters — and turns saving it back into losing it.
	// The path goes through the tree's own resolution, so this reaches nothing a document could
	// not.
	"GET /api/file": func(w http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, err := rootOf(r)
		if err != nil {
			return nil, err
		}
		return Written{}, bytesOf(w, ctx, root, r.URL.Query().Get("path"))
	},

	// The same bytes under a path, for a document that is rendered rather than read. A page
	// resolves its own `href` and `src` against the folder it appears to sit in, and under the
	// query above every page appears to sit in the site root — so the stylesheet beside a report
	// is asked for from a place it was never written. Here the address says where the file is,
	// and the things next to it are next to it.
	"GET /api/file/{root}/{path...}": func(w http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, err := doc.ParseRoot(r.PathValue("root"))
		if err != nil {
			return nil, apperr.BadRequestf(`root must be "project" or "repo:<name>"`)
		}
		return Written{}, bytesOf(w, ctx, root, r.PathValue("path"))
	},

	"GET /api/links": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		open, err := ctx.Root(doc.Project)
		if err != nil {
			return nil, err
		}
		asked, err := query(r, "path")
		if err != nil {
			return nil, err
		}
		path, err := utils.Normalize(asked)
		if err != nil {
			return nil, err
		}
		return GetLinks{Backlinks: open.Links.Backlinks(path), Outbound: open.Links.Outbound(path)}, nil
	},
}

type okAnswer struct {
	OK bool `json:"ok"`
}

// where is the tree a read names and the path inside it. Every read names one, the same way
// every write does.
func where(r *http.Request, ctx *app.Context) (*app.Open, string, error) {
	root, err := rootOf(r)
	if err != nil {
		return nil, "", err
	}
	open, err := ctx.Root(root)
	if err != nil {
		return nil, "", err
	}
	path, err := query(r, "path")
	if err != nil {
		return nil, "", err
	}
	return open, path, nil
}

func rootOf(r *http.Request) (doc.Root, error) {
	root, err := doc.ParseRoot(r.URL.Query().Get("root"))
	if err != nil {
		return "", apperr.BadRequestf(`root must be "project" or "repo:<name>"`)
	}
	return root, nil
}

type docWrite struct {
	Root     doc.Root `json:"root"`
	Path     string   `json:"path"`
	Markdown string   `json:"markdown"`
}

func docBody(raw json.RawMessage) (docWrite, error) {
	var body docWrite
	if json.Unmarshal(raw, &body) != nil {
		return docWrite{}, apperr.BadRequestf("body must name a root, a path and markdown")
	}
	if body.Root == "" || body.Path == "" {
		return docWrite{}, apperr.BadRequestf("body must name a root and a path")
	}
	return body, nil
}

type folderWrite struct {
	Root doc.Root `json:"root"`
	Path string   `json:"path"`
}

func folderBody(raw json.RawMessage) (folderWrite, error) {
	var body folderWrite
	if json.Unmarshal(raw, &body) != nil || body.Root == "" || body.Path == "" {
		return folderWrite{}, apperr.BadRequestf("body must name a root and a path")
	}
	return body, nil
}

type moveWrite struct {
	Root doc.Root `json:"root"`
	From string   `json:"from"`
	To   string   `json:"to"`
}

func moveBody(raw json.RawMessage) (moveWrite, error) {
	var body moveWrite
	if json.Unmarshal(raw, &body) != nil || body.Root == "" || body.From == "" || body.To == "" {
		return moveWrite{}, apperr.BadRequestf("body must name a root, a from and a to")
	}
	return body, nil
}

// bytesOf is what both file routes answer with. They differ only in where they read the address
// from; what may be served, and what a path is allowed to reach, is one rule.
func bytesOf(w http.ResponseWriter, ctx *app.Context, root doc.Root, path string) error {
	if path == "" {
		return apperr.BadRequestf("missing path")
	}
	kind := browser.ServedTypeOf(path)
	if kind == "" {
		return apperr.BadRequestf("not a file this serves")
	}
	open, err := ctx.Root(root)
	if err != nil {
		return err
	}
	absolute, err := open.Tree.Resolve(path)
	if err != nil {
		return err
	}
	body, err := os.ReadFile(absolute)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", kind)
	// The file is on disk and the watcher reports writes, so the answer is only good until
	// something changes it.
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	w.Write(body)
	return nil
}
