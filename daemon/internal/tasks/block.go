// The block contract. A step is handed one file of context and owes one file back: the walk
// writes what fed it to `input` before the block runs, and whatever the block answers lands in
// `output` after — the file is the only channel between steps, and everything else a block needs
// it finds in the checkout it runs in. A block that runs a process passes the three paths on in
// `TASK_INPUT`, `TASK_OUTPUT` and `TASK_VERDICT`, so the process can write its own hand-off and
// its own decision.

package tasks

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/tree"
)

// stepCtx is everything one step is given.
type stepCtx struct {
	// cwd is the checkout the task lives in — every step's working directory.
	cwd string
	// project is where `agent.note` writes: notes are a project idea, wherever the task lives.
	project *tree.Tree
	// input is what upstream produced — the contents of the step's input file.
	input string
	files files
	// routes are where the step's outgoing edges lead, by node name — the paths a verdict may
	// pick.
	routes []string
	env    map[string]string
	// brief is the standing brief every agent step opens with — the same one the terminals get —
	// and persona is what this step in particular is told about itself. Both join the system
	// prompt, in that order.
	brief   string
	persona string
	// scratch is the run's folder, for the one file that belongs to the run rather than to a step.
	scratch string
	// reaches are the services this step can reach, as this checkout is connected to them.
	reaches Reaches
	// ctx is cancelled when the run is stopped. A block that starts a process hands it on, so
	// stopping reaches the work and not just the row that describes it.
	ctx context.Context
	// notify puts something in front of whoever has the app open. It leaves as soon as it is
	// said and nothing waits on it — a page nobody is looking at is not a failed step.
	notify func(title, body string)
}

type stepResult struct {
	output string
	// next is which of ctx.routes to keep. An empty but present list ends every branch quietly;
	// absent keeps them all, which is why it carries its own said.
	next  []string
	chose bool
	// stop is a deliberate halt and its reason: the step is stopped, and the run still finishes.
	stop   string
	halted bool
	// hold is what the step is waiting on somebody to answer. The run pauses here and keeps its
	// place; answering it sends the walk back in.
	hold string
}

// flowEnv are the three paths a process block hands its process, named for the flow they serve.
func flowEnv(ctx stepCtx) map[string]string {
	return map[string]string{
		"TASK_INPUT":   ctx.files.input,
		"TASK_OUTPUT":  ctx.files.output,
		"TASK_VERDICT": ctx.files.verdict,
	}
}

// finish is what a process block ends on: the out-file it was asked to write, or failing that
// what it printed — and its verdict, where it left one.
func finish(ctx stepCtx, said string) (stepResult, error) {
	held := stepResult{output: said}
	if body, found := readFile(ctx.files.output); found {
		held.output = body
	}
	verdict, found := readFile(ctx.files.verdict)
	if !found {
		return held, nil
	}
	next, chose, stop, halted, err := parseVerdict(verdict)
	if err != nil {
		return stepResult{}, err
	}
	held.next, held.chose, held.stop, held.halted = next, chose, stop, halted
	return held, nil
}

// parseVerdict: a verdict is small JSON with everything at stake, so a malformed one is a step
// error rather than a shrug — silently following every path is the one wrong default.
func parseVerdict(text string) (next []string, chose bool, stop string, halted bool, err error) {
	var anything any
	if json.Unmarshal([]byte(text), &anything) != nil {
		return nil, false, "", false, apperr.Taskf("the verdict is not JSON")
	}
	var held map[string]json.RawMessage
	if json.Unmarshal([]byte(text), &held) != nil || held == nil {
		return nil, false, "", false, apperr.Taskf(`a verdict is an object with "next" or "stop"`)
	}
	if raw, said := held["stop"]; said {
		if json.Unmarshal(raw, &stop) != nil {
			return nil, false, "", false, apperr.Taskf(`a verdict "stop" is the reason, a string`)
		}
		halted = true
	}
	if raw, said := held["next"]; said {
		if json.Unmarshal(raw, &next) != nil {
			return nil, false, "", false, apperr.Taskf(`a verdict "next" is a list of path names`)
		}
		if next == nil {
			next = []string{}
		}
		chose = true
	}
	return next, chose, stop, halted, nil
}

// inherited are the variables a session of this app sets in its own children. A server started
// from inside a Claude session would otherwise hand every task a parent it never had.
var inherited = []string{
	"CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT",
	"ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL",
}

// environ is what a step's process starts from: this process's environment scrubbed of those,
// with the step's own written over it.
func environ(ctx stepCtx) []string {
	full := make([]string, 0, len(os.Environ()))
	for _, one := range os.Environ() {
		name, _, _ := strings.Cut(one, "=")
		if !slices.Contains(inherited, name) {
			full = append(full, one)
		}
	}
	for key, value := range ctx.env {
		full = append(full, key+"="+value)
	}
	for key, value := range flowEnv(ctx) {
		full = append(full, key+"="+value)
	}
	return full
}

// block is one kind of step, and what running it does.
type block func(node task.Node, ctx stepCtx) (stepResult, error)
