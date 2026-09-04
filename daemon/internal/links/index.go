// Package links holds what points at what. The index is the tree's, so it lives here rather than
// beside the pure resolution in [markdown]: this one reads documents, and nothing that reads a
// disk can be handed to a browser.
package links

import (
	"sync"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/markdown"
	"github.com/broodmotherai/broodmother/daemon/internal/tree"
)

// Backlink is one document pointing at another, and the line it did it on.
type Backlink struct {
	From doc.Path `json:"from"`
	To   doc.Path `json:"to"`
	// Context is the whole trimmed line, which is what lets a source's relation be read back out
	// of the index rather than by opening every document again to ask.
	Context string `json:"context"`
}

// Index is every link in a tree, resolved. Rebuilt whole on open and kept up to date one
// document at a time, because a save is one document and rereading the tree for it is the cost
// of the tree rather than the cost of the save.
type Index struct {
	tree *tree.Tree

	mutex     sync.RWMutex
	documents []doc.Path
	outbound  map[doc.Path][]Backlink
}

func New(of *tree.Tree) *Index {
	return &Index{tree: of, documents: []doc.Path{}, outbound: map[doc.Path][]Backlink{}}
}

func (i *Index) Rebuild() error {
	documents, err := i.tree.Documents()
	if err != nil {
		return err
	}
	outbound := make(map[doc.Path][]Backlink, len(documents))
	for _, document := range documents {
		body, err := i.tree.Read(document)
		if err != nil {
			continue
		}
		outbound[document] = resolve(document, body, documents)
	}

	i.mutex.Lock()
	i.documents, i.outbound = documents, outbound
	i.mutex.Unlock()
	return nil
}

func resolve(document doc.Path, body string, documents []doc.Path) []Backlink {
	found := []Backlink{}
	for _, link := range markdown.ExtractLinks(body) {
		to := markdown.ResolveTarget(link.Target, documents)
		// A document that links to itself is not a backlink; it is a document.
		if to != "" && to != document {
			found = append(found, Backlink{From: document, To: to, Context: link.Context})
		}
	}
	return found
}

// Update re-reads one document. A document that has gone is forgotten, which is what a read that
// fails means here.
func (i *Index) Update(document doc.Path) {
	body, err := i.tree.Read(document)
	if err != nil {
		i.Forget(document)
		return
	}

	i.mutex.Lock()
	defer i.mutex.Unlock()
	if !held(i.documents, document) {
		i.documents = append(i.documents, document)
	}
	i.outbound[document] = resolve(document, body, i.documents)
}

func (i *Index) Forget(document doc.Path) {
	i.mutex.Lock()
	defer i.mutex.Unlock()
	kept := i.documents[:0]
	for _, one := range i.documents {
		if one != document {
			kept = append(kept, one)
		}
	}
	i.documents = kept
	delete(i.outbound, document)
}

func (i *Index) Outbound(document doc.Path) []Backlink {
	i.mutex.RLock()
	defer i.mutex.RUnlock()
	return append([]Backlink{}, i.outbound[document]...)
}

// Backlinks is everything pointing at a document, in the order the documents were indexed —
// which is the order the tree walks. Read off the document list rather than the map behind it:
// Go visits a map in a different order every run, and a sidebar whose backlinks reshuffle
// between two identical requests is a sidebar nobody can read.
func (i *Index) Backlinks(document doc.Path) []Backlink {
	i.mutex.RLock()
	defer i.mutex.RUnlock()
	found := []Backlink{}
	for _, from := range i.documents {
		for _, link := range i.outbound[from] {
			if link.To == document {
				found = append(found, link)
			}
		}
	}
	return found
}

// Documents is every `.md` the index knows, which is what a resolution is made against.
func (i *Index) Documents() []doc.Path {
	i.mutex.RLock()
	defer i.mutex.RUnlock()
	return append([]doc.Path{}, i.documents...)
}

// RewriteForMove points every link at a document's new home and answers with how many documents
// it had to rewrite. This is what `mv` cannot do, and it is why moving a document is a route
// rather than a shell command.
func (i *Index) RewriteForMove(from, to doc.Path) (int, error) {
	before := i.Documents()
	sources := map[doc.Path]bool{}
	for _, link := range i.Backlinks(from) {
		sources[link.From] = true
	}

	rewritten := 0
	for source := range sources {
		body, err := i.tree.Read(source)
		if err != nil {
			continue
		}
		next := markdown.RewriteLinks(body, from, to, before)
		if next == body {
			continue
		}
		if _, err := i.tree.Write(source, next); err != nil {
			return rewritten, err
		}
		rewritten++
	}
	return rewritten, i.Rebuild()
}

func held(all []doc.Path, one doc.Path) bool {
	for _, each := range all {
		if each == one {
			return true
		}
	}
	return false
}
