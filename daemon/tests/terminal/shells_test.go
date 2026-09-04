// The shells: that one outlives the socket watching it, that coming back gets you what you missed,
// and that the only things which end one are exiting, being finished with, and being left.

package terminal_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/terminal"

	"strings"
	"sync"
	"testing"
	"time"
)

// pane is a watcher that only remembers, so a test can read what a socket would have been sent.
type pane struct {
	mutex  sync.Mutex
	output strings.Builder
	exited *int
	closed bool
}

func (p *pane) Output(data string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.output.WriteString(data)
}

func (p *pane) Exit(code int) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.exited = &code
}

func (p *pane) Close() {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.closed = true
}

func (p *pane) said() string {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	return p.output.String()
}

func (p *pane) ended() (int, bool) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	if p.exited == nil {
		return 0, false
	}
	return *p.exited, true
}

func (p *pane) gone() bool {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	return p.closed
}

// standing is a set of shells opening in a directory of their own, under a shell that starts fast
// and reads nothing of the machine's.
func standing(t *testing.T) (*Shells, string) {
	t.Helper()
	t.Setenv("SHELL", "/bin/sh")
	dir := t.TempDir()
	shells := NewShells(func(string) Session {
		return Session{Cwd: dir, Env: map[string]string{"BROODMOTHER_BRIEF": "the brief"}}
	})
	t.Cleanup(shells.Close)
	return shells, dir
}

