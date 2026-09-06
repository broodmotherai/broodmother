// The shells themselves: one login shell per session, standing in the checkout the root it was
// opened from names — the folder you would have cd'd to anyway.
//
// Where each opens is asked per shell rather than held, because moving the scope has to move where
// the next one opens without touching the ones already running: a pty someone is typing in is not
// somewhere to send a `cd`.
//
// A socket closing does not end a shell. The socket is how you are watching it, and the two are
// not the same thing — the machine going to sleep is not you saying you were done. A shell ends
// when it exits, when the tab it belongs to says so, or when nobody has come back for it in a day.

package terminal

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

const term = "xterm-256color"

// colorfgbg is the ground this terminal is actually drawn on, which is light. A shell started from
// a dark terminal hands its own COLORFGBG down to everything it spawns, and a TUI that reads it —
// Claude Code picking a theme among them — dresses itself for a black background it is not
// standing on. Dark ink on light, stated rather than inherited.
const colorfgbg = "0;15"

// What a terminal is until it says otherwise — xterm's own defaults, so a client that has not
// measured itself yet and the pty it is attached to agree rather than differ.
const (
	cols = 80
	rows = 24
)

// detachedFor is how long a shell nobody is attached to goes on running. A laptop that slept, a
// tab the browser froze, a window closed and reopened and a wifi hiccup all look the same from
// here — a socket that closed — and what is on the other end of them is somebody's work.
//
// Long, because the case it has to survive is a lid shut overnight: a timer does not tick while
// the machine is asleep, but the clock it is measured against moves the whole time, so a short
// window is one that wakes up having thrown away everything it was for. What it still catches is
// the shell nothing will ever ask for again — a pane orphaned by a split that a reload did not
// bring back — and a day is soon enough for that.
const detachedFor = 24 * time.Hour

const reapEvery = time.Minute

// scrollback is what a terminal that comes back is shown before it sees anything live: the tail of
// what it missed. A screenful is not enough — a build that ran while the lid was shut is the thing
// you came back to read — and the whole of it is a log file nobody asked for.
const scrollback = 256 * 1024

// inheritedSession: Claude Code stamps its session onto the environment, and a server started from
// inside one hands that stamp down to every shell it spawns — where the next claude reads it as
// its own parent, calls itself a nested child, and stops saving transcripts. A terminal here is a
// session of its own, whatever happened to launch the server. Only the session marks go:
// everything else the environment holds — CLAUDE_CONFIG_DIR among it — is the user's own shell
// environment, and a login shell here is still their shell.
var inheritedSession = []string{
	"CLAUDECODE",
	"CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_EXECPATH",
	"CLAUDE_CODE_SESSION_ID",
	"CLAUDE_EFFORT",
	"CLAUDE_PID",
}

// Ambient is this process's environment with the session marks taken out — what every shell, hand
// and errand this daemon starts begins from.
func Ambient() []string {
	held := make([]string, 0, len(os.Environ()))
	for _, one := range os.Environ() {
		name, _, _ := strings.Cut(one, "=")
		if !slices.Contains(inheritedSession, name) {
			held = append(held, one)
		}
	}
	return held
}

func shellPath() string {
	if held := os.Getenv("SHELL"); held != "" {
		return held
	}
	return "/bin/bash"
}

// Session is where a shell opens and who it opens as: the repo you are in, holding the credentials
// of the profile it works as.
type Session struct {
	Cwd string
	Env map[string]string
}

// Request is which shell a socket is asking for. The name is the client's — a tab's, which
// outlives the page it was drawn on — so asking again after a reload reaches the same shell, and
// asking after this process was restarted opens a new one under the name the tab still calls it.
type Request struct {
	Root    string
	Session string
	// Cols and Rows are the size of the terminal that will show it, where the client knows one. A
	// shell writes its first prompt before anything can be said back over the socket, and it
	// writes it to the width the pty was made at — so a pty made at a size nothing on screen has
	// is a line wrapped at one width and erased at another, which leaves zsh's start-of-line mark
	// stranded above the first prompt. Zero, and the defaults stand for both.
	Cols int
	Rows int
}

// Watcher is whoever is currently looking at a shell. The shells know nothing about sockets: what
// they have is something to write to and a way to say it has ended.
type Watcher interface {
	Output(data string)
	Exit(code int)
	Close()
}

