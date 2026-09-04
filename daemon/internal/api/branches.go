package api

import (
	"encoding/json"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/branch"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/repo"
)

type GetBranches struct {
	Branches []branch.Branch `json:"branches"`
	// Active is the branch of the open checkout, or null when there is no repository.
	Active *string `json:"active"`
}

var branchesTable = Table{
	"GET /api/branches": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, err := rootOf(r)
		if err != nil {
			return nil, err
		}
		branches, active, err := ctx.Branches.List(root)
		if err != nil {
			return nil, err
		}
		answer := GetBranches{Branches: branches}
		if active != "" {
			answer.Active = &active
		}
		return answer, nil
	},

	"POST /api/branches": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		body, err := parse(r, branchBody)
		if err != nil {
			return nil, err
		}
		made, err := ctx.Branches.Add(body.Root, body.Name)
		if err != nil {
			return nil, err
		}
		return map[string]any{"branch": made, "config": ctx.Config()}, nil
	},

	"POST /api/branches/open": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		body, err := parse(r, branchBody)
		if err != nil {
			return nil, err
		}
		opened, err := ctx.Branches.Open(body.Root, body.Name)
		if err != nil {
			return nil, err
		}
		return map[string]any{"branch": opened, "config": ctx.Config()}, nil
	},

	"DELETE /api/branches": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, err := rootOf(r)
		if err != nil {
			return nil, err
		}
		name, err := query(r, "name")
		if err != nil {
			return nil, err
		}
		left, err := ctx.Branches.Remove(root, name)
		if err != nil {
			return nil, err
		}
		return map[string]any{"branches": left, "config": ctx.Config()}, nil
	},
}

type branchWrite struct {
	Root doc.Root `json:"root"`
	Name string   `json:"name"`
}

func branchBody(raw json.RawMessage) (branchWrite, error) {
	var body branchWrite
	if json.Unmarshal(raw, &body) != nil || body.Root == "" || body.Name == "" {
		return branchWrite{}, apperr.BadRequestf("body must name a root and a name")
	}
	return body, nil
}

func newRepoBody(raw json.RawMessage) (repo.New, error) {
	made, err := newProjectBody(raw)
	if err != nil {
		return repo.New{}, err
	}
	return repo.New{Name: made.Name, Git: made.Git, RemoteURL: made.RemoteURL, Branch: made.Branch}, nil
}
