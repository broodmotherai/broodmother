// The event triggers: reading a source, and telling what moved since the last look.
//
// How one is written: read the source, compare it against the saved cursor, answer with what
// fired and the cursor to save. The first check — no state at all — is the baseline: record where
// the source stands, fire nothing. A new kind of trigger is one such function and a case in
// [eventCheck], and the beat owes it nothing else.

package tasks

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/github"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

// check is what one look turned up, and where the source stands now.
type check struct {
	firings []taskrun.Firing
	state   TriggerState
}

// tools is what a trigger has to look with: the checkout it watches from, whichever service it
// watches as this profile is connected to it, and the clock.
type tools struct {
	cwd     string
	reaches Reaches
	now     time.Time
}

type checkFn func(state TriggerState, with tools) (check, error)

// eventCheck is how a node is looked at, or nil where it is not an event trigger — a schedule is
// the scheduler's and a manual trigger is a person's.
func eventCheck(node task.Node) checkFn {
	switch {
	case node.Kind == task.FileTrigger:
		return func(state TriggerState, with tools) (check, error) { return checkFile(node, state, with) }
	case task.IsGithubWatch(node.Kind):
		return func(state TriggerState, with tools) (check, error) { return checkGithub(node, state, with) }
	default:
		return nil
	}
}

// checkFile fires when the file it watches is not where it was. A missing file stands at 0, so
// appearing counts as a change the way editing does.
func checkFile(node task.Node, state TriggerState, with tools) (check, error) {
	target := node.Path
	if !filepath.IsAbs(target) {
		target = filepath.Join(with.cwd, target)
	}
	seen := float64(0)
	if info, err := os.Stat(target); err == nil {
		// Milliseconds, which is what the TypeScript writes into the same file.
		seen = float64(info.ModTime().UnixNano()) / 1e6
	}
	held := check{firings: []taskrun.Firing{}, state: TriggerState{"mtime": seen}}
	if state != nil {
		before, known := state["mtime"].(float64)
		if !known || before != seen {
			held.firings = append(held.firings, taskrun.Firing{Payload: target})
		}
	}
	return held, nil
}

// everyMinutes is how long a GitHub watch leaves GitHub alone, where the node does not say.
const everyMinutes = 5

// checkGithub is a GitHub watch. The service holds the conditional request and the hour's budget;
// this holds the two things that are the task's — how often to look, and which repository "this
// repository" means — and turns what came back into firings the graph can read.
//
// A watch that cannot run says so rather than resting quietly: no connection and no repository
// are both things somebody has to fix, and a trigger that answered them with silence would look
// exactly like one with nothing to report.
func checkGithub(node task.Node, state TriggerState, with tools) (check, error) {
	reach := with.reaches.Github
	if reach == nil || reach.Service == nil {
		return check{}, apperr.Taskf("no GitHub connection — connect GitHub in Settings to watch one")
	}

	every := float64(everyMinutes)
	if node.Minutes != nil {
		every = *node.Minutes
	}
	looked, _ := state["checkedAt"].(float64)
	now := float64(with.now.UnixMilli())
	// The task beats every thirty seconds. That is the rate for a file on this disk, not for
	// somebody else's API, so a watch that looked recently answers without asking.
	if state != nil && now-looked < every*60_000 {
		return check{firings: []taskrun.Firing{}, state: state}, nil
	}

	watch, err := lookGithub(node, cursorOf(state), reach)
	if err != nil {
		return check{}, err
	}

	firings := make([]taskrun.Firing, 0, len(watch.Items))
	for _, item := range watch.Items {
		firings = append(firings, taskrun.Firing{
			Payload: saidOf(node, item),
			About: &taskrun.Subject{
				Provider: "github",
				Repo:     item.Repo,
				Number:   item.Number,
				URL:      item.URL,
				SHA:      item.SHA,
			},
		})
	}
	next := TriggerState{}
	for key, value := range watch.Cursor {
		next[key] = value
	}
	next["checkedAt"] = now
	return check{firings: firings, state: next}, nil
}

// cursorOf is the saved state as the service reads one. Nil rather than empty on the first look:
// a watch is told it has never looked by being handed nothing, not by being handed a blank.
func cursorOf(state TriggerState) github.Cursor {
	if state == nil {
		return nil
	}
	cursor := github.Cursor{}
	for key, value := range state {
		cursor[key] = value
	}
	return cursor
}

func lookGithub(node task.Node, cursor github.Cursor, reach *GithubReach) (github.Watch, error) {
	if node.Kind == task.GithubMentionTrigger {
		return reach.Service.Mentions(cursor)
	}
	repo := given(node.Repo, reach.Slug)
	if repo == "" {
		return github.Watch{}, apperr.Taskf(
			"no repository to watch: this checkout has no GitHub remote, so name one on the node")
	}
	if node.Kind == task.GithubCheckTrigger {
		branch := given(node.Branch, reach.Branch)
		if branch == "" {
			return github.Watch{}, apperr.Taskf("no branch to watch: name one on the node")
		}
		return reach.Service.Checks(repo, branch, cursor)
	}
	if node.Kind == task.GithubIssueTrigger {
		return reach.Service.Issues(repo, given(node.Query, ""), cursor)
	}
	return reach.Service.Pulls(repo, given(node.Query, ""), cursor)
}

// given is what a node's optional field says, or what the checkout answers where it says nothing.
// The two together are what "this repository" and "this branch" mean.
func given(field *string, otherwise string) string {
	if field != nil {
		return *field
	}
	return otherwise
}

// saidOf is what the run opens on: the thing that happened, written so an agent reading it needs
// nothing else — and so a person reading the run's files knows what it was about.
func saidOf(node task.Node, item github.Item) string {
	head := item.Repo + " — " + item.Title
	if item.Number != nil {
		head = item.Repo + "#" + strconv.Itoa(*item.Number) + " — " + item.Title
	}
	by := ""
	if item.Author != "" {
		by = "\nby " + item.Author
	}
	kind := "on GitHub"
	if node.Kind == task.GithubCheckTrigger {
		kind = "checks"
	}
	said := head + "\n" + item.URL + by + "\n(" + kind + ")"
	if body := strings.TrimSpace(item.Body); body != "" {
		said += "\n\n" + body
	}
	return said
}
