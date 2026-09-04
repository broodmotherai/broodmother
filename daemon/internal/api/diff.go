// Two branches compared whole.

package api

import (
	"net/http"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

// basisOf: anything but the word `split` is `now`, the way the TypeScript reads it — a basis is
// a choice between two pictures rather than a field to be refused over.
func basisOf(r *http.Request) git.Basis {
	if r.URL.Query().Get("basis") == string(git.Split) {
		return git.Split
	}
	return git.Now
}

var diffTable = Table{
	"GET /api/diff": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, against, err := comparing(r)
		if err != nil {
			return nil, err
		}
		files, err := ctx.Branches.Diff(root, against, basisOf(r))
		if err != nil {
			return nil, err
		}
		return map[string]any{"files": files}, nil
	},

	"GET /api/diff/file": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, against, err := comparing(r)
		if err != nil {
			return nil, err
		}
		path, err := query(r, "path")
		if err != nil {
			return nil, err
		}
		return ctx.Branches.DiffFile(root, against, doc.Path(path), basisOf(r))
	},
}

// comparing is the root a diff is asked of and the branch it is held against.
func comparing(r *http.Request) (doc.Root, string, error) {
	root, err := rootOf(r)
	if err != nil {
		return "", "", err
	}
	against, err := query(r, "against")
	if err != nil {
		return "", "", err
	}
	return root, against, nil
}
