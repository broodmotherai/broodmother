// The tree's watcher. Watches a folder of documents and drops the echo of the app's own writes.

package watch

import (
	"os"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

type Tree struct {
	Root string

	watcher *fsnotify.Watcher
	pending *pending
	onEvent func(doc.Event)
	skipped map[string]bool

	mutex  sync.Mutex
	closed bool
	// standing is every folder a watch is open on, so one made later can be added and one that
	// went can be forgotten.
	standing map[string]bool
}

type Options struct {
	// Skipped is what the tree leaves out, which is git's ignore list. Read when the watch opens
	// and refreshed only as folders appear: a `node_modules` that appears afterwards is watched
	// until this tree is next opened.
	Skipped map[string]bool
	// Every is the debounce. Zero is the default.
	Every time.Duration
}

// WatchTree stands a watch over a folder of documents. A watch that will not open is reported and
// then let go of: what is left is a tree that stops refreshing on its own, which is worth less
// than the server and is not worth the server.
func WatchTree(root string, onEvent func(doc.Event), options Options) (*Tree, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	every := options.Every
	if every == 0 {
		every = debounce
	}
	skipped := options.Skipped
	if skipped == nil {
		skipped = map[string]bool{}
	}

	held := &Tree{
		Root: root, watcher: watcher, pending: newPending(every),
		onEvent: onEvent, skipped: skipped, standing: map[string]bool{},
	}
	for _, dir := range dirsUnder(root, skipped, folderNames) {
		held.stand(dir)
	}
	go held.listen()
	return held, nil
}

func folderNames(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	found := []string{}
	for _, entry := range entries {
		if entry.IsDir() {
			found = append(found, entry.Name())
		}
	}
	return found
}

func (t *Tree) stand(dir string) {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	if t.closed || t.standing[dir] {
		return
	}
	if t.watcher.Add(dir) == nil {
		t.standing[dir] = true
	}
}

// Suppress marks paths as the app's own, so a write this daemon made does not come back to it as
// news from somewhere else.
func (t *Tree) Suppress(paths ...doc.Path) { t.pending.Suppress(paths...) }

func (t *Tree) listen() {
	for {
		select {
		case event, open := <-t.watcher.Events:
			if !open {
				return
			}
			t.saw(event)
		case _, open := <-t.watcher.Errors:
			if !open {
				return
			}
			// A watch that fails leaves a stale tree, which is worth less than the app.
		}
	}
}

func (t *Tree) saw(event fsnotify.Event) {
	if event.Name == t.Root || IsSkipped(t.Root, event.Name, t.skipped) {
		return
	}
	path := utils.ToDocPath(t.Root, event.Name)
	// The app's own atomic writes land as a temp file renamed over the real one. The rename's echo
	// is the real path's to report; the temp name is nothing's, and on a busy machine its
	// appearance and disappearance outlive the debounce and leak out.
	if strings.HasSuffix(path, constants.TempSuffix) {
		return
	}

	kind := doc.Changed
	switch {
	case event.Has(fsnotify.Create):
		kind = doc.Created
		// A folder made by something else — an agent laying out a section, a sync pull dropping
		// one — is a folder whose contents nothing would otherwise watch.
		if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
			for _, dir := range dirsUnder(event.Name, t.skipped, folderNames) {
				t.stand(dir)
			}
		}
	case event.Has(fsnotify.Remove), event.Has(fsnotify.Rename):
		// A rename is a removal from where it was; the arrival is its own create event.
		kind = doc.Removed
	case event.Has(fsnotify.Chmod):
		// Not a change to what a document says, and every other watcher here ignores it.
		return
	}

	t.pending.queue(path, func() { t.onEvent(doc.Event{Type: kind, Path: path}) })
}

func (t *Tree) Close() error {
	t.mutex.Lock()
	if t.closed {
		t.mutex.Unlock()
		return nil
	}
	t.closed = true
	t.mutex.Unlock()

	t.pending.stop()
	return t.watcher.Close()
}
