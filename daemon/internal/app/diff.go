// Two branches compared whole. Nothing here is about a commit: what is reported is the
// difference between the branch you are on and the branch you named — as the two stand, or
// against where they parted, which is what the basis says.

package app

import (
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

// DiffSides is one file as each branch has it, or nil on the side that does not have it — which
// is what an added file is on one side and a removed one is on the other.
type DiffSides struct {
	Against *string `json:"against"`
	Current *string `json:"current"`
}

// sides is the repository and the two refs to read out of it.
type sides struct {
	git     *git.Git
	against string
	current string
}

// sidesOf is what to compare, or nothing where there is nothing to compare — no branch open, or
// a branch asked to be compared with itself.
//
// The basis is the whole of what `split` changes: `git diff A...B` is defined as the diff from
// the merge base of the two to B, so resolving the far side to that commit is all it takes — the
// file list and the two sides of each file both come out of the same pair of refs, and neither
// has to know which basis produced them.
func (b *Branches) sidesOf(root doc.Root, against string, basis git.Basis) (*sides, error) {
	_, current, err := b.List(root)
	if err != nil {
		return nil, err
	}
	if current == "" || current == against {
		return nil, nil
	}
	checkouts, err := b.Checkouts(root)
	if err != nil {
		return nil, err
	}
	// No key and no token: a diff is read out of the repository that is already on this disk,
	// and nothing here reaches a remote.
	held := git.New(checkouts.Primary, "", "")
	from := held.ResolveRef(against)
	if from == "" {
		return nil, apperr.Branchf("no branch named %q", against)
	}
	here := held.ResolveRef(current)
	if here == "" {
		return nil, nil
	}
	// Two branches with nothing in common have no split to compare from. The far side stays the
	// branch itself, which is a comparison rather than an error.
	far := from
	if basis == git.Split {
		if base := held.MergeBase(from, here); base != "" {
			far = base
		}
	}
	return &sides{git: held, against: far, current: here}, nil
}

// Diff is every path the two branches disagree about.
func (b *Branches) Diff(root doc.Root, against string, basis git.Basis) ([]git.DiffFile, error) {
	held, err := b.sidesOf(root, against, basis)
	if err != nil || held == nil {
		return []git.DiffFile{}, err
	}
	return held.git.DiffFiles(held.against, held.current), nil
}

// DiffFile is one path, as each branch has it. A rename is one file under two names, so the
// other branch is asked for the name it has rather than the one this branch gave it.
func (b *Branches) DiffFile(root doc.Root, against string, path doc.Path, basis git.Basis) (DiffSides, error) {
	held, err := b.sidesOf(root, against, basis)
	if err != nil || held == nil {
		return DiffSides{}, err
	}
	source := path
	for _, one := range held.git.DiffFiles(held.against, held.current) {
		if one.Path == path && one.From != nil {
			source = *one.From
		}
	}
	answer := DiffSides{}
	if body, found := held.git.ReadBlob(held.against, source); found {
		answer.Against = &body
	}
	if body, found := held.git.ReadBlob(held.current, path); found {
		answer.Current = &body
	}
	return answer, nil
}
