// The profiles: who is working, who they commit as, and what they push and speak with. Every
// write here lands in the profile's own file at 0600, and the ones that change what git offers
// reopen the project behind it — the key a checkout's git carries is fixed when it opens.

package api

import (
	"encoding/json"
	"net/http"
	"regexp"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/chat"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/github"
	"github.com/broodmotherai/broodmother/daemon/internal/profile"
	"github.com/broodmotherai/broodmother/daemon/internal/terminal"
)

type GetProfiles struct {
	Profiles []profile.Profile `json:"profiles"`
	// Active is nil until a project picks one.
	Active *profile.Profile `json:"active"`
	// GithubReady says whether this build can connect to GitHub at all. A button that cannot work
	// is worse than no button, and only a build with a client id can.
	GithubReady bool `json:"githubReady"`
	// SuggestedAuthor is who git on this machine says you are, for filling in a profile nobody
	// has made yet. Nil where git has never been told.
	SuggestedAuthor *git.Author `json:"suggestedAuthor"`
	// SuggestedSSHKey is the key ssh on this machine would use by default, for the same form.
	// Nil where there is none.
	SuggestedSSHKey *string `json:"suggestedSshKey"`
}

var profilesTable = Table{
	"GET /api/profiles": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		all, err := ctx.Profiles.List()
		if err != nil {
			return nil, err
		}
		answer := GetProfiles{
			Profiles:        all,
			Active:          ctx.Profiles.Active(),
			GithubReady:     github.Configured(),
			SuggestedAuthor: profile.MachineAuthor(ctx.Home),
		}
		if key := profile.MachineSSHKey(profile.DefaultSSHDir()); key != "" {
			answer.SuggestedSSHKey = &key
		}
		return answer, nil
	},

	"POST /api/profiles": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, newProfileBody)
		if err != nil {
			return nil, err
		}
		made, err := ctx.Profiles.Add(input)
		if err != nil {
			return nil, err
		}
		return map[string]any{"profile": made, "project": ctx.Workspace.Project()}, nil
	},

	"PUT /api/profiles": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		identity, err := parse(r, identityBody)
		if err != nil {
			return nil, err
		}
		saved, err := ctx.Profiles.SetIdentity(identity)
		if err != nil {
			return nil, err
		}
		return map[string]any{"profile": saved}, nil
	},

	"GET /api/profiles/key": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"publicKey": nullIfEmpty(ctx.Profiles.PublicKey())}, nil
	},

	"POST /api/profiles/key": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		saved, publicKey, err := ctx.Profiles.AddKey()
		if err != nil {
			return nil, err
		}
		return map[string]any{"profile": saved, "publicKey": publicKey}, nil
	},

	/* A key for one model provider, kept in the profile file the way the GitHub token is. What
	   comes back is the profile — which providers are held, and nothing they are held as. */
	"PUT /api/model-keys": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, modelKeyBody)
		if err != nil {
			return nil, err
		}
		saved, err := ctx.Profiles.SetModelKey(input.Provider, &profile.ModelKey{Type: "key", Key: input.Key})
		if err != nil {
			return nil, err
		}
		return map[string]any{"profile": saved}, nil
	},

	"DELETE /api/model-keys": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		provider, err := query(r, "provider")
		if err != nil {
			return nil, err
		}
		saved, err := ctx.Profiles.SetModelKey(provider, nil)
		if err != nil {
			return nil, err
		}
		return map[string]any{"profile": saved}, nil
	},

	/* Every service a task can reach, joined with who this profile is each of them as. The whole
	   list whether connected or not: connecting is done from this page, so a page of only the
	   connected ones would have nothing to connect from. */
	"GET /api/integrations": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		held := ctx.Profiles.Active()
		offered := make([]connectable, 0, len(integrations))
		for _, one := range integrations {
			joined := connectable{integration: one}
			if held != nil {
				if login, connected := held.Connections[one.ID]; connected {
					joined.ConnectedAs = &login
				}
			}
			offered = append(offered, joined)
		}
		return map[string]any{"integrations": offered}, nil
	},
}

