package watch

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
)

type heard struct {
	mutex  sync.Mutex
	events []doc.Event
}

func (h *heard) saw(event doc.Event) {
	h.mutex.Lock()
	defer h.mutex.Unlock()
	h.events = append(h.events, event)
}

// settled waits for the debounce and a little after it, which is what a watcher's answer is worth
// asking for.
func (h *heard) settled() []doc.Event {
	time.Sleep(400 * time.Millisecond)
	h.mutex.Lock()
	defer h.mutex.Unlock()
	return append([]doc.Event{}, h.events...)
}

func watching(t *testing.T, skipped map[string]bool) (string, *heard, *Tree) {
	t.Helper()
	root := t.TempDir()
	told := &heard{}
	held, err := WatchTree(root, told.saw, Options{Skipped: skipped, Every: 50 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { held.Close() })
	// A watch is not standing the instant it is asked for.
	time.Sleep(100 * time.Millisecond)
	return root, told, held
}

func write(t *testing.T, root, name, body string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func kinds(events []doc.Event) map[doc.Path]doc.EventType {
	found := map[doc.Path]doc.EventType{}
	for _, one := range events {
		found[one.Path] = one.Type
	}
	return found
}

func TestReportsWhatChangedUnderIt(t *testing.T) {
	root, told, _ := watching(t, nil)
	write(t, root, "a.md", "one\n")
	write(t, root, "deep/b.md", "two\n")

	got := kinds(told.settled())
	if got["a.md"] != doc.Created {
		t.Errorf("a.md is %q", got["a.md"])
	}
	// The folder and the document inside it both moved.
	if got["deep/b.md"] != doc.Created && got["deep"] != doc.Created {
		t.Errorf("nothing was said about deep: %v", got)
	}
}

// A folder made by something else is a folder whose contents nothing would otherwise watch.
func TestFollowsAFolderMadeAfterItStartedWatching(t *testing.T) {
	root, told, _ := watching(t, nil)
	if err := os.MkdirAll(filepath.Join(root, "later"), 0o755); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	write(t, root, "later/inside.md", "x\n")

	if got := kinds(told.settled()); got["later/inside.md"] == "" {
		t.Errorf("a document in a folder made later went unheard: %v", got)
	}
}

// What the tree lists is what is watched: git's ignore list is out, and so are the app's own
// folders — a repository whose dependencies are on disk has tens of thousands of paths that are
// not content.
func TestSaysNothingAboutWhatTheTreeDoesNotList(t *testing.T) {
	root, told, _ := watching(t, map[string]bool{"node_modules": true})
	write(t, root, "node_modules/dep/index.js", "x\n")
	write(t, root, ".git/HEAD", "ref\n")
	write(t, root, "kept.md", "x\n")

	got := kinds(told.settled())
	for path := range got {
		if path != "kept.md" {
			t.Errorf("reported %q", path)
		}
	}
	if got["kept.md"] == "" {
		t.Error("the document it should have reported went unheard")
	}
}

// The app's own atomic write lands as a temp file renamed over the real one. The rename's echo is
// the real path's to report; the temp name is nothing's.
func TestNeverReportsTheTempFileOfAnAtomicWrite(t *testing.T) {
	root, told, _ := watching(t, nil)
	write(t, root, ".a.md.abc123.broodmothertmp", "x\n")
	write(t, root, "real.md", "x\n")

	for path := range kinds(told.settled()) {
		if path != "real.md" {
			t.Errorf("reported %q", path)
		}
	}
}

// A write of the app's own is not news from somewhere else.
func TestDropsTheEchoOfItsOwnWrite(t *testing.T) {
	root, told, held := watching(t, nil)
	held.Suppress("mine.md")
	write(t, root, "mine.md", "x\n")
	write(t, root, "theirs.md", "x\n")

	got := kinds(told.settled())
	if _, said := got["mine.md"]; said {
		t.Error("reported the app's own write back to it")
	}
	if got["theirs.md"] == "" {
		t.Error("dropped somebody else's write too")
	}
}

// Past the window the entry is spent, and whatever comes next belongs to somebody else.
func TestTheSuppressionIsSpentAfterAMoment(t *testing.T) {
	root, told, held := watching(t, nil)
	held.Suppress("mine.md")
	time.Sleep(suppressFor + 100*time.Millisecond)
	write(t, root, "mine.md", "x\n")

	if kinds(told.settled())["mine.md"] == "" {
		t.Error("a later write to the same path was still dropped")
	}
}

func TestIsSkippedAsksEveryAncestor(t *testing.T) {
	root := "/tmp/tree"
	skipped := map[string]bool{"node_modules": true, "a/b": true}
	for _, one := range []struct {
		path string
		want bool
	}{
		{"/tmp/tree", false},
		{"/tmp/tree/notes/a.md", false},
		{"/tmp/tree/node_modules", true},
		{"/tmp/tree/node_modules/dep/deep/x.js", true},
		{"/tmp/tree/a/b", true},
		{"/tmp/tree/a/b/c/d.md", true},
		{"/tmp/tree/a/c.md", false},
		{"/tmp/tree/.git/HEAD", true},
		{"/tmp/tree/.repos/x", true},
		{"/tmp/tree/.gitignore", false},
	} {
		if got := IsSkipped(root, one.path, skipped); got != one.want {
			t.Errorf("IsSkipped(%q) = %v, want %v", one.path, got, one.want)
		}
	}
}
