// Package activity is what is going on in each checkout: whether something there is at work,
// wants somebody, or is sitting at a prompt.
//
// Claude Code says so itself. Every interactive session writes a probe file under its config
// folder — `sessions/<pid>.json`, with a `cwd` and a `status` it keeps current — and this watches
// that folder. That is the mechanism the tooling around Claude has settled on, and it needs
// nothing installed in the session: no hook, no flag, no wrapper. It also tells the one thing no
// process list can — Claude waiting to be told what next and Claude thinking are the same process,
// and the probe is where the difference is written down.
//
// Everything else is read off the ptys. A shell whose foreground is the shell is at a prompt; one
// running anything else is busy — a build, a test run, muse, which reports nothing about itself.
// Claude is the exception: where a pty is running one, this says nothing about that pty and lets
// the probe answer, because "claude is in the foreground" cannot tell working from waiting and
// would leave a session that has been sitting there all afternoon looking exactly like one
// mid-thought.
//
// The answer is keyed by checkout path, the one name a branch, a shell and a session share. Busy
// beats waiting beats idle, and a checkout nothing can be said about is left out — saying nothing
// is what the client draws as "there is a shell here, at rest".
package activity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
)

// State is what a checkout is doing.
type State string

const (
	Idle    State = "idle"
	Waiting State = "waiting"
	Busy    State = "busy"
)

// rank is what wins when two things say different words about one checkout: busy beats waiting
// beats idle.
var rank = map[State]int{Idle: 0, Waiting: 1, Busy: 2}

// claudeStatus is how Claude's own words map onto the three states the app draws. `shell` is
// Claude running a command on your behalf, which is Claude at work; `waiting` is Claude wanting
// you, which is a stopping point and reads like a prompt.
var claudeStatus = map[string]State{
	"busy": Busy, "shell": Busy, "waiting": Waiting, "idle": Idle,
}

// beat is how often the folder is read whatever the watch has said. A watch that missed a probe
// would otherwise hold a stale answer until the next thing happened, and it is a handful of small
// files.
const beat = 1500 * time.Millisecond

// probes are `<pid>.json`; the keys and sockets beside them are not.
var isProbe = regexp.MustCompile(`^\d+\.json$`)

type probe struct {
	pid   int
	cwd   string
	state State
}

// Watch is the folder, watched.
type Watch struct {
	onMoved func(map[string]State)

	foreground func() []Standing

	mutex  sync.Mutex
	folder string
	held   map[string]probe
	last   string

	watcher *fsnotify.Watcher
	done    chan struct{}
	closed  sync.Once
}

// Standing is one shell as the ptys report it: where it is, and what is in front of it.
type Standing struct {
	PID     int
	Cwd     string
	Process string
}

// prompts: what a foreground called one of these is — a shell at its prompt. A login shell wears a
// leading dash, which is the same shell and not a command.
var prompts = map[string]bool{
	"zsh": true, "bash": true, "fish": true, "sh": true, "dash": true, "login": true,
	"-zsh": true, "-bash": true, "-fish": true, "-sh": true,
}

// speakers are the agents that publish their own state. A pty running one of these is not the
// pty's to call, whatever it looks like from outside.
var speakers = map[string]bool{"claude": true, "node": true}

// Options is what a test needs to move.
type Options struct {
	// ConfigDir is whose sessions to read. Empty is Claude's own.
	ConfigDir string
	// Foreground is every shell this daemon has open, asked each beat. Nil is a daemon with no
	// terminals, which says nothing about a checkout that holds only a shell.
	Foreground func() []Standing
}

// Open starts watching. A folder that is not there is not an error — Claude has not run on this
// machine yet, and it may before the daemon stops.
func Open(onMoved func(map[string]State), options Options) *Watch {
	dir := options.ConfigDir
	if dir == "" {
		dir = filepath.Join(os.Getenv("HOME"), ".claude")
	}
	held := &Watch{
		onMoved:    onMoved,
		folder:     filepath.Join(dir, "sessions"),
		held:       map[string]probe{},
		foreground: options.Foreground,
		done:       make(chan struct{}),
	}
	held.scan()
	held.publish()

	if watcher, err := fsnotify.NewWatcher(); err == nil {
		held.watcher = watcher
		// A folder that is not there yet is watched for by the beat instead.
		watcher.Add(held.folder)
		go held.follow()
	} else {
		go held.follow()
	}
	return held
}

