// Package project is a folder of markdown inside a profile's folder, which is the profile it
// commits as.
//
// A project is any plain directory in a profile's folder — drop one in and it is picked up.
// Which profile it commits as is where it sits, so it is read off the folder rather than
// remembered anywhere.
package project

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/branch"
	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

type Summary struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Profile string `json:"profile"`
}

func AssertName(name string) error {
	if problem := utils.NameProblem(name); problem != "" {
		return apperr.Projectf("project name %s", problem)
	}
	return nil
}

func List(dir string) ([]Summary, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	found := []Summary{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		found = append(found, Summary{
			Name:    entry.Name(),
			Path:    filepath.Join(dir, entry.Name()),
			Profile: filepath.Base(dir),
		})
	}
	collate.SortBy(found, func(one Summary) string { return one.Name })
	return found, nil
}

func Find(name, dir string) (*Summary, error) {
	all, err := List(dir)
	if err != nil {
		return nil, err
	}
	for _, one := range all {
		if one.Name == name {
			return &one, nil
		}
	}
	return nil, nil
}

// Of is the project a path names, read off the path itself: the folder is the name and the
// folder above it is the profile. Nothing is checked — the config already said this is open, and
// a project whose folder has gone is answered for by whoever resolved it.
func Of(path string) Summary {
	return Summary{
		Name:    filepath.Base(path),
		Path:    path,
		Profile: filepath.Base(filepath.Dir(path)),
	}
}

// Checkout is where one of a project's checkouts sits. A project is a folder of them and
// [constants.Primary] is the one it starts with — the clone itself, the one that owns `.git` and
// sits on the default branch. It keeps that name whatever branch it is on, so the folder you
// have always worked in does not move when you switch.
func Checkout(project, folder string) string { return filepath.Join(project, folder) }

// Primary is the checkout a project starts with, by path.
func Primary(project string) string { return Checkout(project, constants.Primary) }

// Checkouts: a project is a folder of checkouts, shaped exactly like a repo it holds — the two
// differ in where their checkouts go, not in what a branch is.
func Checkouts(project string) branch.Checkouts {
	return branch.Checkouts{Primary: Primary(project), Worktrees: project}
}
