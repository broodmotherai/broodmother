package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
)

// watching serves a home whose sessions folder is one the test writes.
func watching(t *testing.T, probes map[int]string) (*Server, string) {
	t.Helper()
	home := t.TempDir()
	claude := t.TempDir()
	sessions := filepath.Join(claude, "sessions")
	if err := os.MkdirAll(sessions, 0o755); err != nil {
		t.Fatal(err)
	}
	for pid, body := range probes {
		probe(t, sessions, pid, body)
	}
	server, err := Start(Options{
		Options: app.Options{Home: home, ClaudeDir: claude, Cron: &memoryCrontab{}}, Port: -1,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close(t.Context()) })
	return server, sessions
}

func probe(t *testing.T, sessions string, pid int, body string) {
	t.Helper()
	name := filepath.Join(sessions, strconv.Itoa(pid)+".json")
	if err := os.WriteFile(name, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func activityOf(t *testing.T, server *Server) map[string]any {
	t.Helper()
	answer := sent(t, server, http.MethodGet, "/api/activity", "")
	states, _ := answer["activity"].(map[string]any)
	return states
}

// Claude says so itself: the probe is where the difference between thinking and waiting is
// written down.
func TestReadsWhatEachSessionSaysItIsDoing(t *testing.T) {
	mine := os.Getpid()
	server, _ := watching(t, map[int]string{
		mine: `{"pid":` + strconv.Itoa(mine) + `,"cwd":"/work/notes","status":"busy"}`,
	})
	if held := activityOf(t, server); held["/work/notes"] != "busy" {
		t.Errorf("says %+v", held)
	}
}

// Busy beats waiting beats idle, and a checkout nothing can be said about is left out — saying
// nothing is what a client draws as "there is a shell here, at rest".
func TestBusyBeatsWaitingBeatsIdle(t *testing.T) {
	mine := os.Getpid()
	server, sessions := watching(t, nil)
	for at, one := range []struct {
		status string
		cwd    string
	}{{"idle", "/work/notes"}, {"waiting", "/work/notes"}, {"idle", "/work/other"}} {
		probe(t, sessions, mine+1000+at,
			`{"pid":`+strconv.Itoa(mine)+`,"cwd":`+quoted(one.cwd)+`,"status":`+quoted(one.status)+`}`)
	}
	held := settledActivity(t, server, 2)
	if held["/work/notes"] != "waiting" || held["/work/other"] != "idle" {
		t.Errorf("says %+v", held)
	}
}

// A session killed outright leaves its probe behind, saying whatever it was doing at the time.
// Left alone that is a checkout stuck at "working" for the rest of the day.
func TestSaysNothingAboutASessionThatIsGone(t *testing.T) {
	server, _ := watching(t, map[int]string{
		// A pid nothing is running under: high, and never reused within a test's life.
		999999: `{"pid":999999,"cwd":"/work/gone","status":"busy"}`,
	})
	if held := activityOf(t, server); len(held) != 0 {
		t.Errorf("says %+v", held)
	}
}

// A probe half-written, or in a shape this does not know, is not news either way.
func TestIgnoresAProbeItCannotRead(t *testing.T) {
	mine := os.Getpid()
	server, sessions := watching(t, map[int]string{
		1: `{"pid":1,"cwd":"/work/a"`,
		2: `{"pid":2,"cwd":"/work/b","status":"dreaming"}`,
		3: `{"cwd":"/work/c","status":"busy"}`,
	})
	// A file that is not a probe at all sits in the same folder.
	if err := os.WriteFile(filepath.Join(sessions, "key.pem"), []byte("not a probe"), 0o644); err != nil {
		t.Fatal(err)
	}
	probe(t, sessions, mine, `{"pid":`+strconv.Itoa(mine)+`,"cwd":"/work/real","status":"waiting"}`)

	held := settledActivity(t, server, 1)
	if len(held) != 1 || held["/work/real"] != "waiting" {
		t.Errorf("says %+v", held)
	}
}

// settledActivity waits for the folder to be read again — the watch is a beat behind a write.
func settledActivity(t *testing.T, server *Server, want int) map[string]any {
	t.Helper()
	for range 100 {
		if held := activityOf(t, server); len(held) == want {
			return held
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("the picture never settled at %d", want)
	return nil
}

// A machine Claude has never run on has a folder that is not there, which is not an error.
func TestSaysNothingWhereClaudeHasNeverRun(t *testing.T) {
	server := servingIn(t, t.TempDir(), "")
	response, body := get(t, server, "/api/activity", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	var held map[string]map[string]any
	if err := json.Unmarshal(body, &held); err != nil {
		t.Fatal(err)
	}
	if len(held["activity"]) != 0 {
		t.Errorf("says %+v", held)
	}
}

// The last resort: every folder in the home, gone, and a config that names nothing.
func TestTakesEverythingOnThisMachineAway(t *testing.T) {
	home, checkout := projectHome(t, map[string]string{"one.md": "hello\n"})
	server := servingIn(t, home, "")
	if _, err := os.Stat(checkout); err != nil {
		t.Fatal(err)
	}
	if listed := held(t, server, "/api/projects", "projects"); len(listed) != 1 {
		t.Fatalf("started with %+v", listed)
	}

	answer := sent(t, server, http.MethodDelete, "/api/data", "")
	saved, _ := answer["config"].(map[string]any)
	if saved["projectPath"] != nil || saved["profile"] != nil {
		t.Errorf("the config still names %+v", saved)
	}
	if _, err := os.Stat(filepath.Join(home, "Ada")); !os.IsNotExist(err) {
		t.Errorf("the profile is still there: %v", err)
	}
	// The config it wrote itself is the one thing left, and it is the empty one.
	if listed := held(t, server, "/api/profiles", "profiles"); len(listed) != 0 {
		t.Errorf("still knows of %+v", listed)
	}
	if listed := held(t, server, "/api/projects", "projects"); len(listed) != 0 {
		t.Errorf("still knows of %+v", listed)
	}
}
