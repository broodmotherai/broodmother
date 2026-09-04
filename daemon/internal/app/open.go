// The disk-touching half of a project, valid only while one is open: its documents, its
// repository, the index of what links to what, and what its `.tools/.skills/` and `.personas/`
// folders carry — with the two watchers that keep all of that true underneath.

package app

import (
	"os"
	"sync"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/links"
	"github.com/broodmotherai/broodmother/daemon/internal/personas"
	"github.com/broodmotherai/broodmother/daemon/internal/relay"
	"github.com/broodmotherai/broodmother/daemon/internal/skills"
	"github.com/broodmotherai/broodmother/daemon/internal/tree"
	"github.com/broodmotherai/broodmother/daemon/internal/watch"
)

// Open is one project's disk, opened. One of these is made per project and dropped to swap, so
// nothing above it has to remember which parts of an open project a file event invalidates.
type Open struct {
	Path  string
	Tree  *tree.Tree
	Links *links.Index

	mutex    sync.RWMutex
	skills   []skills.Skill
	personas []personas.Persona

	treeWatch *watch.Tree
	repoWatch *watch.Repo
}

func openProject(checkout string) *Open {
	// The project is a folder of checkouts and the one you are in may not exist yet — a project
	// made outside the app, or a config naming a branch whose folder has gone.
	os.MkdirAll(checkout, 0o755)
	held := &Open{Path: checkout, Tree: tree.New(checkout), Links: links.New(tree.New(checkout))}
	// A tree that will not read is a project whose folder has gone under us; the index is empty
	// and every route that reads it says so in its own words rather than failing to open at all.
	held.Links.Rebuild()
	held.readSkills()
	held.readPersonas()
	return held
}

func (o *Open) readSkills() {
	found := skills.Scan(o.Path)
	o.mutex.Lock()
	o.skills = found
	o.mutex.Unlock()
}

func (o *Open) readPersonas() {
	found := personas.Scan(o.Path)
	o.mutex.Lock()
	o.personas = found
	o.mutex.Unlock()
}

// Skills is what the open checkout's `.tools/.skills/` carries, as it stood when it was last
// read — which is at open and after any change that touched the folder.
func (o *Open) Skills() []skills.Skill {
	o.mutex.RLock()
	defer o.mutex.RUnlock()
	return o.skills
}

// Personas is the same for `.personas/`.
func (o *Open) Personas() []personas.Persona {
	o.mutex.RLock()
	defer o.mutex.RUnlock()
	return o.personas
}

// watch stands the two watchers over a project's checkout: the tree's, which follows the
// documents, and the repository's, which follows git's own state. A watch that will not open is
// a tree that stops refreshing on its own, which is worth less than the server.
func (o *Open) watch(ctx *Context, root doc.Root) {
	held, err := watch.WatchTree(o.Path, func(event doc.Event) {
		ctx.onTreeEvent(root, event)
	}, watch.Options{
		// What a watch on this folder should not descend into is what the repository ignores,
		// which is what the tree already leaves out of the sidebar. It is asked of git rather than
		// kept as a list of names: the dependency folder of whatever a repository is written in is
		// already in its `.gitignore`, and a list of `node_modules`, `.venv`, `target`, `vendor`
		// is a list nobody can keep up to date.
		Skipped: o.Tree.Ignored(),
	})
	if err == nil {
		o.treeWatch = held
	}
	// Open for every root, scoped or not: the sidebar wears git's letters for all of them, and a
	// commit in a background shell has to reach the rows it is about.
	o.repoWatch = watch.WatchRepo(o.Path, func() {
		ctx.Broadcast(relay.TreeEvent(root, doc.Event{Type: doc.Changed}))
	})
}

func (o *Open) close() {
	if o == nil {
		return
	}
	if o.treeWatch != nil {
		o.treeWatch.Close()
	}
	o.repoWatch.Close()
}

// Suppress marks a path as the app's own so the watcher does not report this daemon's own write
// back to it as news from somewhere else.
func (o *Open) Suppress(paths ...doc.Path) {
	if o != nil && o.treeWatch != nil {
		o.treeWatch.Suppress(paths...)
	}
}
