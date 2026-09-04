package branch_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/branch"

	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

// A project keeps its branches' checkouts beside its clone, which is the layout to test against.
func repository(t *testing.T) Checkouts {
	t.Helper()
	project := t.TempDir()
	checkouts := Checkouts{Primary: filepath.Join(project, "local"), Worktrees: project}
	if err := os.MkdirAll(checkouts.Primary, 0o755); err != nil {
		t.Fatal(err)
	}
	held := git.New(checkouts.Primary, "", "")
	for _, args := range [][]string{
		{"init", "-q", "-b", "main", "."},
		{"config", "user.name", "M"},
		{"config", "user.email", "m@x"},
	} {
		if out, err := held.Run(args...); err != nil || out.Code != 0 {
			t.Fatalf("git %v: %v %s", args, err, out.Stderr)
		}
	}
	if err := os.WriteFile(filepath.Join(checkouts.Primary, "a.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := held.StageAll(); err != nil {
		t.Fatal(err)
	}
	if result := held.Commit("first", git.Author{Name: "M", Email: "m@x"}); !result.OK {
		t.Fatal(result.Message)
	}
	return checkouts
}

func named(branches []Branch) []string {
	found := make([]string, len(branches))
	for index, one := range branches {
		found[index] = one.Name
	}
	return found
}

// The repository's own checkout first, then the rest by name: the one you always have should not
// move around in the list as others come and go.
func TestListsThePrimaryFirstThenTheRestByName(t *testing.T) {
	checkouts := repository(t)
	held := git.New(checkouts.Primary, "", "")
	for _, name := range []string{"zeta", "alpha", "feat/one"} {
		if out, err := held.Run("branch", name); err != nil || out.Code != 0 {
			t.Fatalf("branch %s: %v %s", name, err, out.Stderr)
		}
	}
	got := named(List(checkouts))
	want := "main,alpha,feat/one,zeta"
	if strings.Join(got, ",") != want {
		t.Errorf("listed %v, want %s", got, want)
	}
	if one := List(checkouts)[0]; !one.Primary || !one.CheckedOut {
		t.Errorf("the primary is %+v", one)
	}
}

// A branch with no folder reports where one would go, which is what opening it will make — and
// `feat/sync` cannot be a folder beside `feat`, so the separators flatten.
func TestOffersAFolderToABranchThatHasNone(t *testing.T) {
	checkouts := repository(t)
	if out, err := git.New(checkouts.Primary, "", "").Run("branch", "feat/one"); err != nil || out.Code != 0 {
		t.Fatal(err)
	}
	found := Find(checkouts, "feat/one")
	if found == nil || found.CheckedOut {
		t.Fatalf("found %+v", found)
	}
	if filepath.Base(found.Path) != "feat-one" {
		t.Errorf("offered %q", found.Path)
	}
}

func TestCutsABranchAndGivesItAFolder(t *testing.T) {
	checkouts := repository(t)
	made, err := Create(checkouts, "feat/two", "main", "")
	if err != nil {
		t.Fatal(err)
	}
	if !made.CheckedOut || made.Primary || filepath.Base(made.Path) != "feat-two" {
		t.Errorf("made %+v", made)
	}
	if _, err := os.Stat(filepath.Join(made.Path, "a.md")); err != nil {
		t.Errorf("the checkout is empty: %v", err)
	}
	if _, err := Create(checkouts, "feat/two", "main", ""); err == nil {
		t.Error("cut the same branch twice")
	}
}

// Opening one that already has a checkout is moving into it, and one that does not gets it made.
func TestOpeningABranchIsMovingIntoItsCheckout(t *testing.T) {
	checkouts := repository(t)
	if out, err := git.New(checkouts.Primary, "", "").Run("branch", "develop"); err != nil || out.Code != 0 {
		t.Fatal(err)
	}
	opened, err := Open(checkouts, "develop", "")
	if err != nil {
		t.Fatal(err)
	}
	if !opened.CheckedOut {
		t.Errorf("opened %+v", opened)
	}
	again, err := Open(checkouts, "develop", "")
	if err != nil || again.Path != opened.Path {
		t.Errorf("a second open gave %+v, %v", again, err)
	}
	if _, err := Open(checkouts, "nothing", ""); err == nil {
		t.Error("opened a branch that is not there")
	}
}

// The primary is refused rather than removed — it is the clone every other checkout points into.
func TestRemovesACheckoutButNeverTheRepositorysOwn(t *testing.T) {
	checkouts := repository(t)
	if _, err := Create(checkouts, "temp", "main", ""); err != nil {
		t.Fatal(err)
	}
	if err := Remove(checkouts, "main"); err == nil {
		t.Error("removed the repository's own checkout")
	}
	if err := Remove(checkouts, "nothing"); err == nil {
		t.Error("removed a branch that is not there")
	}
	if err := Remove(checkouts, "temp"); err != nil {
		t.Fatal(err)
	}
	// The branch itself stays: it is in the repository and can be opened again.
	if found := Find(checkouts, "temp"); found == nil || found.CheckedOut {
		t.Errorf("after removing the checkout the branch is %+v", found)
	}
}

// A folder with no repository behind it still has the one place you work in, named for itself.
func TestAPlainFolderIsItsOwnOnlyCheckout(t *testing.T) {
	project := t.TempDir()
	checkouts := Checkouts{Primary: filepath.Join(project, "local"), Worktrees: project}
	if err := os.MkdirAll(checkouts.Primary, 0o755); err != nil {
		t.Fatal(err)
	}
	branches := List(checkouts)
	if len(branches) != 1 || branches[0].Name != "local" || !branches[0].Primary {
		t.Fatalf("listed %+v", branches)
	}
	if _, err := Create(checkouts, "feat", "", ""); err == nil {
		t.Error("cut a branch of a folder that is no repository")
	}
}

// git's own rules for a ref name, asked before git is, so a name like `x.lock` is refused in
// words rather than in whatever `git worktree add` printed.
func TestRefusesANameGitWouldNotTake(t *testing.T) {
	for _, one := range []struct{ name, expect string }{
		{"/leading", "slash"},
		{"trailing/", "slash"},
		{"a//b", "empty segment"},
		{"a..b", `".."`},
		{"a@{b", `"@{"`},
		{"x.lock", `".lock"`},
		{"a b", "letters"},
		{"a~b", "letters"},
	} {
		if got := NameProblem(one.name); !strings.Contains(got, one.expect) {
			t.Errorf("NameProblem(%q) = %q, want something about %q", one.name, got, one.expect)
		}
	}
	for _, name := range []string{"main", "feat/one", "a_b-c.d", "v1.2.3"} {
		if got := NameProblem(name); got != "" {
			t.Errorf("NameProblem(%q) = %q", name, got)
		}
	}
}