// Shell is a running shell and whoever is currently watching it, which may be nobody.
type shell struct {
	id  string
	pty *os.File
	cmd *exec.Cmd
	// cwd is where it was opened — the checkout — which is where whatever it runs is running.
	cwd string

	mutex sync.Mutex
	// buffer is the tail of what it has said, for whoever attaches next.
	buffer  []byte
	watcher Watcher
	// detachedAt is when the last watcher went away, or zero while one is attached.
	detachedAt time.Time
}

// Standing is what one shell is doing right now, as the activity watch reads it.
type Standing struct {
	ID  string
	PID int
	Cwd string
	// Process is the foreground's own title. A program can set it to anything — Claude Code sets
	// its to its version number — so it answers "is the shell itself in front" and no more.
	// Whoever wants the command's actual name resolves the pid.
	Process string
}

// Shells is every one this daemon has open.
type Shells struct {
	session     func(root string) Session
	detachedFor time.Duration
	now         func() time.Time

	mutex  sync.Mutex
	held   map[string]*shell
	reaper chan struct{}
}

func NewShells(session func(root string) Session) *Shells {
	held := &Shells{
		session:     session,
		detachedFor: detachedFor,
		now:         time.Now,
		held:        map[string]*shell{},
		reaper:      make(chan struct{}),
	}
	go held.reaping()
	return held
}

func (s *Shells) reaping() {
	ticker := time.NewTicker(reapEvery)
	defer ticker.Stop()
	for {
		select {
		case <-s.reaper:
			return
		case <-ticker.C:
			s.ReapNow(s.detachedFor)
		}
	}
}

func (s *Shells) Count() int {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return len(s.held)
}

func (s *Shells) Detached() int {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	count := 0
	for _, one := range s.held {
		one.mutex.Lock()
		if one.watcher == nil {
			count++
		}
		one.mutex.Unlock()
	}
	return count
}

// Foreground is what each shell is doing right now: its pid, where it stands, and the name of
// whatever holds its foreground. Read off the process each time it is asked; nothing is cached,
// because the question is what is true now.
func (s *Shells) Foreground() []Standing {
	s.mutex.Lock()
	held := make([]*shell, 0, len(s.held))
	for _, one := range s.held {
		held = append(held, one)
	}
	s.mutex.Unlock()

	standing := make([]Standing, 0, len(held))
	for _, one := range held {
		standing = append(standing, Standing{
			ID: one.id, PID: one.cmd.Process.Pid, Cwd: one.cwd, Process: foregroundOf(one),
		})
	}
	slices.SortFunc(standing, func(a, b Standing) int { return strings.Compare(a.ID, b.ID) })
	return standing
}

// Attach is a watcher taking over a shell: the one it names if that shell is still running,
// otherwise a new one in the root it asked for. A session that has been reaped or that exited
// while nobody was looking is answered with a new shell rather than an error — the tab is still on
// screen and it still needs something to type into, and the answer says which it got.
//
// What comes back is the shell's id, whether it was resumed, and what it missed while nobody was
// watching.
func (s *Shells) Attach(watcher Watcher, ask Request) (id string, resumed bool, missed string) {
	s.mutex.Lock()
	found := s.held[ask.Session]
	one := found
	if one == nil {
		name := ask.Session
		if name == "" {
			name = newName()
		}
		one = s.spawn(ask.Root, name, ask.Cols, ask.Rows)
	}
	s.mutex.Unlock()

	// Two tabs cannot watch one shell: the second would type into the first's line. The one that
	// was there goes, and this watcher is the one that has it.
	one.mutex.Lock()
	previous := one.watcher
	one.watcher = watcher
	one.detachedAt = time.Time{}
	if found != nil {
		missed = string(one.buffer)
	}
	one.mutex.Unlock()
	if previous != nil && previous != watcher {
		previous.Close()
	}
	return one.id, found != nil, missed
}

// Write types into a shell.
func (s *Shells) Write(id, data string) {
	if one := s.shell(id); one != nil {
		one.pty.WriteString(data)
	}
}

