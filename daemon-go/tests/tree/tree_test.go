package tree_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/tree"

	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

func standing(t *testing.T, files map[string]string) *Tree {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return New(dir)
}

func flatten(entries []doc.Entry) []string {
	var found []string
	for _, one := range entries {
		found = append(found, string(one.Kind)+" "+one.Path)
		found = append(found, flatten(one.Children)...)
	}
	return found
}

// A dotted name is still a document — `.gitignore` is as editable as any other. Only git's store
// and the app's own folders are held back.
func TestListsDottedNamesAndHoldsBackOnlyWhatIsNotADocument(t *testing.T) {
	held := standing(t, map[string]string{
		"sync.md":           "x",
		".gitignore":        "x",
		"docs/plan.md":      "x",
		".git/config":       "x",
		".repos/a/b.md":     "x",
		".broodmother/x.md": "x",
	})
	entries, err := held.List()
	if err != nil {
		t.Fatal(err)
	}
	listed := strings.Join(flatten(entries), " ")
	for _, want := range []string{"file sync.md", "file .gitignore", "dir docs", "file docs/plan.md"} {
		if !strings.Contains(listed, want) {
			t.Errorf("did not list %q: %s", want, listed)
		}
	}
	// Named exactly, or the check would match `.gitignore` and call the store listed.
	for _, unwanted := range []string{"dir .git", "dir .repos", "dir .broodmother"} {
		if strings.Contains(listed, unwanted) {
			t.Errorf("listed %q: %s", unwanted, listed)
		}
	}
}

// Folders first, then the browser's order within each kind — which puts a lowercase name before
// a capital, where Go's own sort would not.
func TestListsFoldersFirstThenInTheBrowsersOrder(t *testing.T) {
	held := standing(t, map[string]string{
		"Zeta.md": "x", "alpha.md": "x", "README.md": "x",
		"zoo/a.md": "x", "Apples/a.md": "x",
	})
	entries, err := held.List()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, one := range entries {
		names = append(names, one.Name)
	}
	want := []string{"Apples", "zoo", "alpha.md", "README.md", "Zeta.md"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Errorf("listed %v, want %v", names, want)
	}
}

func TestReadsAndWritesADocument(t *testing.T) {
	held := standing(t, nil)
	path, err := held.Write("notes/sync.md", "# Sync\n")
	if err != nil {
		t.Fatal(err)
	}
	if path != "notes/sync.md" {
		t.Errorf("wrote %q", path)
	}
	body, err := held.Read("notes/sync.md")
	if err != nil || body != "# Sync\n" {
		t.Errorf("read %q, %v", body, err)
	}
	if !held.Exists("notes/sync.md") || held.Exists("nowhere.md") {
		t.Error("exists disagreed with the disk")
	}
}

// Every `.md` in the tree, in walk order, which is what a link resolution is made against.
func TestFindsEveryMarkdownDocument(t *testing.T) {
	held := standing(t, map[string]string{
		"b.md": "x", "a/inner.md": "x", "logo.png": "x", "notes.txt": "x",
	})
	documents, err := held.Documents()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(documents, ",") != "a/inner.md,b.md" {
		t.Errorf("found %v", documents)
	}
}

// The one place a tree's boundary exists. A path arrives from a browser, so an escape is refused
// rather than resolved.
func TestRefusesAPathThatLeavesTheTree(t *testing.T) {
	held := standing(t, map[string]string{"a.md": "x"})
	for _, path := range []string{"../outside.md", "a/../../outside.md", "/etc/passwd", ".git/config", ""} {
		if _, err := held.Read(path); err == nil {
			t.Errorf("read %q", path)
		}
		if _, err := held.Write(path, "x"); err == nil {
			t.Errorf("wrote %q", path)
		}
	}
}

func TestMakesAFolderOnceAndSaysSoTheSecondTime(t *testing.T) {
	held := standing(t, nil)
	if _, err := held.Mkdir("empty"); err != nil {
		t.Fatal(err)
	}
	if _, err := held.Mkdir("empty"); err == nil {
		t.Error("made the same folder twice")
	}
}

func TestMovesADocumentAndRefusesToLandOnOne(t *testing.T) {
	held := standing(t, map[string]string{"a.md": "one", "taken.md": "two"})
	from, to, err := held.Move("a.md", "deep/deeper/b.md")
	if err != nil {
		t.Fatal(err)
	}
	if from != "a.md" || to != "deep/deeper/b.md" {
		t.Errorf("moved %q to %q", from, to)
	}
	if body, _ := held.Read("deep/deeper/b.md"); body != "one" {
		t.Errorf("landed as %q", body)
	}
	if _, _, err := held.Move("taken.md", "deep/deeper/b.md"); err == nil {
		t.Error("moved onto a document that was already there")
	}
}

func TestRemovesWhatIsThereAndSaysSoWhenItIsNot(t *testing.T) {
	held := standing(t, map[string]string{"a.md": "x", "dir/b.md": "x"})
	if _, err := held.Remove("a.md"); err != nil {
		t.Fatal(err)
	}
	if held.Exists("a.md") {
		t.Error("it is still there")
	}
	if _, err := held.Remove("dir"); err != nil {
		t.Fatal(err)
	}
	if _, err := held.Remove("nowhere.md"); err == nil {
		t.Error("removed something that was not there")
	}
}
