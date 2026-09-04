package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

// openRuns writes into the same file the daemon reads, which is how a run the walk wrote reaches
// a listing here.
func openRuns(file string) (*sql.DB, error) {
	store, err := taskrun.Open(file)
	if err != nil {
		return nil, err
	}
	store.Close()
	return sql.Open("sqlite", file)
}

const aTask = `{
  "version": 1,
  "nodes": [
    {"id": "trigger", "kind": "trigger.interval", "name": "Every hour", "x": 80, "y": 120, "minutes": 60},
    {"id": "lonely", "kind": "trigger.manual", "name": "Trigger manually", "x": 80, "y": 240},
    {"id": "off", "kind": "trigger.time", "name": "At nine", "x": 80, "y": 360, "at": "09:00", "off": true},
    {"id": "work", "kind": "agent.shell", "name": "Say so", "x": 240, "y": 120, "command": "echo hi"}
  ],
  "edges": [{"from": "trigger", "to": "work"}]
}
`

const aCanvas = `{
  "nodes": [
    {"id": "a", "type": "text", "x": 0, "y": 0, "width": 160, "height": 80, "text": "one"},
    {"id": "b", "type": "text", "x": 320, "y": 0, "width": 160, "height": 80, "text": "two"}
  ],
  "edges": [{"id": "e1", "fromNode": "a", "toNode": "b"}]
}
`

func held(t *testing.T, server *Server, path, key string) []map[string]any {
	t.Helper()
	answer := sent(t, server, http.MethodGet, path, "")
	raw, _ := answer[key].([]any)
	found := make([]map[string]any, 0, len(raw))
	for _, one := range raw {
		row, _ := one.(map[string]any)
		found = append(found, row)
	}
	return found
}

// Only the wired triggers — the ones that would actually fire it — and a task nobody wired fires
// nothing, which is what an empty list means.
func TestListsWhatFiresEachTask(t *testing.T) {
	home, _ := projectHome(t, map[string]string{
		".tasks/nightly.task": aTask,
		"deep/second.task":    aTask,
	})
	server := servingIn(t, home, "")

	found := held(t, server, "/api/tasks", "tasks")
	if len(found) != 2 {
		t.Fatalf("listed %+v", found)
	}
	one := found[0]
	ref, _ := one["ref"].(map[string]any)
	if ref["root"] != "project" || ref["path"] != ".tasks/nightly.task" || one["name"] != "nightly" {
		t.Fatalf("listed %+v", one)
	}
	triggers, _ := one["triggers"].([]any)
	if len(triggers) != 1 {
		t.Fatalf("fired by %+v", triggers)
	}
	// The wired one, read as a sentence. The manual trigger leads nowhere and the timed one is
	// switched off, so neither is offered.
	wired, _ := triggers[0].(map[string]any)
	if wired["kind"] != "trigger.interval" || wired["label"] != "every 60 minutes" {
		t.Errorf("fired by %+v", wired)
	}
	if one["lastRun"] != nil {
		t.Errorf("a task nothing has run has %+v", one["lastRun"])
	}
}

// A broken task fires nothing, and saying so is the only way anybody learns why it stopped.
func TestListsABrokenTaskWithWhatIsWrongWithIt(t *testing.T) {
	home, _ := projectHome(t, map[string]string{".tasks/half.task": `{"version":1,"nodes":[{}]}`})
	server := servingIn(t, home, "")

	found := held(t, server, "/api/tasks", "tasks")
	if len(found) != 1 {
		t.Fatalf("listed %+v", found)
	}
	if said, _ := found[0]["broken"].(string); said == "" {
		t.Errorf("said nothing about what is wrong: %+v", found[0])
	}
	if triggers, _ := found[0]["triggers"].([]any); len(triggers) != 0 {
		t.Errorf("a broken task is fired by %+v", triggers)
	}
}

