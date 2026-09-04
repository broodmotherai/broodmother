// The projects on this machine: what there is, which one is open, and making or removing one.
// Nothing here opens a checkout itself — it records the choice and asks for the project to be
// reopened, because what a checkout carries is a question of watchers and git rather than of
// config.

package api

import (
	"encoding/json"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/config"
	"github.com/broodmotherai/broodmother/daemon/internal/project"
)

type GetProjects struct {
	Home     string            `json:"home"`
	Projects []project.Summary `json:"projects"`
	Active   *project.Summary  `json:"active"`
}

func putConfig(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
	next, err := parse(r, config.Parse)
	if err != nil {
		return nil, err
	}
	saved, err := ctx.Workspace.SetConfig(next)
	if err != nil {
		return nil, err
	}
	return map[string]any{"config": saved}, nil
}

// newProjectBody and newRepoBody are the same shape but for the repo's extra field, so the git
// half of each is proved once.
func newProjectBody(raw json.RawMessage) (project.New, error) {
	var body struct {
		Name      string  `json:"name"`
		Git       string  `json:"git"`
		RemoteURL *string `json:"remoteUrl"`
		Branch    *string `json:"branch"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Name == "" {
		return project.New{}, apperr.BadRequestf("body must name the project")
	}
	kind, err := gitKind(body.Git)
	if err != nil {
		return project.New{}, err
	}
	return project.New{
		Name: body.Name, Git: kind,
		RemoteURL: orEmpty(body.RemoteURL), Branch: orEmpty(body.Branch),
	}, nil
}

func gitKind(said string) (project.Kind, error) {
	switch project.Kind(said) {
	case project.NoGit, project.Local, project.Remote:
		return project.Kind(said), nil
	}
	return "", apperr.BadRequestf(`git must be "none", "local" or "remote"`)
}

// orEmpty is what a body left out, read as nothing said. The remote is one a person pastes, as
// something git can clone — see [config.NormalizeRemote]; a credential embedded in it is refused,
// because this file syncs.
func orEmpty(said *string) string {
	if said == nil {
		return ""
	}
	return *said
}

var projectsTable = Table{
	"POST /api/projects": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, newProjectBody)
		if err != nil {
			return nil, err
		}
		made, err := ctx.Workspace.AddProject(input)
		if err != nil {
			return nil, err
		}
		return map[string]any{"project": made, "config": ctx.Config()}, nil
	},

	"DELETE /api/projects": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		name, err := query(r, "name")
		if err != nil {
			return nil, err
		}
		active, err := ctx.Workspace.RemoveProject(name)
		if err != nil {
			return nil, err
		}
		return map[string]any{"active": active, "config": ctx.Config()}, nil
	},

	"GET /api/projects": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		all, err := ctx.Workspace.ListProjects()
		if err != nil {
			return nil, err
		}
		return GetProjects{Home: ctx.Home, Projects: all, Active: ctx.Workspace.Project()}, nil
	},

	"POST /api/projects/open": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		path, err := parse(r, named("path"))
		if err != nil {
			return nil, err
		}
		saved, err := ctx.Workspace.OpenProject(path)
		if err != nil {
			return nil, err
		}
		return map[string]any{"config": saved}, nil
	},

	"PUT /api/projects": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		name, err := parse(r, named("profile"))
		if err != nil {
			return nil, err
		}
		open, err := ctx.Profiles.Select(name)
		if err != nil {
			return nil, err
		}
		return map[string]any{"project": open}, nil
	},
}
