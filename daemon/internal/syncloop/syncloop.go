// Package syncloop pulls, commits and pushes once the project has been quiet for its idle period
// — as much of that as its settings ask for, and none of it in a project with no repository. A
// conflict latches: nothing syncs again until it is explicitly cleared.
//
// Named for the loop rather than for what it does, because `sync` is taken by the standard
// library and this file needs it.
package syncloop

import (
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
)

// State is where a project stands. Off is a project that does not sync.
type State string

const (
	Off      State = "off"
	Idle     State = "idle"
	Syncing  State = "syncing"
	Conflict State = "conflict"
	Error    State = "error"
	Offline  State = "offline"
)

type Status struct {
	State State `json:"state"`
	// LastSyncedAt is milliseconds since the epoch, absent until a pass has settled.
	LastSyncedAt *float64 `json:"lastSyncedAt,omitempty"`
	// Conflicted is non-empty only in conflict, which latches until explicitly cleared.
	Conflicted []doc.Path `json:"conflicted"`
	Message    string     `json:"message,omitempty"`
}

func same(a, b Status) bool {
	if a.State != b.State || a.Message != b.Message || len(a.Conflicted) != len(b.Conflicted) {
		return false
	}
	if (a.LastSyncedAt == nil) != (b.LastSyncedAt == nil) {
		return false
	}
	if a.LastSyncedAt != nil && *a.LastSyncedAt != *b.LastSyncedAt {
		return false
	}
	for index := range a.Conflicted {
		if a.Conflicted[index] != b.Conflicted[index] {
			return false
		}
	}
	return true
}

var mdSuffix = regexp.MustCompile(`(?i)\.md$`)

// CommitMessage is what a pass commits under: the one document it touched, the folder they share,
// or a count where they share none.
func CommitMessage(paths []doc.Path) string {
	if len(paths) == 0 {
		return "docs: update"
	}
	if len(paths) == 1 {
		return "docs: update " + mdSuffix.ReplaceAllString(paths[0], "")
	}

	folders := make([][]string, len(paths))
	for index, path := range paths {
		parts := strings.Split(path, "/")
		folders[index] = parts[:len(parts)-1]
	}
	common := []string{}
	for at := range folders[0] {
		segment := folders[0][at]
		shared := true
		for _, one := range folders {
			if at >= len(one) || one[at] != segment {
				shared = false
				break
			}
		}
		if !shared {
			break
		}
		common = append(common, segment)
	}
	if len(common) > 0 {
		return "docs: update " + strings.Join(common, "/")
	}
	return "docs: update " + strconv.Itoa(len(paths)) + " files"
}

// Deps is everything the loop asks of the daemon around it, so the loop itself touches nothing
// but git and the clock.
type Deps struct {
	// Git is nil when no project is open. A project that is a plain folder still has one here —
	// it is what reports there is no repository.
	Git func() *git.Git
	// Settings is the open project's own. Every project answers this differently.
	Settings func() git.Settings
	// Author is nil until a profile exists: a commit needs someone to commit as.
	Author func() *git.Author
	// Acts is the newest act the ledger holds for each path about to be committed, for the
	// trailers — asked only where the setting is on, and answering with nothing is a commit
	// worded exactly as it was before this existed.
	Acts func([]doc.Path) []ledger.Entry
	// OnStatus is told whenever the status moves, and never when it has not.
	OnStatus func(Status)
	// Now is the clock, for a test that needs to move it.
	Now func() time.Time
}

type Loop struct {
	deps Deps

	mutex      sync.Mutex
	status     Status
	lastEditAt *time.Time
	running    bool
	stop       chan struct{}
	// pending is what the listener has not been told yet, filled under the lock and emptied
	// outside it.
	pending []Status
}

func New(deps Deps) *Loop {
	if deps.Now == nil {
		deps.Now = time.Now
	}
	return &Loop{deps: deps, status: Status{State: Off, Conflicted: []doc.Path{}}}
}

