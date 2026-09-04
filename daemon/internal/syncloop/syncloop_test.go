package syncloop

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

type world struct {
	checkout string
	settings git.Settings
	author   *git.Author
	clock    time.Time
	told     []Status
}

func (w *world) deps() Deps {
	return Deps{
		Git:      func() *git.Git { return git.New(w.checkout, "", "") },
		Settings: func() git.Settings { return w.settings },
		Author:   func() *git.Author { return w.author },
		OnStatus: func(status Status) { w.told = append(w.told, status) },
		Now:      func() time.Time { return w.clock },
	}
}

func repository(t *testing.T, remote bool) *world {
	t.Helper()
	dir := t.TempDir()
	held := git.New(dir, "", "")
	for _, args := range [][]string{
		{"init", "-q", "-b", "main", "."},
		{"config", "user.name", "M"},
		{"config", "user.email", "m@x"},
	} {
		if out, err := held.Run(args...); err != nil || out.Code != 0 {
			t.Fatalf("git %v: %v %s", args, err, out.Stderr)
		}
	}
	write(t, dir, "a.md", "one\n")
	if err := held.StageAll(); err != nil {
		t.Fatal(err)
	}
	if result := held.Commit("first", git.Author{Name: "M", Email: "m@x"}); !result.OK {
		t.Fatal(result.Message)
	}
	if remote {
		bare := t.TempDir()
		if out, err := git.New(bare, "", "").Run("init", "-q", "--bare", "."); err != nil || out.Code != 0 {
			t.Fatal(err)
		}
		if out, err := held.Run("remote", "add", "origin", bare); err != nil || out.Code != 0 {
			t.Fatal(err)
		}
	}
	settings := git.DefaultSettings()
	settings.Enabled = true
	settings.IdleMs = 1000
	return &world{
		checkout: dir,
		settings: settings,
		author:   &git.Author{Name: "M", Email: "m@x"},
		clock:    time.Unix(1000000, 0),
	}
}

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func subjects(t *testing.T, dir string) []string {
	t.Helper()
	out, err := git.New(dir, "", "").Run("log", "--format=%s")
	if err != nil || out.Code != 0 {
		t.Fatalf("log: %v %s", err, out.Stderr)
	}
	found := []string{}
	for _, line := range strings.Split(strings.TrimSpace(out.Stdout), "\n") {
		if line != "" {
			found = append(found, line)
		}
	}
	return found
}

// Why this project does not sync is checked before the switch is: having no repository is the
// reason the switch cannot be turned on, so it is the more useful of the two things to be told.
func TestSaysWhyItDoesNotSync(t *testing.T) {
	for _, one := range []struct {
		name    string
		set     func(*world)
		message string
	}{
		{"no repository", func(w *world) { w.checkout = t.TempDir() }, "this project has no git repo"},
		{"switched off", func(w *world) { w.settings.Enabled = false }, "sync is off for this project"},
		{"nothing turned on", func(w *world) {
			w.settings.AutoCommit, w.settings.Pull, w.settings.Push = false, false, false
		}, "sync has nothing turned on"},
	} {
		t.Run(one.name, func(t *testing.T) {
			w := repository(t, false)
			one.set(w)
			got := New(w.deps()).Refresh()
			if got.State != Off || got.Message != one.message {
				t.Errorf("answered %+v", got)
			}
		})
	}
}

// Coming back from off is a fresh start: the reason it was off no longer holds, and leaving it
// on screen would explain a state the project is not in any more.
func TestForgetsTheReasonOnceItNoLongerHolds(t *testing.T) {
	w := repository(t, false)
	w.settings.Enabled = false
	loop := New(w.deps())
	if got := loop.Refresh(); got.State != Off {
		t.Fatalf("started as %+v", got)
	}
	w.settings.Enabled = true
	got := loop.Refresh()
	if got.State != Idle || got.Message != "" {
		t.Errorf("came back as %+v", got)
	}
}

func TestCommitsWhatChangedOncePastTheQuietPeriod(t *testing.T) {
	w := repository(t, false)
	loop := New(w.deps())
	write(t, w.checkout, "notes/new.md", "two\n")

	// Nothing has been noted, so nothing syncs however long it has been.
	if got := loop.Tick(); got.State == Syncing {
		t.Error("synced without an edit to sync")
	}
	loop.NoteEdit()
	// Still inside the quiet period.
	w.clock = w.clock.Add(500 * time.Millisecond)
	if got := loop.Tick(); got.State != Off && got.State != Idle {
		t.Errorf("synced early: %+v", got)
	}
	w.clock = w.clock.Add(600 * time.Millisecond)
	got := loop.Tick()
	if got.State != Idle {
		t.Fatalf("answered %+v", got)
	}
	if subjects(t, w.checkout)[0] != "docs: update notes/new" {
		t.Errorf("committed %v", subjects(t, w.checkout))
	}
	if got.LastSyncedAt == nil {
		t.Error("a settled pass did not move the clock")
	}
}

