// Package llm is what answers a conversation, and the one place that knows a provider exists.
//
// Every model names its provider and every provider is a case in [Stream], so a second one is a
// file beside this and a branch. Putting them all behind a single gateway instead would be that
// function and nothing else in the app.
//
// A turn is not one request. The model asks for tools, the tools answer, and it is asked again
// with what they said — so a turn is a loop, bounded by the rounds it is allowed, and what comes
// out of it is a stream of parts rather than an answer.
package llm

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/chat"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
)

// Message is one turn of the conversation as the model is handed it.
type Message struct {
	Role string
	Text string
}

// Tool is one thing the model may ask for: what it is called, when to reach for it, and the JSON
// schema of what it takes.
type Tool struct {
	Name        string
	Description string
	// Schema is the JSON Schema object for the tool's input, as the provider wants it.
	Schema map[string]any
	// Run answers the call. Expected failures come back as text rather than as an error: a model
	// reads "no such document" and tries something else, where an error ends the turn.
	Run func(ctx context.Context, id string, input json.RawMessage) string
}

// Ask is one turn: who is speaking, what has been said, and how far they may reach.
type Ask struct {
	Model    string
	Messages []Message
	System   string
	Tools    []Tool
	// Rounds is how many times the turn may answer itself. Zero is [constants.MaxRounds]; an agent
	// delegating gets more, since an errand is several deep.
	Rounds int
	// Title is how each call reads on its step's row. Held by whoever built the tools, since only
	// they know what the arguments mean.
	Title Titler
}

// PartKind is what came out of a turn.
type PartKind string

const (
	// TextPart is the answer as it is written.
	TextPart PartKind = "text"
	// StepPart is something the turn did to write it.
	StepPart PartKind = "step"
	// BreakPart is where one message ends and the next begins — what a person typing does between
	// "on it" and the report. The words before it are a message of their own, and what follows
	// starts one.
	BreakPart PartKind = "break"
)

type Part struct {
	Kind PartKind
	Text string
	Step chat.Step
}

// Credential is what the profile holds for a provider, or empty where it holds none.
type Credential func(provider string) string

// Streamer is what answers a conversation. The service asks for one of these and knows nothing
// about who serves it — which is what makes the model a choice rather than a fact about the app.
type Streamer interface {
	Stream(ctx context.Context, ask Ask, part func(Part)) error
}

type streamer struct {
	credential Credential
	io         IO
}

func New(credential Credential, io IO) Streamer {
	if io == nil {
		io = post
	}
	return streamer{credential: credential, io: io}
}

// Stream runs the turn and hands each part on as it arrives. It answers when the model stops
// asking for tools, when the rounds run out, or when the context is cancelled — which is somebody
// pressing stop, and what has arrived by then is theirs to keep.
func (s streamer) Stream(ctx context.Context, ask Ask, part func(Part)) error {
	provider := chat.ProviderOf(ask.Model)
	if provider == "" {
		return apperr.Chatf("no such model: %s", ask.Model)
	}
	key := s.credential(provider)
	if key == "" {
		return apperr.Chatf("%s is not connected — add a key in Settings", labelOf(provider))
	}
	rounds := ask.Rounds
	if rounds <= 0 {
		rounds = constants.MaxRounds
	}

	// Not a default: a provider added to the list and not to this switch is a model that would
	// quietly answer as somebody else.
	switch provider {
	case "anthropic":
		return anthropic{key: key, io: s.io}.run(ctx, ask, rounds, part)
	}
	return apperr.Chatf("nothing here speaks to %s", provider)
}

func labelOf(provider string) string {
	for _, one := range chat.Providers {
		if one.ID == provider {
			return one.Label
		}
	}
	return provider
}

// Turns is the conversation as the model is handed it: messages said back to back by one side are
// one turn. An agent's "on it" and its report are two bubbles and one answer, and a provider is
// owed turns that alternate.
func Turns(messages []Message) []Message {
	made := []Message{}
	for _, one := range messages {
		if len(made) > 0 && made[len(made)-1].Role == one.Role {
			made[len(made)-1].Text += "\n\n" + one.Text
			continue
		}
		made = append(made, one)
	}
	return made
}

// step is one on its way out. The id is the provider's own call id, so the second sighting of one
// lands on the row the first sighting made.
func step(id, tool, state, title, output, detail string) Part {
	summary := title
	if summary == "" {
		summary = tool
	}
	if output != "" {
		summary += " — " + output
	}
	return Part{Kind: StepPart, Step: chat.Step{
		ID: id, Tool: tool, Summary: summary, State: state, Detail: detail,
	}}
}

// summarise is what came back, in a few words. The payload was for the model; a conversation kept
// on disk has no reason to carry every document it read.
func summarise(text string) string {
	lines := strings.Count(text, "\n") + 1
	if len(text) <= 60 && lines == 1 {
		return strings.TrimSpace(text)
	}
	return strconv.Itoa(len(text)) + " characters, " + strconv.Itoa(lines) + " lines"
}

// Titler is how a tool call reads on the step's row: what was asked of the tool, not what came
// back. Held by whoever builds the tools, since only they know what the arguments mean.
type Titler func(name string, input json.RawMessage) string

func titleOf(titler Titler, name string, input json.RawMessage) string {
	if titler == nil {
		return name
	}
	return titler(name, input)
}
