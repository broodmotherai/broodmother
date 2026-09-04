// Package watch keeps a tree and a repository true underneath everything above them.
//
// Two watchers, and they watch different things. The tree's follows the documents; the
// repository's follows `.git/index` and `.git/HEAD`, because a commit or a stage made in a shell
// changes what the sidebar should say about every row without touching a single document.
package watch

import (
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

const debounce = 100 * time.Millisecond

// suppressFor is how long a write of the app's own is allowed to echo for. One write can arrive
// as more than one event, so this cannot be spent on the first — but it only has to outlast the
// echo of a local write, which is immediate.
const suppressFor = 250 * time.Millisecond

// IsSkipped reports whether a path is beneath something the tree does not list. `skipped` holds
// git's ignore list as the tree read it — the top of each ignored thing, so `node_modules` rather
// than the forty thousand paths inside it — which means every ancestor has to be asked about, not
// just the name on the end.
func IsSkipped(root, target string, skipped map[string]bool) bool {
	if target == root {
		return false
	}
	prefix := ""
	for _, segment := range strings.Split(utils.ToDocPath(root, target), "/") {
		if constants.IsReserved(segment) {
			return true
		}
		if prefix == "" {
			prefix = segment
		} else {
			prefix = prefix + "/" + segment
		}
		if skipped[prefix] {
			return true
		}
	}
	return false
}

// pending is the debounce: one event per path, the last one wins, and it fires once the path has
// been quiet.
type pending struct {
	mutex sync.Mutex
	held  map[string]*time.Timer
	// suppressed is what the app wrote itself, and until when.
	suppressed map[string]time.Time
	every      time.Duration
}

func newPending(every time.Duration) *pending {
	return &pending{held: map[string]*time.Timer{}, suppressed: map[string]time.Time{}, every: every}
}

// Suppress marks a path as the app's own, so the echo of a write this daemon made is not reported
// back to it as news.
func (p *pending) Suppress(paths ...string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	until := time.Now().Add(suppressFor)
	for _, path := range paths {
		p.suppressed[path] = until
	}
}

// isSuppressed: inside the window the change is the app's own and is dropped; past it, the entry
// is spent and whatever comes next belongs to somebody else.
func (p *pending) isSuppressed(path string) bool {
	until, said := p.suppressed[path]
	if !said {
		return false
	}
	if until.Before(time.Now()) {
		delete(p.suppressed, path)
		return false
	}
	return true
}

func (p *pending) queue(path string, fire func()) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	if timer, already := p.held[path]; already {
		timer.Stop()
	}
	p.held[path] = time.AfterFunc(p.every, func() {
		p.mutex.Lock()
		delete(p.held, path)
		quiet := p.isSuppressed(path)
		p.mutex.Unlock()
		if !quiet {
			fire()
		}
	})
}

func (p *pending) stop() {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	for path, timer := range p.held {
		timer.Stop()
		delete(p.held, path)
	}
}

// dirsUnder is every folder a watch has to stand over, since a watch is per-directory and this
// one has to follow the whole tree. What the tree lists is what is watched: dotted files are in —
// `.gitignore` is a document like any other — and three things are out: git's store, the app's own
// folders, and everything the repository ignores. A repository whose dependencies are on disk has
// tens of thousands of those, none of it content, and the tree does not list any of it.
func dirsUnder(root string, skipped map[string]bool, walk func(string) []string) []string {
	found := []string{root}
	for at := 0; at < len(found); at++ {
		for _, name := range walk(found[at]) {
			child := filepath.Join(found[at], name)
			if !IsSkipped(root, child, skipped) {
				found = append(found, child)
			}
		}
	}
	return found
}
