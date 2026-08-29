// Package branch is a branch of a repository, checked out or not. The branch is the identity: a
// checkout is only where one happens to live, and every branch git knows about is offered
// whether or not this machine has given it a folder yet.
//
// The same shape describes a project's branches and a repo's — the two differ in where their
// checkouts go, not in what a branch is.
package branch

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/collate"
	"github.com/broodmotherai/broodmother/daemon-go/internal/git"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

// Checkouts is where a repository's checkouts are. A project keeps its own beside the clone; a
// repo's repository is somewhere you chose, so the checkouts broodmother makes for it go into
// the project rather than into your folder. Everything below is the same work either way.
type Checkouts struct {
	// Primary is the repository itself. It cannot be removed, and it is never moved onto another
	// branch — opening one makes a folder rather than checking out under your feet.
	Primary string
	// Worktrees is where a branch with no folder gets one.
	Worktrees string
}

type Branch struct {
	Name string `json:"name"`
	// Path is where its checkout is, or would go once it has one.
	Path       string `json:"path"`
	CheckedOut bool   `json:"checkedOut"`
	// Primary is the repository itself, which cannot be removed.
	Primary bool `json:"primary"`
}

// FolderFor: `feat/sync` cannot be a folder beside `feat`, so the separators flatten instead.
func FolderFor(name string) string { return strings.ReplaceAll(name, "/", "-") }

// Key is how a repo's open checkout is keyed in the config: one project may link many repos, and
// each of them stands on a branch of its own.
func Key(project, repo string) string { return project + "#" + repo }

// WorktreePath is where a branch's checkout is, or would go.
func WorktreePath(checkouts Checkouts, name string) string {
	return filepath.Join(checkouts.Worktrees, FolderFor(name))
}

var refName = regexp.MustCompile(`^[\w./-]+$`)

// NameProblem is git's own rules for a ref name, as the complaint to put after the noun — or
// empty when the name is one git will take. [utils.NameProblem] asks whether a name can be a
// folder, which is a different question and the one the checkout has to answer; this is whether
// git will accept it at all, and without it a name like `x.lock` reaches the caller as whatever
// `git worktree add` printed.
func NameProblem(name string) string {
	switch {
	case strings.HasPrefix(name, "/"), strings.HasSuffix(name, "/"):
		return "must not start or end with a slash"
	case strings.Contains(name, "//"):
		return "must not have an empty segment"
	case strings.Contains(name, ".."):
		return `must not contain ".."`
	case strings.Contains(name, "@{"):
		return `must not contain "@{"`
	case strings.HasSuffix(name, ".lock"):
		return `must not end with ".lock"`
	case !refName.MatchString(name):
		return "may only hold letters, digits, and . _ - /"
	}
	return ""
}

func isDir(target string) bool {
	info, err := os.Stat(target)
	return err == nil && info.IsDir()
}

// isCheckout: a checkout has a `.git` — a directory in the clone, a file in every worktree
// beside it.
func isCheckout(target string) bool {
	_, err := os.Stat(filepath.Join(target, ".git"))
	return err == nil
}

func branchOf(target string) string {
	name := strings.TrimSpace(mustRun(git.New(target, "", ""), "rev-parse", "--abbrev-ref", "HEAD"))
	if name == "HEAD" {
		return ""
	}
	return name
}

func mustRun(held *git.Git, args ...string) string {
	out, err := held.Run(args...)
	if err != nil || out.Code != 0 {
		return ""
	}
	return out.Stdout
}

type checkout struct {
	folder  string
	path    string
	branch  string
	primary bool
}

