// Package task is what a task is: a graph of triggers and agents, and the file it lives in. The
// shape only — reading and writing one is the codec's, walking one is the graph's.
//
// The TypeScript this is ported from writes a node as a discriminated union, one interface per
// kind. Go has no such thing, so a node is one struct wearing every field any kind can carry and
// a Kind that says which of them mean anything. The codec is where that stops being a loose bag:
// it reads only the fields the kind allows and writes only the fields the kind carried, so a
// field set on the wrong kind never reaches the file.
package task

import (
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/grid"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

const Extension = ".task"

func IsTaskPath(path string) bool { return utils.Extension(path) == "task" }

type Kind string

const (
	ManualTrigger   Kind = "trigger.manual"
	IntervalTrigger Kind = "trigger.interval"
	TimeTrigger     Kind = "trigger.time"
	FileTrigger     Kind = "trigger.file"

	GithubIssueTrigger   Kind = "trigger.github.issue"
	GithubPullTrigger    Kind = "trigger.github.pull"
	GithubMentionTrigger Kind = "trigger.github.mention"
	GithubCheckTrigger   Kind = "trigger.github.check"

	ClaudeAgent  Kind = "agent.claude"
	MuseAgent    Kind = "agent.muse"
	ShellAgent   Kind = "agent.shell"
	ApproveAgent Kind = "agent.approve"
	NotifyAgent  Kind = "agent.notify"
	HTTPAgent    Kind = "agent.http"

	GithubCommentAgent Kind = "agent.github.comment"
	GithubPullAgent    Kind = "agent.github.pull"

	GateAgent Kind = "agent.gate"
	NoteAgent Kind = "agent.note"
)

// Kinds is every kind a task can hold, in the order the add menu offers them.
var Kinds = []Kind{
	ManualTrigger, IntervalTrigger, TimeTrigger, FileTrigger,
	GithubIssueTrigger, GithubPullTrigger, GithubMentionTrigger, GithubCheckTrigger,
	ClaudeAgent, MuseAgent, ShellAgent, ApproveAgent, NotifyAgent, HTTPAgent,
	GithubCommentAgent, GithubPullAgent,
	GateAgent, NoteAgent,
}

// LegacyKinds are the kinds the editor no longer offers. A task written when it did still opens
// and runs; the menu just does not make any more of them.
var LegacyKinds = []Kind{GateAgent, NoteAgent}

// Weekday is a day a time trigger may fire on, as cron writes them.
type Weekday string

var Weekdays = []Weekday{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}

func (d Weekday) valid() bool {
	for _, one := range Weekdays {
		if one == d {
			return true
		}
	}
	return false
}

// HTTPMethod is a verb a step may use. A closed list because a typo in a method is a request
// that fails at the far end for a reason nothing here would explain.
type HTTPMethod string

var HTTPMethods = []HTTPMethod{"GET", "POST", "PUT", "PATCH", "DELETE"}

func (m HTTPMethod) valid() bool {
	for _, one := range HTTPMethods {
		if one == m {
			return true
		}
	}
	return false
}

// Node is one step. Every kind carries an id, a name, a corner and the switch; the rest is the
// kind's, and which fields those are is written down once, in the codec.
type Node struct {
	ID   string
	Kind Kind
	Name string
	X    float64
	Y    float64
	// Off: the node does no work of its own and stands as a wire instead — what feeds it goes
	// straight on to what it feeds. A trigger switched off never fires, which is how a task keeps
	// its schedule on paper while you work on it. False is on, so every task written before the
	// switch reads as one with everything on.
	Off bool

	// Minutes is how often an interval trigger fires, how long a watch leaves GitHub alone, and
	// how long an errand may take. Unset on an errand is 5 — a step, not a day.
	Minutes *float64
	// At is a local time of day, HH:MM.
	At string
	// Days are the days a time trigger fires on. Unset is every day, which is what one written
	// before this said.
	Days []Weekday
	// Path is the file a trigger watches, or the note a run's output lands in.
	Path string
	// Append adds to the end of a note instead of rewriting it — how a recurring task keeps a log.
	Append *bool

	// Repo is `owner/name`. Unset is the remote of the checkout the task lives in.
	Repo *string
	// Query is a GitHub search, where one is wanted: `label:bug`, `review-requested:@me`. Unset
	// watches everything in the repository.
	Query *string
	// Branch is the branch whose checks are watched. Unset is the branch the checkout is on.
	Branch *string
	// Number is the issue or pull request commented on. Unset is whatever the trigger was about.
	Number *float64
	// Base is what a pull request is opened against. Unset is the repository's default branch.
	Base *string
	// Head is what it is opened from. Unset is the branch the checkout is on.
	Head *string
	// Title: the first line of the step's input is the title unless one is written here.
	Title *string
	Draft *bool

	Prompt string
	// Persona names a project persona whose PERSONA.md joins the agent's system prompt.
	Persona *string
	// Retries is how many more times to try after a failure. Unset is none.
	Retries *float64
	// Command is run by `sh -c` in the checkout, upstream output on stdin, stdout onward.
	Command string
	// Question is what an approval asks, where the node's name is not the whole question.
	Question *string

	URL string
	// Method unset is POST: the step has something to say, and saying it is what this is for.
	Method *HTTPMethod
	// Header is one header, written as it goes on the wire — `Authorization: Bearer …`.
	Header *string

	// Pattern: the branch continues only when the input matches — how "act on what the agent
	// flagged" is written.
	Pattern string
}

type Edge struct {
	From string
	To   string
}

type Task struct {
	Version int
	Nodes   []Node
	Edges   []Edge
}

// Empty is the task the app makes: the trigger that makes it runnable by hand, and nothing else
// yet. Unlike a canvas, which is fine with nothing on it, a task with no trigger is a task with
// no way to run.
func Empty() Task {
	return Task{
		Version: 1,
		Nodes:   []Node{{ID: "trigger", Kind: ManualTrigger, Name: ManualName, X: 80, Y: 120}},
		Edges:   []Edge{},
	}
}

func IsTrigger(kind Kind) bool { return strings.HasPrefix(string(kind), "trigger.") }

// IsGithub reports whether a kind reaches GitHub. The middle segment rather than the first,
// because both families have members there.
func IsGithub(kind Kind) bool { return strings.Contains(string(kind), ".github.") }

// IsGithubWatch reports whether a kind watches GitHub rather than writes to it — the ones that
// need a poll, and the ones that carry minutes.
func IsGithubWatch(kind Kind) bool { return IsGithub(kind) && IsTrigger(kind) }

// GithubKinds are the kinds that reach GitHub: a branch of their own in the add menu, under
// whichever family they belong to, and the ones the runtime needs a connection for.
var GithubKinds = githubKinds()

func githubKinds() []Kind {
	var found []Kind
	for _, kind := range Kinds {
		if IsGithub(kind) {
			found = append(found, kind)
		}
	}
	return found
}

// Fires reports whether a trigger will actually fire the task: wired into the graph, and
// switched on. Everything that keeps time or watches a source asks this one question.
func Fires(node Node, wired map[string]bool) bool { return wired[node.ID] && !node.Off }

// KindLabel is what each kind is called: the word in the add menu, and the name a node of it
// wears until it is given another.
var KindLabel = map[Kind]string{
	ManualTrigger:        ManualName,
	IntervalTrigger:      "Every N minutes",
	TimeTrigger:          "At a time",
	FileTrigger:          "When a file changes",
	ClaudeAgent:          "Claude Code",
	MuseAgent:            "Muse Code",
	ShellAgent:           "Command",
	ApproveAgent:         "Wait for approval",
	NotifyAgent:          "Notify me",
	HTTPAgent:            "Call a URL",
	GithubIssueTrigger:   "When an issue changes",
	GithubPullTrigger:    "When a pull request changes",
	GithubMentionTrigger: "When you are mentioned",
	GithubCheckTrigger:   "When checks change",
	GithubCommentAgent:   "Comment on GitHub",
	GithubPullAgent:      "Open a pull request",
	GateAgent:            "Only if",
	NoteAgent:            "Write a note",
}

// TriggerLabel is how a trigger reads in a sentence — the tasks page's word for it. Empty for an
// agent, which is not a thing that happens to you.
func TriggerLabel(node Node) string {
	switch node.Kind {
	case ManualTrigger:
		return "triggered manually"
	case IntervalTrigger:
		return "every " + number(node.Minutes) + " minute" + plural(node.Minutes)
	case TimeTrigger:
		return "at " + node.At + onDays(node.Days)
	case FileTrigger:
		return "when " + node.Path + " changes"
	case GithubIssueTrigger:
		return "when an issue changes in " + orThis(node.Repo, "repo") + asked(node.Query)
	case GithubPullTrigger:
		return "when a pull request changes in " + orThis(node.Repo, "repo") + asked(node.Query)
	case GithubMentionTrigger:
		return "when you are mentioned on GitHub"
	case GithubCheckTrigger:
		return "when checks change on " + orThis(node.Branch, "branch")
	default:
		return ""
	}
}

// number is a count as the template interpolating it would print it, which is JavaScript's
// number-to-string rather than Go's %v — 1.5 is "1.5" and 30 is "30", not "30.0".
func number(minutes *float64) string {
	if minutes == nil {
		return "undefined"
	}
	return strconv.FormatFloat(*minutes, 'g', -1, 64)
}

func plural(minutes *float64) string {
	if minutes != nil && *minutes == 1 {
		return ""
	}
	return "s"
}

func orThis(value *string, noun string) string {
	if value == nil {
		return "this " + noun
	}
	return *value
}

// onDays is the days a time trigger keeps to, where it keeps to any — read as part of the
// sentence the trigger is, since one that fires twice a week is not one that fires daily.
func onDays(days []Weekday) string {
	if len(days) == 0 {
		return ""
	}
	named := make([]string, len(days))
	for index, day := range days {
		named[index] = string(day)
	}
	return " on " + strings.Join(named, ", ")
}

// asked is the search a watch narrows itself with, where it has one — read as part of the
// sentence the trigger is, since a trigger watching one label is not watching the repository.
func asked(query *string) string {
	if query == nil || *query == "" {
		return ""
	}
	return " matching " + *query
}

// Every card on the board is this big, whatever it holds: a task is read as a chain, and a chain
// of things all the same size is the shape of the chain rather than the shape of its links.
// Laying one out by hand, leave a card's width between them.
const (
	NodeW = 96.0
	NodeH = 96.0
)

// FreshID is the next id nothing in this task has taken — `claude-1`, `interval-2`, `comment-1` —
// so an id says what it is as well as which one it is. The last part of the kind, not the second:
// everything that reaches GitHub has three, and `github-4` says nothing.
func FreshID(t Task, kind Kind) string {
	parts := strings.Split(string(kind), ".")
	stem := parts[len(parts)-1]
	taken := map[string]bool{}
	for _, node := range t.Nodes {
		taken[node.ID] = true
	}
	for n := 1; ; n++ {
		id := stem + "-" + strconv.Itoa(n)
		if !taken[id] {
			return id
		}
	}
}

// MakeNode makes a node the way the editor makes one: a fresh id, the kind's name, the fields
// the kind is born with, and its corner on the grid.
func MakeNode(t Task, kind Kind, x, y float64) Node {
	node := Node{
		ID:   FreshID(t, kind),
		Kind: kind,
		Name: KindLabel[kind],
		X:    grid.Snap(x),
		Y:    grid.Snap(y),
	}
	// The seed each kind is born with. Only three carry a value; the rest are born with the empty
	// string the struct already holds, which is what the TypeScript's empty partial amounts to.
	switch kind {
	case IntervalTrigger:
		minutes := 30.0
		node.Minutes = &minutes
	case TimeTrigger:
		node.At = "09:00"
	}
	return node
}