// Held work is not synced work, so the clock only moves when nothing was left behind.
func TestLeavesChangesAloneWhenAutoCommitIsOff(t *testing.T) {
	w := repository(t, false)
	w.settings.AutoCommit = false
	loop := New(w.deps())
	write(t, w.checkout, "held.md", "x\n")

	got := loop.SyncNow()
	if got.State != Idle {
		t.Fatalf("answered %+v", got)
	}
	if got.Message != "auto-commit is off — your changes are waiting to be committed" {
		t.Errorf("said %q", got.Message)
	}
	if got.LastSyncedAt != nil {
		t.Error("the clock moved with work left behind")
	}
	if len(subjects(t, w.checkout)) != 1 {
		t.Errorf("committed anyway: %v", subjects(t, w.checkout))
	}
}

func TestSaysSoWhenThereIsNoRemoteAndWhenPushIsOff(t *testing.T) {
	w := repository(t, false)
	loop := New(w.deps())
	write(t, w.checkout, "a.md", "changed\n")
	if got := loop.SyncNow(); got.Message != "no remote — commits stay in this project" {
		t.Errorf("with no remote it said %q", got.Message)
	}

	w = repository(t, true)
	w.settings.Push = false
	loop = New(w.deps())
	write(t, w.checkout, "a.md", "changed\n")
	if got := loop.SyncNow(); got.Message != "push is off — commits stay in this project" {
		t.Errorf("with push off it said %q", got.Message)
	}
}

// A conflict latches: nothing syncs again until it is explicitly cleared.
func TestAConflictLatchesUntilItIsCleared(t *testing.T) {
	w := repository(t, false)
	loop := New(w.deps())
	// Stand a conflicted index up by hand: two branches that both changed the same line.
	held := git.New(w.checkout, "", "")
	run := func(args ...string) {
		t.Helper()
		if out, err := held.Run(args...); err != nil || out.Code != 0 {
			t.Fatalf("git %v: %v %s", args, err, out.Stderr)
		}
	}
	run("branch", "other")
	write(t, w.checkout, "a.md", "mine\n")
	if err := held.StageAll(); err != nil {
		t.Fatal(err)
	}
	held.Commit("mine", *w.author)
	if out, _ := held.Run("merge", "other"); out.Code != 0 {
		t.Log("merge already clean, standing the latch up directly")
	}

	// Whatever git did above, the latch itself is what is under test.
	loop.mutex.Lock()
	loop.set(Status{State: Conflict, Conflicted: []doc.Path{"a.md"}, Message: "unresolved conflict"})
	loop.mutex.Unlock()

	write(t, w.checkout, "b.md", "x\n")
	loop.NoteEdit()
	w.clock = w.clock.Add(2 * time.Second)
	if got := loop.Tick(); got.State != Conflict {
		t.Errorf("a latched conflict synced anyway: %+v", got)
	}
	if got := loop.SyncNow(); got.State != Conflict {
		t.Errorf("sync now got past the latch: %+v", got)
	}
	cleared := loop.ClearConflict()
	if cleared.State != Idle || len(cleared.Conflicted) != 0 {
		t.Errorf("cleared to %+v", cleared)
	}
}

// The loop wakes every second, and a status that has not changed is not news anyone downstream
// needs another copy of.
func TestSaysNothingWhenNothingMoved(t *testing.T) {
	w := repository(t, false)
	w.settings.Enabled = false
	loop := New(w.deps())
	loop.Refresh()
	before := len(w.told)
	for range 5 {
		loop.Refresh()
	}
	if len(w.told) != before {
		t.Errorf("told a listener %d times about a status that did not move", len(w.told)-before)
	}
}

// The listener hears every move in the order it happened, which is what a status line redraws
// from — `syncing` before `idle`, never the other way round.
func TestTellsAListenerInTheOrderThingsMoved(t *testing.T) {
	w := repository(t, false)
	loop := New(w.deps())
	write(t, w.checkout, "a.md", "changed\n")
	loop.SyncNow()

	var states []State
	for _, one := range w.told {
		states = append(states, one.State)
	}
	if len(states) < 2 || states[0] != Syncing || states[len(states)-1] != Idle {
		t.Errorf("told %v", states)
	}
}
