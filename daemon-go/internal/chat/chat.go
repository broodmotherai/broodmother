// Package chat is the conversations this project has held, and everything said in one — the
// record. The reply being written into one right now is `internal/chats`, and the answering is
// `internal/llm`.
package chat

import (
	"strings"
	"unicode"

	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
)

// Provider is who serves a model, which is also who you authenticate with — one credential per
// provider, however many of its models you talk to.
type Provider struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// KeysURL is where its keys are made, because a link beats a description of where to look.
	KeysURL string `json:"keysUrl"`
}

// Model is one you can hold a conversation with, and who serves it.
type Model struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Provider string `json:"provider"`
}

var Providers = []Provider{{
	ID:      "anthropic",
	Label:   "Anthropic",
	KeysURL: "https://console.anthropic.com/settings/keys",
}}

// Models are the ones on offer. One for now; the picker exists so that the second is a line
// rather than a rewrite.
var Models = []Model{{ID: "claude-opus-5", Label: "Claude Opus 5", Provider: "anthropic"}}

// Serves reports whether this build has a provider of that id — which is the same question as
// whether a credential for it is worth keeping.
func Serves(provider string) bool {
	for _, one := range Providers {
		if one.ID == provider {
			return true
		}
	}
	return false
}

// ProviderOf is who serves a model, or empty for a model nobody here serves.
func ProviderOf(model string) string {
	for _, one := range Models {
		if one.ID == model {
			return one.Provider
		}
	}
	return ""
}

// Step is one thing an answer did on its way to being written — a document read, a task started.
// A chat that can change the project has to show its working, so these are kept with the message
// and drawn above it, the way a task run keeps its steps.
type Step struct {
	ID string `json:"id"`
	// Tool is the tool's own name, as the model called it.
	Tool string `json:"tool"`
	// Summary is the call as one line — "read Handbook/Risks.md", "run Ops/Nightly.task".
	Summary string `json:"summary"`
	State   string `json:"state"`
	// Detail is what came back, where that is worth reading — a refusal, or an error in its own
	// words.
	Detail string `json:"detail,omitempty"`
}

type Message struct {
	ID   string `json:"id"`
	Role string `json:"role"`
	Text string `json:"text"`
	At   int64  `json:"at"`
	// Steps are absent on anything you said, and on an answer that only talked.
	Steps []Step `json:"steps,omitempty"`
	// From is the agent who said it, where one agent said this to another. Absent on everything
	// the person typed, which is what makes its presence worth drawing: a message in your thread
	// that you did not write.
	From string `json:"from,omitempty"`
}

type Summary struct {
	ID string `json:"id"`
	// Title is taken from the first thing you said, the way every chat app names one.
	Title     string `json:"title"`
	Model     string `json:"model"`
	UpdatedAt int64  `json:"updatedAt"`
}

// Chat is a conversation and everything in it. The field order is the wire order, and it is the
// TypeScript's: the summary, then what was said.
type Chat struct {
	Summary
	Messages []Message `json:"messages"`
}

// NewChat is what a conversation is called before anything is said in it. Naming it from the
// first thing said happens when something is said, which is the socket's.
const NewChat = "New chat"

// Agent is one of the people-shaped agents under the chats. One wears a persona from the
// project's `.personas/`, answers in a work chat the way a colleague types, and has one running
// conversation the way a DM does.
type Agent struct {
	ID string `json:"id"`
	// Name is what you call them — "Priya", not the persona's path.
	Name string `json:"name"`
	// Persona is the one worn: a name `GET /api/personas` lists.
	Persona string `json:"persona"`
	// Model is a chat model id: the brain behind the voice.
	Model string `json:"model"`
	// Color is the avatar's.
	Color string `json:"color"`
	// Chat is the one conversation held with them, opened on the chat socket like any other.
	Chat string `json:"chat"`
	// Attachments is where their deliverables go, project-relative. A later feature reads every
	// one of these folders, so the shape is a contract.
	Attachments string `json:"attachments"`
	CreatedAt   int64  `json:"createdAt"`
}

// NewAgent is a colleague as a caller hands one over.
type NewAgent struct {
	Name    string
	Persona string
	Model   string
	Color   string
}

// Place is where an agent was dragged to, or nothing where nobody has placed it and the board is
// free to lay it out.
type Place struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Placed is an agent's place on the chart: who they report to, and where they stand. A forest —
// several agents with no lead at all is the ordinary state of a small project — and one lead
// each, since the question the chart is asked is who to escalate to.
type Placed struct {
	Agent
	// Lead is an agent id, or nil at the top of a tree.
	Lead  *string `json:"lead"`
	Place *Place  `json:"place"`
}

// AttachmentsOf is where an agent's deliverables go, from their name: lower case, one dash
// between words, nothing a path would trip on.
func AttachmentsOf(name string) string {
	var out strings.Builder
	dashed := false
	for _, r := range strings.ToLower(name) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if dashed && out.Len() > 0 {
				out.WriteByte('-')
			}
			dashed = false
			out.WriteRune(r)
			continue
		}
		dashed = true
	}
	slug := out.String()
	if slug == "" {
		slug = "agent"
	}
	return constants.AttachmentsDir + "/" + slug
}
