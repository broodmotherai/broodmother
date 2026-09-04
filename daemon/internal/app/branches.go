// Branches, which here are checkouts: cutting one makes a folder, opening one moves into it, and
// which folder a root is standing in is the config's to record — because it has to be answerable
// before git is asked anything.

package app

import (
	"path/filepath"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/branch"
	"github.com/broodmotherai/broodmother/daemon/internal/config"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/project"
	"github.com/broodmotherai/broodmother/daemon/internal/repo"
)

// BranchDeps is what this asks of the rest of the daemon. Everything a branch does is the same
// work whether the root is the project or one of its repos, and these are the four places the two
// differ: where the project is, where a repo's checkout is, where the project's is, and what has
// to be put back once the config names another one.
type BranchDeps struct {
	Store          *config.Store
	Project        func() *project.Summary
	RequireProject func() (*project.Summary, error)
	RepoCheckout   func(projectPath, name string) string
	Checkout       func() string
	SSHKey         func() string
	Reopen         func()
}

type Branches struct {
	deps BranchDeps
}

func newBranches(deps BranchDeps) *Branches { return &Branches{deps: deps} }

// Checkouts is where a root's checkouts are: the project's beside its clone, a repo's inside the
// project. Everything a branch does is the same work either way.
func (b *Branches) Checkouts(root doc.Root) (branch.Checkouts, error) {
	open, err := b.deps.RequireProject()
	if err != nil {
		return branch.Checkouts{}, err
	}
	name, isRepo := root.Repo()
	if !isRepo {
		// A project keeps its branches' checkouts beside its clone, which is the layout it has
		// always had.
		return project.Checkouts(open.Path), nil
	}
	if repo.Find(open.Path, name) == nil {
		return branch.Checkouts{}, apperr.NoRepof("no repo named %q", name)
	}
	return repo.CheckoutsOf(open.Path, name), nil
}

// PathOf is the folder a root is standing in.
func (b *Branches) PathOf(root doc.Root) string {
	if name, isRepo := root.Repo(); isRepo {
		open := b.deps.Project()
		if open == nil {
			return ""
		}
		return b.deps.RepoCheckout(open.Path, name)
	}
	return b.deps.Checkout()
}

// List is every branch a root's repository knows, and the one its open checkout is on. A repo the
// project does not have is no branches rather than a refusal: a sidebar asking about a repo that
// has just been unlinked wants an empty list, not an error to draw.
func (b *Branches) List(root doc.Root) ([]branch.Branch, string, error) {
	if name, isRepo := root.Repo(); isRepo {
		open := b.deps.Project()
		if open == nil || repo.Find(open.Path, name) == nil {
			return []branch.Branch{}, "", nil
		}
	}
	checkouts, err := b.Checkouts(root)
	if err != nil {
		return nil, "", err
	}
	branches := branch.List(checkouts)
	here := b.PathOf(root)
	for _, one := range branches {
		if one.Path == here {
			return branches, one.Name, nil
		}
	}
	return branches, "", nil
}

// MoveInto records which checkout a root is standing in. The folder is what gets recorded, not
// the branch: a checkout moved onto another branch from a terminal is still the folder you are
// standing in.
func (b *Branches) MoveInto(root doc.Root, into branch.Branch) error {
	open, err := b.deps.RequireProject()
	if err != nil {
		return err
	}
	folder := filepath.Base(into.Path)
	next := b.deps.Store.Config()
	if name, isRepo := root.Repo(); isRepo {
		next.RepoBranch[branch.Key(open.Path, name)] = folder
	} else {
		next.Checkouts[open.Path] = folder
	}
	if _, err := b.deps.Store.Save(next); err != nil {
		return err
	}
	b.deps.Reopen()
	return nil
}

// Add cuts one off the branch this root is open on: a new branch continues the work you are in.
func (b *Branches) Add(root doc.Root, name string) (branch.Branch, error) {
	checkouts, err := b.Checkouts(root)
	if err != nil {
		return branch.Branch{}, err
	}
	_, from, err := b.List(root)
	if err != nil {
		return branch.Branch{}, err
	}
	made, err := branch.Create(checkouts, name, from, b.deps.SSHKey())
	if err != nil {
		return branch.Branch{}, err
	}
	return made, b.MoveInto(root, made)
}

// Open is moving into a branch's checkout, and it gets one here if it has none — which is what
// makes picking a branch off the remote a single gesture.
func (b *Branches) Open(root doc.Root, name string) (branch.Branch, error) {
	checkouts, err := b.Checkouts(root)
	if err != nil {
		return branch.Branch{}, err
	}
	opened, err := branch.Open(checkouts, name, b.deps.SSHKey())
	if err != nil {
		return branch.Branch{}, err
	}
	return opened, b.MoveInto(root, opened)
}

// Remove takes a checkout off disk. Removing the one you are in falls back to the repository's
// own.
func (b *Branches) Remove(root doc.Root, name string) ([]branch.Branch, error) {
	checkouts, err := b.Checkouts(root)
	if err != nil {
		return nil, err
	}
	gone := branch.Find(checkouts, name)
	if gone == nil {
		return nil, apperr.Branchf("no branch named %q", name)
	}
	here := gone.Path == b.PathOf(root)
	if err := branch.Remove(checkouts, name); err != nil {
		return nil, err
	}
	if here {
		if err := b.MoveInto(root, branch.Branch{Name: name, Path: checkouts.Primary}); err != nil {
			return nil, err
		}
	}
	return branch.List(checkouts), nil
}
