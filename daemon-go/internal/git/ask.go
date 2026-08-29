// What a checkout is asked, and what it answers. Everything here runs git; the reading of what
// git said is next door in parse.go.

package git

import (
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

// real compares through the link so `/tmp` and `/private/tmp` are not two different folders.
func real(target string) string {
	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		return target
	}
	return resolved
}

// IsRepo reports whether this directory is itself a checkout, rather than merely sitting inside
// one. `--git-dir` alone answers yes for any folder under a repository, which would call a plain
// project git-backed the moment someone kept their broodmother home in one.
func (g *Git) IsRepo() bool {
	out, err := g.Run("rev-parse", "--show-toplevel")
	if err != nil || out.failed() {
		return false
	}
	top := strings.TrimSpace(out.Stdout)
	return top != "" && real(top) == real(g.Root)
}

// Branch is the branch the checkout is on, or empty when it is detached or not a checkout at
// all. `symbolic-ref` rather than `rev-parse`, because a repository with no commits yet is on a
// branch — an unborn one — and `rev-parse HEAD` has nothing to resolve and fails.
func (g *Git) Branch() string { return g.first("symbolic-ref", "--short", "HEAD") }

// RemoteURL is the project's own clone as the truth about where it syncs, not the app's config.
func (g *Git) RemoteURL() string { return g.first("remote", "get-url", "origin") }

// GitDir is where git keeps this checkout's state — the worktree's own folder, not the clone's,
// which is what a worktree's `.git` file points at. Empty where there is no repository.
func (g *Git) GitDir() string { return g.first("rev-parse", "--absolute-git-dir") }

func (g *Git) first(args ...string) string {
	out, err := g.Run(args...)
	if err != nil || out.failed() {
		return ""
	}
	return strings.TrimSpace(out.Stdout)
}

func (g *Git) Ignored() map[string]bool {
	ignored := map[string]bool{}
	out, err := g.Run("ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z")
	if err != nil || out.failed() {
		return ignored
	}
	for _, path := range records(out.Stdout) {
		ignored[strings.TrimSuffix(path, "/")] = true
	}
	return ignored
}

// Changes is what the working tree has done to each path, for the sidebar to say so. A folder
// that is not a repository has touched nothing, which is an answer rather than an error —
// nothing here is worth failing to draw a tree over.
func (g *Git) Changes() TreeChanges {
	out, err := g.Run("status", "--porcelain=v2", "--untracked-files=all", "-z")
	if err != nil || out.failed() {
		return TreeChanges{}
	}
	return ParseChanges(out.Stdout)
}

// LastCommit is the last commit to touch one path, or nil where git has nothing to say about it
// — an uncommitted file, a folder that is no repository, a path nobody has ever committed.
func (g *Git) LastCommit(file string) *CommitTouch {
	out, err := g.Run("log", "-1", "--format=%H%x00%an%x00%aI%x00%s", "--", file)
	if err != nil || out.failed() {
		return nil
	}
	fields := strings.Split(strings.TrimSpace(out.Stdout), "\x00")
	if len(fields) == 0 || fields[0] == "" {
		return nil
	}
	// A field git did not print is empty rather than missing, which is what the destructuring
	// this is ported from leaves behind.
	touch := CommitTouch{Sha: fields[0]}
	for index, into := range []*string{&touch.Author, &touch.At, &touch.Subject} {
		if index+1 < len(fields) {
			*into = fields[index+1]
		}
	}
	return &touch
}

func (g *Git) Status() (Status, error) {
	out, err := g.Run("status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z")
	if err != nil {
		return Status{}, err
	}
	if out.failed() {
		return Status{}, apperr.Repof("%s", orElse(out.Stderr, "git status failed"))
	}
	return ParseStatus(out.Stdout), nil
}

var (
	nothingPushed = regexp.MustCompile(`couldn't find remote ref|does not appear to have any commits`)
	conflicted    = regexp.MustCompile(`conflict|could not apply|merge failed`)
)

func (g *Git) Pull(branch string) Result {
	out, err := g.Run("pull", "--rebase", "--no-edit", "origin", branch)
	if err != nil {
		return Result{Failure: FailOther, Message: err.Error()}
	}
	if !out.failed() {
		return Result{OK: true}
	}
	said := out.both()
	// Nothing pushed to the remote branch yet, which is not a failure to pull.
	if nothingPushed.MatchString(strings.ToLower(said)) {
		return Result{OK: true}
	}
	failure := ClassifyRemoteError(said)
	if conflicted.MatchString(strings.ToLower(said)) {
		failure = FailConflict
	}
	return Result{Failure: failure, Message: out.reason()}
}

