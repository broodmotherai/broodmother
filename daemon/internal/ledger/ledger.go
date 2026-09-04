// Package ledger is who did what, and when.
//
// Everything here is a claim rather than a credential. The port is loopback and has no auth, so
// anything that can reach it can say it is anybody — which is why this is provenance for
// collaboration and not an audit log. What it is worth is that an agent finding a changed file
// can find out whose work it is looking at, which git alone cannot say.
package ledger

import (
	"encoding/json"
	"strings"
	"unicode"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
)

// Action is what was done. Errand is the coarse one: a Claude Code session or a shell ran in the
// checkout and these are the paths that differed either side of it.
type Action string

const (
	Write  Action = "write"
	Move   Action = "move"
	Delete Action = "delete"
	Errand Action = "errand"
	Commit Action = "commit"
)

// ActorKind is what sort of thing did it. Person is somebody typing in the editor, which is what
// an unattributed write through the app's own door is. Unknown is a claim that would not parse —
// never a guess.
type ActorKind string

const (
	AgentActor   ActorKind = "agent"
	ChatActor    ActorKind = "chat"
	TaskActor    ActorKind = "task"
	PersonActor  ActorKind = "person"
	UnknownActor ActorKind = "unknown"
)

var actorKinds = []ActorKind{AgentActor, ChatActor, TaskActor, PersonActor, UnknownActor}

type Actor struct {
	Kind ActorKind `json:"kind"`
	// ID is the agent, the chat or the run — whatever the app files that sort of actor under.
	ID      string `json:"id,omitempty"`
	Name    string `json:"name,omitempty"`
	Persona string `json:"persona,omitempty"`
	Model   string `json:"model,omitempty"`
	// Context is the thread or the run the work was done in, where that is somewhere else: an
	// agent's id is not their conversation, and the conversation is what a person would open.
	Context string `json:"context,omitempty"`
}

// Header is what an actor travels on. A tool reaching the app's own front door sets it; the
// editor does not, and that absence is what makes a write a person's.
const Header = "x-broodmother-actor"

// Person is somebody typing in the editor: what a write nobody claimed is, and the only default.
func Person() Actor { return Actor{Kind: PersonActor} }

// ParseActor is who a request says it is. Absent is a person, because the editor is the one
// writer that does not set the header and a save it made is somebody typing. Anything that does
// not parse is unknown — a claim the app could not read is not a claim about anybody, and the one
// thing worse than not knowing is filing a guess under a name.
func ParseActor(header string) Actor {
	if header == "" {
		return Person()
	}
	var said map[string]json.RawMessage
	if json.Unmarshal([]byte(header), &said) != nil || said == nil {
		return Actor{Kind: UnknownActor}
	}
	var kind string
	if json.Unmarshal(orNull(said["kind"]), &kind) != nil || !known(ActorKind(kind)) {
		return Actor{Kind: UnknownActor}
	}

	actor := Actor{Kind: ActorKind(kind)}
	for _, field := range []struct {
		key  string
		into *string
	}{
		{"id", &actor.ID}, {"name", &actor.Name}, {"persona", &actor.Persona},
		{"model", &actor.Model}, {"context", &actor.Context},
	} {
		var value string
		if json.Unmarshal(orNull(said[field.key]), &value) == nil && value != "" {
			*field.into = value
		}
	}
	return actor
}

func known(kind ActorKind) bool {
	for _, one := range actorKinds {
		if one == kind {
			return true
		}
	}
	return false
}

func orNull(data json.RawMessage) json.RawMessage {
	if data == nil {
		return json.RawMessage("null")
	}
	return data
}

type Entry struct {
	At int64 `json:"at"`
	// Project is the project folder, the way the config names one — the ledger holds every
	// project's.
	Project string   `json:"project"`
	Root    doc.Root `json:"root"`
	Path    doc.Path `json:"path"`
	Action  Action   `json:"action"`
	Actor   Actor    `json:"actor"`
	// Created says the write made the document rather than changing one, so "Priya made it, Rafa
	// changed it" is a thing the ledger can say.
	Created *bool `json:"created,omitempty"`
	// Note is what it was part of, in the words of whoever did it: the errand's first line, the
	// task the note step belonged to, the path a move came from.
	Note string `json:"note,omitempty"`
}

// New is an act as it is filed: the clock is the store's, the way it is for a chat's messages.
type New struct {
	Project string
	Root    doc.Root
	Path    doc.Path
	Action  Action
	Actor   Actor
	Created *bool
	Note    string
}

// domain is made up and says so: nobody has an account at it, and GitHub will render the
// co-author as a contributor without a face. That is the bargain — the alternative is the agent's
// work signed by the person whose git identity happened to run the sync, which is the attribution
// this whole feature exists to stop.
const domain = "agents.broodmother.local"

// TrailersFor is what a commit says about who did the work in it, in trailers a person and
// `git log` can both read.
//
// Only an agent is co-authored. A chat is the person at the keyboard and a person is already the
// commit's author, so naming either would be saying the same thing twice; a task run gets a
// Changed-by and no address, because a timer is not somebody to write to.
func TrailersFor(acts []Entry) []string {
	lines := []string{}
	named := map[string]bool{}
	for _, act := range acts {
		actor := act.Actor
		if actor.Kind != AgentActor && actor.Kind != TaskActor {
			continue
		}
		who := actor.ID
		if who == "" {
			who = actor.Name
		}
		key := string(actor.Kind) + ":" + who
		if named[key] {
			continue
		}
		named[key] = true

		if actor.Kind == TaskActor {
			said := "Changed-by: a task run"
			if actor.ID != "" {
				said += " (" + actor.ID + ")"
			}
			lines = append(lines, said)
			continue
		}
		name := actor.Name
		if name == "" {
			name = "an agent"
		}
		badge := []string{"agent"}
		if actor.Persona != "" {
			badge = append(badge, "persona "+actor.Persona)
		}
		if actor.Model != "" {
			badge = append(badge, actor.Model)
		}
		lines = append(lines, "Changed-by: "+name+" ("+strings.Join(badge, ", ")+")")
		lines = append(lines, "Co-authored-by: "+name+" <"+address(name)+">")
	}
	return lines
}

// address is an agent's, from their name the way their attachments folder is: lower case, one
// dash between words, nothing an address would trip on.
func address(name string) string {
	var out strings.Builder
	dashed := false
	for _, r := range strings.ToLower(name) {
		if isLetterOrNumber(r) {
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
	return slug + "@" + domain
}

// isLetterOrNumber is `\p{L}` or `\p{N}`, which is what the pattern this is ported from keeps —
// a name in any script slugs to itself rather than to a row of dashes.
func isLetterOrNumber(r rune) bool { return unicode.IsLetter(r) || unicode.IsNumber(r) }
