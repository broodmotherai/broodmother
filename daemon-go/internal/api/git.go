package api

import (
	"encoding/json"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
	"github.com/broodmotherai/broodmother/daemon-go/internal/config"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/git"
)

// GetGit is what git says about the open project's checkout, and how this project is set to
// sync. Two halves of one answer: the first is read off disk, the second is the machine's own
// setting. A repo's repository is yours to commit, so nothing here speaks for it.
type GetGit struct {
	State    git.State    `json:"state"`
	Settings git.Settings `json:"settings"`
}

// GetConfig is what the daemon is running on, and which of the config's fields the last read had
// to throw away. The second is why the answer is not the config alone: a file repaired in
// silence is a setting that went missing without anybody being told.
type GetConfig struct {
	Config config.Config `json:"config"`
	Reset  []string      `json:"reset"`
}

// Writing the config settles who is working again where the open project moved, which is all of
// what it means here: restarting the sync loop and moving the watchers is the rest of it in the
// TypeScript, and neither exists yet to be restarted.
var gitTable = Table{
	"GET /api/config": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return GetConfig{Config: ctx.Config(), Reset: ctx.Store.Reset()}, nil
	},

	"PUT /api/config": putConfig,

	"GET /api/git": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return GetGit{State: ctx.GitState(), Settings: ctx.GitSettings()}, nil
	},

	"PUT /api/git": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		settings, err := parse(r, git.ParseSettings)
		if err != nil {
			return nil, err
		}
		saved, err := ctx.SetGitSettings(settings)
		if err != nil {
			return nil, err
		}
		return map[string]any{"settings": saved}, nil
	},

	// Asked on purpose rather than found out by a sync failing, and it names which of the four
	// reasons it is — `auth` on its own is not something anyone can act on.
	"POST /api/git/check": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, err := parse(r, rootBody)
		if err != nil {
			return nil, err
		}
		return ctx.CheckAccess(root)
	},
}

// rootBody is the `{ "root": … }` every write names the tree it is about with.
func rootBody(raw json.RawMessage) (doc.Root, error) {
	var held struct {
		Root string `json:"root"`
	}
	if json.Unmarshal(raw, &held) != nil {
		return "", apperr.BadRequestf(`root must be "project" or "repo:<name>"`)
	}
	root, err := doc.ParseRoot(held.Root)
	if err != nil {
		return "", apperr.BadRequestf(`root must be "project" or "repo:<name>"`)
	}
	return root, nil
}
