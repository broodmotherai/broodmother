package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// walking builds a project holding one task and serves it.
func walking(t *testing.T, board string) (*Server, string) {
	t.Helper()
	home, checkout := projectHome(t, map[string]string{".tasks/one.task": board})
	return servingIn(t, home, ""), checkout
}

func started(t *testing.T, server *Server, body string) map[string]any {
	t.Helper()
	answer := sent(t, server, http.MethodPost, "/api/task/run", body)
	run, _ := answer["run"].(map[string]any)
	if run == nil {
		t.Fatalf("started %+v", answer)
	}
	return run
}

// settled waits for the run to stop moving. A run is handed back mid-flight, so a test that read
// it once would be reading the moment it started.
func settled(t *testing.T, server *Server) map[string]any {
	t.Helper()
	for range 200 {
		runs := held(t, server, "/api/task/runs?root=project&path=.tasks/one.task", "runs")
		if len(runs) > 0 {
			if state, _ := runs[0]["state"].(string); state != "running" {
				return runs[0]
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("the run never settled")
	return nil
}

func steps(run map[string]any) map[string]map[string]any {
	found := map[string]map[string]any{}
	walked, _ := run["steps"].([]any)
	for _, one := range walked {
		step, _ := one.(map[string]any)
		node, _ := step["node"].(string)
		found[node] = step
	}
	return found
}

// A task laid out as `trigger -> first -> second`, with whatever commands are given.
func chain(first, second string) string {
	return `{"version":1,"nodes":[
		{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
		{"id":"a","kind":"agent.shell","name":"First","x":240,"y":80,"command":` + quoted(first) + `},
		{"id":"b","kind":"agent.shell","name":"Second","x":400,"y":80,"command":` + quoted(second) + `}],
		"edges":[{"from":"t","to":"a"},{"from":"a","to":"b"}]}`
}

// The file is the only channel between steps: what one writes is what the next is handed.
func TestWalksATaskAndCarriesEachStepsWordOn(t *testing.T) {
	server, _ := walking(t, chain("echo hello", "cat; echo ' and goodbye'"))
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	run := settled(t, server)

	if run["state"] != "done" {
		t.Fatalf("ended as %+v", run)
	}
	walked := steps(run)
	if walked["a"]["state"] != "done" || !strings.Contains(walked["a"]["output"].(string), "hello") {
		t.Errorf("the first step is %+v", walked["a"])
	}
	if said, _ := walked["b"]["output"].(string); !strings.Contains(said, "hello") ||
		!strings.Contains(said, "and goodbye") {
		t.Errorf("the second step read %q", said)
	}
	// A manual trigger is done rather than skipped: it is what opened the run.
	if walked["t"]["state"] != "done" {
		t.Errorf("the trigger is %+v", walked["t"])
	}
	if at, _ := run["finishedAt"].(float64); at <= 0 {
		t.Errorf("finished at %+v", run["finishedAt"])
	}
}

// What was typed opens the run, as though a trigger had seen it.
func TestOpensTheRunOnWhatWasTyped(t *testing.T) {
	server, _ := walking(t, chain("cat", "cat"))
	started(t, server, `{"root":"project","path":".tasks/one.task","input":"the thing to do"}`)
	run := settled(t, server)
	if said, _ := steps(run)["b"]["output"].(string); !strings.Contains(said, "the thing to do") {
		t.Errorf("the last step read %q", said)
	}
}

// The files the steps handed each other, kept after the run as its inspectable record.
func TestKeepsTheFilesTheStepsHandedEachOther(t *testing.T) {
	server, _ := walking(t, chain("echo written", "cat"))
	run := started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	settled(t, server)

	scratch, _ := run["scratch"].(string)
	if scratch == "" {
		t.Fatalf("the run has no folder: %+v", run)
	}
	body, err := os.ReadFile(filepath.Join(scratch, "a.out.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "written") {
		t.Errorf("the first step's hand-off says %q", body)
	}
	if _, err := os.Stat(filepath.Join(scratch, "b.in.md")); err != nil {
		t.Errorf("the second step was handed nothing: %v", err)
	}
}

// The Run button and a schedule landing mid-run both mean "be running", not "run twice".
func TestJoinsTheRunAlreadyWalking(t *testing.T) {
	server, _ := walking(t, chain("sleep 0.4; echo one", "cat"))
	first := started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	second := started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	if first["id"] != second["id"] {
		t.Errorf("stacked a second run: %+v then %+v", first["id"], second["id"])
	}
	settled(t, server)
	if runs := held(t, server, "/api/task/runs?root=project&path=.tasks/one.task", "runs"); len(runs) != 1 {
		t.Errorf("the task ran %d times", len(runs))
	}
}

// A step that fails ends the run with its reason, and what never got to run is skipped.
func TestFailsTheRunAtTheStepThatFailed(t *testing.T) {
	server, _ := walking(t, chain("echo nope >&2; exit 1", "echo unreached"))
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	run := settled(t, server)

	if run["state"] != "error" {
		t.Fatalf("ended as %+v", run)
	}
	if said, _ := run["error"].(string); !strings.Contains(said, "First: ") || !strings.Contains(said, "nope") {
		t.Errorf("failed with %q", said)
	}
	walked := steps(run)
	if walked["a"]["state"] != "error" || walked["b"]["state"] != "skipped" {
		t.Errorf("walked %+v", walked)
	}
}

// The gate ran either way; a miss keeps no route, so the branch beyond it goes quiet.
func TestEndsTheBranchAGateHeldBack(t *testing.T) {
	board := `{"version":1,"nodes":[
		{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
		{"id":"g","kind":"agent.gate","name":"Only if ready","x":240,"y":80,"pattern":"ready"},
		{"id":"b","kind":"agent.shell","name":"After","x":400,"y":80,"command":"echo ran"}],
		"edges":[{"from":"t","to":"g"},{"from":"g","to":"b"}]}`
	server, _ := walking(t, board)
	started(t, server, `{"root":"project","path":".tasks/one.task","input":"not yet"}`)
	run := settled(t, server)

	if run["state"] != "done" {
		t.Fatalf("ended as %+v", run)
	}
	walked := steps(run)
	if walked["g"]["state"] != "done" || walked["b"]["state"] != "skipped" {
		t.Errorf("walked %+v", walked)
	}
	// What was ruled out is saved on the run, so a pause does not forget it.
	if pruned, _ := run["pruned"].([]any); len(pruned) != 1 || pruned[0] != "g>b" {
		t.Errorf("ruled out %+v", run["pruned"])
	}
}

// A verdict picks which paths onward to follow, by the name of the node each leads to.
func TestFollowsOnlyThePathsAVerdictPicked(t *testing.T) {
	board := `{"version":1,"nodes":[
		{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
		{"id":"a","kind":"agent.shell","name":"Decide","x":240,"y":80,
		 "command":"printf '{\"next\":[\"Left\"]}' > \"$TASK_VERDICT\"; echo chose"},
		{"id":"l","kind":"agent.shell","name":"Left","x":400,"y":40,"command":"echo left"},
		{"id":"r","kind":"agent.shell","name":"Right","x":400,"y":160,"command":"echo right"}],
		"edges":[{"from":"t","to":"a"},{"from":"a","to":"l"},{"from":"a","to":"r"}]}`
	server, _ := walking(t, board)
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	run := settled(t, server)

	walked := steps(run)
	if walked["l"]["state"] != "done" || walked["r"]["state"] != "skipped" {
		t.Errorf("walked %+v", walked)
	}
}

// A deliberate halt is an outcome, not a failure: the run still finishes.
func TestStopsTheFlowWhereAStepSaidTo(t *testing.T) {
	board := `{"version":1,"nodes":[
		{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
		{"id":"a","kind":"agent.shell","name":"Look","x":240,"y":80,
		 "command":"printf '{\"stop\":\"nothing to do\"}' > \"$TASK_VERDICT\""},
		{"id":"b","kind":"agent.shell","name":"After","x":400,"y":80,"command":"echo ran"}],
		"edges":[{"from":"t","to":"a"},{"from":"a","to":"b"}]}`
	server, _ := walking(t, board)
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	run := settled(t, server)

	if run["state"] != "done" {
		t.Fatalf("ended as %+v", run)
	}
	walked := steps(run)
	if walked["a"]["state"] != "stopped" || walked["a"]["halted"] != "nothing to do" {
		t.Errorf("the step is %+v", walked["a"])
	}
	if walked["b"]["state"] != "skipped" {
		t.Errorf("the step after it is %+v", walked["b"])
	}
}

// A malformed verdict is a step error rather than a shrug: silently following every path is the
// one wrong default.
func TestRefusesAVerdictItCannotRead(t *testing.T) {
	server, _ := walking(t, chain(`printf 'not json' > "$TASK_VERDICT"`, "echo after"))
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	run := settled(t, server)
	if run["state"] != "error" {
		t.Fatalf("ended as %+v", run)
	}
	if said, _ := steps(run)["a"]["error"].(string); !strings.Contains(said, "not JSON") {
		t.Errorf("failed with %q", said)
	}
}

const approving = `{"version":1,"nodes":[
	{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
	{"id":"a","kind":"agent.shell","name":"Prepare","x":240,"y":80,"command":"echo prepared"},
	{"id":"h","kind":"agent.approve","name":"Ready?","x":400,"y":80,"question":"Send it?"},
	{"id":"b","kind":"agent.shell","name":"Send","x":560,"y":80,"command":"cat"}],
	"edges":[{"from":"t","to":"a"},{"from":"a","to":"h"},{"from":"h","to":"b"}]}`

// The run keeps its place at the question and picks up from there when it is answered.
func TestPausesAtAnApprovalAndWalksOnWhenItIsAnswered(t *testing.T) {
	server, _ := walking(t, approving)
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	run := settled(t, server)

	if run["state"] != "paused" {
		t.Fatalf("ended as %+v", run)
	}
	walked := steps(run)
	if walked["h"]["state"] != "held" || walked["h"]["asked"] != "Send it?" {
		t.Errorf("the question is %+v", walked["h"])
	}
	if walked["b"]["state"] != "waiting" {
		t.Errorf("the step after it is %+v", walked["b"])
	}

	sent(t, server, http.MethodPost, "/api/task/approve",
		`{"root":"project","path":".tasks/one.task","approved":true}`)
	run = settled(t, server)
	if run["state"] != "done" {
		t.Fatalf("ended as %+v", run)
	}
	walked = steps(run)
	if walked["h"]["state"] != "done" {
		t.Errorf("the question is %+v", walked["h"])
	}
	// Approving passes what fed the step straight on, so the step after it reads the same thing.
	if said, _ := walked["b"]["output"].(string); !strings.Contains(said, "prepared") {
		t.Errorf("the step after it read %q", said)
	}
}

// A person saying no is an outcome, not a fault: the branch beyond it ends and the run finishes.
func TestEndsTheBranchBeyondADenial(t *testing.T) {
	server, _ := walking(t, approving)
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	settled(t, server)

	sent(t, server, http.MethodPost, "/api/task/approve",
		`{"root":"project","path":".tasks/one.task","approved":false,"note":"not this week"}`)
	run := settled(t, server)

	if run["state"] != "done" {
		t.Fatalf("ended as %+v", run)
	}
	walked := steps(run)
	if walked["h"]["state"] != "stopped" || walked["h"]["halted"] != "not this week" {
		t.Errorf("the question is %+v", walked["h"])
	}
	if walked["b"]["state"] != "skipped" {
		t.Errorf("the step after it is %+v", walked["b"])
	}
}

func TestSaysWhenThereIsNothingToApproveOrStop(t *testing.T) {
	server, _ := walking(t, chain("echo one", "echo two"))
	for _, one := range []struct{ path, body string }{
		{"/api/task/stop", `{"root":"project","path":".tasks/one.task"}`},
		{"/api/task/approve", `{"root":"project","path":".tasks/one.task","approved":true}`},
	} {
		refused(t, server, http.MethodPost, one.path, one.body)
	}
	// And a task that is not there is said so by name rather than started.
	refused(t, server, http.MethodPost, "/api/task/run", `{"root":"project","path":".tasks/nothing.task"}`)
	refused(t, server, http.MethodPost, "/api/task/run", `{"root":"repo:missing","path":".tasks/one.task"}`)
}

// The stop button means what it says: the step's own process ends with it.
func TestStopsARunAndTheWorkWithIt(t *testing.T) {
	server, _ := walking(t, chain("sleep 30", "echo unreached"))
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	// The first step has to be under way before there is anything to stop.
	for range 100 {
		if walked := steps(latest(t, server)); walked["a"]["state"] == "running" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	answer := sent(t, server, http.MethodPost, "/api/task/stop",
		`{"root":"project","path":".tasks/one.task"}`)
	run, _ := answer["run"].(map[string]any)
	if run["state"] != "error" || run["error"] != "stopped" {
		t.Fatalf("stopped as %+v", run)
	}
	walked := steps(run)
	if walked["a"]["state"] != "skipped" || walked["b"]["state"] != "skipped" {
		t.Errorf("walked %+v", walked)
	}
}

func latest(t *testing.T, server *Server) map[string]any {
	t.Helper()
	runs := held(t, server, "/api/task/runs?root=project&path=.tasks/one.task", "runs")
	if len(runs) == 0 {
		t.Fatal("nothing has run")
	}
	return runs[0]
}

// A GitHub step with nothing connected stops at that step and says so. An action that quietly
// did nothing would be worse than one that fails: a task nobody connected still looks like it
// commented.
func TestSaysWhenNothingIsConnectedToGithub(t *testing.T) {
	board := `{"version":1,"nodes":[
		{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
		{"id":"g","kind":"agent.github.comment","name":"Say so","x":240,"y":80}],
		"edges":[{"from":"t","to":"g"}]}`
	server, _ := walking(t, board)
	started(t, server, `{"root":"project","path":".tasks/one.task"}`)
	run := settled(t, server)

	if run["state"] != "error" {
		t.Fatalf("ended as %+v", run)
	}
	if said, _ := steps(run)["g"]["error"].(string); !strings.Contains(said, "no GitHub connection") {
		t.Errorf("failed with %q", said)
	}
}

// Switched off, the node is a wire: what fed it goes straight on to what it feeds, so the branch
// keeps running and only this step's work is missing.
func TestWalksPastAStepThatIsSwitchedOff(t *testing.T) {
	board := `{"version":1,"nodes":[
		{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
		{"id":"a","kind":"agent.shell","name":"Skipped","x":240,"y":80,"command":"echo never","off":true},
		{"id":"b","kind":"agent.shell","name":"After","x":400,"y":80,"command":"cat"}],
		"edges":[{"from":"t","to":"a"},{"from":"a","to":"b"}]}`
	server, _ := walking(t, board)
	started(t, server, `{"root":"project","path":".tasks/one.task","input":"carried"}`)
	run := settled(t, server)

	walked := steps(run)
	if walked["a"]["state"] != "off" {
		t.Errorf("the switched-off step is %+v", walked["a"])
	}
	if said, _ := walked["b"]["output"].(string); !strings.Contains(said, "carried") {
		t.Errorf("the step after it read %q", said)
	}
}

// A note is written into the project, and the same context goes on untouched.
func TestWritesANoteIntoTheProject(t *testing.T) {
	board := `{"version":1,"nodes":[
		{"id":"t","kind":"trigger.manual","name":"Trigger manually","x":80,"y":80},
		{"id":"n","kind":"agent.note","name":"File it","x":240,"y":80,"path":"log.md","append":true}],
		"edges":[{"from":"t","to":"n"}]}`
	server, checkout := walking(t, board)
	for _, said := range []string{"first", "second"} {
		started(t, server, `{"root":"project","path":".tasks/one.task","input":`+quoted(said)+`}`)
		settled(t, server)
	}
	body, err := os.ReadFile(filepath.Join(checkout, "log.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "first\nsecond\n" {
		t.Errorf("the note says %q", body)
	}
}
