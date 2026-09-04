package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

// A home with one profile holding one project, standing on the checkout the app would have made
// it. `write` lays the files in, relative to that checkout.
func projectHome(t *testing.T, write map[string]string) (string, string) {
	t.Helper()
	home := t.TempDir()
	checkout := filepath.Join(home, "Ada", "notes", "local")
	if err := os.MkdirAll(checkout, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "Ada", "profile.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, body := range write {
		full := filepath.Join(checkout, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return home, checkout
}

// What the open checkout carries for the agents it opens, read when the project opens.
func TestListsWhatTheCheckoutCarriesForItsAgents(t *testing.T) {
	home, _ := projectHome(t, map[string]string{
		".tools/.skills/deploy/SKILL.md":     "---\ndescription: ships it\n---\n",
		".tools/.skills/dev/review/SKILL.md": "---\nname: ignored\n---\n",
		".personas/librarian/PERSONA.md":     "---\ndescription: keeps the vault\n---\n",
	})
	server := servingIn(t, home, "")

	var skills struct {
		Skills []struct{ Name, Description string } `json:"skills"`
	}
	_, body := get(t, server, "/api/skills", "")
	if err := json.Unmarshal(body, &skills); err != nil {
		t.Fatal(err)
	}
	if len(skills.Skills) != 2 {
		t.Fatalf("carries %+v", skills.Skills)
	}
	// The folder is the name, nested folders included, and a skill nobody described still says so.
	if skills.Skills[0].Name != "deploy" || skills.Skills[0].Description != "ships it" {
		t.Errorf("first is %+v", skills.Skills[0])
	}
	if skills.Skills[1].Name != "dev/review" || skills.Skills[1].Description == "" {
		t.Errorf("second is %+v", skills.Skills[1])
	}

	var personas struct {
		Personas []struct{ Name, Description string } `json:"personas"`
	}
	_, body = get(t, server, "/api/personas", "")
	if err := json.Unmarshal(body, &personas); err != nil {
		t.Fatal(err)
	}
	if len(personas.Personas) != 1 || personas.Personas[0].Name != "librarian" {
		t.Errorf("carries %+v", personas.Personas)
	}
}

// A project with no checkout of its own carries nothing rather than refusing: the page that asks
// is the one you would use to make some.
func TestCarriesNothingBeforeThereIsAProject(t *testing.T) {
	server := serving(t, "")
	for _, path := range []string{"/api/skills", "/api/personas"} {
		response, body := get(t, server, path, "")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s answered %d: %s", path, response.StatusCode, body)
		}
		var held map[string][]any
		if err := json.Unmarshal(body, &held); err != nil {
			t.Fatal(err)
		}
		for _, carried := range held {
			if len(carried) != 0 {
				t.Errorf("%s carries %+v", path, carried)
			}
		}
	}
}

// A repository on `main` with a checkout of `feature` beside it, which is the shape the app
// gives a project: the clone is the primary and a branch gets a worktree of its own.
//
// Built with the commands the daemon itself is allowed to run — no `checkout`, no `rm` — since
// the guard against a destructive git command applies to the fixture as much as to the daemon.
func branched(t *testing.T, project string) {
	t.Helper()
	primary := filepath.Join(project, "local")
	feature := filepath.Join(project, "feature")

	run := func(root string, args ...string) {
		t.Helper()
		out, err := git.New(root, "", "").Run(args...)
		if err != nil || out.Code != 0 {
			t.Fatalf("git %v: %v %s", args, err, out.Stderr)
		}
	}
	write := func(root, name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	run(primary, "init", "-q", "-b", "main", ".")
	run(primary, "config", "user.name", "M")
	run(primary, "config", "user.email", "m@x")
	write(primary, "kept.md", "the same on both\n")
	write(primary, "gone.md", "only on main\n")
	write(primary, "was.md", "renamed later\n")
	run(primary, "add", "-A")
	run(primary, "commit", "-qm", "first")

	run(primary, "worktree", "add", "-q", feature, "-b", "feature")
	write(feature, "kept.md", "changed on the branch\n")
	write(feature, "new.md", "only on the branch\n")
	if err := os.Remove(filepath.Join(feature, "gone.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(feature, "was.md"), filepath.Join(feature, "now.md")); err != nil {
		t.Fatal(err)
	}
	run(feature, "add", "-A")
	run(feature, "commit", "-qm", "second")

	// Both branches move on after the split, which is what makes the two bases differ.
	write(primary, "later.md", "main kept working\n")
	run(primary, "add", "-A")
	run(primary, "commit", "-qm", "third")
}

// standingOn is a config with the project open on one of its checkouts.
func standingOn(project, folder string) string {
	return `{"projectPath":` + quoted(project) + `,"profile":"Ada","checkouts":{` +
		quoted(project) + `:` + quoted(folder) + `},"git":{},"repo":{},"repoBranch":{}}`
}

func diffed(t *testing.T, server *Server, path string) []map[string]any {
	t.Helper()
	response, body := get(t, server, path, "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("%s answered %d: %s", path, response.StatusCode, body)
	}
	var held struct {
		Files []map[string]any `json:"files"`
	}
	if err := json.Unmarshal(body, &held); err != nil {
		t.Fatal(err)
	}
	return held.Files
}

func changes(files []map[string]any) map[string]string {
	held := map[string]string{}
	for _, one := range files {
		path, _ := one["path"].(string)
		change, _ := one["change"].(string)
		held[path] = change
	}
	return held
}

// As the two stand: what main has that this branch does not, and the other way about.
func TestComparesTwoBranchesAsTheyStand(t *testing.T) {
	home, checkout := projectHome(t, nil)
	branched(t, filepath.Dir(checkout))
	server := servingIn(t, home, standingOn(filepath.Dir(checkout), "feature"))

	files := diffed(t, server, "/api/diff?root=project&against=main")
	got := changes(files)
	want := map[string]string{
		"kept.md":  "modified",
		"new.md":   "added",
		"gone.md":  "removed",
		"now.md":   "renamed",
		"later.md": "removed",
	}
	for path, change := range want {
		if got[path] != change {
			t.Errorf("%s is %q, want %q — the whole is %+v", path, got[path], change, got)
		}
	}
	// A rename is one file under two names, and the other branch's name is the one carried.
	for _, one := range files {
		if one["path"] == "now.md" && one["from"] != "was.md" {
			t.Errorf("the rename came from %+v", one["from"])
		}
	}
}

// Against where they parted: what this branch did, with the other branch's own work since the
// split left out of it — which is the difference a pull request shows.
func TestComparesTwoBranchesAgainstWhereTheyParted(t *testing.T) {
	home, checkout := projectHome(t, nil)
	branched(t, filepath.Dir(checkout))
	server := servingIn(t, home, standingOn(filepath.Dir(checkout), "feature"))

	got := changes(diffed(t, server, "/api/diff?root=project&against=main&basis=split"))
	if _, said := got["later.md"]; said {
		t.Errorf("the other branch's own work is in it: %+v", got)
	}
	if got["kept.md"] != "modified" || got["new.md"] != "added" {
		t.Errorf("this branch's work is not: %+v", got)
	}
}

// One file as each branch has it, and nothing on the side that does not have it.
func TestReadsOneFileOffBothBranches(t *testing.T) {
	home, checkout := projectHome(t, nil)
	branched(t, filepath.Dir(checkout))
	server := servingIn(t, home, standingOn(filepath.Dir(checkout), "feature"))

	read := func(path string) map[string]any {
		t.Helper()
		response, body := get(t, server, "/api/diff/file?root=project&against=main&path="+path, "")
		if response.StatusCode != http.StatusOK {
			t.Fatalf("answered %d: %s", response.StatusCode, body)
		}
		var held map[string]any
		if err := json.Unmarshal(body, &held); err != nil {
			t.Fatal(err)
		}
		return held
	}

	if held := read("kept.md"); held["against"] != "the same on both\n" || held["current"] != "changed on the branch\n" {
		t.Errorf("read %+v", held)
	}
	if held := read("new.md"); held["against"] != nil || held["current"] != "only on the branch\n" {
		t.Errorf("an added file read %+v", held)
	}
	// The other branch is asked for the name it has rather than the one this branch gave it.
	if held := read("now.md"); held["against"] != "renamed later\n" {
		t.Errorf("a renamed file read %+v", held)
	}
}

// A branch compared with itself has nothing to say, and a branch that is not there is said so
// by name rather than answered with an empty list.
func TestSaysWhatItCannotCompare(t *testing.T) {
	home, checkout := projectHome(t, nil)
	branched(t, filepath.Dir(checkout))
	server := servingIn(t, home, standingOn(filepath.Dir(checkout), "feature"))

	if files := diffed(t, server, "/api/diff?root=project&against=feature"); len(files) != 0 {
		t.Errorf("compared a branch with itself: %+v", files)
	}
	response, body := get(t, server, "/api/diff?root=project&against=nowhere", "")
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	response, _ = get(t, server, "/api/diff?root=project", "")
	if response.StatusCode != http.StatusBadRequest {
		t.Errorf("a diff against nothing answered %d", response.StatusCode)
	}
}

// A project that is not a repository is standing in a folder rather than on a branch, so the
// branch it is asked to compare with is one nothing answers to — which is said by name. A repo
// that is not there is the other case and answers with nothing, because there is no side to
// stand on at all.
func TestSaysWhichSideOfAComparisonIsMissing(t *testing.T) {
	home, _ := projectHome(t, map[string]string{"one.md": "hello\n"})
	server := servingIn(t, home, "")

	response, body := get(t, server, "/api/diff?root=project&against=main", "")
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	if files := diffed(t, server, "/api/diff?root=repo:missing&against=main"); len(files) != 0 {
		t.Errorf("compared a repo that is not there: %+v", files)
	}
}
