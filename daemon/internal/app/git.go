// The open project's repository, and the loop that commits it. Git is asked of the checkout
// rather than remembered: a project that is not a repository has said so by being a folder, and
// one somebody committed to in a terminal has moved without telling this daemon.

package app

import (
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/relay"
	"github.com/broodmotherai/broodmother/daemon/internal/syncloop"
)

// Git is the open project's checkout, ready to be asked. The profile's key and host token ride
// with it, because who is pushing is a question about the profile rather than the repository.
func (c *Context) Git() *git.Git {
	return git.New(c.Workspace.Checkout(), c.Profiles.SSHKey(), c.Profiles.HostToken())
}

// GitSettings is how the open project syncs. A project nobody has configured uses the defaults,
// which sync nothing — git is opt-in, the same way it is optional.
func (c *Context) GitSettings() git.Settings {
	held := c.Config()
	if held.ProjectPath != nil {
		if settings, said := held.Git[*held.ProjectPath]; said {
			return settings
		}
	}
	return git.DefaultSettings()
}

func (c *Context) SetGitSettings(settings git.Settings) (git.Settings, error) {
	open, err := c.Workspace.RequireProject()
	if err != nil {
		return git.Settings{}, err
	}
	next := c.Config()
	next.Git[open.Path] = settings
	if _, err := c.Store.Save(next); err != nil {
		return git.Settings{}, err
	}
	// The sync loop is told to look again here in the TypeScript. There is no loop yet.
	return settings, nil
}

// GitState is what git says about the open project's checkout, read off it rather than
// remembered. A project that is not a repository has said so by being a folder.
func (c *Context) GitState() git.State {
	if c.Workspace.Checkout() == "" {
		return git.State{}
	}
	return c.Git().State()
}

// CheckAccess asks a root's checkout whether it can reach its remote — the project's, or one of
// its repos'. The key and the token ride either way: who is pushing is a question about the
// profile rather than about the repository.
func (c *Context) CheckAccess(root doc.Root) (git.AccessCheck, error) {
	open, err := c.Root(root)
	if err != nil {
		return git.AccessCheck{}, err
	}
	return git.New(open.Path, c.Profiles.SSHKey(), c.Profiles.HostToken()).CheckAccess(), nil
}

// startSync stands the loop up over whatever project is open. The loop asks the context for the
// project's git and settings each pass, so opening another project moves it without restarting.
func (c *Context) startSync() {
	c.sync = syncloop.New(syncloop.Deps{
		Git: func() *git.Git {
			if c.Workspace.Checkout() == "" {
				return nil
			}
			return c.Git()
		},
		Settings: c.GitSettings,
		Author: func() *git.Author {
			held := c.Profiles.Active()
			if held == nil {
				return nil
			}
			return &held.GitAuthor
		},
		Acts:     c.actsForCommit,
		OnStatus: func(status syncloop.Status) { c.Broadcast(relay.SyncStatus(status)) },
	})
	c.sync.Start(time.Second)
}

// Sync is the loop, for the routes that ask it things.
func (c *Context) Sync() *syncloop.Loop { return c.sync }

// NoteEdit tells the loop the project moved, which is what its quiet period is measured from.
func (c *Context) NoteEdit() {
	if c.sync != nil {
		c.sync.NoteEdit()
	}
}
