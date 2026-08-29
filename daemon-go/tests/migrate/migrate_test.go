package migrate_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/migrate"

	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/broodmotherai/broodmother/daemon-go/internal/config"
)

// build lays out a home. A name ending in `/` is an empty folder; everything else is a file with
// the bytes given, and the folders above it are made.
func build(t *testing.T, files map[string]string) string {
	t.Helper()
	home := t.TempDir()
	for name, body := range files {
		full := filepath.Join(home, filepath.FromSlash(name))
		if strings.HasSuffix(name, "/") {
			if err := os.MkdirAll(full, 0o755); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return home
}

// tree is every path under the home, relative and slash-separated, so a whole layout is one
// comparison rather than a dozen stats.
func tree(t *testing.T, home string) []string {
	t.Helper()
	var found []string
	err := filepath.WalkDir(home, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || path == home {
			return err
		}
		rest, err := filepath.Rel(home, path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(rest)
		if entry.IsDir() {
			name += "/"
		}
		found = append(found, name)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(found)
	return found
}

func run(t *testing.T, home string, loaded config.Loaded) config.Config {
	t.Helper()
	held, err := Run(home, loaded)
	if err != nil {
		t.Fatalf("migration: %v", err)
	}
	return held
}

func plain() config.Loaded {
	return config.Loaded{Config: config.Default(nil), Bindings: map[string]string{}}
}

func has(t *testing.T, home string, paths ...string) {
	t.Helper()
	found := tree(t, home)
	for _, path := range paths {
		if !slices.Contains(found, path) {
			t.Errorf("no %s — the home is %v", path, found)
		}
	}
}

func hasNo(t *testing.T, home string, paths ...string) {
	t.Helper()
	found := tree(t, home)
	for _, path := range paths {
		if slices.Contains(found, path) {
			t.Errorf("%s is still there — the home is %v", path, found)
		}
	}
}

// The whole cost of running on a home that needs nothing: a handful of directory reads and not
// one write. A migration that moved something here would move it on every start.
func TestLeavesAHomeAlreadyInShapeAlone(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":                   "{}\n",
		"ada/notes/local/one.md":             "hello\n",
		"ada/notes/.repos/x/local/README.md": "x\n",
	})
	before := tree(t, home)
	held := run(t, home, plain())
	if got := tree(t, home); !slices.Equal(got, before) {
		t.Errorf("moved something:\n got %v\nwant %v", got, before)
	}
	if held.Profile == nil || *held.Profile != "ada" {
		t.Errorf("profile is %v", held.Profile)
	}
}

// A home from before profiles existed: every folder in it is a project, and there is no profile
// to hand them to.
func TestMakesAProfileForAHomeThatNeverHadOne(t *testing.T) {
	home := build(t, map[string]string{"notes/one.md": "hello\n"})
	held := run(t, home, plain())

	has(t, home, "default/", "default/profile.json", "default/notes/", "default/notes/local/", "default/notes/local/one.md")
	hasNo(t, home, "notes/", ".migrating/")
	if held.Profile == nil || *held.Profile != "default" {
		t.Errorf("profile is %v", held.Profile)
	}
}

// The binding was a map in the config before a project sat inside the profile it commits as.
func TestHandsEachProjectToTheProfileItWasBoundTo(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json": "{}\n",
		"bo/profile.json":  "{}\n",
		"notes/one.md":     "hello\n",
		"drafts/two.md":    "hello\n",
	})
	loaded := plain()
	loaded.Bindings = map[string]string{filepath.Join(home, "notes"): "bo"}
	run(t, home, loaded)

	// Bound to bo; unbound, so the first profile there is.
	has(t, home, "bo/notes/local/one.md", "ada/drafts/local/two.md")
}

// `profiles/ada.json` and the key beside it become the folder `ada/` holds.
func TestAProfileFileBecomesAFolder(t *testing.T) {
	home := build(t, map[string]string{
		"profiles/ada.json":    `{"color":"#8fb8d8","sshKeyPath":"` + "SSHKEY" + `"}` + "\n",
		"profiles/ada.key":     "private\n",
		"profiles/ada.key.pub": "public\n",
	})
	// The path is only known once the home is, and the repoint turns on it being exact.
	file := filepath.Join(home, "profiles", "ada.json")
	body, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	rewritten := strings.Replace(string(body), "SSHKEY", filepath.Join(home, "profiles", "ada.key"), 1)
	if err := os.WriteFile(file, []byte(rewritten), 0o644); err != nil {
		t.Fatal(err)
	}

	run(t, home, plain())
	has(t, home, "ada/", "ada/profile.json", "ada/profile.key", "ada/profile.key.pub")
	hasNo(t, home, "profiles/")

	var held map[string]any
	saved, err := os.ReadFile(filepath.Join(home, "ada", "profile.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(saved, &held); err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, "ada", "profile.key"); held["sshKeyPath"] != want {
		t.Errorf("key is %v, want %s", held["sshKeyPath"], want)
	}
	if held["color"] != "#8fb8d8" {
		t.Errorf("lost the rest of the file: %v", held)
	}
}

// A profile and a project could share a name, and the profile is the one that keeps it: the
// projects are staged out of the way before any profile is made.
func TestAProfileTakesTheNameAProjectHad(t *testing.T) {
	home := build(t, map[string]string{
		"profiles/ada.json": "{}\n",
		"ada/one.md":        "hello\n",
	})
	run(t, home, plain())
	has(t, home, "ada/profile.json", "ada/ada/local/one.md")
}

// A migration that stopped halfway is the only way this happens, and neither folder is worth
// losing to the other.
func TestKeepsBothWhereTheNameIsAlreadyTaken(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":        "{}\n",
		"ada/notes/local/kept.md": "kept\n",
		"notes/moved.md":          "moved\n",
	})
	run(t, home, plain())
	has(t, home, "ada/notes/local/kept.md", "ada/notes-2/local/moved.md")
}

