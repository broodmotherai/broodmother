// What an agent can do: everything the chat can, and three more that the chat has not got — a
// shell in the checkout, Claude Code in it, and a way to say something to a colleague.
//
// The chat is a conversation about a folder of markdown; an agent is somebody you hand work to,
// and hands are what work takes.
//
// Expected failures come back as text rather than thrown, the way the chat's do: the brain reads
// "command failed: …" and tells you, where an exception ends the turn mid-sentence.

package tools

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apicall"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/errand"
	"github.com/broodmotherai/broodmother/daemon-go/internal/llm"
	"github.com/broodmotherai/broodmother/daemon-go/internal/terminal"
)

const (
	// claudeMinutes is how long an errand handed to Claude Code may take before it is a stuck one.
	// Longer than a task step's five: an agent is given afternoons, not commands.
	claudeMinutes = 20
	// shellMinutes: a shell command is a quick thing; past this it is a job for `claude_code`.
	shellMinutes = 5
)

// AgentDeps is what an agent's hands work with, beyond what the chat's tools already have.
type AgentDeps struct {
	Deps
	// Checkout is where the hands work, asked each call.
	Checkout func() string
	// Env is what the hands run with, beyond the ambient environment: `CLAUDE_CONFIG_DIR`, a key.
	Env func() map[string]string
	// Brief is what Claude Code is told about the app — the terminal brief, since it has a shell.
	Brief func() string
	// Persona is the persona's body, which Claude Code wears too, so what it writes sounds like
	// them.
	Persona string
	// Name is the agent's, so the errand knows whose it is.
	Name string
	// Attachments is where deliverables go, absolute.
	Attachments string
	// Progress is a word on how an errand is going, filed by the tool call it belongs to, for the
	// step on screen to wear while the hands are busy.
	Progress func(call, note string)
	// Message says something to another agent, by the name their colleague knows them by. Answers
	// with what became of it — delivered, or why not.
	Message func(to, message string) string
	// NoteErrand is what an errand left different, for the ledger: the paths the checkout says
	// changed either side of it, and the errand in its own first line.
	NoteErrand func(paths []doc.Path, note string)
	// Claude is how Claude Code is invoked. A test hands in a script; the app has `claude` on PATH.
	Claude string
	// Marks and Changed are how the checkout is looked at either side of an errand. Injected so a
	// test can watch a directory it controls rather than a real one.
	Marks   func(checkout string) errand.Marks
	Changed func(before, after errand.Marks) []doc.Path
}

// Agent is the chat's tools, plus the hands.
func Agent(deps AgentDeps) []llm.Tool {
	return append(Chat(deps.Deps),
		llm.Tool{
			Name: "claude_code",
			Description: "Hand a task to Claude Code, running in the checkout with the whole disk and a " +
				"shell. Use it for anything that reads or changes files, writes code or prose, " +
				"researches across the project, or takes more than one command. Write the task " +
				"the way you would brief a capable colleague: the goal, what matters, where the " +
				"result should go. It answers with what it did.",
			Schema: object(map[string]any{
				"task":    field("string", "the errand, in full"),
				"minutes": minutesField(claudeMinutes, 120),
			}, "task"),
			Run: func(ctx context.Context, call string, input json.RawMessage) string {
				var said struct {
					Task    string `json:"task"`
					Minutes int    `json:"minutes"`
				}
				if err := json.Unmarshal(input, &said); err != nil {
					return failed(err)
				}
				return watching(deps, firstLine(said.Task, noteMax), func() string {
					return runClaude(ctx, deps, said.Task, said.Minutes, call)
				})
			},
		},
		llm.Tool{
			Name: "shell",
			Description: "Run one shell command in the checkout — ls, git status, grep, a script. Quick " +
				"things; anything longer than a command is a task for claude_code. Answers with " +
				"stdout and stderr.",
			Schema: object(map[string]any{
				"command": field("string", "the command, as you would type it"),
				"minutes": minutesField(shellMinutes, 60),
			}, "command"),
			Run: func(ctx context.Context, _ string, input json.RawMessage) string {
				var said struct {
					Command string `json:"command"`
					Minutes int    `json:"minutes"`
				}
				if err := json.Unmarshal(input, &said); err != nil {
					return failed(err)
				}
				return watching(deps, firstLine(said.Command, noteMax), func() string {
					return runShell(ctx, deps, said.Command, said.Minutes)
				})
			},
		},
		llm.Tool{
			Name: "agent_message",
			Description: "Say something to another agent in this project, by name. Use it to ask a colleague " +
				"for the part of a job that is theirs rather than yours — their part of the " +
				"project, their persona's trade. It lands in their thread and they answer it as a " +
				"turn of their own, so their answer comes back to you here in a while rather than " +
				"at once: say what you asked for and carry on, do not wait.",
			Schema: object(map[string]any{
				"to": field("string", "who, by the name you know them by"),
				"message": field("string",
					"what you are asking for, written the way you would message a colleague"),
			}, "to", "message"),
			Run: func(_ context.Context, _ string, input json.RawMessage) string {
				var said struct{ To, Message string }
				if err := json.Unmarshal(input, &said); err != nil {
					return failed(err)
				}
				if deps.Message == nil {
					return "there is nobody else in this project"
				}
				return deps.Message(said.To, said.Message)
			},
		},
		llm.Tool{
			Name:        "list_attachments",
			Description: "What is in your attachments folder — everything you have made so far, by name.",
			Schema:      object(map[string]any{}),
			Run: func(context.Context, string, json.RawMessage) string {
				entries, err := os.ReadDir(deps.Attachments)
				if err != nil || len(entries) == 0 {
					return "nothing yet in " + deps.Attachments
				}
				names := make([]string, 0, len(entries))
				for _, one := range entries {
					names = append(names, one.Name())
				}
				slices.Sort(names)
				return strings.Join(names, "\n")
			},
		},
	)
}

