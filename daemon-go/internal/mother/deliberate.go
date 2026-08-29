// The expensive pass, spent only past the gate: one non-interactive Claude Code errand — scrubbed
// env, a timeout, Mother's soul appended — that reads the moment and either writes the suggestion
// or declines to.
//
// NOTHING is the content-level second gate, and it is the expected answer.

package mother

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/terminal"
)

// Soul is the voice Mother deliberates in. Built into the daemon the way the default soul is, and
// yielding the same way: a project carrying `.personas/mother/PERSONA.md` speaks instead.
const Soul = `You are Mother, the overseer that ships with broodmother. You watch everything flowing through the project — task runs, agents, sync, the records — and, rarely and well, suggest the next thing worth doing.

You are deciding whether one observation is worth interrupting the person for. The bar is high: a wrong interruption costs more trust than five right ones earn, and silence is almost always acceptable. Say NOTHING unless a person who saw what you saw would genuinely want to be told now.

You observe and suggest; you do not act. No edits, no runs started, nothing sent. A suggestion names the thing and what to do about it, in one or two plain sentences.`

const (
	deliberateFor = 3 * time.Minute
	// anchorChars is enough of an anchor to deliberate on; a document longer than this is its
	// opening.
	anchorChars = 8000
)

// Ask is one observation put to the deliberation: the rule that noticed it, its evidence, and the
// document it is anchored on, where it is anchored on one.
type Ask struct {
	Rule     string
	Ref      *doc.Ref
	Evidence string
}

// Finding is a durable observation the deliberation wants written down, the keys a `finding` needs.
type Finding struct {
	Name     string
	Claim    string
	Evidence string
}

// Said is what came back. Say is what to show the person, or empty where the deliberation found
// nothing worth saying.
type Said struct {
	Say     string
	Finding *Finding
}

// DeliberateDeps is what the errand runs with.
type DeliberateDeps struct {
	// Cwd is where it runs: the project checkout.
	Cwd func() string
	// Persona is the project's own `.personas/mother/PERSONA.md`, where it carries one.
	Persona func() string
	// Brief is the standing brief every agent opens with.
	Brief func() string
	Env   func() map[string]string
	// Anchor is the anchored document's content, or empty where it cannot be read.
	Anchor func(ref doc.Ref) string
	// Claude is how Claude Code is invoked. A test hands in a script; the app has it on PATH.
	Claude  string
	Timeout time.Duration
}

// Deliberator is the pass itself.
type Deliberator func(ctx context.Context, ask Ask) (Said, error)

func NewDeliberator(deps DeliberateDeps) Deliberator {
	return func(ctx context.Context, ask Ask) (Said, error) {
		anchored := ""
		if ask.Ref != nil && deps.Anchor != nil {
			anchored = deps.Anchor(*ask.Ref)
		}
		system := strings.Join(nonEmpty(Soul, called(deps.Brief), called(deps.Persona)), "\n\n")

		timeout := deps.Timeout
		if timeout <= 0 {
			timeout = deliberateFor
		}
		within, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()

		name := deps.Claude
		if name == "" {
			name = "claude"
		}
		held := exec.CommandContext(within, name, prompt(ask, anchored, system)...)
		held.Dir = called(deps.Cwd)
		env := terminal.Ambient()
		if deps.Env != nil {
			for key, value := range deps.Env() {
				env = append(env, key+"="+value)
			}
		}
		held.Env = env
		var out, errs bytes.Buffer
		held.Stdout = &out
		held.Stderr = &errs

		if err := held.Run(); err != nil {
			said := strings.TrimSpace(errs.String())
			if said == "" {
				said = strings.TrimSpace(out.String())
			}
			if said == "" {
				said = "claude failed"
			}
			return Said{}, apperr.Chatf("%s", said)
		}
		return ParseDeliberation(out.String()), nil
	}
}

func prompt(ask Ask, anchored, system string) []string {
	lines := []string{`An observation from the "` + ask.Rule + `" watch: ` + ask.Evidence}
	if ask.Ref != nil {
		lines = append(lines, "It is anchored on "+string(ask.Ref.Root)+":"+string(ask.Ref.Path)+".")
	}
	if anchored != "" {
		lines = append(lines, "The document it is about begins:\n---\n"+cutAt(anchored, anchorChars)+"\n---")
	}
	lines = append(lines,
		"Decide whether this is worth interrupting the person for, and look around the checkout first where that would settle it.",
		"Answer with exactly the word NOTHING if it is not.",
		"Otherwise answer with one line of JSON and nothing else:",
		`{"say": "<one or two sentences naming the thing and what to do about it>", "finding": {"name": "...", "claim": "...", "evidence": "..."}}`,
		`Include "finding" only where something durable about the project was learned — a fact worth keeping after the popup is gone. Leave it out otherwise.`)
	return []string{
		"-p", strings.Join(lines, "\n\n"),
		"--append-system-prompt", system,
		"--permission-mode", "acceptEdits",
	}
}

// nothing is NOTHING however it is dressed.
var nothing = regexp.MustCompile(`^NOTHING\b`)

// jsonIn is the object in an answer that was asked for one line of JSON and gave a paragraph too.
var jsonIn = regexp.MustCompile(`(?s)\{.*\}`)

// ParseDeliberation is what the errand answered, read generously: NOTHING however it is dressed,
// the JSON it was asked for, or — from a model that answered in prose anyway — the prose as the
// say.
func ParseDeliberation(stdout string) Said {
	text := strings.TrimSpace(stdout)
	if text == "" || nothing.MatchString(text) {
		return Said{}
	}
	if held := jsonIn.FindString(text); held != "" {
		var raw struct {
			Say     string `json:"say"`
			Finding *struct {
				Name     string `json:"name"`
				Claim    string `json:"claim"`
				Evidence string `json:"evidence"`
			} `json:"finding"`
		}
		if json.Unmarshal([]byte(held), &raw) == nil {
			say := strings.TrimSpace(raw.Say)
			finding := findingOf(raw.Finding)
			if say != "" || finding != nil {
				return Said{Say: say, Finding: finding}
			}
		}
		// Not the JSON it was asked for; the text itself is the answer.
	}
	return Said{Say: text}
}

func findingOf(raw *struct {
	Name     string `json:"name"`
	Claim    string `json:"claim"`
	Evidence string `json:"evidence"`
}) *Finding {
	if raw == nil {
		return nil
	}
	name, claim, evidence := strings.TrimSpace(raw.Name), strings.TrimSpace(raw.Claim), strings.TrimSpace(raw.Evidence)
	if name == "" || claim == "" || evidence == "" {
		return nil
	}
	return &Finding{Name: name, Claim: claim, Evidence: evidence}
}

func called(held func() string) string {
	if held == nil {
		return ""
	}
	return held()
}

func nonEmpty(parts ...string) []string {
	held := []string{}
	for _, one := range parts {
		if strings.TrimSpace(one) != "" {
			held = append(held, one)
		}
	}
	return held
}

func cutAt(text string, at int) string {
	if len(text) <= at {
		return text
	}
	return text[:at]
}
