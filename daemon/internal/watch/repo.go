// The repository's watcher. It follows git's own state rather than the files in it: a commit, a
// stage or a branch move made in a shell changes what the sidebar should say about every row
// without touching a single document — and the tree watcher deliberately never looks inside
// `.git`, so nothing else would notice.
//
// Four files say all of it: the index moves on every stage and commit, HEAD moves when the
// checkout changes branch, the branch HEAD names moves on a commit, a reset or an amend, and
// `packed-refs` is where that branch goes once git packs it. They are polled rather than
// event-watched, and that is a lesson, not a shortcut: git replaces the index by renaming a
// lockfile over it, an event watch follows the orphaned inode into silence after the first
// replacement, and a stale letter in the sidebar is exactly what this exists to prevent. Four
// stats every 200ms is nothing; the object store is left alone. The paths are asked of git rather
// than assumed at `.git/`, because a worktree's `.git` is a file pointing somewhere else — and its
// refs live in the clone it was cut from, not beside its index.

package watch

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

const poll = 200 * time.Millisecond

type Repo struct {
	stop chan struct{}
	once sync.Once
}

// WatchRepo polls a checkout's git state. A folder with no repository has none to watch, which is
// an ordinary thing for a project to be — the watch just never opens, and nil is what says so.
func WatchRepo(checkout string, onChange func()) *Repo {
	held := git.New(checkout, "", "")
	dir := held.GitDir()
	if dir == "" {
		return nil
	}
	common := held.CommonDir()
	if common == "" {
		common = dir
	}

	watched := &Repo{stop: make(chan struct{})}
	go func() {
		ticker := time.NewTicker(poll)
		defer ticker.Stop()
		seen := stamps(dir, common)
		for {
			select {
			case <-watched.stop:
				return
			case <-ticker.C:
				now := stamps(dir, common)
				if now != seen {
					seen = now
					onChange()
				}
			}
		}
	}()
	return watched
}

// stamps is the files as one string: when each was last written and how big it is. A comparison
// rather than an event, for the reason at the top of the file.
func stamps(dir, common string) string {
	paths := []string{
		filepath.Join(dir, "index"),
		filepath.Join(dir, "HEAD"),
		filepath.Join(common, "packed-refs"),
	}
	if ref := headRef(dir); ref != "" {
		paths = append(paths, filepath.Join(common, ref))
	}
	said := ""
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			said += path + ":gone;"
			continue
		}
		said += path + ":" + info.ModTime().String() + ":" + strconv.FormatInt(info.Size(), 10) + ";"
	}
	return said
}

// headRef is the branch HEAD names, read off the file rather than asked of git — this runs five
// times a second. Empty on a detached HEAD, whose commit is in HEAD itself.
func headRef(dir string) string {
	body, err := os.ReadFile(filepath.Join(dir, "HEAD"))
	if err != nil {
		return ""
	}
	ref, named := strings.CutPrefix(strings.TrimSpace(string(body)), "ref: ")
	if !named {
		return ""
	}
	return filepath.FromSlash(ref)
}

func (r *Repo) Close() {
	if r == nil {
		return
	}
	r.once.Do(func() { close(r.stop) })
}
