// Package doc says how a document is addressed, and what a listing of them looks like. This is
// vocabulary rather than machinery: the browser speaks it to name what it is asking for, and
// the daemon speaks it to answer — so it lives here, apart from the tree that does the reading.
package doc

import (
	"encoding/json"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
)

// Root says which tree a path is in: the project's markdown, or one of its repos' files. A
// project has as many repos as its documents cover, so the root names which.
type Root string

const Project Root = "project"

const repoPrefix = "repo:"

type Path = string

func RepoRoot(name string) Root { return Root(repoPrefix + name) }

// Repo is the repo a root names, and false when it names the project.
func (r Root) Repo() (string, bool) {
	name, found := strings.CutPrefix(string(r), repoPrefix)
	return name, found
}

func ParseRoot(raw string) (Root, error) {
	if raw == string(Project) {
		return Project, nil
	}
	if name, found := strings.CutPrefix(raw, repoPrefix); found && name != "" {
		return Root(raw), nil
	}
	return "", apperr.BadRequestf("not a root: %q", raw)
}

func (r *Root) UnmarshalJSON(data []byte) error {
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	parsed, err := ParseRoot(raw)
	if err != nil {
		return err
	}
	*r = parsed
	return nil
}

// Ref is the whole address: a path is only half of one now that there are many trees.
type Ref struct {
	Root Root `json:"root"`
	Path Path `json:"path"`
}

type Kind string

const (
	File Kind = "file"
	Dir  Kind = "dir"
)

type Entry struct {
	Kind Kind   `json:"kind"`
	Path Path   `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size,omitempty"`
	// ModifiedAt is milliseconds since the epoch, fractional the way `stats.mtimeMs` is: a file
	// system keeps nanoseconds and JavaScript reports them as a fraction of a millisecond rather
	// than rounding them off, so a whole number here would be a different answer.
	ModifiedAt float64 `json:"modifiedAt,omitempty"`
	Children   []Entry `json:"children,omitempty"`
}

type EventType string

const (
	Created EventType = "created"
	Changed EventType = "changed"
	Removed EventType = "removed"
	Moved   EventType = "moved"
)

type Event struct {
	Type EventType `json:"type"`
	Path Path      `json:"path,omitempty"`
	From Path      `json:"from,omitempty"`
	To   Path      `json:"to,omitempty"`
}
