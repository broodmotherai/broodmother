// The task file, read and written. Parsing refuses anything it cannot vouch for, and says which
// node was wrong; writing is canonical, so a load–save round trip changes no bytes.

package task

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/github"
)

func fail(format string, args ...any) error { return apperr.Taskf(format, args...) }

type raw = map[string]json.RawMessage

func record(data json.RawMessage, what string) (raw, error) {
	var held raw
	if err := json.Unmarshal(data, &held); err != nil || held == nil {
		return nil, fail("%s is not an object", what)
	}
	return held, nil
}

func text(data json.RawMessage, what string) (string, error) {
	var held string
	if data == nil || json.Unmarshal(data, &held) != nil {
		return "", fail("%s is not a string", what)
	}
	return held, nil
}

func finite(data json.RawMessage, what string) (float64, error) {
	var held float64
	if data == nil || json.Unmarshal(data, &held) != nil || math.IsInf(held, 0) || math.IsNaN(held) {
		return 0, fail("%s is not a number", what)
	}
	return held, nil
}

func boolean(data json.RawMessage, what string) (bool, error) {
	var held bool
	if data == nil || json.Unmarshal(data, &held) != nil {
		return false, fail("%s is not a boolean", what)
	}
	return held, nil
}

// span is a length of time, named for the node rather than the field: every one of them is
// minutes, and the message says so whichever field carried it.
func span(data json.RawMessage, id string) (float64, error) {
	minutes, err := finite(data, id+" minutes")
	if err != nil {
		return 0, err
	}
	if minutes < 1 {
		return 0, fail("%s minutes must be at least 1", id)
	}
	return minutes, nil
}

// quote is JSON.stringify of a value, which is how the TypeScript names one it will not take.
func quote(value any) string {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "undefined"
	}
	return strings.TrimSuffix(out.String(), "\n")
}

// undefinedOr is a value quoted the way the TypeScript quotes it, and the bare word `undefined`
// where the field was absent — which is what JSON.stringify answers with and what the template
// interpolating it then prints.
func undefinedOr(data json.RawMessage, found bool) string {
	if !found {
		return "undefined"
	}
	return string(data)
}

// switched is the switch every node wears. Only off is written down — a node that is on is the
// plain case and says nothing, so turning one on again leaves the file as it was.
func switched(held raw, id string) (bool, error) {
	data, found := held["off"]
	if !found {
		return false, nil
	}
	return boolean(data, id+" off")
}

// repoOf is the repository a GitHub node names, where it names one. Unset is the checkout's own
// remote, which is the ordinary case and is resolved when the task runs rather than here — a
// task written for a checkout that has since moved is still a task.
func repoOf(held raw, id string) (*string, error) {
	data, found := held["repo"]
	if !found {
		return nil, nil
	}
	repo, err := text(data, id+" repo")
	if err != nil {
		return nil, err
	}
	if !github.IsSlug(repo) {
		return nil, fail("%s repo is not an owner/name", id)
	}
	return &repo, nil
}

// tries is how many more times a step may be tried after it fails. Zero is written as nothing: a
// step that is not retried is the plain case and says so by staying silent.
func tries(held raw, id string) (*float64, error) {
	data, found := held["retries"]
	if !found {
		return nil, nil
	}
	retries, err := finite(data, id+" retries")
	if err != nil {
		return nil, err
	}
	if retries != math.Trunc(retries) || retries < 0 {
		return nil, fail("%s retries is not a count", id)
	}
	if retries == 0 {
		return nil, nil
	}
	return &retries, nil
}

// daysOf are the days a time trigger keeps to. An unknown one is refused by name rather than
// dropped: a trigger silently firing every day because a day was misspelled is the worse answer.
func daysOf(held raw, id string) ([]Weekday, error) {
	data, found := held["days"]
	if !found {
		return nil, nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, fail("%s days is not a list", id)
	}
	days := make([]Weekday, 0, len(items))
	for at, item := range items {
		named, err := text(item, fmt.Sprintf("%s day %d", id, at))
		if err != nil {
			return nil, err
		}
		if !Weekday(named).valid() {
			return nil, fail("%s has unknown day %s", id, quote(named))
		}
		days = append(days, Weekday(named))
	}
	if len(days) == 0 {
		return nil, nil
	}
	return days, nil
}

// minutesOf is how long a watch leaves GitHub alone between looks, and how long an errand may
// take. One field, one rule, whichever kind is asking.
func minutesOf(held raw, id string) (*float64, error) {
	data, found := held["minutes"]
	if !found {
		return nil, nil
	}
	minutes, err := span(data, id)
	if err != nil {
		return nil, err
	}
	return &minutes, nil
}