func minutesField(unsaid, most int) map[string]any {
	return map[string]any{
		"type": "integer", "minimum": 1, "maximum": most,
		"description": "how long it may take; unsaid is " + strconv.Itoa(unsaid),
	}
}

// watching runs an errand with the checkout watched either side of it. What it changed is filed as
// one act per path, all naming the same errand.
//
// Nothing is filed where nothing differs, and a failed errand is watched like any other — a command
// that fell over halfway still changed what it changed.
func watching(deps AgentDeps, note string, errand func() string) string {
	if deps.NoteErrand == nil || deps.Marks == nil || deps.Changed == nil {
		return errand()
	}
	checkout := deps.Checkout()
	before := deps.Marks(checkout)
	said := errand()
	if changed := deps.Changed(before, deps.Marks(checkout)); len(changed) > 0 {
		deps.NoteErrand(changed, note)
	}
	return said
}

func environ(deps AgentDeps) []string {
	held := terminal.Ambient()
	if deps.Env != nil {
		for key, value := range deps.Env() {
			held = append(held, key+"="+value)
		}
	}
	return held
}

func runShell(ctx context.Context, deps AgentDeps, command string, minutes int) string {
	if minutes <= 0 {
		minutes = shellMinutes
	}
	within, cancel := context.WithTimeout(ctx, time.Duration(minutes)*time.Minute)
	defer cancel()

	held := exec.CommandContext(within, "/bin/sh", "-c", command)
	held.Dir = deps.Checkout()
	held.Env = environ(deps)
	held.Stdin = strings.NewReader("")
	var out, errs bytes.Buffer
	held.Stdout = &out
	held.Stderr = &errs

	err := held.Run()
	said := strings.Join(nonEmpty(out.String(), errs.String()), "\n")
	if err != nil {
		what := strings.TrimSpace(said)
		if what == "" {
			what = "no output"
		}
		return apicall.Cut("command failed (exit " + exitOf(held) + "): " + what)
	}
	if said == "" {
		return "(no output)"
	}
	return apicall.Cut(said)
}

func exitOf(held *exec.Cmd) string {
	if held.ProcessState == nil {
		return "?"
	}
	return strconv.Itoa(held.ProcessState.ExitCode())
}

func nonEmpty(parts ...string) []string {
	held := []string{}
	for _, one := range parts {
		if one != "" {
			held = append(held, one)
		}
	}
	return held
}

