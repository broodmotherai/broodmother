// The repos a project holds: what there is, making and removing one, and which of them the tabs
// are about.

package api

import (
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
)

var reposTable = Table{
	"POST /api/repos": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, newRepoBody)
		if err != nil {
			return nil, err
		}
		made, err := ctx.Workspace.AddRepo(input)
		if err != nil {
			return nil, err
		}
		return map[string]any{"repo": made, "config": ctx.Config()}, nil
	},

	"DELETE /api/repos": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		name, err := query(r, "name")
		if err != nil {
			return nil, err
		}
		if err := ctx.Workspace.RemoveRepo(name); err != nil {
			return nil, err
		}
		return map[string]any{"config": ctx.Config()}, nil
	},

	"GET /api/repos": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"repos": ctx.Workspace.Repos()}, nil
	},

	"POST /api/scope": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		to, err := parse(r, rootBody)
		if err != nil {
			return nil, err
		}
		saved, err := ctx.Workspace.SetScope(to)
		if err != nil {
			return nil, err
		}
		return map[string]any{"config": saved}, nil
	},
}
