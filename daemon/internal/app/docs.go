// The documents, and the one way one is written. A tree is reached through the root a request
// named — the project's, or one of its repos' — because everything above this is written once and
// asked of whichever of them the browser meant.

package app

import (
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/canvas"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/diagrams"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon/internal/links"
	"github.com/broodmotherai/broodmother/daemon/internal/relay"
	"github.com/broodmotherai/broodmother/daemon/internal/repo"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/tree"
)

// Root is the tree a request named: the project's, or one of its repos'. A repo is opened on
// demand rather than held — its tree is a folder on disk either way, and until there is a watcher
// there is nothing to keep open between requests.
func (c *Context) Root(root doc.Root) (*Open, error) {
	if name, isRepo := root.Repo(); isRepo {
		return c.Repo(name)
	}
	c.mutex.RLock()
	open := c.open
	c.mutex.RUnlock()
	if open == nil {
		return nil, apperr.NoProjectf("no project is open — create or choose one first")
	}
	return open, nil
}

// Repo is one of the open project's repos, standing on whichever checkout the config has it
// open on.
func (c *Context) Repo(name string) (*Open, error) {
	open, err := c.Workspace.RequireProject()
	if err != nil {
		return nil, err
	}
	if repo.Find(open.Path, name) == nil {
		return nil, apperr.NoRepof("no repo named %q in this project", name)
	}
	return openProject(c.Workspace.RepoCheckout(open.Path, name)), nil
}

// Sites is every checkout a board can live in: the project, and every repo it holds. Tasks run
// from them and diagrams are drawn in them, and both are found the same way.
//
// A repo's is opened here rather than held, which is what a repo's tree is everywhere else in
// this daemon.
func (c *Context) Sites() []diagrams.Site {
	sites := []diagrams.Site{}
	open, err := c.Root(doc.Project)
	if err != nil {
		return sites
	}
	sites = append(sites, diagrams.Site{Root: doc.Project, Tree: open.Tree})
	for _, one := range c.Workspace.Repos() {
		held, err := c.Repo(one.Name)
		if err != nil {
			continue
		}
		sites = append(sites, diagrams.Site{Root: doc.RepoRoot(one.Name), Tree: held.Tree})
	}
	return sites
}

// projectTree and projectLinks are the open project's, or nil where nothing is open — which is
// no records, for the same reason it is no wikilinks and no sync.
func (c *Context) projectTree() *tree.Tree {
	open, err := c.Root(doc.Project)
	if err != nil {
		return nil
	}
	return open.Tree
}

func (c *Context) projectLinks() *links.Index {
	open, err := c.Root(doc.Project)
	if err != nil {
		return nil
	}
	return open.Links
}

// CheckBoard: a board is a document with a shape to keep, and its editor is not the only thing
// that writes one. A `.task` or `.canvas` that will not parse opens broken — and a task that
// will not parse quietly stops being scheduled — so a write that would leave one that way is
// refused, in the codec's own words, while whoever wrote it is still listening.
func CheckBoard(path, text string) error {
	if canvas.IsCanvasPath(path) {
		_, err := canvas.Parse(text)
		return err
	}
	if !task.IsTaskPath(path) {
		return nil
	}
	parsed, err := task.Parse(text)
	if err != nil {
		return err
	}
	// The same answer the run gives, given before the file is on disk rather than after.
	if task.RunOrder(parsed) == nil {
		return apperr.Taskf("the task has a cycle — untangle it first")
	}
	return nil
}

// WriteDoc is the one way a document is written: the board rule first, then the bytes, then the
// index, then the ledger, then everyone watching.
func (c *Context) WriteDoc(root doc.Root, path, markdown string, by ledger.Actor) (doc.Path, error) {
	open, err := c.Root(root)
	if err != nil {
		return "", err
	}
	if err := CheckBoard(path, markdown); err != nil {
		return "", err
	}
	existed := open.Tree.Exists(path)
	open.Suppress(path)
	written, err := open.Tree.Write(path, markdown)
	if err != nil {
		return "", err
	}
	// Wikilinks and sync are the project's idea; a repo is a code repository and neither applies
	// to it.
	if root == doc.Project {
		open.Links.Update(written)
		c.NoteEdit()
	}
	// Filed before the sidebar hears about it, so anything that comes looking on the back of the
	// event finds the row already there.
	made := !existed
	c.RecordAct(ledger.New{Root: root, Path: written, Action: ledger.Write, Actor: by, Created: &made})
	kind := doc.Changed
	if made {
		kind = doc.Created
	}
	c.Broadcast(relay.TreeEvent(root, doc.Event{Type: kind, Path: written}))
	return written, nil
}

// onTreeEvent is what a change made behind the daemon's back means: the index has to hear about
// it, and so does every open socket.
func (c *Context) onTreeEvent(root doc.Root, event doc.Event) {
	if root == doc.Project {
		open, err := c.Root(root)
		if err == nil && strings.HasSuffix(event.Path, ".md") {
			if event.Type == doc.Removed {
				open.Links.Forget(event.Path)
			} else {
				open.Links.Update(event.Path)
			}
		}
		// Rescanning whole costs less than being clever about which half of a move mattered.
		if err == nil && touches(event, constants.SkillsDir) {
			open.readSkills()
		}
		if err == nil && touches(event, constants.PersonasDir) {
			open.readPersonas()
		}
		c.NoteEdit()
	}
	c.Broadcast(relay.TreeEvent(root, event))
}

// touches is whether an event landed in a folder the open project keeps a reading of. A move is
// two paths, and either end of it is a reason to read again.
func touches(event doc.Event, folder string) bool {
	for _, path := range []doc.Path{event.Path, event.From, event.To} {
		if path == folder || strings.HasPrefix(path, folder+"/") {
			return true
		}
	}
	return false
}