// Resize moves a shell to the size of the terminal showing it. A pty rejects a zero dimension, and
// xterm reports one while the panel is hidden.
func (s *Shells) Resize(id string, cols, rows int) {
	one := s.shell(id)
	if one == nil || cols <= 0 || rows <= 0 {
		return
	}
	pty.Setsize(one.pty, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

// Detach says a watcher went away. The shell has not.
func (s *Shells) Detach(id string, watcher Watcher) {
	one := s.shell(id)
	if one == nil {
		return
	}
	one.mutex.Lock()
	defer one.mutex.Unlock()
	// A watcher that has already been replaced closes after the one that took over from it, and
	// it is not the one to say the shell is unwatched.
	if one.watcher != watcher {
		return
	}
	one.watcher = nil
	one.detachedAt = s.now()
}

// Finish is somebody saying they are done with a shell: a tab closed, which is the only thing that
// ends one early. Everything a split opened under that name goes with it, because a tab is closed
// whole and its panes are not separately closeable.
//
// Answers how many went, so that closing something already gone is not an error — the shell may
// have exited on its own a moment before.
func (s *Shells) Finish(name string) int {
	s.mutex.Lock()
	going := []string{}
	for id := range s.held {
		if id == name || strings.HasPrefix(id, name+"/") {
			going = append(going, id)
		}
	}
	s.mutex.Unlock()
	for _, id := range going {
		s.kill(id)
	}
	return len(going)
}

// ReapNow ends the shells nobody came back for. The window is a parameter so that what it does
// when one is up can be asked without waiting a day to ask it.
func (s *Shells) ReapNow(within time.Duration) {
	deadline := s.now().Add(-within)
	s.mutex.Lock()
	going := []string{}
	for id, one := range s.held {
		one.mutex.Lock()
		if !one.detachedAt.IsZero() && !one.detachedAt.After(deadline) {
			going = append(going, id)
		}
		one.mutex.Unlock()
	}
	s.mutex.Unlock()
	for _, id := range going {
		s.kill(id)
	}
}

// Close ends every shell: one left running past the server is one editing a checkout with nobody
// to read what it did.
func (s *Shells) Close() {
	select {
	case <-s.reaper:
	default:
		close(s.reaper)
	}
	s.mutex.Lock()
	going := make([]string, 0, len(s.held))
	for id := range s.held {
		going = append(going, id)
	}
	s.mutex.Unlock()
	for _, id := range going {
		s.kill(id)
	}
}

func (s *Shells) shell(id string) *shell {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.held[id]
}

// spawn makes a shell. Called with the map's lock held.
func (s *Shells) spawn(root, id string, wide, high int) *shell {
	session := s.session(root)
	command := exec.Command(shellPath(), "-l")
	command.Dir = session.Cwd
	env := append(Ambient(), "TERM="+term, "COLORFGBG="+colorfgbg)
	for key, value := range session.Env {
		env = append(env, key+"="+value)
	}
	command.Env = env

	// The terminal's own size where the client sent one, so the first prompt is drawn to the
	// width it will be read at. Otherwise the size a terminal is until it is told otherwise,
	// which is what an unfitted one on the other end still has.
	if wide <= 0 {
		wide = cols
	}
	if high <= 0 {
		high = rows
	}
	held := &shell{id: id, cwd: session.Cwd, cmd: command}
	file, err := pty.StartWithSize(command, &pty.Winsize{Cols: uint16(wide), Rows: uint16(high)})
	if err != nil {
		// A shell that would not start is one nothing can be typed into. It is filed anyway, so
		// the tab asking for it is answered rather than left dialling, and it reaps like any
		// other once nobody comes back.
		held.pty, _ = os.Open(os.DevNull)
		s.held[id] = held
		return held
	}
	held.pty = file
	s.held[id] = held
	go s.pump(held)
	return held
}

// pump carries what the shell says to whoever is watching, and keeps the tail whether anyone is or
// not: what a shell said while the lid was shut is the thing somebody is coming back to read.
func (s *Shells) pump(one *shell) {
	buffer := make([]byte, 32*1024)
	// A read ends where the kernel had bytes to hand over, which is not where a character ends: a
	// pty splits a box-drawing rune's three bytes across two reads often enough to be the ordinary
	// case rather than the corner. Passed on as it stands, neither half is UTF-8, and the JSON
	// frame carrying it writes a replacement character for every stray byte — so one cell of the
	// screen becomes three, and everything after it on the row is pushed along. That is a TUI
	// drawn with holes in it and its columns out of true. Whatever is not yet a whole character
	// waits here for the rest of itself.
	var partial []byte
	for {
		read, err := one.pty.Read(buffer)
		if read > 0 {
			said := buffer[:read]
			if len(partial) > 0 {
				said = append(partial, said...)
			}
			whole, rest := characters(said)
			partial = append(partial[:0:0], rest...)
			if len(whole) > 0 {
				data := string(whole)
				one.mutex.Lock()
				one.buffer = tail(append(one.buffer, whole...))
				watcher := one.watcher
				one.mutex.Unlock()
				if watcher != nil {
					watcher.Output(data)
				}
			}
		}
		if err != nil {
			break
		}
	}
	// The shell has ended. Reading a closed pty is how that is heard: the process is waited on
	// for its code, and whoever was watching is told before the socket goes.
	code := 0
	if err := one.cmd.Wait(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		} else {
			code = 1
		}
	}
	s.mutex.Lock()
	delete(s.held, one.id)
	s.mutex.Unlock()

	one.mutex.Lock()
	watcher := one.watcher
	one.watcher = nil
	one.mutex.Unlock()
	if watcher != nil {
		watcher.Exit(code)
		watcher.Close()
	}
}

func (s *Shells) kill(id string) {
	s.mutex.Lock()
	one := s.held[id]
	delete(s.held, id)
	s.mutex.Unlock()
	if one == nil {
		return
	}
	// Let go of the watcher before the pty goes, so that the exit is not reported to whoever is on
	// the other end of it. A tab remounting asks for its shell again in the moment between these
	// two, and telling that one its shell had exited would close a pane that is only just opening
	// — it is dropped instead, and asks again for a shell of its own.
	one.mutex.Lock()
	watcher := one.watcher
	one.watcher = nil
	one.mutex.Unlock()

	if one.cmd.Process != nil {
		one.cmd.Process.Kill()
	}
	one.pty.Close()
	if watcher != nil {
		watcher.Close()
	}
}

// foregroundOf is what holds the shell's foreground: the process group in front of the pty,
// resolved through the process table to its executable's name. The shell's own name where nothing
// else is running in it, and where the question cannot be answered at all.
//
// The executable's name rather than the process's title, which is what node-pty reports on the
// other side. A title is whatever the program set it to — Claude Code sets its to its version
// number — so the implementation this is ported from reads the title first and then asks the
// process table anyway whenever the title was not a shell's name. This asks the process table
// once and is done: the answer is the one that decides either way.
func foregroundOf(one *shell) string {
	group, err := unix.IoctlGetInt(int(one.pty.Fd()), unix.TIOCGPGRP)
	if err != nil {
		return commandName(one.cmd.Path)
	}
	out, err := exec.Command("ps", "-o", "comm=", "-p", strconv.Itoa(group)).Output()
	if name := strings.TrimSpace(string(out)); err == nil && name != "" {
		return commandName(name)
	}
	return commandName(one.cmd.Path)
}

func commandName(path string) string {
	if at := strings.LastIndexByte(path, '/'); at >= 0 {
		return path[at+1:]
	}
	return path
}

// tail is the last of the output, cut on a line where there is one to cut on: half a line at the
// head of what you come back to reads as a shell that lost its place.
func tail(buffer []byte) []byte {
	if len(buffer) <= scrollback {
		return buffer
	}
	cut := len(buffer) - scrollback
	line := indexFrom(buffer, cut, '\n')
	if line == -1 || line-cut > 4096 {
		return buffer[boundary(buffer, cut):]
	}
	return buffer[line+1:]
}

// characters splits what has been read into the part that is whole characters and the part that is
// the beginning of one. A trailing byte that begins nothing valid counts as whole: no byte after it
// will make it UTF-8, and holding it back would stall everything queued behind it.
func characters(data []byte) (whole, partial []byte) {
	for at := len(data) - 1; at >= 0 && len(data)-at < utf8.UTFMax; at-- {
		if !utf8.RuneStart(data[at]) {
			continue
		}
		if utf8.FullRune(data[at:]) {
			break
		}
		return data[:at], data[at:]
	}
	return data, nil
}

// boundary is the first byte at or after `cut` that begins a character, so that a backlog cut to
// length does not open on the tail of one.
func boundary(buffer []byte, cut int) int {
	for at := cut; at < len(buffer) && at-cut < utf8.UTFMax; at++ {
		if utf8.RuneStart(buffer[at]) {
			return at
		}
	}
	return cut
}

func indexFrom(buffer []byte, from int, want byte) int {
	for at := from; at < len(buffer); at++ {
		if buffer[at] == want {
			return at
		}
	}
	return -1
}

// newName is the id a socket that named no session gets. Random rather than counted: a tab holds
// on to it across a restart of this process, and a counter would hand a second tab the first's.
func newName() string {
	held := make([]byte, 16)
	rand.Read(held)
	return hex.EncodeToString(held)
}