// A canvas has no runner, so this is all it has: what has been drawn, and what a broken one is
// broken by.
func TestListsWhatHasBeenDrawn(t *testing.T) {
	home, _ := projectHome(t, map[string]string{
		"diagrams/flow.canvas": aCanvas,
		"broken.canvas":        `{"nodes":[{"id":"a","type":"group"}]}`,
	})
	server := servingIn(t, home, "")

	found := held(t, server, "/api/diagrams", "diagrams")
	if len(found) != 2 {
		t.Fatalf("drew %+v", found)
	}
	var flow, broken map[string]any
	for _, one := range found {
		ref, _ := one["ref"].(map[string]any)
		if ref["path"] == "diagrams/flow.canvas" {
			flow = one
		} else {
			broken = one
		}
	}
	if flow == nil || flow["name"] != "flow" || flow["nodes"] != 2.0 || flow["edges"] != 1.0 {
		t.Errorf("drew %+v", flow)
	}
	if broken == nil || broken["nodes"] != 0.0 {
		t.Fatalf("drew %+v", broken)
	}
	if said, _ := broken["broken"].(string); said == "" {
		t.Errorf("said nothing about what is wrong: %+v", broken)
	}
}

// The runs the store remembers, whichever daemon wrote them: the file is the same file in the
// same home.
func TestReadsTheRunsTheWalkWrote(t *testing.T) {
	home, _ := projectHome(t, map[string]string{".tasks/nightly.task": aTask})
	writeRuns(t, home)
	server := servingIn(t, home, "")

	runs := held(t, server, "/api/task/log", "runs")
	if len(runs) != 2 {
		t.Fatalf("logged %+v", runs)
	}
	// Newest first, and where the run's files are is derived from the base and the id.
	if runs[0]["id"] != "run-2" {
		t.Fatalf("logged %+v", runs[0])
	}
	if runs[0]["scratch"] != filepath.Join(home, "tasks", "runs", "run-2") {
		t.Errorf("the run's files are at %+v", runs[0]["scratch"])
	}
	// It was still walking when the last server stopped, so starting ended it.
	if runs[0]["state"] != "error" || runs[0]["error"] != "the server stopped mid-run" {
		t.Errorf("logged %+v", runs[0])
	}
	if at, _ := runs[0]["finishedAt"].(float64); at <= 0 {
		t.Errorf("ended at %+v", runs[0]["finishedAt"])
	}
	// A run that ruled nothing out says nothing about its edges.
	if _, said := runs[0]["pruned"]; said {
		t.Errorf("a run that ruled nothing out carries %+v", runs[0]["pruned"])
	}

	done, _ := runs[1]["steps"].([]any)
	if len(done) != 1 {
		t.Fatalf("the first run walked %+v", done)
	}
	step, _ := done[0].(map[string]any)
	if step["node"] != "work" || step["state"] != "done" || step["output"] != "hi" {
		t.Errorf("the step is %+v", step)
	}
	if pruned, _ := runs[1]["pruned"].([]any); len(pruned) != 1 {
		t.Errorf("the first run ruled out %+v", runs[1]["pruned"])
	}

	// One task's own, and the task's row carries the newest of them.
	only := held(t, server, "/api/task/runs?root=project&path=.tasks/nightly.task", "runs")
	if len(only) != 2 {
		t.Errorf("that task ran %+v", only)
	}
	if none := held(t, server, "/api/task/runs?root=project&path=.tasks/nothing.task", "runs"); len(none) != 0 {
		t.Errorf("a task nothing has run has %+v", none)
	}
	tasks := held(t, server, "/api/tasks", "tasks")
	last, _ := tasks[0]["lastRun"].(map[string]any)
	if last == nil || last["id"] != "run-2" {
		t.Errorf("the task's last run is %+v", tasks[0]["lastRun"])
	}
	// A row of the tasks page says how the last run went, not where its files are.
	if _, said := last["scratch"]; said {
		t.Errorf("the row carries %+v", last["scratch"])
	}
}

