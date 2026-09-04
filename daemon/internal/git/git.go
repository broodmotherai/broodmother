// Package git is what a checkout is asked about and answers with. Settings are stored; state
// and access are read off the repository, which is the truth about where it syncs.
package git

import "github.com/broodmotherai/broodmother/daemon/internal/doc"

// Settings are how a checkout syncs. Sync is off until it is asked for; everything else
// describes how it should behave once it is.
type Settings struct {
	// Enabled: the sync loop runs in this project.
	Enabled bool `json:"enabled"`
	// AutoCommit: commit local edits automatically.
	AutoCommit bool `json:"autoCommit"`
	// Pull: rebase before push.
	Pull bool `json:"pull"`
	// Push: push after commit.
	Push bool `json:"push"`
	// IdleMs is the idle period before a sync run.
	IdleMs int `json:"idleMs"`
	// Trailers: commits say who did the work, in trailers the ledger answers for. Off until
	// somebody turns it on: it changes what gets pushed to a remote, and a synthetic co-author
	// address going out to somebody's GitHub is theirs to decide.
	Trailers bool `json:"trailers"`
}

func DefaultSettings() Settings {
	return Settings{Enabled: false, AutoCommit: true, Pull: true, Push: true, IdleMs: 10000, Trailers: false}
}

// Author is who a checkout commits as, as it appears in git config.
type Author struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// State is read off the checkout, never stored — the repository is the truth about where it
// syncs.
type State struct {
	// Repo is false when the checkout is a plain folder.
	Repo bool `json:"repo"`
	// RemoteURL is null when the repo has none.
	RemoteURL *string `json:"remoteUrl"`
	// Branch is null on a checkout not on a branch, or on one with no repo.
	Branch *string `json:"branch"`
}

// AccessState is why a checkout can or cannot reach its remote. Asked on purpose, rather than
// found out by a sync failing — and named, because `auth` on its own is not something anyone
// can act on.
type AccessState string

const (
	NoRepo   AccessState = "no-repo"
	NoRemote AccessState = "no-remote"
	OK       AccessState = "ok"
	Offline  AccessState = "offline"
	Auth     AccessState = "auth"
	Other    AccessState = "other"
)

type AccessCheck struct {
	State     AccessState `json:"state"`
	RemoteURL *string     `json:"remoteUrl"`
	// Message is what it means, and what to do about it where there is something to do.
	Message string `json:"message"`
}

// CommitTouch is the last commit to touch a path, which is all git can say about who wrote
// something and is a different question from the ledger's: a commit is when the work was filed,
// by whoever was configured as the author, and says nothing about which agent did it.
type CommitTouch struct {
	Sha    string `json:"sha"`
	Author string `json:"author"`
	// At is ISO 8601, as git writes it.
	At      string `json:"at"`
	Subject string `json:"subject"`
}

// Change is what became of a path between two branches.
type Change string

const (
	Added    Change = "added"
	Modified Change = "modified"
	Removed  Change = "removed"
	Renamed  Change = "renamed"
	// Conflicted is the one state only a working tree can be in — a merge that stopped halfway.
	Conflicted Change = "conflicted"
)

// TreeChanges is every path a checkout has touched, and how. Untracked is added: to a sidebar
// the distinction is git's, not yours — a new file is a new file.
type TreeChanges map[doc.Path]Change

// Basis says which two points a comparison is between. Now is the two branches as they stand,
// which answers "how do these differ" and includes everything the other branch has gained since
// you left it. Split holds the branch you are on against the last commit the two had in common,
// which answers "what have I done" — the difference a pull request shows.
//
// The names are of the basis rather than of git's spelling: two dots and three dots is a
// distinction about arguments, and this is a distinction about what you are looking at.
type Basis string

const (
	Now   Basis = "now"
	Split Basis = "split"
)

// DiffFile is one path that differs between two branches, as they stand — not as a commit did
// to it. A branch is compared with another branch whole, so what is reported is the difference
// between the two, with nothing said about how either got there.
type DiffFile struct {
	// Path is where it is on the branch you are on, or where it was when it is gone from it.
	Path   doc.Path `json:"path"`
	Change Change   `json:"change"`
	// From is what it was called on the other branch, for a rename. Null otherwise.
	From *doc.Path `json:"from"`
}
