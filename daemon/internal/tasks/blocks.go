// The kinds of step there are, and what running each of them does.
//
// A new kind is one function here, one entry in [blocks], a node kind in `internal/task`, and an
// entry in the web editor's own table.

package tasks

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
)

// stepMinutes is long enough for a real errand, short enough that a stuck agent ends the step
// rather than the day — unless the node itself asks for longer.
const stepMinutes = 5

func timeoutOf(node task.Node) time.Duration {
	minutes := float64(stepMinutes)
	if node.Minutes != nil {
		minutes = *node.Minutes
	}
	return time.Duration(minutes * float64(time.Minute))
}

// blocks is every kind a step can be. A node kind that is not here is a trigger.
var blocks = map[task.Kind]block{
	task.ShellAgent:   runShell,
	task.ClaudeAgent:  runClaude,
	task.MuseAgent:    runMuse,
	task.ApproveAgent: runApprove,
	task.NotifyAgent:  runNotify,
	task.HTTPAgent:    runHTTP,
	task.GateAgent:    runGate,
	task.NoteAgent:    runNote,

	task.GithubCommentAgent: runGithubComment,
	task.GithubPullAgent:    runGithubPull,
}

// process is what the three blocks that start one have in common: the checkout as the working
// directory, upstream output on stdin, the flow env, and the run's cancellation.
func process(ctx stepCtx, node task.Node, name string, args []string) (stepResult, error) {
	within, cancel := context.WithTimeout(ctx.ctx, timeoutOf(node))
	defer cancel()

	command := exec.CommandContext(within, name, args...)
	command.Dir = ctx.cwd
	command.Env = environ(ctx)
	command.Stdin = strings.NewReader(ctx.input)
	var out, errs bytes.Buffer
	command.Stdout = &out
	command.Stderr = &errs

	if err := command.Run(); err != nil {
		return stepResult{}, apperr.Taskf("%s", said(out.String(), errs.String(), name+" failed"))
	}
	return finish(ctx, out.String())
}

// said is what a process that failed is reported as: what it complained, or what it printed, or
// the bare fact that it did.
func said(out, errs, fallback string) string {
	if held := strings.TrimSpace(errs); held != "" {
		return held
	}
	if held := strings.TrimSpace(out); held != "" {
		return held
	}
	return fallback
}

// runShell is one shell step: the node's command under `sh -c` in the checkout, upstream output
// on stdin, stdout onward — the workhorse for git, gh, curl and their kin. It gets the same flow
// env an agent does, so a script can write its own hand-off and verdict too.
func runShell(node task.Node, ctx stepCtx) (stepResult, error) {
	return process(ctx, node, "/bin/sh", []string{"-c", node.Command})
}

// runClaude is one Claude Code errand: the node's prompt as the ask, the flow protocol appended,
// run from the checkout the task lives in. Non-interactive `-p` has nobody to answer permission
// prompts — anything short of a grant is a denial — so the session gets what the contract needs
// and no more: edits in its workspace, with the run's scratch folder added so the hand-off files
// are in reach.
func runClaude(node task.Node, ctx stepCtx) (stepResult, error) {
	args := []string{"-p", node.Prompt + "\n\n" + protocol(ctx)}
	if system := system(ctx); system != "" {
		args = append(args, "--append-system-prompt", system)
	}
	args = append(args, "--permission-mode", "acceptEdits")
	if ctx.files.output != "" {
		args = append(args, "--add-dir", filepath.Dir(ctx.files.output))
	}
	held, err := process(ctx, node, "claude", args)
	if err != nil {
		return stepResult{}, apperr.Taskf("%s%s", err.Error(), loginHint(err.Error()))
	}
	return held, nil
}

// notLoggedIn is the shape of every way claude says the one thing worth a hint.
var notLoggedIn = regexp.MustCompile(`(?i)not logged in|no.*api.*key|auth`)

func loginHint(details string) string {
	if !notLoggedIn.MatchString(details) {
		return ""
	}
	return " — Claude not logged in: set ANTHROPIC_API_KEY or run `claude auth login`" +
		" (if keychain is locked, run `security unlock-keychain ~/Library/Keychains/login.keychain-db`)"
}

// runMuse is the same errand run by muse. `muse exec` runs the prompt to completion headlessly,
// speaking the same flow protocol claude speaks. Muse has no `--append-system-prompt`, so the
// persona rides ahead of the ask instead — the same content, a different channel.
func runMuse(node task.Node, ctx stepCtx) (stepResult, error) {
	ask := node.Prompt + "\n\n" + protocol(ctx)
	if system := system(ctx); system != "" {
		ask = system + "\n\n" + ask
	}
	return process(ctx, node, "muse", []string{"exec", "--yolo", ask})
}

// system is what an agent step is told before the errand: where it is standing, then who it is.
func system(ctx stepCtx) string {
	said := []string{}
	if ctx.brief != "" {
		said = append(said, ctx.brief)
	}
	if ctx.persona != "" {
		said = append(said, ctx.persona)
	}
	return strings.Join(said, "\n\n")
}