func (l *Loop) State() Status {
	l.mutex.Lock()
	defer l.mutex.Unlock()
	return l.copy()
}

// copy is the status as a caller may keep it, with its own list. Held under the lock.
func (l *Loop) copy() Status {
	held := l.status
	held.Conflicted = append([]doc.Path{}, l.status.Conflicted...)
	if l.status.LastSyncedAt != nil {
		at := *l.status.LastSyncedAt
		held.LastSyncedAt = &at
	}
	return held
}

// Start wakes the loop on an interval. The pass itself is what decides whether the quiet period
// has passed, so waking often costs nothing.
func (l *Loop) Start(every time.Duration) {
	l.mutex.Lock()
	if l.stop != nil {
		l.mutex.Unlock()
		return
	}
	stop := make(chan struct{})
	l.stop = stop
	l.mutex.Unlock()

	go func() {
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				l.Tick()
			}
		}
	}()
}

func (l *Loop) Stop() {
	l.mutex.Lock()
	defer l.mutex.Unlock()
	if l.stop != nil {
		close(l.stop)
		l.stop = nil
	}
}

func (l *Loop) NoteEdit() {
	l.mutex.Lock()
	defer l.mutex.Unlock()
	at := l.deps.Now()
	l.lastEditAt = &at
}

func (l *Loop) ClearConflict() Status {
	l.mutex.Lock()
	if l.status.State == Conflict {
		l.set(Status{State: Idle, Conflicted: []doc.Path{}, LastSyncedAt: l.status.LastSyncedAt})
	}
	answer := l.copy()
	l.mutex.Unlock()
	l.flush()
	return answer
}

// Refresh recomputes the standing state without syncing, for when the project underneath
// changes. Switching from a clone to a plain folder has to stop saying "synced two minutes ago".
func (l *Loop) Refresh() Status {
	l.mutex.Lock()
	switch {
	case l.status.State == Conflict:
	case l.idleReason() != "":
		l.set(Status{State: Off, Conflicted: []doc.Path{}, Message: l.idleReason()})
	case l.status.State == Off:
		// Coming back from off is a fresh start: the reason it was off no longer holds, and
		// leaving it on screen would explain a state the project is not in any more.
		l.set(Status{State: Idle, Conflicted: l.status.Conflicted})
	}
	answer := l.copy()
	l.mutex.Unlock()
	l.flush()
	return answer
}

// idleReason is why this project does not sync, or empty when it does. Having no repository is
// checked before the switch is: it is the reason the switch cannot be turned on, so it is the
// more useful of the two things to be told.
func (l *Loop) idleReason() string {
	held := l.deps.Git()
	if held == nil {
		return "no project is open"
	}
	if !held.IsRepo() {
		return "this project has no git repo"
	}
	settings := l.deps.Settings()
	switch {
	case !settings.Enabled:
		return "sync is off for this project"
	case !settings.AutoCommit && !settings.Pull && !settings.Push:
		return "sync has nothing turned on"
	}
	return ""
}

// Tick is the automatic path: it only syncs once the quiet period has passed.
func (l *Loop) Tick() Status {
	l.mutex.Lock()
	settings := l.deps.Settings()
	quiet := l.lastEditAt != nil &&
		l.deps.Now().Sub(*l.lastEditAt) >= time.Duration(settings.IdleMs)*time.Millisecond
	skip := l.status.State == Conflict || !settings.Enabled || !quiet
	held := l.copy()
	l.mutex.Unlock()

	if skip {
		return held
	}
	return l.sync()
}

// SyncNow is the manual path, still refused while a conflict is latched. Someone asked, so
// someone is told: an unchanged status is not news the loop volunteers, but it is an answer here.
func (l *Loop) SyncNow() Status {
	l.mutex.Lock()
	latched := l.status.State == Conflict
	before := l.copy()
	l.mutex.Unlock()
	if latched {
		return before
	}

	after := l.sync()
	if same(before, after) && l.deps.OnStatus != nil {
		l.deps.OnStatus(after)
	}
	return after
}