// listCheckouts is the folders on disk. The primary is listed whether or not it is a checkout: a
// repository that is only a folder of files still has the one place you work in. Everything in
// the worktrees folder has to be a real checkout, because that is the only thing broodmother
// puts there.
func listCheckouts(checkouts Checkouts) []checkout {
	first := checkout{folder: utils.Base(checkouts.Primary), path: checkouts.Primary, primary: true}
	// Only asked of a real checkout: a plain folder inside somebody's git-backed home would
	// otherwise report that repository's branch as its own.
	if isCheckout(checkouts.Primary) {
		first.branch = branchOf(checkouts.Primary)
	}
	found := []checkout{first}

	entries, err := os.ReadDir(checkouts.Worktrees)
	if err != nil {
		return found
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		target := filepath.Join(checkouts.Worktrees, entry.Name())
		// A project's worktrees sit beside its clone, so the folder holding them holds the primary
		// too — and it has already been listed.
		if target == checkouts.Primary || !isCheckout(target) {
			continue
		}
		found = append(found, checkout{folder: entry.Name(), path: target, branch: branchOf(target)})
	}
	return found
}

// knownBranches is every branch the repository knows, local and remote alike, with the remote's
// name dropped so `origin/feat` and `feat` are the one branch they describe.
func knownBranches(primary string) []string {
	out := mustRun(git.New(primary, "", ""),
		"for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes")

	names := []string{}
	seen := map[string]bool{}
	add := func(name string) {
		if name != "" && !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	for line := range strings.SplitSeq(out, "\n") {
		ref := strings.TrimSpace(line)
		if rest, found := strings.CutPrefix(ref, "refs/heads/"); found {
			add(rest)
			continue
		}
		rest, found := strings.CutPrefix(ref, "refs/remotes/")
		if !found {
			continue
		}
		// `refs/remotes/<remote>/<branch>`, and the remote is not part of the branch's name.
		_, name, cut := strings.Cut(rest, "/")
		// `origin/HEAD` points at the default branch rather than being a branch of its own.
		if cut && name != "HEAD" {
			add(name)
		}
	}
	return names
}

// List is every branch, checked out or not. The ones with a folder report where it is; the rest
// report where one would go, which is what opening them will make. The branch a checkout is on
// comes from git rather than from the folder name, because a checkout can be moved onto another
// branch from a terminal and the folder would not know.
func List(checkouts Checkouts) []Branch {
	order := []string{}
	found := map[string]Branch{}
	set := func(name string, one Branch) {
		if _, already := found[name]; !already {
			order = append(order, name)
		}
		found[name] = one
	}

	for _, name := range knownBranches(checkouts.Primary) {
		set(name, Branch{Name: name, Path: WorktreePath(checkouts, name)})
	}
	// Second, so a branch that has a folder overwrites the offer of one.
	for _, one := range listCheckouts(checkouts) {
		// A checkout with no branch is a folder with no repository behind it: it is named for
		// itself, because there is no branch to name it after.
		name := one.branch
		if name == "" {
			name = one.folder
		}
		set(name, Branch{Name: name, Path: one.path, CheckedOut: true, Primary: one.primary})
	}

	branches := make([]Branch, 0, len(order))
	for _, name := range order {
		branches = append(branches, found[name])
	}
	// The repository's own checkout first, then the rest by name: the one you always have should
	// not move around in the list as others come and go.
	sort.SliceStable(branches, func(i, j int) bool {
		if branches[i].Primary != branches[j].Primary {
			return branches[i].Primary
		}
		return collate.Before(branches[i].Name, branches[j].Name)
	})
	return branches
}

func Find(checkouts Checkouts, name string) *Branch {
	for _, one := range List(checkouts) {
		if one.Name == name {
			return &one
		}
	}
	return nil
}

func assertName(checkouts Checkouts, name string) error {
	problem := NameProblem(name)
	if problem == "" {
		problem = utils.NameProblem(FolderFor(name))
	}
	if problem != "" {
		return apperr.Branchf("branch name %s", problem)
	}
	if WorktreePath(checkouts, name) == checkouts.Primary {
		return apperr.Branchf("%q is the repository's own checkout", FolderFor(name))
	}
	return nil
}

// primaryOf is where the repository is, which is where every branch command has to run from.
func primaryOf(checkouts Checkouts) (string, error) {
	if !isCheckout(checkouts.Primary) {
		return "", apperr.Branchf("%s is not a checkout, so it has no branches",
			utils.Base(checkouts.Primary))
	}
	return checkouts.Primary, nil
}

// add is `git worktree add`. A worktree is a second working copy of one repository, so the
// branch it gets is a branch of that repository and not a copy of it.
func add(checkouts Checkouts, name string, args func(target string) []string, sshKeyPath string) (Branch, error) {
	if err := assertName(checkouts, name); err != nil {
		return Branch{}, err
	}
	primary, err := primaryOf(checkouts)
	if err != nil {
		return Branch{}, err
	}
	target := WorktreePath(checkouts, name)
	if isDir(target) {
		return Branch{}, apperr.Branchf("%q already exists", FolderFor(name))
	}
	if err := os.MkdirAll(checkouts.Worktrees, 0o755); err != nil {
		return Branch{}, err
	}

	out, err := git.New(primary, sshKeyPath, "").Run(args(target)...)
	if err != nil {
		return Branch{}, err
	}
	if out.Code != 0 {
		return Branch{}, apperr.Branchf("%s", firstLine(out.Stderr, "git worktree add failed"))
	}
	return Branch{Name: name, Path: target, CheckedOut: true}, nil
}

// Create cuts off the branch you are on, which is the work the new one continues. Without one —
// a checkout sitting on no branch at all — it comes off the primary's HEAD instead.
//
// A branch is only a starting point here, so git is content for it to be checked out somewhere
// else; that is only refused when two checkouts would sit on the same branch.
func Create(checkouts Checkouts, name, from, sshKeyPath string) (Branch, error) {
	if Find(checkouts, name) != nil {
		return Branch{}, apperr.Branchf("%q already exists", name)
	}
	return add(checkouts, name, func(target string) []string {
		args := []string{"worktree", "add", "-b", name, target}
		if from != "" {
			args = append(args, from)
		}
		return args
	}, sshKeyPath)
}

// Open is the branch you asked for, in a folder you can work in. One that already has a checkout
// is simply handed back — opening is moving into it — and one that does not gets it made here,
// which is what makes picking a branch off the remote the whole gesture rather than a setup step
// before it.
func Open(checkouts Checkouts, name, sshKeyPath string) (Branch, error) {
	found := Find(checkouts, name)
	if found == nil {
		return Branch{}, apperr.Branchf("no branch named %q", name)
	}
	if found.CheckedOut {
		return *found, nil
	}
	primary, err := primaryOf(checkouts)
	if err != nil {
		return Branch{}, err
	}
	// Only on the remote so far is the normal way to pick work up, so it is fetched before git is
	// asked to check it out. Already here, this changes nothing and costs a round trip.
	git.New(primary, sshKeyPath, "").RunFor(30*time.Second, "fetch", "origin", name)
	return add(checkouts, name, func(target string) []string {
		return []string{"worktree", "add", target, name}
	}, sshKeyPath)
}

// Remove takes the folder and git's record of it. The branch itself is untouched: it stays in
// the repository and can be opened again. The primary is refused rather than removed — for a
// project it is the clone every other checkout points into, and for a repo it is your
// repository, which broodmother did not make and does not take away.
func Remove(checkouts Checkouts, name string) error {
	found := Find(checkouts, name)
	switch {
	case found == nil:
		return apperr.Branchf("no branch named %q", name)
	case found.Primary:
		return apperr.Branchf("%q is the repository's own checkout", name)
	case !found.CheckedOut:
		return apperr.Branchf("%q has no checkout to remove", name)
	}

	out, err := git.New(checkouts.Primary, "", "").Run("worktree", "remove", found.Path)
	if err != nil {
		return err
	}
	if out.Code != 0 {
		// Uncommitted work is the usual reason git refuses, and it is right to. The folder is left
		// where it is and the reason is passed on.
		return apperr.Branchf("%s", firstLine(out.Stderr, "git worktree remove failed"))
	}
	// git leaves the directory behind when it was already empty of tracked files.
	return os.RemoveAll(found.Path)
}

func firstLine(said, fallback string) string {
	line := strings.SplitN(strings.TrimSpace(said), "\n", 2)[0]
	if line == "" {
		return fallback
	}
	return line
}