// runClaude is one Claude Code errand, headless, in the checkout — the shape of a task's Claude
// step, with two differences. It wears the agent's persona rather than a node's, so what it writes
// sounds like the person you asked; and it is watched as it goes: `stream-json` says what the
// session is doing line by line, and the last thing said becomes the note the step on screen wears,
// so a twenty-minute errand is not twenty minutes of a spinner.
func runClaude(ctx context.Context, deps AgentDeps, task string, minutes int, call string) string {
	if minutes <= 0 {
		minutes = claudeMinutes
	}
	within, cancel := context.WithTimeout(ctx, time.Duration(minutes)*time.Minute)
	defer cancel()

	system := strings.Join(nonEmpty(
		briefOf(deps),
		"## Whose errand this is\n\nYou are the hands of "+deps.Name+", an agent in this project who was asked to do this in\n"+
			"a chat and handed it to you. Do it fully. Anything you make — a report, a draft, an\n"+
			"export, a script — goes in "+deps.Attachments+" unless the task says otherwise; make the\n"+
			"folder if it is not there. Edits to documents that already exist stay where they are. If you\n"+
			"find work in this checkout that the errand did not ask for and somebody else plainly did,\n"+
			"leave it alone and say so in what you report back: everything this errand touches is filed as\n"+
			deps.Name+"'s. When you are done, say in a few lines what you did and where it is: that is\n"+
			"what "+deps.Name+" reads back to the person who asked.",
		personaOf(deps),
	), "\n\n")

	name := deps.Claude
	if name == "" {
		name = "claude"
	}
	held := exec.CommandContext(within, name,
		"-p", task,
		"--append-system-prompt", system,
		"--permission-mode", "acceptEdits",
		"--output-format", "stream-json",
		"--verbose")
	held.Dir = deps.Checkout()
	held.Env = environ(deps)
	held.Stdin = strings.NewReader("")
	var errs bytes.Buffer
	held.Stderr = &errs
	// Errors ride out on stderr; the lines are stdout's, and reading only those keeps a warning
	// printed mid-run from being parsed as one.
	out, err := held.StdoutPipe()
	if err != nil {
		return apicall.Cut("claude failed: " + err.Error())
	}
	if err := held.Start(); err != nil {
		return apicall.Cut("claude failed: " + err.Error())
	}

	var result, failure *string
	stray := []string{}
	scanner := bufio.NewScanner(out)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		event, ok := eventOf(line)
		if !ok {
			if strings.TrimSpace(line) != "" {
				stray = append(stray, line)
			}
			continue
		}
		switch event.Type {
		case "assistant":
			if note := noteOf(event); note != "" && deps.Progress != nil {
				deps.Progress(call, note)
			}
		case "result":
			said := event.Result
			if event.IsError {
				failure = &said
			} else {
				result = &said
			}
		}
	}
	held.Wait()

	if failure != nil {
		what := *failure
		if what == "" {
			what = "claude failed"
		}
		return apicall.Cut("claude failed: " + what)
	}
	if result != nil {
		if *result == "" {
			return "(claude said nothing)"
		}
		return apicall.Cut(*result)
	}
	// No result line at all: the session did not get as far as answering.
	details := strings.TrimSpace(errs.String())
	if details == "" {
		details = strings.TrimSpace(strings.Join(stray, "\n"))
	}
	if details == "" {
		details = "claude failed"
	}
	return apicall.Cut("claude failed: " + details + loginHint(details))
}

func briefOf(deps AgentDeps) string {
	if deps.Brief == nil {
		return ""
	}
	return deps.Brief()
}

func personaOf(deps AgentDeps) string {
	if strings.TrimSpace(deps.Persona) == "" {
		return ""
	}
	return "## Who " + deps.Name + " is\n\n" + deps.Persona
}

// streamEvent is the sliver of Claude Code's stream-json this reads.
type streamEvent struct {
	Type    string `json:"type"`
	IsError bool   `json:"is_error"`
	Result  string `json:"result"`
	Message struct {
		Content []struct {
			Type  string         `json:"type"`
			Text  string         `json:"text"`
			Name  string         `json:"name"`
			Input map[string]any `json:"input"`
		} `json:"content"`
	} `json:"message"`
}

func eventOf(line string) (streamEvent, bool) {
	var held streamEvent
	if json.Unmarshal([]byte(line), &held) != nil || held.Type == "" {
		return streamEvent{}, false
	}
	return held, true
}

// noteOf is what the session is doing, in a few words: the last thing it said, or the tool it
// reached for and what with.
func noteOf(event streamEvent) string {
	content := event.Message.Content
	for at := len(content) - 1; at >= 0; at-- {
		part := content[at]
		if part.Type == "tool_use" && part.Name != "" {
			what := ""
			for _, key := range []string{"command", "file_path", "pattern", "description"} {
				held, said := part.Input[key].(string)
				if !said || held == "" {
					continue
				}
				if key == "file_path" {
					held = filepath.Base(held)
				}
				what = " " + held
				break
			}
			return firstLine(part.Name+what, noteMax)
		}
		if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
			return firstLine(part.Text, noteMax)
		}
	}
	return ""
}

// notLoggedIn is the shape of every way claude says the one thing worth a hint.
var notLoggedIn = regexp.MustCompile(`(?i)not logged in|no.*api.*key|auth`)

// loginHint is the one thing worth saying about a claude that would not start.
func loginHint(details string) string {
	if !notLoggedIn.MatchString(details) {
		return ""
	}
	return " — Claude not logged in: set ANTHROPIC_API_KEY or run `claude auth login`"
}

func failed(err error) string {
	encoded, _ := json.Marshal(err.Error())
	return `{"error": ` + string(encoded) + `}`
}