// The layout before a project held checkouts had the project folder be the checkout itself.
func TestLiftsTheCheckoutIntoLocalAndLeavesTheReposBesideIt(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":                 "{}\n",
		"ada/notes/one.md":                 "hello\n",
		"ada/notes/.projects/x/local/a.md": "x\n",
	})
	run(t, home, plain())
	has(t, home, "ada/notes/local/one.md", "ada/notes/.repos/x/local/a.md")
	hasNo(t, home, "ada/notes/.projects/", "ada/notes/local/.repos/")
}

// A project already holding a checkout is left exactly as it is.
func TestLeavesAProjectThatAlreadyHasACheckout(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":         "{}\n",
		"ada/notes/local/one.md":   "hello\n",
		"ada/notes/feature/one.md": "hello\n",
	})
	run(t, home, plain())
	has(t, home, "ada/notes/local/one.md", "ada/notes/feature/one.md")
	hasNo(t, home, "ada/notes/local/local/")
}

// Every repository the registry pointed at, moved into the project as the repo's own `local`.
func TestAdoptsEveryRepositoryTheRegistryPointedAt(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":       "{}\n",
		"ada/notes/local/one.md": "hello\n",
	})
	// A repository anywhere on the disk, which is what the registry was for. Outside the home,
	// or it would be read as a project from the old layout and moved before this ran.
	elsewhere := filepath.Join(t.TempDir(), "api")
	if err := os.MkdirAll(elsewhere, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(elsewhere, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	registry := map[string]string{"api": elsewhere, "gone": filepath.Join(home, "nothing")}
	body, err := json.Marshal(registry)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, "ada", "notes", ".repos"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "ada", "notes", ".repos", "projects.json"), body, 0o644); err != nil {
		t.Fatal(err)
	}

	run(t, home, plain())
	has(t, home, "ada/notes/.repos/api/local/main.go")
	// The registry the repos replaced is the one thing the migration deletes, and an entry with
	// nothing behind it leaves nothing behind.
	hasNo(t, home, "ada/notes/.repos/projects.json", "ada/notes/.repos/gone/")
}

// Tasks were called dreams, and the name was in the extension every one of them wore. Every
// checkout, since a branch has a copy.
func TestRenamesEveryDreamToATask(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":                 "{}\n",
		"ada/notes/local/.tasks/one.dream": "{}\n",
		"ada/notes/local/deep/two.dream":   "{}\n",
		"ada/notes/feature/three.dream":    "{}\n",
		// A repo is somebody else's source and is never walked.
		"ada/notes/.repos/x/local/four.dream": "{}\n",
	})
	run(t, home, plain())
	has(t, home,
		"ada/notes/local/.tasks/one.task",
		"ada/notes/local/deep/two.task",
		"ada/notes/feature/three.task",
		"ada/notes/.repos/x/local/four.dream",
	)
	hasNo(t, home, "ada/notes/local/.tasks/one.dream")
}

// A dream whose task is already there is left alone rather than written over.
func TestLeavesADreamWhoseTaskIsAlreadyThere(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":          "{}\n",
		"ada/notes/local/one.dream": "old\n",
		"ada/notes/local/one.task":  "new\n",
	})
	run(t, home, plain())
	body, err := os.ReadFile(filepath.Join(home, "ada", "notes", "local", "one.task"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "new\n" {
		t.Errorf("the task now says %q", body)
	}
	has(t, home, "ada/notes/local/one.dream")
}

// `attachments/` is dotted like every other folder the app owns, and `.skills/` moves under
// `.tools/` beside what a skill runs.
func TestRenamesTheTwoFoldersInsideACheckout(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json":                       "{}\n",
		"ada/notes/local/attachments/one.png":    "png\n",
		"ada/notes/local/.skills/hello/SKILL.md": "hi\n",
		"ada/notes/feature/attachments/two.png":  "png\n",
	})
	run(t, home, plain())
	has(t, home,
		"ada/notes/local/.attachments/one.png",
		"ada/notes/local/.tools/.skills/hello/SKILL.md",
		"ada/notes/feature/.attachments/two.png",
	)
	hasNo(t, home, "ada/notes/local/attachments/", "ada/notes/local/.skills/")
}

// Everything this machine filed under a project path, filed under the path it now has.
func TestRewritesTheConfigOntoThePathsThatMoved(t *testing.T) {
	home := build(t, map[string]string{
		"ada/profile.json": "{}\n",
		"notes/one.md":     "hello\n",
	})
	was := filepath.Join(home, "notes")
	now := filepath.Join(home, "ada", "notes")

	loaded := plain()
	loaded.Config.ProjectPath = &was
	loaded.Config.Checkouts = map[string]string{was: "feature"}
	loaded.Config.Repo = map[string]*string{was: nil}
	loaded.Config.RepoBranch = map[string]string{was + "#api": "trunk", "no-hash": "kept"}
	held := run(t, home, loaded)

	if held.ProjectPath == nil || *held.ProjectPath != now {
		t.Errorf("the open project is %v, want %s", held.ProjectPath, now)
	}
	if held.Profile == nil || *held.Profile != "ada" {
		t.Errorf("profile is %v", held.Profile)
	}
	if held.Checkouts[now] != "feature" {
		t.Errorf("checkouts are %v", held.Checkouts)
	}
	if _, said := held.Repo[now]; !said {
		t.Errorf("repo is %v", held.Repo)
	}
	if held.RepoBranch[now+"#api"] != "trunk" || held.RepoBranch["no-hash"] != "kept" {
		t.Errorf("repoBranch is %v", held.RepoBranch)
	}
}
