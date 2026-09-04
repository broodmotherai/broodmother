// One pass: pull, commit, push, in that order and only as far as the settings ask.

package syncloop

import (
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
)

func (l *Loop) sync() Status {
	l.mutex.Lock()
	if l.running {
		held := l.copy()
		l.mutex.Unlock()
		return held
	}
	settings := l.deps.Settings()
	held := l.deps.Git()
	author := l.deps.Author()
	if reason := l.idleReason(); reason != "" {
		l.set(Status{State: Off, Conflicted: []doc.Path{}, Message: reason, LastSyncedAt: l.status.LastSyncedAt})
		answer := l.copy()
		l.mutex.Unlock()
		l.flush()
		return answer
	}
	l.running = true
	l.set(Status{State: Syncing, Conflicted: l.status.Conflicted, LastSyncedAt: l.status.LastSyncedAt})
	l.mutex.Unlock()
	l.flush()

	answer := l.pass(held, settings, author)

	l.mutex.Lock()
	l.running = false
	l.mutex.Unlock()
	return answer
}

// pass runs outside the lock: git is a subprocess and holding a mutex across one would stop
// every read of the status while a push is in flight.
func (l *Loop) pass(held *git.Git, settings git.Settings, author *git.Author) Status {
	before, err := held.Status()
	if err != nil {
		return l.settle(Status{State: Error, Conflicted: []doc.Path{}, Message: err.Error()})
	}
	if len(before.Conflicted) > 0 {
		return l.latch(before.Conflicted, "unresolved conflict")
	}

	// The branch comes from the checkout rather than from settings: a checkout is the same
	// repository on another branch, and it syncs to the branch it is on.
	branch := held.Branch()
	if branch == "" {
		return l.settle(Status{State: Error, Conflicted: []doc.Path{}, Message: "the checkout is not on a branch"})
	}

	// Commit before pulling: rebasing onto a dirty tree fails, and the conflict we do want to see
	// is between two commits.
	uncommitted := false
	if len(before.Changed) > 0 {
		switch {
		case !settings.AutoCommit:
			uncommitted = true
		case author == nil:
			return l.settle(Status{State: Off, Conflicted: []doc.Path{}, Message: "no profile set up"})
		default:
			if err := held.StageAll(); err != nil {
				return l.settle(Status{State: Error, Conflicted: []doc.Path{}, Message: err.Error()})
			}
			committed := held.Commit(l.message(before.Changed, settings), *author)
			if !committed.OK {
				return l.settle(Status{State: Error, Conflicted: []doc.Path{},
					Message: orElse(strings.TrimSpace(committed.Message), "commit failed")})
			}
		}
	}

	// A remote is the project's, not the config's. Without one there is nothing to pull from or
	// push to, and a project whose history stays local is a working project.
	remote := ""
	if settings.Pull || settings.Push {
		remote = held.RemoteURL()
	}

	if settings.Pull && remote != "" && !uncommitted {
		pulled := held.Pull(branch)
		if !pulled.OK {
			if pulled.Failure == git.FailConflict {
				after, _ := held.Status()
				return l.latch(after.Conflicted, pulled.Message)
			}
			return l.settle(Status{State: stateFor(pulled.Failure), Conflicted: []doc.Path{},
				Message: string(pulled.Failure) + ": " + strings.TrimSpace(pulled.Message)})
		}
	}

	if settings.Push && remote != "" {
		pushed := held.Push(branch)
		if !pushed.OK {
			return l.settle(Status{State: stateFor(pushed.Failure), Conflicted: []doc.Path{},
				Message: string(pushed.Failure) + ": " + strings.TrimSpace(pushed.Message)})
		}
	}

	settled := Status{State: Idle, Conflicted: []doc.Path{},
		Message: settledMessage(settings, remote, uncommitted)}

	// Held work is not synced work, so the clock only moves when nothing was left behind.
	if !uncommitted {
		l.mutex.Lock()
		l.lastEditAt = nil
		l.mutex.Unlock()
		at := float64(l.deps.Now().UnixNano()) / 1e6
		settled.LastSyncedAt = &at
	}
	return l.settle(settled)
}

func stateFor(failure git.Failure) State {
	if failure == git.FailOffline {
		return Offline
	}
	return Error
}

// settledMessage is what a successful pass has to say for itself, when it did less than the full
// round.
func settledMessage(settings git.Settings, remote string, uncommitted bool) string {
	switch {
	case uncommitted:
		return "auto-commit is off — your changes are waiting to be committed"
	case (settings.Pull || settings.Push) && remote == "":
		return "no remote — commits stay in this project"
	case !settings.Push:
		return "push is off — commits stay in this project"
	}
	return ""
}

// message is what the commit says. The subject is what it always was; the trailers are what the
// ledger says about the paths in this commit, newest act per path, and only where the project has
// asked for them. With the setting off — or with a ledger that watched none of it — the message is
// byte-identical to what it was before any of this existed.
func (l *Loop) message(paths []doc.Path, settings git.Settings) string {
	subject := CommitMessage(paths)
	if !settings.Trailers || l.deps.Acts == nil {
		return subject
	}
	said := ledger.TrailersFor(l.deps.Acts(paths))
	if len(said) == 0 {
		return subject
	}
	return subject + "\n\n" + strings.Join(said, "\n")
}

func (l *Loop) latch(conflicted []doc.Path, message string) Status {
	return l.settle(Status{State: Conflict, Conflicted: conflicted,
		Message: orElse(strings.TrimSpace(message), "conflict")})
}

func (l *Loop) settle(status Status) Status {
	l.mutex.Lock()
	if status.LastSyncedAt == nil {
		status.LastSyncedAt = l.status.LastSyncedAt
	}
	l.set(status)
	answer := l.copy()
	l.mutex.Unlock()
	l.flush()
	return answer
}

// set is silent when nothing moved: the loop wakes every second, and a status that has not
// changed is not news anyone downstream needs another copy of.
//
// Held under the lock, so the listener is not called here — it is queued and told by [flush]
// once the lock is gone. In order, and never from a goroutine: a listener that saw `idle` before
// the `syncing` that preceded it would draw the wrong thing, and one that asked the loop
// something back from inside the lock would deadlock.
func (l *Loop) set(next Status) {
	if next.Conflicted == nil {
		next.Conflicted = []doc.Path{}
	}
	if same(l.status, next) {
		return
	}
	l.status = next
	l.pending = append(l.pending, l.copy())
}

// flush tells the listener everything that moved since it was last told, in the order it moved.
func (l *Loop) flush() {
	l.mutex.Lock()
	told := l.pending
	l.pending = nil
	l.mutex.Unlock()
	if l.deps.OnStatus == nil {
		return
	}
	for _, status := range told {
		l.deps.OnStatus(status)
	}
}

func orElse(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