// A run interrupted mid-step cannot be picked up where it was left — the step that was running
// may have half-done something the world can see, and doing it again would comment twice. A
// paused run was written deliberately at a step boundary and is left exactly where it stands.
func TestEndsTheRunsAStartFindsStillWalking(t *testing.T) {
	home := t.TempDir()
	store, err := openRuns(filepath.Join(home, "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	steps := `[{"node":"one","name":"One","kind":"agent.shell","state":"done"},` +
		`{"node":"two","name":"Two","kind":"agent.shell","state":"running"},` +
		`{"node":"three","name":"Three","kind":"agent.shell","state":"waiting"}]`
	for _, state := range []string{"running", "paused"} {
		if _, err := store.Exec(
			`INSERT INTO runs (root, path, started_at, state, steps, pruned)
			 VALUES ('project', '.tasks/nightly.task', 1000, ?, ?, '[]')`, state, steps); err != nil {
			t.Fatal(err)
		}
	}
	store.Close()

	server := servingIn(t, home, "")
	runs := held(t, server, "/api/task/log", "runs")
	if len(runs) != 2 {
		t.Fatalf("logged %+v", runs)
	}
	// Newest first, so the paused one comes back first — untouched.
	if runs[0]["state"] != "paused" {
		t.Errorf("the paused run is %+v", runs[0]["state"])
	}
	if runs[1]["state"] != "error" || runs[1]["error"] != "the server stopped mid-run" {
		t.Errorf("the abandoned run is %+v", runs[1])
	}
	// What it had already done stands; what it was in the middle of and had not reached does not.
	walked, _ := runs[1]["steps"].([]any)
	want := []string{"done", "skipped", "skipped"}
	for index, one := range walked {
		step, _ := one.(map[string]any)
		if step["state"] != want[index] {
			t.Errorf("step %d is %+v, want %s", index, step["state"], want[index])
		}
	}
	// And it stays ended: a second start has nothing left to end.
	again := servingIn(t, home, "")
	runs = held(t, again, "/api/task/log", "runs")
	if runs[1]["finishedAt"] == nil {
		t.Errorf("the second start moved it: %+v", runs[1])
	}
}

// A home whose store has never been written to answers with nothing rather than failing.
func TestLogsNothingBeforeAnythingHasRun(t *testing.T) {
	server := serving(t, "")
	if runs := held(t, server, "/api/task/log", "runs"); len(runs) != 0 {
		t.Errorf("logged %+v", runs)
	}
	if found := held(t, server, "/api/tasks", "tasks"); len(found) != 0 {
		t.Errorf("listed %+v", found)
	}
	if found := held(t, server, "/api/diagrams", "diagrams"); len(found) != 0 {
		t.Errorf("drew %+v", found)
	}
	response, body := get(t, server, "/api/task/runs?root=project", "")
	if response.StatusCode != http.StatusBadRequest {
		t.Errorf("answered %d: %s", response.StatusCode, body)
	}
}

// Two runs written the way the walk writes them, straight into the file both daemons share.
func writeRuns(t *testing.T, home string) {
	t.Helper()
	store, err := openRuns(filepath.Join(home, "tasks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	steps, err := json.Marshal([]map[string]any{
		{"node": "work", "name": "Say so", "kind": "agent.shell", "state": "done", "output": "hi"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, one := range []struct {
		startedAt  int64
		finishedAt any
		state      string
		steps      string
		pruned     string
	}{
		{1000, int64(2000), "done", string(steps), `["trigger>lonely"]`},
		{3000, nil, "running", `[]`, `[]`},
	} {
		if _, err := store.Exec(
			`INSERT INTO runs (root, path, started_at, finished_at, state, error, steps, pruned)
			 VALUES ('project', '.tasks/nightly.task', ?, ?, ?, NULL, ?, ?)`,
			one.startedAt, one.finishedAt, one.state, one.steps, one.pruned); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(home, "tasks", "runs"), 0o755); err != nil {
		t.Fatal(err)
	}
}
