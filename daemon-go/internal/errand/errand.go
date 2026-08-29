// Package errand is what an errand left different, for the ledger.
//
// The hands work on the real disk rather than through the app's door, so watching the checkout
// either side of one is the only way the app can find out what they did. The boundary is all it
// knows: it says which errand a file was part of, never which line was whose.
package errand

import (
	"io/fs"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

// Marks is every file in a checkout and what it looked like, keyed by the path the ledger files
// acts under.
type Marks map[doc.Path]string

// skipped are the folders no errand's work is in, and walking them is the difference between a
// look that costs nothing and one that reads a `node_modules`.
var skipped = map[string]bool{
	".git": true, "node_modules": true, ".next": true, "dist": true, "build": true,
	constants.ReposDir: true,
}

// MarksOf is one look at a checkout: each file's size and mtime, which is enough to tell a file
// that changed from one that did not without reading any of them.
func MarksOf(checkout string) Marks {
	held := Marks{}
	if checkout == "" {
		return held
	}
	filepath.WalkDir(checkout, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := entry.Name()
		if entry.IsDir() {
			if path != checkout && skipped[name] {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		relative, err := filepath.Rel(checkout, path)
		if err != nil {
			return nil
		}
		held[doc.Path(filepath.ToSlash(relative))] =
			strconv.FormatInt(info.Size(), 10) + ":" + strconv.FormatInt(info.ModTime().UnixNano(), 10)
		return nil
	})
	return held
}

// ChangedBetween is what differs across two looks: written, edited or taken away. Sorted, so one
// errand's acts land in an order somebody can read rather than a map's.
func ChangedBetween(before, after Marks) []doc.Path {
	changed := []doc.Path{}
	for path, mark := range after {
		if before[path] != mark {
			changed = append(changed, path)
		}
	}
	for path := range before {
		if _, still := after[path]; !still {
			changed = append(changed, path)
		}
	}
	sortPaths(changed)
	return changed
}

func sortPaths(paths []doc.Path) {
	slices.SortFunc(paths, func(a, b doc.Path) int { return strings.Compare(string(a), string(b)) })
}