func (w *Watch) follow() {
	ticker := time.NewTicker(beat)
	defer ticker.Stop()
	var events chan fsnotify.Event
	if w.watcher != nil {
		events = w.watcher.Events
	}
	for {
		select {
		case <-w.done:
			return
		case _, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			w.scan()
			w.publish()
		case <-ticker.C:
			// The folder may have arrived since the watch was set up.
			if w.watcher != nil {
				w.watcher.Add(w.folder)
			}
			w.scan()
			w.publish()
		}
	}
}

func (w *Watch) Close() {
	w.closed.Do(func() {
		close(w.done)
		if w.watcher != nil {
			w.watcher.Close()
		}
	})
}

// scan is every probe in the folder, read fresh; the ones whose files have gone, dropped.
func (w *Watch) scan() {
	entries, err := os.ReadDir(w.folder)
	if err != nil {
		w.mutex.Lock()
		w.held = map[string]probe{}
		w.mutex.Unlock()
		return
	}
	found := map[string]probe{}
	for _, entry := range entries {
		if entry.IsDir() || !isProbe.MatchString(entry.Name()) {
			continue
		}
		if one, ok := read(filepath.Join(w.folder, entry.Name())); ok {
			found[entry.Name()] = one
		}
	}
	w.mutex.Lock()
	w.held = found
	w.mutex.Unlock()
}

// read is one probe. A probe half-written, or in a shape this does not know, is not news either
// way — the event for the finished file is on its way.
func read(file string) (probe, bool) {
	body, err := os.ReadFile(file)
	if err != nil {
		return probe{}, false
	}
	var raw struct {
		PID    *float64 `json:"pid"`
		Cwd    string   `json:"cwd"`
		Status string   `json:"status"`
	}
	if json.Unmarshal(body, &raw) != nil || raw.PID == nil || raw.Cwd == "" {
		return probe{}, false
	}
	state, known := claudeStatus[raw.Status]
	if !known {
		return probe{}, false
	}
	return probe{pid: int(*raw.PID), cwd: raw.Cwd, state: state}, true
}

// States is what each checkout is doing, as it last read. A checkout nothing can be said about is
// left out — saying nothing is what a client draws as "there is a shell here, at rest".
func (w *Watch) States() map[string]State {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	return w.fold()
}

func (w *Watch) fold() map[string]State {
	states := map[string]State{}
	// The ptys first, so a probe's word about a checkout wins over the shell's: busy beats
	// waiting beats idle, and only Claude can tell those two apart about itself.
	for _, one := range w.shells() {
		if known, said := states[one.cwd]; !said || rank[one.state] > rank[known] {
			states[one.cwd] = one.state
		}
	}
	for _, one := range w.held {
		// A session killed outright leaves its probe behind, saying whatever it was doing at the
		// time. Left alone that is a checkout stuck at "working" for the rest of the day.
		if !running(one.pid) {
			continue
		}
		if known, said := states[one.cwd]; !said || rank[one.state] > rank[known] {
			states[one.cwd] = one.state
		}
	}
	return states
}

// shells is what the ptys say, as probes: a shell at its prompt is idle, one running anything else
// is busy, and one running an agent that speaks for itself is left for the probe to answer.
func (w *Watch) shells() []probe {
	if w.foreground == nil {
		return nil
	}
	said := []probe{}
	for _, one := range w.foreground() {
		if one.Cwd == "" || speakers[one.Process] {
			continue
		}
		state := Busy
		if prompts[one.Process] {
			state = Idle
		}
		said = append(said, probe{pid: one.PID, cwd: one.Cwd, state: state})
	}
	return said
}

// publish says so only when the picture has moved: this is asked every beat, and a client told the
// same thing every beat would re-render on nothing.
func (w *Watch) publish() {
	w.mutex.Lock()
	states := w.fold()
	body, _ := json.Marshal(states)
	moved := string(body) != w.last
	w.last = string(body)
	w.mutex.Unlock()
	if moved && w.onMoved != nil {
		w.onMoved(states)
	}
}

// running asks the kernel whether the process is there without touching it.
func running(pid int) bool {
	if pid <= 0 {
		return false
	}
	held, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return held.Signal(syscall.Signal(0)) == nil
}
