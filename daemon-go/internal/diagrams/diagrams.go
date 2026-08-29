// Package diagrams is what the open checkouts have drawn.
//
// A `.canvas` file has no runner behind it the way a task does — it is drawn on and read, and
// that is all — so this is the whole of its server side: the list, so that something which
// cannot open the sidebar can still find out what has been drawn and whether it still opens.
package diagrams

import (
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/canvas"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tree"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

// Site is one place a board can live: an open checkout, with the tree that reads it.
type Site struct {
	Root doc.Root
	Tree *tree.Tree
}

type Summary struct {
	Ref  doc.Ref `json:"ref"`
	Name string  `json:"name"`
	// Nodes and Edges are how much is on it. Zero on a broken one, which has nothing readable
	// to count.
	Nodes int `json:"nodes"`
	Edges int `json:"edges"`
	// Broken is what a diagram that will not open is broken by.
	Broken string `json:"broken,omitempty"`
}

func Scan(sites []Site) []Summary {
	found := []Summary{}
	for _, site := range sites {
		for _, path := range Files(site.Tree, canvas.IsCanvasPath) {
			held := Summary{
				Ref:  doc.Ref{Root: site.Root, Path: path},
				Name: strings.TrimSuffix(utils.Base(string(path)), canvas.Extension),
			}
			source, err := site.Tree.Read(string(path))
			if err == nil {
				var drawn canvas.Canvas
				drawn, err = canvas.Parse(source)
				if err == nil {
					held.Nodes, held.Edges = len(drawn.Nodes), len(drawn.Edges)
				}
			}
			if err != nil {
				held.Broken = err.Error()
			}
			found = append(found, held)
		}
	}
	return found
}

// Files is every document in a tree whose path answers to `is`. A board is found by walking the
// same listing the sidebar draws, so what the sidebar leaves out is left out here too.
func Files(held *tree.Tree, is func(string) bool) []doc.Path {
	entries, err := held.List()
	if err != nil {
		return nil
	}
	var found []doc.Path
	var walk func([]doc.Entry)
	walk = func(entries []doc.Entry) {
		for _, entry := range entries {
			if entry.Kind == doc.Dir {
				walk(entry.Children)
				continue
			}
			if is(string(entry.Path)) {
				found = append(found, entry.Path)
			}
		}
	}
	walk(entries)
	return found
}