func (g *Git) StageAll() error {
	out, err := g.Run("add", "-A")
	if err != nil {
		return err
	}
	if out.failed() {
		return apperr.Repof("%s", orElse(out.Stderr, "git add failed"))
	}
	return nil
}

func (g *Git) Commit(message string, author Author) Result {
	out, err := g.Run("-c", "user.name="+author.Name, "-c", "user.email="+author.Email,
		"commit", "-m", message)
	if err != nil {
		return Result{Failure: FailOther, Message: err.Error()}
	}
	if !out.failed() {
		return Result{OK: true}
	}
	return Result{Failure: FailOther, Message: out.reason()}
}

func (g *Git) Push(branch string) Result {
	out, err := g.Run("push", "origin", "HEAD:"+branch)
	if err != nil {
		return Result{Failure: FailOther, Message: err.Error()}
	}
	if !out.failed() {
		return Result{OK: true}
	}
	return Result{Failure: ClassifyRemoteError(out.both()), Message: out.reason()}
}

// CheckAccess is whether this checkout can actually reach its remote, and if not, which of the
// four reasons it is. Everything here is already knowable — the point is that a bare `auth` in
// the status line is not an answer anybody can act on, and this is asked on purpose rather than
// found out by a sync failing.
func (g *Git) CheckAccess() AccessCheck {
	if !g.IsRepo() {
		return AccessCheck{State: NoRepo, Message: "This is a folder, not a repository. `git init` makes it one."}
	}
	remote := g.RemoteURL()
	if remote == "" {
		return AccessCheck{State: NoRemote, Message: "A repository with no remote. History is kept here and pushed nowhere."}
	}

	out, err := g.RunFor(15*time.Second, "ls-remote", "--heads", remote)
	if err == nil && !out.failed() {
		return AccessCheck{State: OK, RemoteURL: &remote, Message: "Reached " + remote + "."}
	}
	switch ClassifyRemoteError(out.both()) {
	case FailOffline:
		return AccessCheck{State: Offline, RemoteURL: &remote,
			Message: "Could not reach " + remote + ". That usually means the network, not the credentials."}
	case FailAuth:
		return AccessCheck{State: Auth, RemoteURL: &remote, Message: AuthAdvice(remote)}
	}
	reason := strings.SplitN(strings.TrimSpace(out.Stderr), "\n", 2)[0]
	return AccessCheck{State: Other, RemoteURL: &remote, Message: orElse(reason, "git could not reach it.")}
}

// ResolveRef is the ref a branch name stands for, spelled in full so nothing else can answer to
// it — a file called `main` beside a branch called `main` is a question git would otherwise have
// to guess at. A branch nobody has checked out yet is only on the remote, and that is the
// ordinary way to meet one here, so it is looked for there too.
func (g *Git) ResolveRef(name string) string {
	for _, ref := range []string{"refs/heads/" + name, "refs/remotes/origin/" + name} {
		if found := g.first("rev-parse", "--verify", "--quiet", ref); found != "" {
			return ref
		}
	}
	return ""
}

// MergeBase is where two branches parted: the last commit they have in common. Held against the
// branch you are on it gives the difference a pull request shows — what this branch did, with
// the other branch's own work since the split left out of it.
//
// Empty when they have no commit in common at all, which is two histories that were never one.
// There is no split to compare from, so the caller falls back to the branch itself.
func (g *Git) MergeBase(against, current string) string {
	return g.first("merge-base", against, current)
}

// DiffFiles is every path the two branches disagree about. Two dots rather than three: this is
// the difference between the branches as they stand, not what one of them has done since they
// parted — nothing here is about commits.
func (g *Git) DiffFiles(against, current string) []DiffFile {
	out, err := g.Run("diff", "--name-status", "--find-renames", "-z", against, current)
	if err != nil || out.failed() {
		return []DiffFile{}
	}
	return ParseNameStatus(out.Stdout)
}

// ReadBlob is a file as one branch has it, and false when that branch does not have it — which
// is what an added file is on one side and a removed one is on the other.
func (g *Git) ReadBlob(ref string, path doc.Path) (string, bool) {
	out, err := g.Run("show", ref+":"+path)
	if err != nil || out.failed() {
		return "", false
	}
	return out.Stdout, true
}

// State is what git says about this checkout, read off it rather than remembered.
func (g *Git) State() State {
	held := State{Repo: g.IsRepo()}
	if !held.Repo {
		return held
	}
	if remote := g.RemoteURL(); remote != "" {
		held.RemoteURL = &remote
	}
	if branch := g.Branch(); branch != "" {
		held.Branch = &branch
	}
	return held
}

func orElse(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
