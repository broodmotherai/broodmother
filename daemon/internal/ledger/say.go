// The ledger in words, for whoever is reading it — a tool answering an agent, and the line under a
// document in the doc pane.
//
// Past tense throughout, and "as part of" for an errand rather than "wrote": a row says what was
// true when it was written and nothing has told the ledger since, and an errand's row says which
// errand a file was part of, never which line was whose.

package ledger

import (
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

func SayAct(entry Entry, now int64) string {
	said := who(entry.Actor) + " " + did(entry) + " " + Ago(now-entry.At)
	if entry.Actor.Context != "" {
		said += ", in " + entry.Actor.Context
	}
	return said
}

// SayCommit is what git has to say, which is a different question and is labelled as one wherever
// it is shown: a commit is when work was filed and by whichever author was configured.
func SayCommit(touch git.CommitTouch, now int64) string {
	when := touch.At
	if at, ok := millisOf(touch.At); ok {
		when = Ago(now - at)
	}
	sha := touch.Sha
	if len(sha) > 7 {
		sha = sha[:7]
	}
	return "git: last committed by " + touch.Author + " " + when + " — “" + touch.Subject + "” (" + sha + ")"
}

func who(actor Actor) string {
	switch actor.Kind {
	case AgentActor:
		name := actor.Name
		if name == "" {
			name = "an agent"
		}
		badge := []string{}
		if actor.Persona != "" {
			badge = append(badge, actor.Persona)
		}
		if actor.Model != "" {
			badge = append(badge, actor.Model)
		}
		if len(badge) == 0 {
			return name + " (agent)"
		}
		return name + " (agent, " + strings.Join(badge, ", ") + ")"
	case ChatActor:
		return "the page’s chat"
	case TaskActor:
		if actor.ID != "" {
			return "a task run (" + actor.ID + ")"
		}
		return "a task run"
	case PersonActor:
		return "somebody typing in the editor"
	default:
		return "somebody the app could not name"
	}
}

func did(entry Entry) string {
	switch entry.Action {
	case Write:
		if entry.Created != nil && *entry.Created {
			return "made this"
		}
		return "changed this"
	case Move:
		if entry.Note != "" {
			return "moved this here from " + entry.Note
		}
		return "moved this here"
	case Delete:
		return "deleted this"
	case Errand:
		if entry.Note != "" {
			return "changed this as part of “" + entry.Note + "”"
		}
		return "changed this in an errand"
	case Commit:
		return "committed this"
	}
	return string(entry.Action)
}

// Ago is how long ago, in the roundest unit that still says something.
func Ago(ms int64) string {
	if ms < 60_000 {
		return "just now"
	}
	minutes := rounded(float64(ms) / 60_000)
	if minutes < 60 {
		return strconv.Itoa(minutes) + " minute" + plural(minutes) + " ago"
	}
	hours := rounded(float64(minutes) / 60)
	if hours < 24 {
		return strconv.Itoa(hours) + " hour" + plural(hours) + " ago"
	}
	days := rounded(float64(hours) / 24)
	return strconv.Itoa(days) + " day" + plural(days) + " ago"
}

func plural(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

// millisOf reads git's ISO 8601. Not a time it can read is shown as it stands rather than as a
// duration from a date nobody could parse.
func millisOf(at string) (int64, bool) {
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05Z0700", time.RFC3339Nano} {
		if held, err := time.Parse(layout, at); err == nil {
			return held.UnixMilli(), true
		}
	}
	return 0, false
}

// rounded is JavaScript's Math.round: a half goes up, including a negative half.
func rounded(value float64) int {
	if value < 0 {
		return -int(-value + 0.5)
	}
	return int(value + 0.5)
}
