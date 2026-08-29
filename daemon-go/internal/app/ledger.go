// What was done to a document, filed against the project it was done in. A ledger that will not
// write is a document with no provenance rather than a write that failed, so nothing here is
// answered for.

package app

import (
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/ledger"
)

// RecordAct files one act against the open project.
func (c *Context) RecordAct(entry ledger.New) {
	open := c.Workspace.Project()
	if c.Ledger == nil || open == nil {
		return
	}
	entry.Project = open.Path
	c.Ledger.Record(entry)
}

// ActsFor is what the ledger holds about one path in the open project.
func (c *Context) ActsFor(root doc.Root, path doc.Path, limit int) []ledger.Entry {
	open := c.Workspace.Project()
	if c.Ledger == nil || open == nil {
		return []ledger.Entry{}
	}
	return c.Ledger.ForPath(open.Path, root, path, limit)
}

// actsForCommit is the newest act the ledger holds for each path in a commit, in the order the
// paths came — which is git's, so a commit's trailers read in the order its files do.
func (c *Context) actsForCommit(paths []doc.Path) []ledger.Entry {
	found := []ledger.Entry{}
	for _, path := range paths {
		if acts := c.ActsFor(doc.Project, path, 1); len(acts) > 0 {
			found = append(found, acts[0])
		}
	}
	return found
}
