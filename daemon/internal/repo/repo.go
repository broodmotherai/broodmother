// Package repo is a repository the project's documents are about. It lives inside the project,
// so it goes where the project goes and deleting it is deleting the repository. A project has as
// many as its documents cover; a repo belongs to the one project.
package repo

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/branch"
	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
)

type Summary struct {
	Name string `json:"name"`
	// Repo is the absolute path to the repository itself, which is also its primary checkout.
	Repo string `json:"repo"`
}

// Path is where a project keeps one. The folder sits beside the project's own checkouts rather
// than inside one, so the sync loop never sees it and no branch of the project carries a
// different set of repos than its neighbour.
func Path(project, name string) string {
	return filepath.Join(project, constants.ReposDir, name)
}

// CheckoutsOf: a repo is a folder of checkouts, shaped exactly like the project holding it.
func CheckoutsOf(project, name string) branch.Checkouts {
	return branch.Checkouts{
		Primary:   filepath.Join(Path(project, name), constants.Primary),
		Worktrees: Path(project, name),
	}
}

// List is every repo in the project — drop a folder in and it is picked up, the way a project is.
func List(project string) []Summary {
	entries, err := os.ReadDir(filepath.Join(project, constants.ReposDir))
	if err != nil {
		return []Summary{}
	}
	found := []Summary{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		found = append(found, Summary{Name: entry.Name(), Repo: CheckoutsOf(project, entry.Name()).Primary})
	}
	collate.SortBy(found, func(one Summary) string { return one.Name })
	return found
}

func Find(project, name string) *Summary {
	for _, one := range List(project) {
		if one.Name == name {
			return &one
		}
	}
	return nil
}
