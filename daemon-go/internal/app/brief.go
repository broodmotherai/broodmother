// The standing brief, as this daemon can see the room.
//
// A snapshot: a shell somebody is typing in is not somewhere to send an update, so the routes
// named in it are how a long-lived agent catches up.

package app

import (
	"github.com/broodmotherai/broodmother/daemon-go/internal/activity"
	"github.com/broodmotherai/broodmother/daemon-go/internal/brief"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/syncloop"
	"github.com/broodmotherai/broodmother/daemon-go/internal/terminal"
)

// Scope is which tree the tabs are about: one of the project's repos where the config names one
// that is still there, and the project itself otherwise.
func (c *Context) Scope() doc.Root {
	open := c.Workspace.Project()
	if open == nil {
		return doc.Project
	}
	name, said := c.Store.Config().Repo[open.Path]
	if !said || name == nil || *name == "" {
		return doc.Project
	}
	for _, one := range c.Workspace.Repos() {
		if one.Name == *name {
			return doc.RepoRoot(*name)
		}
	}
	return doc.Project
}

// Here is where a shell opens and where the hands work: the checkout of the scoped repo, the
// project if that repo is gone, and the home only on a first run with neither.
func (c *Context) Here() string { return c.checkoutOf(c.Scope()) }

func (c *Context) checkoutOf(root doc.Root) string {
	if name, inRepo := root.Repo(); inRepo {
		if open, err := c.Repo(name); err == nil {
			return open.Path
		}
	}
	if open, err := c.Root(doc.Project); err == nil {
		return open.Path
	}
	return c.Home
}

// Brief is the whole standing brief for one room, as it stands right now.
func (c *Context) Brief(surface brief.Surface) string {
	return brief.Write(c.briefState(c.Here(), c.Scope(), surface))
}

func (c *Context) briefState(cwd string, scope doc.Root, surface brief.Surface) brief.State {
	state := brief.State{
		API:     c.serverURL(),
		Surface: surface,
		Scope:   scope,
		Cwd:     cwd,
		Sync:    syncSaid(c.sync),
	}
	if held := c.Profiles.Active(); held != nil {
		state.Profile = held.Name
		if held.Soul != nil {
			state.Soul = *held.Soul
		}
	}
	summary := c.Workspace.Project()
	open, err := c.Root(doc.Project)
	if summary == nil || err != nil {
		return state
	}
	state.Project = &brief.Project{Name: summary.Name, Path: summary.Path, Checkout: open.Path}
	state.Skills = open.Skills()
	state.Personas = open.Personas()
	for _, one := range c.Workspace.Repos() {
		held, err := c.Repo(one.Name)
		if err != nil {
			continue
		}
		state.Repos = append(state.Repos, brief.Repo{Name: one.Name, Path: held.Path})
	}
	return state
}

// syncSaid is the loop's state in the one word the brief has room for. A loop that is not there
// yet is one nothing is committed for, which is what off means.
func syncSaid(loop *syncloop.Loop) brief.Sync {
	if loop == nil {
		return brief.SyncOff
	}
	switch loop.State().State {
	case syncloop.Conflict:
		return brief.SyncConflicted
	case syncloop.Off:
		return brief.SyncOff
	default:
		return brief.SyncOn
	}
}

// session is where a shell opens and what it opens with: the root it was opened from, the project
// if that root is gone, and the home only on a first run with neither.
//
// The brief and nothing else in the environment: what an agent runs as is said in the line it is
// handed, which is the profile's to write.
func (c *Context) session(root string) terminal.Session {
	scope := c.Scope()
	if root != "" {
		if held, err := doc.ParseRoot(root); err == nil {
			scope = held
		}
	}
	cwd := c.checkoutOf(scope)
	return terminal.Session{
		Cwd: cwd,
		Env: map[string]string{"BROODMOTHER_BRIEF": brief.Write(c.briefState(cwd, scope, brief.Terminal))},
	}
}

// foreground is what the activity watch reads off the ptys: every shell, where it stands, and what
// is in front of it.
func (c *Context) foreground() []activity.Standing {
	if c.Shells == nil {
		return nil
	}
	held := c.Shells.Foreground()
	standing := make([]activity.Standing, 0, len(held))
	for _, one := range held {
		standing = append(standing, activity.Standing{PID: one.PID, Cwd: one.Cwd, Process: one.Process})
	}
	return standing
}
