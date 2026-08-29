// The beat: the clock that fires a schedule, the watch that notices a file, and the queue between
// a firing and the run that carries it.

package tasks_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/tasks"

	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/diagrams"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/taskrun"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tree"
)

// held is a store standing over one checkout, with a clock the test moves by hand and a record of
// what the schedule asked to run.
type held struct {
	store   *Store
	dir     string
	now     time.Time
	fired   []doc.Ref
	scratch string
	// reaches is what a step or a watch finds connected. Empty unless a test says otherwise,
	// which is a machine nobody has signed in on.
	reaches Reaches
}

func standing(t *testing.T, files map[string]string) *held {
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
	runs, err := taskrun.Open(filepath.Join(t.TempDir(), "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { runs.Close() })

	one := &held{dir: dir, now: time.Date(2026, 8, 28, 9, 0, 0, 0, time.Local)}
	one.scratch = t.TempDir()
	// A clock of its own rather than the laptop's crontab, so a test can watch a schedule come
	// due without a machine in it — and without editing the crontab of whoever is running them.
	clock := NewTimerScheduler(
		func(ref doc.Ref) { one.fired = append(one.fired, ref) },
		func() time.Time { return one.now },
	)
	one.store = NewStore(Deps{
		Sites: func() []diagrams.Site {
			return []diagrams.Site{{Root: doc.Project, Tree: tree.New(dir)}}
		},
		Runs:      runs,
		Scheduler: clock,
		Reach:     func(string) Reaches { return one.reaches },
		Triggers:  NewTriggerStore(filepath.Join(t.TempDir(), "triggers.json")),
		Scratch:   func() string { return one.scratch },
		Now:       func() time.Time { return one.now },
	})
	t.Cleanup(one.store.Stop)
	return one
}

func (h *held) at(moment time.Time) { h.now = moment }

func (h *held) after(d time.Duration) { h.now = h.now.Add(d) }

const nightly = `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.interval", "name": "Every 30 minutes", "x": 80, "y": 120, "minutes": 30},
  {"id": "step", "kind": "agent.shell", "name": "Say", "x": 240, "y": 120, "command": "echo ran"}
], "edges": [{"from": "t", "to": "step"}]}`

func watching(path string) string {
	return `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.file", "name": "When it changes", "x": 80, "y": 120, "path": "` + path + `"},
  {"id": "step", "kind": "agent.shell", "name": "Say", "x": 240, "y": 120, "command": "cat"}
], "edges": [{"from": "t", "to": "step"}]}`
}

// An interval is armed at first sight and fires a full interval later, so a beat is not a firing:
// a daemon restarted every ten minutes would otherwise run an hourly task every ten.
func TestAnIntervalIsArmedBeforeItFires(t *testing.T) {
	one := standing(t, map[string]string{"a.task": nightly})

	one.store.Tick()
	if len(one.fired) != 0 {
		t.Fatalf("fired on the beat that armed it: %v", one.fired)
	}
	one.after(20 * time.Minute)
	one.store.Tick()
	if len(one.fired) != 0 {
		t.Fatalf("fired before its interval was up: %v", one.fired)
	}
	one.after(11 * time.Minute)
	one.store.Tick()
	if len(one.fired) != 1 {
		t.Fatalf("fired %d times, want 1", len(one.fired))
	}
	if one.fired[0].Path != "a.task" {
		t.Errorf("fired %s", one.fired[0].Path)
	}
	// And it starts its interval again rather than firing on every beat from here.
	one.after(time.Minute)
	one.store.Tick()
	if len(one.fired) != 1 {
		t.Errorf("fired again a minute later: %d", len(one.fired))
	}
}

// A trigger wired to nothing fires nothing: a task whose triggers lead nowhere runs when somebody
// presses play and never otherwise.
func TestATriggerWiredToNothingKeepsNoTime(t *testing.T) {
	loose := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.interval", "name": "Every 30 minutes", "x": 80, "y": 120, "minutes": 30}
], "edges": []}`
	one := standing(t, map[string]string{"a.task": loose})

	one.store.Tick()
	one.after(time.Hour)
	one.store.Tick()
	if len(one.fired) != 0 {
		t.Fatalf("fired for a trigger that leads nowhere: %v", one.fired)
	}
}

// A time trigger fires on the beat that crosses its HH:MM, and only on that one.
func TestATimeTriggerFiresOnTheBeatThatCrossesIt(t *testing.T) {
	daily := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.time", "name": "At 09:30", "x": 80, "y": 120, "at": "09:30"},
  {"id": "step", "kind": "agent.shell", "name": "Say", "x": 240, "y": 120, "command": "echo ran"}
], "edges": [{"from": "t", "to": "step"}]}`
	one := standing(t, map[string]string{"a.task": daily})

	one.at(time.Date(2026, 8, 28, 9, 29, 0, 0, time.Local))
	one.store.Tick() // The first beat crosses nothing: there is no beat before it.
	one.at(time.Date(2026, 8, 28, 9, 29, 30, 0, time.Local))
	one.store.Tick()
	if len(one.fired) != 0 {
		t.Fatalf("fired before its time: %v", one.fired)
	}
	one.at(time.Date(2026, 8, 28, 9, 30, 10, 0, time.Local))
	one.store.Tick()
	if len(one.fired) != 1 {
		t.Fatalf("fired %d times, want 1", len(one.fired))
	}
	one.at(time.Date(2026, 8, 28, 9, 30, 40, 0, time.Local))
	one.store.Tick()
	if len(one.fired) != 1 {
		t.Errorf("fired twice inside the same minute: %d", len(one.fired))
	}
}

