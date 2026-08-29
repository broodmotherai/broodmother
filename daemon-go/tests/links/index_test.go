package links_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/links"

	"os"
	"path/filepath"
	"testing"

	"github.com/broodmotherai/broodmother/daemon-go/internal/tree"
)

func indexed(t *testing.T, files map[string]string) *Index {
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
	held := New(tree.New(dir))
	if err := held.Rebuild(); err != nil {
		t.Fatal(err)
	}
	return held
}

// The order is the order the tree walks — folders first, then files, each in the browser's
// order — and it is the same order twice running. Go visits a map differently every run, and a
// sidebar whose backlinks reshuffle between two identical requests is one nobody can read.
func TestBacklinksComeBackInTreeOrderEveryTime(t *testing.T) {
	held := indexed(t, map[string]string{
		"sync.md":      "# Sync\n",
		"README.md":    "points at [[sync]]\n",
		"docs/plan.md": "also points at [[sync]]\n",
		"zz.md":        "and [[sync]] again\n",
	})
	want := []string{"docs/plan.md", "README.md", "sync.md", "zz.md"}
	got := held.Documents()
	for index, one := range want {
		if index >= len(got) || got[index] != one {
			t.Fatalf("documents are %v, want %v", got, want)
		}
	}

	first := names(held.Backlinks("sync.md"))
	if len(first) != 3 || first[0] != "docs/plan.md" || first[1] != "README.md" || first[2] != "zz.md" {
		t.Fatalf("backlinks are %v", first)
	}
	for range 20 {
		if again := names(held.Backlinks("sync.md")); !same(again, first) {
			t.Fatalf("a second ask gave %v, want %v", again, first)
		}
	}
}

func TestForgetsADocumentAndKeepsTheRestInOrder(t *testing.T) {
	held := indexed(t, map[string]string{
		"a.md": "[[c]]\n", "b.md": "[[c]]\n", "c.md": "# C\n",
	})
	held.Forget("a.md")
	if got := names(held.Backlinks("c.md")); len(got) != 1 || got[0] != "b.md" {
		t.Errorf("backlinks are %v", got)
	}
	if got := held.Documents(); len(got) != 2 {
		t.Errorf("documents are %v", got)
	}
}

// A document that links to itself is not a backlink; it is a document.
func TestADocumentDoesNotLinkToItself(t *testing.T) {
	held := indexed(t, map[string]string{"a.md": "see [[a]] and [[b]]\n", "b.md": "# B\n"})
	if got := held.Backlinks("a.md"); len(got) != 0 {
		t.Errorf("backlinks are %v", got)
	}
	if got := held.Outbound("a.md"); len(got) != 1 || got[0].To != "b.md" {
		t.Errorf("outbound is %v", got)
	}
}

func names(links []Backlink) []string {
	found := make([]string, len(links))
	for index, one := range links {
		found[index] = one.From
	}
	return found
}

func same(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for index := range a {
		if a[index] != b[index] {
			return false
		}
	}
	return true
}