// until waits for something a shell says, since a pty answers when it answers.
func until(t *testing.T, watching *pane, want string) string {
	t.Helper()
	for range 400 {
		if said := watching.said(); strings.Contains(said, want) {
			return said
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("the shell never said %q; it said %q", want, watching.said())
	return ""
}

// What is typed reaches the shell, and what the shell says reaches whoever is watching.
func TestAShellAnswersWhatIsTypedIntoIt(t *testing.T) {
	shells, _ := standing(t)
	watching := &pane{}
	id, resumed, missed := shells.Attach(watching, Request{Cols: 100, Rows: 30})
	if id == "" {
		t.Fatal("no shell")
	}
	if resumed || missed != "" {
		t.Errorf("a first attach resumed %v with %q", resumed, missed)
	}

	shells.Write(id, "echo marco-polo\n")
	until(t, watching, "marco-polo")
}

// The shell opens where it was told to and holds what it was handed: the brief is the one thing in
// its environment that is the app's rather than the user's.
func TestAShellStandsInTheCheckoutWithTheBrief(t *testing.T) {
	shells, dir := standing(t)
	watching := &pane{}
	id, _, _ := shells.Attach(watching, Request{})

	shells.Write(id, "pwd\n")
	until(t, watching, dir)
	shells.Write(id, "echo \"[$BROODMOTHER_BRIEF]\"\n")
	until(t, watching, "[the brief]")
}

// A socket closing is not somebody saying they were done: the shell goes on running, and the next
// socket to ask for it by name gets it back with what it missed.
func TestASocketGoingAwayLeavesTheShellRunning(t *testing.T) {
	shells, _ := standing(t)
	first := &pane{}
	id, _, _ := shells.Attach(first, Request{Session: "a-tab"})
	shells.Write(id, "echo before-the-lid\n")
	until(t, first, "before-the-lid")

	shells.Detach(id, first)
	if shells.Count() != 1 {
		t.Fatalf("%d shells after a detach, want 1", shells.Count())
	}
	if shells.Detached() != 1 {
		t.Errorf("%d detached, want 1", shells.Detached())
	}
	// It goes on working while nobody is looking, which is the whole point.
	shells.Write(id, "echo while-nobody-looked\n")
	time.Sleep(150 * time.Millisecond)

	second := &pane{}
	again, resumed, missed := shells.Attach(second, Request{Session: "a-tab"})
	if again != id || !resumed {
		t.Fatalf("came back to %s (resumed %v), want %s", again, resumed, id)
	}
	if !strings.Contains(missed, "before-the-lid") || !strings.Contains(missed, "while-nobody-looked") {
		t.Errorf("what it missed was %q", missed)
	}
}

// Two panes cannot watch one shell: the second would type into the first's line. The one that was
// there is let go.
func TestASecondPaneTakesTheShellFromTheFirst(t *testing.T) {
	shells, _ := standing(t)
	first := &pane{}
	id, _, _ := shells.Attach(first, Request{Session: "a-tab"})

	second := &pane{}
	shells.Attach(second, Request{Session: "a-tab"})
	if !first.gone() {
		t.Error("the first pane was left watching")
	}

	shells.Write(id, "echo to-the-second\n")
	until(t, second, "to-the-second")
}

// A session that has been reaped, or that exited while nobody was looking, is answered with a new
// shell rather than an error: the tab is still on screen and still needs something to type into.
func TestAskingForAShellThatIsGoneOpensANewOne(t *testing.T) {
	shells, _ := standing(t)
	watching := &pane{}
	_, resumed, _ := shells.Attach(watching, Request{Session: "a-tab-from-last-time"})
	if resumed {
		t.Error("resumed a shell that never existed")
	}
}

// Being finished with a shell is said out loud, and everything a split opened under that name goes
// with it: a tab is closed whole.
func TestFinishingATabTakesItsPanesWithIt(t *testing.T) {
	shells, _ := standing(t)
	shells.Attach(&pane{}, Request{Session: "tab"})
	shells.Attach(&pane{}, Request{Session: "tab/left"})
	shells.Attach(&pane{}, Request{Session: "another"})

	if closed := shells.Finish("tab"); closed != 2 {
		t.Fatalf("closed %d, want 2", closed)
	}
	if shells.Count() != 1 {
		t.Errorf("%d shells left, want 1", shells.Count())
	}
	// Closing something already gone is not an error: it may have exited a moment before.
	if closed := shells.Finish("tab"); closed != 0 {
		t.Errorf("closed %d of a tab already gone", closed)
	}
}

// A shell that exits says so to whoever is watching, and takes itself off the list.
func TestAShellThatExitsSaysSo(t *testing.T) {
	shells, _ := standing(t)
	watching := &pane{}
	id, _, _ := shells.Attach(watching, Request{})

	shells.Write(id, "exit 3\n")
	for range 400 {
		if code, ended := watching.ended(); ended {
			if code != 3 {
				t.Errorf("exited %d, want 3", code)
			}
			if !watching.gone() {
				t.Error("the pane was not let go")
			}
			if shells.Count() != 0 {
				t.Errorf("%d shells left after an exit", shells.Count())
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("never exited; it said %q", watching.said())
}

// Shells nobody came back for are reaped. One being watched is not: the window is about being
// alone, not about being idle.
func TestOnlyTheShellsNobodyCameBackForAreReaped(t *testing.T) {
	shells, _ := standing(t)
	left := &pane{}
	leftID, _, _ := shells.Attach(left, Request{Session: "left"})
	watched := &pane{}
	shells.Attach(watched, Request{Session: "watched"})
	shells.Detach(leftID, left)

	shells.ReapNow(0)
	if shells.Count() != 1 {
		t.Fatalf("%d shells after the reap, want 1", shells.Count())
	}
	// Nothing is told about a reaped shell: it is reaped precisely because nobody was watching.
	if left.gone() {
		t.Error("a pane that had already gone was closed again")
	}
	if watched.gone() {
		t.Error("reaped a shell somebody was watching")
	}
	// And the one still being watched still works.
	shells.Write("watched", "echo still-here\n")
	until(t, watched, "still-here")
}

// What each shell is doing right now, for whoever is drawing the rail.
func TestForegroundSaysWhereEachShellStands(t *testing.T) {
	shells, dir := standing(t)
	watching := &pane{}
	id, _, _ := shells.Attach(watching, Request{Session: "one"})
	// Wait for a prompt, so the shell is up and the pty has a foreground to report.
	shells.Write(id, "echo up\n")
	until(t, watching, "up")

	standing := shells.Foreground()
	if len(standing) != 1 {
		t.Fatalf("%d shells standing, want 1", len(standing))
	}
	one := standing[0]
	if one.ID != "one" || one.Cwd != dir || one.PID <= 0 {
		t.Errorf("standing %+v", one)
	}
	// At a prompt the foreground is the shell itself, which is what the activity watch reads as
	// "there is a shell here, at rest".
	if !strings.Contains(one.Process, "sh") {
		t.Errorf("the foreground is %q", one.Process)
	}
}

// The environment a shell starts from is the user's own, minus the marks a Claude session stamps
// on its children: a shell here is a session of its own, whatever launched the server.
func TestTheSessionMarksDoNotReachAShell(t *testing.T) {
	t.Setenv("CLAUDECODE", "1")
	t.Setenv("CLAUDE_CODE_SESSION_ID", "abc")
	t.Setenv("CLAUDE_CONFIG_DIR", "/somewhere")

	held := map[string]string{}
	for _, one := range Ambient() {
		key, value, _ := strings.Cut(one, "=")
		held[key] = value
	}
	for _, gone := range []string{"CLAUDECODE", "CLAUDE_CODE_SESSION_ID"} {
		if _, still := held[gone]; still {
			t.Errorf("%s was handed down", gone)
		}
	}
	// Everything else is the user's own shell environment, and a login shell here is still theirs.
	if held["CLAUDE_CONFIG_DIR"] != "/somewhere" {
		t.Error("CLAUDE_CONFIG_DIR did not survive")
	}
}