// A day it does not keep to is a day it does not fire on, and the same time on a day it does.
func TestATimeTriggerKeepsToItsDays(t *testing.T) {
	weekly := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.time", "name": "Mondays", "x": 80, "y": 120, "at": "09:30", "days": ["mon"]},
  {"id": "step", "kind": "agent.shell", "name": "Say", "x": 240, "y": 120, "command": "echo ran"}
], "edges": [{"from": "t", "to": "step"}]}`
	one := standing(t, map[string]string{"a.task": weekly})

	// A Friday.
	one.at(time.Date(2026, 8, 28, 9, 29, 0, 0, time.Local))
	one.store.Tick()
	one.at(time.Date(2026, 8, 28, 9, 31, 0, 0, time.Local))
	one.store.Tick()
	if len(one.fired) != 0 {
		t.Fatalf("fired on a Friday: %v", one.fired)
	}
	// The Monday after.
	one.at(time.Date(2026, 8, 31, 9, 29, 0, 0, time.Local))
	one.store.Tick()
	one.at(time.Date(2026, 8, 31, 9, 31, 0, 0, time.Local))
	one.store.Tick()
	if len(one.fired) != 1 {
		t.Errorf("fired %d times on the Monday, want 1", len(one.fired))
	}
}

// A trigger switched off keeps no time, and when it comes back on it starts its interval over
// rather than firing for the wait.
func TestASwitchedOffTriggerStartsOverWhenItComesBack(t *testing.T) {
	off := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.interval", "name": "Every 30 minutes", "x": 80, "y": 120, "minutes": 30, "off": true},
  {"id": "step", "kind": "agent.shell", "name": "Say", "x": 240, "y": 120, "command": "echo ran"}
], "edges": [{"from": "t", "to": "step"}]}`
	one := standing(t, map[string]string{"a.task": off})

	one.store.Tick()
	one.after(time.Hour)
	one.store.Tick()
	if len(one.fired) != 0 {
		t.Fatalf("fired while switched off: %v", one.fired)
	}
	if err := os.WriteFile(filepath.Join(one.dir, "a.task"), []byte(nightly), 0o644); err != nil {
		t.Fatal(err)
	}
	one.store.Tick()
	if len(one.fired) != 0 {
		t.Fatalf("fired for the hour it was off: %v", one.fired)
	}
	one.after(31 * time.Minute)
	one.store.Tick()
	if len(one.fired) != 1 {
		t.Errorf("fired %d times after coming back, want 1", len(one.fired))
	}
}

// The first look at a file is the baseline: it records where the file stands and fires nothing,
// or every task watching a file would run once the moment the daemon started.
func TestTheFirstLookAtAFileFiresNothing(t *testing.T) {
	one := standing(t, map[string]string{"a.task": watching("in.md"), "in.md": "hello"})

	one.store.Tick()
	if runs := one.store.RunsFor(doc.Ref{Root: doc.Project, Path: "a.task"}); len(runs) != 0 {
		t.Fatalf("ran on the baseline look: %d runs", len(runs))
	}
}

// A file that moved is a run, and what it now says is what the run opens on.
func TestAFileThatChangedBecomesARun(t *testing.T) {
	one := standing(t, map[string]string{"a.task": watching("in.md"), "in.md": "hello"})
	one.store.Tick()

	touch(t, filepath.Join(one.dir, "in.md"), "goodbye")
	one.store.Tick()

	run := settled(t, one, "a.task", 1)[0]
	if run.State != taskrun.RunDone {
		t.Fatalf("run %s: %s", run.State, run.Error)
	}
	// The opening names the file that moved and carries what it now says, so the step gets both.
	got := output(run, "step")
	if !strings.HasSuffix(got, "\n\ngoodbye") || !strings.Contains(got, "in.md") {
		t.Errorf("the step read %q", got)
	}
}

// A file that appears counts as a change the way editing one does: a missing file stands at zero,
// so a task waiting for a report to be written runs when it is.
func TestAFileThatAppearsCountsAsAChange(t *testing.T) {
	one := standing(t, map[string]string{"a.task": watching("in.md")})
	one.store.Tick()

	touch(t, filepath.Join(one.dir, "in.md"), "here now")
	one.store.Tick()

	if run := settled(t, one, "a.task", 1)[0]; run.State != taskrun.RunDone {
		t.Fatalf("run %s: %s", run.State, run.Error)
	}
}

