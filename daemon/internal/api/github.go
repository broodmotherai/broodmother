// Signing in to GitHub, and the two questions a project asks once it has. The token never leaves
// the server — what the browser is told is the login.

package api

import (
	"encoding/json"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/github"
	"github.com/broodmotherai/broodmother/daemon/internal/profile"
)

// connected is the answer to one ask of the token endpoint: still waiting, or signed in and here
// is the profile as the browser may see it.
type connected struct {
	Pending bool            `json:"pending"`
	Profile profile.Profile `json:"profile"`
}

var githubTable = Table{
	/* Signing in is two requests: one that opens a code, and one asked again while the browser
	   is being answered. Holding a request open for as long as someone takes to find their
	   password is a request nobody can tell from a hang. */
	"POST /api/github/device": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return ctx.Profiles.StartGithub()
	},

	"POST /api/github/connect": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		deviceCode, err := parse(r, named("deviceCode"))
		if err != nil {
			return nil, err
		}
		pending, held, err := ctx.Profiles.ConnectGithub(deviceCode)
		if err != nil {
			return nil, err
		}
		return connected{Pending: pending, Profile: held}, nil
	},

	"DELETE /api/github": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		held, err := ctx.Profiles.DisconnectGithub()
		if err != nil {
			return nil, err
		}
		return map[string]any{"profile": held}, nil
	},

	"GET /api/github/repos": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		found, err := ctx.Profiles.GithubRepos()
		if err != nil {
			return nil, err
		}
		return map[string]any{"repos": found}, nil
	},

	"POST /api/github/repos": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, newGithubRepoBody)
		if err != nil {
			return nil, err
		}
		made, err := ctx.Profiles.CreateGithubRepo(input)
		if err != nil {
			return nil, err
		}
		return map[string]any{"repo": made}, nil
	},
}

func newGithubRepoBody(raw json.RawMessage) (github.NewRepo, error) {
	var body struct {
		Name    string `json:"name"`
		Private *bool  `json:"private"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Name == "" || body.Private == nil {
		return github.NewRepo{}, apperr.BadRequestf("body must name the repository and say whether it is private")
	}
	return github.NewRepo{Name: body.Name, Private: *body.Private}, nil
}
