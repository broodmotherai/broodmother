// Package tree is a folder of documents, read and written. One tree stands over one checkout:
// the project's, or a repo's, which is why a path is only half an address now that there are
// many of them.
//
// How a document is addressed is vocabulary the browser shares and lives in [doc]; this reads
// the disk, and nothing that does can be handed to a browser.
package tree

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

type Tree struct {
	Root string
	git  *git.Git
}

func New(root string) *Tree { return &Tree{Root: root, git: git.New(root, "", "")} }

func (t *Tree) Resolve(input string) (string, error) { return utils.ResolveInRoot(t.Root, input) }

// List is the whole tree, folders first and each level in the browser's order.
func (t *Tree) List() ([]doc.Entry, error) { return t.walk("", t.git.Ignored()) }

func (t *Tree) walk(prefix doc.Path, ignored map[string]bool) ([]doc.Entry, error) {
	dir := t.Root
	if prefix != "" {
		dir = filepath.Join(t.Root, prefix)
	}
	found, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	entries := []doc.Entry{}
	for _, one := range found {
		// A dotted name is still a document — `.gitignore` is as editable as any other. Only git's
		// store and the app's own folders are held back.
		if constants.IsReserved(one.Name()) {
			continue
		}
		path := one.Name()
		if prefix != "" {
			path = prefix + "/" + one.Name()
		}
		if ignored[path] {
			continue
		}

		switch {
		case one.IsDir():
			children, err := t.walk(path, ignored)
			if err != nil {
				return nil, err
			}
			entries = append(entries, doc.Entry{
				Kind: doc.Dir, Path: path, Name: one.Name(), Children: children,
			})
		case one.Type().IsRegular():
			info, err := one.Info()
			if err != nil {
				continue
			}
			entries = append(entries, doc.Entry{
				Kind: doc.File, Path: path, Name: one.Name(),
				Size: info.Size(), ModifiedAt: float64(info.ModTime().UnixNano()) / 1e6,
			})
		}
	}

	// Folders first, then the browser's order within each kind.
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == doc.Dir
		}
		return collate.Before(entries[i].Name, entries[j].Name)
	})
	return entries, nil
}

// Documents is every `.md` file in the tree, for the link index.
func (t *Tree) Documents() ([]doc.Path, error) {
	entries, err := t.List()
	if err != nil {
		return nil, err
	}
	found := []doc.Path{}
	var collect func([]doc.Entry)
	collect = func(entries []doc.Entry) {
		for _, one := range entries {
			if one.Kind == doc.Dir {
				collect(one.Children)
				continue
			}
			if strings.HasSuffix(one.Path, ".md") {
				found = append(found, one.Path)
			}
		}
	}
	collect(entries)
	return found, nil
}

func (t *Tree) Exists(input string) bool {
	absolute, err := t.Resolve(input)
	if err != nil {
		return false
	}
	return exists(absolute)
}

func (t *Tree) Read(input string) (string, error) {
	absolute, err := t.Resolve(input)
	if err != nil {
		return "", err
	}
	body, err := os.ReadFile(absolute)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (t *Tree) Write(input, contents string) (doc.Path, error) {
	path, err := utils.Normalize(input)
	if err != nil {
		return "", err
	}
	absolute, err := t.Resolve(path)
	if err != nil {
		return "", err
	}
	if err := utils.AtomicWrite(absolute, []byte(contents), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// Mkdir makes a folder with nothing in it yet. Git has no way to hold one, so it is on disk and
// nowhere else until something is put in it — which is what every git client does.
func (t *Tree) Mkdir(input string) (doc.Path, error) {
	path, err := utils.Normalize(input)
	if err != nil {
		return "", err
	}
	absolute, err := t.Resolve(path)
	if err != nil {
		return "", err
	}
	if exists(absolute) {
		return "", apperr.Pathf("%s already exists", path)
	}
	if err := os.MkdirAll(absolute, 0o755); err != nil {
		return "", err
	}
	return path, nil
}

func (t *Tree) Move(fromInput, toInput string) (from, to doc.Path, err error) {
	if from, err = utils.Normalize(fromInput); err != nil {
		return "", "", err
	}
	if to, err = utils.Normalize(toInput); err != nil {
		return "", "", err
	}
	fromAbsolute, err := t.Resolve(from)
	if err != nil {
		return "", "", err
	}
	toAbsolute, err := t.Resolve(to)
	if err != nil {
		return "", "", err
	}
	if exists(toAbsolute) {
		return "", "", apperr.Pathf("%s already exists", to)
	}
	if err := os.MkdirAll(filepath.Dir(toAbsolute), 0o755); err != nil {
		return "", "", err
	}
	if err := os.Rename(fromAbsolute, toAbsolute); err != nil {
		return "", "", err
	}
	return from, to, nil
}

// Remove takes a document or a whole folder off disk. A path that is not there is an error
// rather than a shrug: something asked for it by name.
func (t *Tree) Remove(input string) (doc.Path, error) {
	path, err := utils.Normalize(input)
	if err != nil {
		return "", err
	}
	absolute, err := t.Resolve(path)
	if err != nil {
		return "", err
	}
	if !exists(absolute) {
		return "", apperr.NotFoundf("%s is not there", path)
	}
	if err := os.RemoveAll(absolute); err != nil {
		return "", err
	}
	return path, nil
}

// Changes is what the working tree has done to each path, which is what the sidebar draws its
// letters from.
func (t *Tree) Changes() git.TreeChanges { return t.git.Changes() }

// Ignored is what git leaves out, as the tree read it — the top of each ignored thing rather
// than everything inside it.
func (t *Tree) Ignored() map[string]bool { return t.git.Ignored() }

// exists is a stat that answered, the way the try/catch this is ported from reads it: anything
// that stopped the question being answered is a no.
func exists(absolute string) bool {
	_, err := os.Stat(absolute)
	return err == nil
}