// Two firings are two runs, one after another: they share a checkout, so a batch is a queue rather
// than a crowd — and nothing seen is ever dropped, since the cursor has already moved past it.
func TestFiringsBecomeOneRunAtATime(t *testing.T) {
	one := standing(t, map[string]string{"a.task": watching("in.md"), "in.md": "first"})
	one.store.Tick()

	touch(t, filepath.Join(one.dir, "in.md"), "second")
	one.store.Tick()
	settled(t, one, "a.task", 1)
	touch(t, filepath.Join(one.dir, "in.md"), "third")
	one.store.Tick()

	runs := settled(t, one, "a.task", 2)
	if len(runs) != 2 {
		t.Fatalf("%d runs, want 2", len(runs))
	}
	if got := output(runs[0], "step"); !strings.HasSuffix(got, "\n\nthird") {
		t.Errorf("the newest run read %q", got)
	}
	if got := output(runs[1], "step"); !strings.HasSuffix(got, "\n\nsecond") {
		t.Errorf("the older run read %q", got)
	}
}

// A GitHub watch on a machine nobody has signed in on says so on the trigger rather than resting
// quietly — a watch that answered with silence would look exactly like one with nothing to report.
func TestAWatchWithNothingConnectedSaysSo(t *testing.T) {
	issues := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.github.issue", "name": "When an issue changes", "x": 80, "y": 120, "repo": "a/b"},
  {"id": "step", "kind": "agent.shell", "name": "Say", "x": 240, "y": 120, "command": "cat"}
], "edges": [{"from": "t", "to": "step"}]}`
	one := standing(t, map[string]string{"a.task": issues})
	one.store.Tick()

	summaries := one.store.Summaries()
	if len(summaries) != 1 || len(summaries[0].Triggers) != 1 {
		t.Fatalf("summaries: %+v", summaries)
	}
	if !strings.Contains(summaries[0].Triggers[0].Error, "no GitHub connection") {
		t.Errorf("a watch with nothing connected said %q", summaries[0].Triggers[0].Error)
	}
}

// The cursors are on disk so a restarted daemon picks up where the last one stood: one that
// forgot would take a fresh baseline and miss the change made while it was down.
func TestTheCursorsOutliveTheStore(t *testing.T) {
	dir := t.TempDir()
	cursors := filepath.Join(t.TempDir(), "triggers.json")
	touch(t, filepath.Join(dir, "a.task"), watching("in.md"))
	touch(t, filepath.Join(dir, "in.md"), "hello")

	first := NewTriggerStore(cursors)
	first.Set("project:a.task#t", TriggerState{"mtime": float64(1)})

	second := NewTriggerStore(cursors)
	if got := second.Get("project:a.task#t"); got == nil || got["mtime"] != float64(1) {
		t.Fatalf("a new store read %v", got)
	}
	second.Prune(map[string]bool{})
	if got := NewTriggerStore(cursors).Get("project:a.task#t"); got != nil {
		t.Errorf("a pruned cursor came back: %v", got)
	}
}

// moved counts the writes a test has made, so each one lands on an mtime of its own.
var moved atomic.Int64

func touch(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	// The watch compares mtimes, and two writes inside one filesystem tick carry the same one —
	// which on a fast machine is every write a test makes.
	at := time.Now().Add(time.Duration(moved.Add(1)) * time.Second)
	if err := os.Chtimes(path, at, at); err != nil {
		t.Fatal(err)
	}
}

// settled waits until a task has had `want` runs and the newest has finished, and hands back every
// one of them, newest first. A walk is a goroutine, so a test that looked straight after the beat
// would be reading a run that has not run yet.
func settled(t *testing.T, one *held, path doc.Path, want int) []taskrun.Run {
	t.Helper()
	ref := doc.Ref{Root: doc.Project, Path: path}
	for range 300 {
		runs := one.store.RunsFor(ref)
		if len(runs) >= want && runs[0].FinishedAt != nil {
			return runs
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s never had %d finished runs", path, want)
	return nil
}

func output(run taskrun.Run, node string) string {
	for _, step := range run.Steps {
		if step.Node == node && step.Output != nil {
			return *step.Output
		}
	}
	return ""
}

// The beat comes round on its own, and stops when it is told to. Everything else here calls Tick
// by hand; this is the one thing that proves anything calls it otherwise.
func TestTheBeatComesRoundOnItsOwn(t *testing.T) {
	one := standing(t, map[string]string{"a.task": watching("in.md"), "in.md": "hello"})
	one.store.Tick() // The baseline, so the beat has something to notice a change against.
	one.store.StartEvery(5 * time.Millisecond)

	touch(t, filepath.Join(one.dir, "in.md"), "moved")
	if run := settled(t, one, "a.task", 1)[0]; run.State != taskrun.RunDone {
		t.Fatalf("run %s: %s", run.State, run.Error)
	}

	one.store.Stop()
	before := len(one.store.RunsFor(doc.Ref{Root: doc.Project, Path: "a.task"}))
	touch(t, filepath.Join(one.dir, "in.md"), "moved again")
	time.Sleep(100 * time.Millisecond)
	after := len(one.store.RunsFor(doc.Ref{Root: doc.Project, Path: "a.task"}))
	if after != before {
		t.Errorf("a stopped beat ran something: %d runs, was %d", after, before)
	}
}
