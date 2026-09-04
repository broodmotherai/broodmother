// A folder's watcher. It stands over one directory and nothing under it, and says only that the
// listing moved: something appeared or something went. What the project keeps its repos in is
// the one folder that wants this — a repository cloned into it from a shell is a repo the sidebar
// should list, and nothing inside the repo is this watcher's to report.

package watch

import (
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// settle is this watcher's debounce, longer than the tree's: what answers it reopens a tree,
// and a clone lands as one folder and then thousands of files nothing here is listening for.
const settle = 500 * time.Millisecond

type Folder struct {
	watcher *fsnotify.Watcher
	pending *pending

	mutex  sync.Mutex
	closed bool
}

// WatchFolder stands a watch over a directory's own listing. A folder that is not there cannot be
// watched, and says so: whoever asked stands it again once the folder exists.
func WatchFolder(dir string, onChange func()) (*Folder, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := watcher.Add(dir); err != nil {
		watcher.Close()
		return nil, err
	}
	held := &Folder{watcher: watcher, pending: newPending(settle)}
	go held.listen(dir, onChange)
	return held, nil
}

func (f *Folder) listen(dir string, onChange func()) {
	for {
		select {
		case event, open := <-f.watcher.Events:
			if !open {
				return
			}
			// Only what a listing shows: a write inside a child is the child's own watcher's
			// business, and a chmod is nobody's.
			if event.Has(fsnotify.Create) || event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
				f.pending.queue(dir, onChange)
			}
		case _, open := <-f.watcher.Errors:
			if !open {
				return
			}
		}
	}
}

func (f *Folder) Close() error {
	if f == nil {
		return nil
	}
	f.mutex.Lock()
	if f.closed {
		f.mutex.Unlock()
		return nil
	}
	f.closed = true
	f.mutex.Unlock()

	f.pending.stop()
	return f.watcher.Close()
}