// optionalText reads a field only where the file carries one, the way the TypeScript guards each
// with `!== undefined`.
func optionalText(held raw, key, what string) (*string, error) {
	data, found := held[key]
	if !found {
		return nil, nil
	}
	value, err := text(data, what)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func optionalBool(held raw, key, what string) (*bool, error) {
	data, found := held[key]
	if !found {
		return nil, nil
	}
	value, err := boolean(data, what)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

// ManualName is what the trigger every task is born with is called. It was LegacyManualName for
// a while; a task that still wears that default takes the one it has now, and the next save
// writes it.
const (
	ManualName       = "Trigger manually"
	LegacyManualName = "When run"
)

// time is HH:MM on a 24-hour clock, which is the one thing a time trigger has to be.
var timePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func readNode(data json.RawMessage, index int) (Node, error) {
	held, err := record(data, fmt.Sprintf("node %d", index))
	if err != nil {
		return Node{}, err
	}
	id, err := text(held["id"], fmt.Sprintf("node %d id", index))
	if err != nil {
		return Node{}, err
	}
	node := Node{ID: id}
	if node.Name, err = text(held["name"], id+" name"); err != nil {
		return Node{}, err
	}
	if node.X, err = finite(held["x"], id+" x"); err != nil {
		return Node{}, err
	}
	if node.Y, err = finite(held["y"], id+" y"); err != nil {
		return Node{}, err
	}
	if node.Off, err = switched(held, id); err != nil {
		return Node{}, err
	}

	kind, found := held["kind"]
	named, _ := text(kind, "")
	node.Kind = Kind(named)
	switch node.Kind {
	case ManualTrigger:
		if node.Name == LegacyManualName {
			node.Name = ManualName
		}
	case IntervalTrigger:
		minutes, err := span(held["minutes"], id)
		if err != nil {
			return Node{}, err
		}
		node.Minutes = &minutes
	case TimeTrigger:
		if node.At, err = text(held["at"], id+" at"); err != nil {
			return Node{}, err
		}
		if !timePattern.MatchString(node.At) {
			return Node{}, fail("%s at must be HH:MM", id)
		}
		if node.Days, err = daysOf(held, id); err != nil {
			return Node{}, err
		}
	case FileTrigger:
		if node.Path, err = text(held["path"], id+" path"); err != nil {
			return Node{}, err
		}
	case GithubIssueTrigger, GithubPullTrigger:
		if node.Repo, err = repoOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Minutes, err = minutesOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Query, err = optionalText(held, "query", id+" query"); err != nil {
			return Node{}, err
		}
	case GithubMentionTrigger:
		if node.Repo, err = repoOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Minutes, err = minutesOf(held, id); err != nil {
			return Node{}, err
		}
	case GithubCheckTrigger:
		if node.Repo, err = repoOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Minutes, err = minutesOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Branch, err = optionalText(held, "branch", id+" branch"); err != nil {
			return Node{}, err
		}
	case GithubCommentAgent:
		if node.Repo, err = repoOf(held, id); err != nil {
			return Node{}, err
		}
		if data, found := held["number"]; found {
			at, err := finite(data, id+" number")
			if err != nil {
				return Node{}, err
			}
			if at != math.Trunc(at) || at < 1 {
				return Node{}, fail("%s number is not an issue number", id)
			}
			node.Number = &at
		}
	case GithubPullAgent:
		if node.Repo, err = repoOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Base, err = optionalText(held, "base", id+" base"); err != nil {
			return Node{}, err
		}
		if node.Head, err = optionalText(held, "head", id+" head"); err != nil {
			return Node{}, err
		}
		if node.Title, err = optionalText(held, "title", id+" title"); err != nil {
			return Node{}, err
		}
		if node.Draft, err = optionalBool(held, "draft", id+" draft"); err != nil {
			return Node{}, err
		}
	case ClaudeAgent, MuseAgent:
		if node.Prompt, err = text(held["prompt"], id+" prompt"); err != nil {
			return Node{}, err
		}
		if node.Persona, err = optionalText(held, "persona", id+" persona"); err != nil {
			return Node{}, err
		}
		if node.Minutes, err = minutesOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Retries, err = tries(held, id); err != nil {
			return Node{}, err
		}
	case ShellAgent:
		if node.Command, err = text(held["command"], id+" command"); err != nil {
			return Node{}, err
		}
		if node.Minutes, err = minutesOf(held, id); err != nil {
			return Node{}, err
		}
		if node.Retries, err = tries(held, id); err != nil {
			return Node{}, err
		}
	case ApproveAgent:
		if node.Question, err = optionalText(held, "question", id+" question"); err != nil {
			return Node{}, err
		}
	case NotifyAgent:
	case HTTPAgent:
		if node.URL, err = text(held["url"], id+" url"); err != nil {
			return Node{}, err
		}
		if data, found := held["method"]; found {
			named, err := text(data, id+" method")
			if err != nil {
				return Node{}, err
			}
			method := HTTPMethod(strings.ToUpper(named))
			if !method.valid() {
				return Node{}, fail("%s has unknown method %s", id, quote(string(method)))
			}
			node.Method = &method
		}
		if node.Header, err = optionalText(held, "header", id+" header"); err != nil {
			return Node{}, err
		}
		if node.Minutes, err = minutesOf(held, id); err != nil {
			return Node{}, err
		}
	case GateAgent:
		if node.Pattern, err = text(held["pattern"], id+" pattern"); err != nil {
			return Node{}, err
		}
		// The TypeScript asks JavaScript whether the pattern compiles. Go's regexp is RE2, which
		// takes a little less than JavaScript does — a lookahead is a pattern this refuses and the
		// browser keeps. The gate is a legacy kind and its patterns in the wild are words, so this
		// is named rather than worked around; a gate that needs a lookahead is the reason to.
		if _, err := regexp.Compile(node.Pattern); err != nil {
			return Node{}, fail("%s pattern is not a regular expression", id)
		}
	case NoteAgent:
		if node.Path, err = text(held["path"], id+" path"); err != nil {
			return Node{}, err
		}
		if node.Append, err = optionalBool(held, "append", id+" append"); err != nil {
			return Node{}, err
		}
	default:
		return Node{}, fail("%s has unknown kind %s", id, undefinedOr(kind, found))
	}
	return node, nil
}

func Parse(source string) (Task, error) {
	var body json.RawMessage
	if err := json.Unmarshal([]byte(source), &body); err != nil {
		return Task{}, fail("not JSON")
	}
	held, err := record(body, "task")
	if err != nil {
		return Task{}, err
	}
	if version, err := finite(held["version"], "version"); err != nil || version != 1 {
		return Task{}, fail("version must be 1")
	}
	rawNodes, err := list(held, "nodes")
	if err != nil {
		return Task{}, err
	}
	rawEdges, err := list(held, "edges")
	if err != nil {
		return Task{}, err
	}

	nodes := make([]Node, 0, len(rawNodes))
	ids := map[string]bool{}
	for index, data := range rawNodes {
		node, err := readNode(data, index)
		if err != nil {
			return Task{}, err
		}
		nodes = append(nodes, node)
		ids[node.ID] = true
	}
	if len(ids) != len(nodes) {
		return Task{}, fail("node ids repeat")
	}

	edges := make([]Edge, 0, len(rawEdges))
	for index, data := range rawEdges {
		held, err := record(data, fmt.Sprintf("edge %d", index))
		if err != nil {
			return Task{}, err
		}
		edge := Edge{}
		if edge.From, err = text(held["from"], fmt.Sprintf("edge %d from", index)); err != nil {
			return Task{}, err
		}
		if edge.To, err = text(held["to"], fmt.Sprintf("edge %d to", index)); err != nil {
			return Task{}, err
		}
		if !ids[edge.From] || !ids[edge.To] {
			return Task{}, fail("edge %d points at a missing node", index)
		}
		if edge.From == edge.To {
			return Task{}, fail("edge %d points at itself", index)
		}
		edges = append(edges, edge)
	}

	return Task{Version: 1, Nodes: nodes, Edges: edges}, nil
}

// list is a field that has to be a list to be read at all — unlike the canvas, where both are
// optional, a task says how many of each it has even when it has none.
func list(held raw, key string) ([]json.RawMessage, error) {
	var items []json.RawMessage
	data, found := held[key]
	if !found || json.Unmarshal(data, &items) != nil || items == nil {
		return nil, fail("%s is not a list", key)
	}
	return items, nil
}

type wireHead struct {
	ID   string  `json:"id"`
	Kind Kind    `json:"kind"`
	Name string  `json:"name"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Off  bool    `json:"off,omitempty"`
}

type wireEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type wireTask struct {
	Version int        `json:"version"`
	Nodes   []any      `json:"nodes"`
	Edges   []wireEdge `json:"edges"`
}

// One struct per kind, in schema field order, because declaration order is wire order: this is
// the whole of what makes a save byte-identical to the load before it.
type (
	wireInterval struct {
		wireHead
		Minutes float64 `json:"minutes"`
	}
	wireTime struct {
		wireHead
		At   string    `json:"at"`
		Days []Weekday `json:"days,omitempty"`
	}
	wirePath struct {
		wireHead
		Path string `json:"path"`
	}
	wireWatch struct {
		wireHead
		Repo    *string  `json:"repo,omitempty"`
		Query   *string  `json:"query,omitempty"`
		Minutes *float64 `json:"minutes,omitempty"`
	}
	wireMention struct {
		wireHead
		Repo    *string  `json:"repo,omitempty"`
		Minutes *float64 `json:"minutes,omitempty"`
	}
	wireCheck struct {
		wireHead
		Repo    *string  `json:"repo,omitempty"`
		Branch  *string  `json:"branch,omitempty"`
		Minutes *float64 `json:"minutes,omitempty"`
	}
	wireComment struct {
		wireHead
		Repo   *string  `json:"repo,omitempty"`
		Number *float64 `json:"number,omitempty"`
	}
	wirePull struct {
		wireHead
		Repo  *string `json:"repo,omitempty"`
		Base  *string `json:"base,omitempty"`
		Head  *string `json:"head,omitempty"`
		Title *string `json:"title,omitempty"`
		Draft *bool   `json:"draft,omitempty"`
	}
	wirePrompt struct {
		wireHead
		Prompt  string   `json:"prompt"`
		Persona *string  `json:"persona,omitempty"`
		Minutes *float64 `json:"minutes,omitempty"`
		Retries *float64 `json:"retries,omitempty"`
	}
	wireShell struct {
		wireHead
		Command string   `json:"command"`
		Minutes *float64 `json:"minutes,omitempty"`
		Retries *float64 `json:"retries,omitempty"`
	}
	wireApprove struct {
		wireHead
		Question *string `json:"question,omitempty"`
	}
	wireHTTP struct {
		wireHead
		URL     string      `json:"url"`
		Method  *HTTPMethod `json:"method,omitempty"`
		Header  *string     `json:"header,omitempty"`
		Minutes *float64    `json:"minutes,omitempty"`
	}
	wireGate struct {
		wireHead
		Pattern string `json:"pattern"`
	}
	wireNote struct {
		wireHead
		Path   string `json:"path"`
		Append *bool  `json:"append,omitempty"`
	}
)

// every is an interval's minutes, which the format requires and the struct holds as optional
// like every other kind's. Nothing this codec parses reaches here without one.
func every(minutes *float64) float64 {
	if minutes == nil {
		return 0
	}
	return *minutes
}

func wireOf(node Node) any {
	head := wireHead{ID: node.ID, Kind: node.Kind, Name: node.Name, X: node.X, Y: node.Y, Off: node.Off}
	switch node.Kind {
	case IntervalTrigger:
		return wireInterval{head, every(node.Minutes)}
	case TimeTrigger:
		return wireTime{head, node.At, node.Days}
	case FileTrigger:
		return wirePath{head, node.Path}
	case GithubIssueTrigger, GithubPullTrigger:
		return wireWatch{head, node.Repo, node.Query, node.Minutes}
	case GithubMentionTrigger:
		return wireMention{head, node.Repo, node.Minutes}
	case GithubCheckTrigger:
		return wireCheck{head, node.Repo, node.Branch, node.Minutes}
	case GithubCommentAgent:
		return wireComment{head, node.Repo, node.Number}
	case GithubPullAgent:
		return wirePull{head, node.Repo, node.Base, node.Head, node.Title, node.Draft}
	case ClaudeAgent, MuseAgent:
		return wirePrompt{head, node.Prompt, node.Persona, node.Minutes, node.Retries}
	case ShellAgent:
		return wireShell{head, node.Command, node.Minutes, node.Retries}
	case ApproveAgent:
		return wireApprove{head, node.Question}
	case HTTPAgent:
		return wireHTTP{head, node.URL, node.Method, node.Header, node.Minutes}
	case GateAgent:
		return wireGate{head, node.Pattern}
	case NoteAgent:
		return wireNote{head, node.Path, node.Append}
	default:
		// Manual and notify carry nothing of their own, and anything else never got past the codec.
		return head
	}
}

// Serialize is canonical two-space JSON in schema field order, so a load–save round trip is
// byte-identical and tasks diff cleanly in git. An encoder rather than MarshalIndent, for the
// reason the canvas gives: Go escapes `<`, `>` and `&` by default and JSON.stringify does not.
func Serialize(t Task) string {
	wire := wireTask{
		Version: t.Version,
		Nodes:   make([]any, 0, len(t.Nodes)),
		Edges:   make([]wireEdge, 0, len(t.Edges)),
	}
	for _, node := range t.Nodes {
		wire.Nodes = append(wire.Nodes, wireOf(node))
	}
	for _, edge := range t.Edges {
		wire.Edges = append(wire.Edges, wireEdge{From: edge.From, To: edge.To})
	}

	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(wire); err != nil {
		panic(err)
	}
	return out.String()
}