// protocol is the flow's side of the prompt: where the context is, where the hand-off goes, and —
// only where there is a real choice — how to pick a path or stop the run. The paths are spelled
// out literally because the model cannot expand an env var without a shell.
func protocol(ctx stepCtx) string {
	lines := []string{"You are one step of an automated flow."}
	if ctx.files.input != "" {
		lines = append(lines, "Your input context is the file at "+ctx.files.input+".")
	}
	if ctx.files.output == "" {
		return strings.Join(append(lines,
			"Your final message is the context handed to the next step."), "\n")
	}
	lines = append(lines, "Write the context the next step will need to the file at "+ctx.files.output+".")
	if len(ctx.routes) > 1 {
		named := make([]string, 0, len(ctx.routes))
		for _, route := range ctx.routes {
			named = append(named, `"`+route+`"`)
		}
		lines = append(lines, "This step has "+strconv.Itoa(len(ctx.routes))+" paths onward: "+
			strings.Join(named, ", ")+`. To follow only some of them, write {"next": ["<path name>", ...]}`+
			" to the file at "+ctx.files.verdict+".")
	}
	return strings.Join(append(lines,
		`To stop the flow deliberately, write {"stop": "<reason>"} to the file at `+ctx.files.verdict+"."), "\n")
}

// runApprove stops and waits for a person. The block itself does nothing but say what it is
// waiting to be told — the run pausing at it, keeping its place, and picking back up when the
// answer comes are the walk's, because they are what a run being resumable is for.
func runApprove(node task.Node, ctx stepCtx) (stepResult, error) {
	asked := ""
	if node.Question != nil {
		asked = strings.TrimSpace(*node.Question)
	}
	if asked == "" {
		asked = node.Name
	}
	return stepResult{output: ctx.input, hold: asked}, nil
}

// runNotify tells you. The node's name is the title and whatever reached it is the body, so a
// step whose whole job is getting your attention has nothing to configure — and it hands its
// input straight on, so it stands mid-chain rather than only at the end of one.
func runNotify(node task.Node, ctx stepCtx) (stepResult, error) {
	ctx.notify(node.Name, ctx.input)
	return stepResult{output: ctx.input}, nil
}

// runGate ran either way; a miss keeps no route, so the branch beyond it goes quiet.
func runGate(node task.Node, ctx stepCtx) (stepResult, error) {
	pattern, err := regexp.Compile(node.Pattern)
	if err != nil {
		return stepResult{}, apperr.Taskf("%s", err.Error())
	}
	if pattern.MatchString(ctx.input) {
		return stepResult{output: ctx.input}, nil
	}
	return stepResult{output: "", next: []string{}, chose: true}, nil
}

// runNote writes what fed it into the project, and passes the same context onward untouched.
func runNote(node task.Node, ctx stepCtx) (stepResult, error) {
	if ctx.project == nil {
		return stepResult{}, apperr.Taskf("no project to write the note into")
	}
	if strings.TrimSpace(node.Path) == "" {
		return stepResult{}, apperr.Taskf("the note has no path yet — name one in its options")
	}
	body := ""
	if ctx.input != "" {
		body = ctx.input + "\n"
	}
	had := ""
	if node.Append != nil && *node.Append {
		had, _ = ctx.project.Read(node.Path)
	}
	if _, err := ctx.project.Write(node.Path, had+body); err != nil {
		return stepResult{}, err
	}
	return stepResult{output: ctx.input}, nil
}

// runHTTP is the escape hatch: the step's input to a URL, the response onward. A Discord webhook,
// a Zapier hook, something internal — everything with an address and no folder of its own here
// works through this rather than waiting for one.
//
// A non-2xx is a step error wearing the status, because a webhook that answered 401 did not do
// what the step was for and a run that carried on regardless would say it had.
func runHTTP(node task.Node, ctx stepCtx) (stepResult, error) {
	if strings.TrimSpace(node.URL) == "" {
		return stepResult{}, apperr.Taskf("the call has no URL yet — name one in its options")
	}
	// Unset is POST: the step has something to say, and saying it is what this is for.
	method := http.MethodPost
	if node.Method != nil {
		method = string(*node.Method)
	}

	within, cancel := context.WithTimeout(ctx.ctx, timeoutOf(node))
	defer cancel()
	// A body on a GET is the one verb here that is asking rather than telling.
	var body io.Reader
	if method != http.MethodGet {
		body = strings.NewReader(ctx.input)
	}
	request, err := http.NewRequestWithContext(within, method, node.URL, body)
	if err != nil {
		return stepResult{}, apperr.Taskf("%s", err.Error())
	}
	// The one header a node may carry, written the way it goes on the wire.
	if node.Header != nil {
		if name, value, found := strings.Cut(*node.Header, ":"); found && strings.TrimSpace(name) != "" {
			request.Header.Set(strings.TrimSpace(name), strings.TrimSpace(value))
		}
	}

	answer, err := http.DefaultClient.Do(request)
	if err != nil {
		return stepResult{}, apperr.Taskf("%s", err.Error())
	}
	defer answer.Body.Close()
	raw, _ := io.ReadAll(answer.Body)
	if answer.StatusCode < 200 || answer.StatusCode > 299 {
		if len(raw) > 0 {
			return stepResult{}, apperr.Taskf("%s: %s", answer.Status, raw)
		}
		return stepResult{}, apperr.Taskf("%s", answer.Status)
	}
	return stepResult{output: string(raw)}, nil
}