// integration is a service a task can reach, and how you sign in to it. One entry per provider,
// which is what makes a second one an entry here rather than another field on the profile and
// another branch in the settings page.
//
// Nothing about the credential is here. What a connection is made of belongs to the service that
// makes it; this says only that the connection exists to be made. It is the tasks feature's in
// the TypeScript and moves there when that lands; this route is the only thing reading it today.
type integration struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// What it gives a task, in the line the settings page prints under its name.
	What string `json:"what"`
	// Connect is how signing in goes: `device` is the code you type into a page in the browser.
	Connect string `json:"connect"`
}

type connectable struct {
	integration
	// ConnectedAs is who this profile is there, or nil where it is not connected.
	ConnectedAs *string `json:"connectedAs"`
}

var integrations = []integration{{
	ID:      "github",
	Label:   "GitHub",
	What:    "Watch issues, pull requests, mentions and checks. Comment, and open pull requests.",
	Connect: "device",
}}

func newProfileBody(raw json.RawMessage) (profile.New, error) {
	var body struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Name == "" {
		return profile.New{}, apperr.BadRequestf("body must name the profile")
	}
	identity, err := identityBody(raw)
	if err != nil {
		return profile.New{}, err
	}
	return profile.New{Name: body.Name, Identity: identity}, nil
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// identityBody is the whole identity or none of it. The reader in `internal/profile` fills in
// around a field it cannot read, because a file dropped in by hand is still somebody; a request
// is not, and half an identity saved over a whole one loses the other half.
func identityBody(raw json.RawMessage) (profile.Identity, error) {
	var body struct {
		Color         string             `json:"color"`
		GitAuthor     *author            `json:"gitAuthor"`
		SSHKeyPath    *string            `json:"sshKeyPath"`
		AgentCommands *map[string]string `json:"agentCommands"`
		Soul          *string            `json:"soul"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return profile.Identity{}, apperr.BadRequestf("body must be an identity")
	}
	if !colorPattern.MatchString(body.Color) {
		return profile.Identity{}, apperr.BadRequestf("color must be #rrggbb")
	}
	if body.GitAuthor == nil || body.GitAuthor.Name == "" || body.GitAuthor.Email == "" {
		return profile.Identity{}, apperr.BadRequestf("gitAuthor must be a name and an email")
	}
	if body.SSHKeyPath != nil && *body.SSHKeyPath == "" {
		return profile.Identity{}, apperr.BadRequestf("sshKeyPath must be a path or null")
	}
	if body.Soul != nil && *body.Soul == "" {
		return profile.Identity{}, apperr.BadRequestf("soul must be a prompt or null")
	}
	if body.AgentCommands == nil {
		return profile.Identity{}, apperr.BadRequestf("agentCommands must be a line per agent")
	}
	commands, err := agentCommands(*body.AgentCommands)
	if err != nil {
		return profile.Identity{}, err
	}
	return profile.Identity{
		Color:         body.Color,
		GitAuthor:     git.Author{Name: body.GitAuthor.Name, Email: body.GitAuthor.Email},
		SSHKeyPath:    body.SSHKeyPath,
		AgentCommands: commands,
		Soul:          body.Soul,
	}, nil
}

type author struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// agentCommands: a kind left out runs the default one, and a blank line is the same as leaving it
// out — so it is refused here rather than saved as an agent that runs nothing.
func agentCommands(said map[string]string) (terminal.Commands, error) {
	commands := terminal.Commands{}
	for kind, line := range said {
		if !terminal.IsAgent(terminal.Kind(kind)) {
			return nil, apperr.BadRequestf("%q is not an agent this daemon opens", kind)
		}
		if line == "" {
			return nil, apperr.BadRequestf("the line for %s must not be blank", kind)
		}
		commands[terminal.Kind(kind)] = line
	}
	return commands, nil
}

type modelKey struct {
	Provider string `json:"provider"`
	Key      string `json:"key"`
}

func modelKeyBody(raw json.RawMessage) (modelKey, error) {
	var body modelKey
	if json.Unmarshal(raw, &body) != nil || body.Key == "" {
		return modelKey{}, apperr.BadRequestf("body must be a provider and a key")
	}
	if !chat.Serves(body.Provider) {
		return modelKey{}, apperr.BadRequestf("%q is not a provider this daemon serves a model from", body.Provider)
	}
	return body, nil
}

// nullIfEmpty is a string the browser reads as absent when there is none — a profile with no key
// answers null rather than the empty string.
func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
