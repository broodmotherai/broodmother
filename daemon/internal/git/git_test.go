package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// repo is a real one, because what these methods are is the reading of what git actually says.
func repo(t *testing.T) *Git {
	t.Helper()
	held := New(t.TempDir(), "", "")
	for _, args := range [][]string{
		{"init", "-q", "-b", "main", "."},
		{"config", "user.name", "M"},
		{"config", "user.email", "m@x"},
	} {
		if out, err := held.Run(args...); err != nil || out.failed() {
			t.Fatalf("git %v: %v %s", args, err, out.Stderr)
		}
	}
	return held
}

func write(t *testing.T, held *Git, name, body string) {
	t.Helper()
	path := filepath.Join(held.Root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func commit(t *testing.T, held *Git, message string) {
	t.Helper()
	if err := held.StageAll(); err != nil {
		t.Fatal(err)
	}
	if result := held.Commit(message, Author{Name: "M", Email: "m@x"}); !result.OK {
		t.Fatalf("commit: %s", result.Message)
	}
}

// A folder under a repository is not itself a checkout, which is what keeps a project inside a
// git-backed home from reading as git-backed.
func TestOnlyTheTopOfACheckoutIsARepo(t *testing.T) {
	held := repo(t)
	if !held.IsRepo() {
		t.Error("a checkout said it was not one")
	}
	inside := filepath.Join(held.Root, "notes")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	if New(inside, "", "").IsRepo() {
		t.Error("a folder inside a checkout said it was one")
	}
	if New(t.TempDir(), "", "").IsRepo() {
		t.Error("a plain folder said it was a checkout")
	}
}

// A repository with no commits yet is on a branch — an unborn one — which `rev-parse HEAD` has
// nothing to resolve for and this has to answer anyway.
func TestKnowsTheBranchBeforeThereIsACommitOnIt(t *testing.T) {
	held := repo(t)
	if got := held.Branch(); got != "main" {
		t.Errorf("branch is %q", got)
	}
	state := held.State()
	if !state.Repo || state.Branch == nil || *state.Branch != "main" || state.RemoteURL != nil {
		t.Errorf("state is %+v", state)
	}
}

func TestSaysWhatTheWorkingTreeHasDoneToEachPath(t *testing.T) {
	held := repo(t)
	write(t, held, "kept.md", "one\n")
	write(t, held, "gone.md", "two\n")
	commit(t, held, "first")

	write(t, held, "kept.md", "one changed\n")
	if err := os.Remove(filepath.Join(held.Root, "gone.md")); err != nil {
		t.Fatal(err)
	}
	write(t, held, "a new file.md", "three\n")

	changes := held.Changes()
	for path, want := range map[string]Change{
		"kept.md": Modified, "gone.md": Removed, "a new file.md": Added,
	} {
		if got := changes[path]; got != want {
			t.Errorf("%q is %q, want %q", path, got, want)
		}
	}

	status, err := held.Status()
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Changed) != 3 || len(status.Conflicted) != 0 {
		t.Errorf("status is %+v", status)
	}
}

func TestReadsTheLastCommitToTouchAPath(t *testing.T) {
	held := repo(t)
	write(t, held, "notes/sync.md", "one\n")
	commit(t, held, "the subject line")

	touch := held.LastCommit("notes/sync.md")
	if touch == nil {
		t.Fatal("no commit found")
	}
	if touch.Subject != "the subject line" || touch.Author != "M" || touch.Sha == "" || touch.At == "" {
		t.Errorf("read %+v", touch)
	}
	if held.LastCommit("nothing.md") != nil {
		t.Error("found a commit for a path nobody has committed")
	}
}

func TestComparesTwoBranchesAndReadsAFileOutOfOne(t *testing.T) {
	held := repo(t)
	write(t, held, "kept.md", "one\n")
	write(t, held, "old-name.md", "two two two two two\n")
	commit(t, held, "first")

	if out, err := held.Run("branch", "other"); err != nil || out.failed() {
		t.Fatalf("branch: %v %s", err, out.Stderr)
	}
	write(t, held, "kept.md", "one changed\n")
	write(t, held, "added.md", "three\n")
	if err := os.Rename(filepath.Join(held.Root, "old-name.md"), filepath.Join(held.Root, "new-name.md")); err != nil {
		t.Fatal(err)
	}
	commit(t, held, "second")

	found := map[string]Change{}
	for _, one := range held.DiffFiles("other", "main") {
		found[one.Path] = one.Change
	}
	if found["kept.md"] != Modified || found["added.md"] != Added {
		t.Errorf("diffed %+v", found)
	}
	if found["new-name.md"] != Renamed && found["new-name.md"] != Added {
		t.Errorf("a rename read as %q", found["new-name.md"])
	}

	if ref := held.ResolveRef("other"); ref != "refs/heads/other" {
		t.Errorf("resolved %q", ref)
	}
	if ref := held.ResolveRef("nothing"); ref != "" {
		t.Errorf("resolved a branch that is not there: %q", ref)
	}
	if base := held.MergeBase("other", "main"); base == "" {
		t.Error("two branches that parted have no base")
	}

	// The bytes, not a trimmed reading of them: a diff whose two sides differ only in the last
	// newline is a difference.
	body, there := held.ReadBlob("other", "kept.md")
	if !there || body != "one\n" {
		t.Errorf("read %q, %v", body, there)
	}
	if _, there := held.ReadBlob("other", "added.md"); there {
		t.Error("read a file the branch does not have")
	}
}

// The guard is the promise, not the convention: it runs before the process does.
func TestNeverRunsSomethingThatCouldThrowWorkAway(t *testing.T) {
	held := repo(t)
	write(t, held, "kept.md", "one\n")
	commit(t, held, "first")
	write(t, held, "kept.md", "edited but not committed\n")

	if _, err := held.Run("reset", "--hard"); err == nil {
		t.Fatal("ran a reset")
	}
	body, err := os.ReadFile(filepath.Join(held.Root, "kept.md"))
	if err != nil || string(body) != "edited but not committed\n" {
		t.Errorf("the edit is %q, %v", body, err)
	}
}

// A command that never started says why rather than saying nothing, because every caller reads
// stderr for the reason and would otherwise guess "the remote is unreachable".
func TestSaysSomethingWhenGitNeverRan(t *testing.T) {
	out, err := New(filepath.Join(t.TempDir(), "not-there"), "", "").Run("status")
	if err != nil {
		t.Fatal(err)
	}
	if !out.failed() || strings.TrimSpace(out.Stderr) == "" {
		t.Errorf("answered %+v", out)
	}
}

// The key is added to whatever ssh would have offered, never substituted for it.
func TestOffersTheProfilesKeyBesideWhateverSSHAlreadyHas(t *testing.T) {
	if got := SSHCommand(""); got != "ssh -oBatchMode=yes" {
		t.Errorf("bare is %q", got)
	}
	got := SSHCommand("~/.ssh/id_ed25519")
	if !strings.HasPrefix(got, "ssh -oBatchMode=yes -i \"/") {
		t.Errorf("the key is not offered beside the rest, expanded: %q", got)
	}
	if strings.Contains(got, "IdentitiesOnly") {
		t.Error("the profile's key was made the only one")
	}
}

// The three kinds of remote are fixed three different ways, so one sentence would be wrong for
// two of them.
func TestNamesWhatToDoAboutARefusedRemote(t *testing.T) {
	for _, one := range []struct{ url, expect string }{
		{"/tmp/a-repo", "path on this machine"},
		{"file:///tmp/a-repo", "path on this machine"},
		{"git@github.com:owner/name.git", "refused your key"},
		{"ssh://git@host/owner/name.git", "refused your key"},
		{"https://github.com/owner/name.git", "credential helper"},
	} {
		if got := AuthAdvice(one.url); !strings.Contains(got, one.expect) {
			t.Errorf("AuthAdvice(%q) said %q", one.url, got)
		}
	}
}

// Asked on purpose rather than found out by a sync failing, and it names which reason it is.
func TestSaysWhyItCannotReachARemote(t *testing.T) {
	plain := New(t.TempDir(), "", "").CheckAccess()
	if plain.State != NoRepo || plain.RemoteURL != nil {
		t.Errorf("a plain folder answered %+v", plain)
	}
	held := repo(t)
	if bare := held.CheckAccess(); bare.State != NoRemote {
		t.Errorf("a repository with no remote answered %+v", bare)
	}

	remote := New(t.TempDir(), "", "")
	if out, err := remote.Run("init", "-q", "--bare", "."); err != nil || out.failed() {
		t.Fatalf("bare init: %v %s", err, out.Stderr)
	}
	if out, err := held.Run("remote", "add", "origin", remote.Root); err != nil || out.failed() {
		t.Fatalf("remote add: %v %s", err, out.Stderr)
	}
	if reached := held.CheckAccess(); reached.State != OK || reached.RemoteURL == nil {
		t.Errorf("a reachable remote answered %+v", reached)
	}
}
