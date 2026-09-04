// GitHub end to end inside a task: a watch that turns an issue into a run, the file the run
// carries about what it is, and the two steps that act on it.

package tasks_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/tasks"

	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/github"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

// hub is GitHub as these tests answer it: a queue of replies, and what was asked for.
type hub struct {
	replies []github.Reply
	paths   []string
	bodies  []string
}

func (h *hub) io(path, _ string, _ http.Header, body []byte) (github.Reply, error) {
	h.paths = append(h.paths, path)
	h.bodies = append(h.bodies, string(body))
	if len(h.replies) == 0 {
		return github.Reply{Status: 200, Headers: http.Header{}, Body: []byte("[]")}, nil
	}
	reply := h.replies[0]
	h.replies = h.replies[1:]
	return reply, nil
}

func answering(bodies ...any) *hub {
	held := &hub{}
	for _, body := range bodies {
		encoded, err := json.Marshal(body)
		if err != nil {
			panic(err)
		}
		held.replies = append(held.replies,
			github.Reply{Status: 200, Headers: http.Header{}, Body: encoded})
	}
	return held
}

// connected gives the store a GitHub it can reach, standing in a checkout whose remote and branch
// are the two answers a node that names neither means.
func (h *held) connected(hub *hub, slug, branch string) {
	h.reaches = Reaches{Github: &GithubReach{
		Service: github.NewService("t0ken", github.ServiceOptions{IO: hub.io}),
		Slug:    slug,
		Branch:  branch,
	}}
}

const onIssues = `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.github.issue", "name": "When an issue changes", "x": 80, "y": 120, "minutes": 1},
  {"id": "step", "kind": "agent.shell", "name": "Read it", "x": 240, "y": 120, "command": "cat"}
], "edges": [{"from": "t", "to": "step"}]}`

func anIssue(number int, title, at string) map[string]any {
	return map[string]any{
		"number": number, "title": title, "updated_at": at, "body": "please look",
		"html_url": "https://github.com/a/b/issues/7",
		"user":     map[string]any{"login": "someone"},
	}
}

// An issue that moved becomes a run, and the run opens on the issue written out so an agent
// reading it needs nothing else.
func TestAnIssueThatMovedBecomesARun(t *testing.T) {
	one := standing(t, map[string]string{"a.task": onIssues})
	hub := answering(
		[]any{anIssue(7, "the old one", "2026-08-01T00:00:00Z")},
		[]any{anIssue(7, "please look", "2026-08-05T00:00:00Z")},
	)
	one.connected(hub, "a/b", "main")

	one.store.Tick() // The baseline.
	one.after(2 * time.Minute)
	one.store.Tick()

	run := settled(t, one, "a.task", 1)[0]
	if run.State != taskrun.RunDone {
		t.Fatalf("run %s: %s", run.State, run.Error)
	}
	said := output(run, "step")
	for _, want := range []string{"a/b#7", "please look", "by someone", "(on GitHub)"} {
		if !strings.Contains(said, want) {
			t.Errorf("the step read %q, wanted %q in it", said, want)
		}
	}
}

// The watch leaves GitHub alone between looks: the beat is the rate for a file on this disk, not
// for somebody else's API.
func TestAWatchThatLookedRecentlyDoesNotAskAgain(t *testing.T) {
	one := standing(t, map[string]string{"a.task": onIssues})
	hub := answering([]any{anIssue(7, "one", "2026-08-01T00:00:00Z")})
	one.connected(hub, "a/b", "main")

	one.store.Tick()
	one.after(20 * time.Second)
	one.store.Tick()
	if len(hub.paths) != 1 {
		t.Fatalf("asked GitHub %d times inside a minute", len(hub.paths))
	}
	one.after(2 * time.Minute)
	one.store.Tick()
	if len(hub.paths) != 2 {
		t.Errorf("asked GitHub %d times, want 2", len(hub.paths))
	}
}

// What the run is about is one file of the run's own, so a step three along can still answer the
// issue the first one was handed.
func TestARunCarriesWhatItIsAbout(t *testing.T) {
	one := standing(t, map[string]string{"a.task": onIssues})
	hub := answering(
		[]any{anIssue(7, "old", "2026-08-01T00:00:00Z")},
		[]any{anIssue(7, "new", "2026-08-05T00:00:00Z")},
	)
	one.connected(hub, "a/b", "main")

	one.store.Tick()
	one.after(2 * time.Minute)
	one.store.Tick()
	run := settled(t, one, "a.task", 1)[0]

	body, err := os.ReadFile(filepath.Join(taskrun.ScratchOf(one.scratch, run.ID), "about.json"))
	if err != nil {
		t.Fatal(err)
	}
	var about taskrun.Subject
	if err := json.Unmarshal(body, &about); err != nil {
		t.Fatal(err)
	}
	if about.Provider != "github" || about.Repo != "a/b" {
		t.Fatalf("about %+v", about)
	}
	if about.Number == nil || *about.Number != 7 {
		t.Errorf("about number %v", about.Number)
	}
}

// A comment step names no issue: it answers the one the run is about, with what the step before
// it wrote. That is the whole point of putting an agent in front of one.
func TestACommentAnswersTheIssueTheRunIsAbout(t *testing.T) {
	board := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.github.issue", "name": "When an issue changes", "x": 80, "y": 120, "minutes": 1},
  {"id": "say", "kind": "agent.shell", "name": "Draft", "x": 240, "y": 120, "command": "echo 'on it'"},
  {"id": "post", "kind": "agent.github.comment", "name": "Say it", "x": 400, "y": 120}
], "edges": [{"from": "t", "to": "say"}, {"from": "say", "to": "post"}]}`
	one := standing(t, map[string]string{"a.task": board})
	hub := answering(
		[]any{anIssue(7, "old", "2026-08-01T00:00:00Z")},
		[]any{anIssue(7, "new", "2026-08-05T00:00:00Z")},
		map[string]any{"html_url": "https://github.com/a/b/issues/7#issuecomment-1"},
	)
	one.connected(hub, "a/b", "main")

	one.store.Tick()
	one.after(2 * time.Minute)
	one.store.Tick()

	run := settled(t, one, "a.task", 1)[0]
	if run.State != taskrun.RunDone {
		t.Fatalf("run %s: %s", run.State, run.Error)
	}
	if got := output(run, "post"); got != "https://github.com/a/b/issues/7#issuecomment-1" {
		t.Fatalf("the step answered %q", got)
	}
	posted := hub.paths[len(hub.paths)-1]
	if posted != "/repos/a/b/issues/7/comments" {
		t.Errorf("commented at %s", posted)
	}
	if !strings.Contains(hub.bodies[len(hub.bodies)-1], "on it") {
		t.Errorf("commented %q", hub.bodies[len(hub.bodies)-1])
	}
}

// A comment step with nothing to go on stops and says which of the two things is missing, rather
// than quietly doing nothing.
func TestACommentWithNoIssueSaysSo(t *testing.T) {
	board := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.manual", "name": "Trigger manually", "x": 80, "y": 120},
  {"id": "say", "kind": "agent.shell", "name": "Draft", "x": 240, "y": 120, "command": "echo 'on it'"},
  {"id": "post", "kind": "agent.github.comment", "name": "Say it", "x": 400, "y": 120}
], "edges": [{"from": "t", "to": "say"}, {"from": "say", "to": "post"}]}`
	one := standing(t, map[string]string{"a.task": board})
	one.connected(answering(), "a/b", "main")

	if _, err := one.store.Run(doc.Ref{Root: doc.Project, Path: "a.task"}, "", false); err != nil {
		t.Fatal(err)
	}
	run := settled(t, one, "a.task", 1)[0]
	if run.State != taskrun.RunError {
		t.Fatalf("ended as %s", run.State)
	}
	if !strings.Contains(stepError(run, "post"), "which issue") {
		t.Errorf("failed with %q", stepError(run, "post"))
	}
}

// A pull request takes its title from the first line of what it was handed and its description
// from the rest — a commit message's shape, because it is the shape anybody writing for this
// already writes in. Where to open it from is the checkout's own branch.
func TestAPullTakesItsTitleFromTheFirstLine(t *testing.T) {
	board := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.manual", "name": "Trigger manually", "x": 80, "y": 120},
  {"id": "say", "kind": "agent.shell", "name": "Write it", "x": 240, "y": 120,
   "command": "printf '# Tidy the beat\\n\\nIt was untidy.\\n'"},
  {"id": "open", "kind": "agent.github.pull", "name": "Open it", "x": 400, "y": 120}
], "edges": [{"from": "t", "to": "say"}, {"from": "say", "to": "open"}]}`
	one := standing(t, map[string]string{"a.task": board})
	hub := answering(
		map[string]any{"default_branch": "trunk"},
		map[string]any{"html_url": "https://github.com/a/b/pull/9"},
	)
	one.connected(hub, "a/b", "work")

	if _, err := one.store.Run(doc.Ref{Root: doc.Project, Path: "a.task"}, "", false); err != nil {
		t.Fatal(err)
	}
	run := settled(t, one, "a.task", 1)[0]
	if run.State != taskrun.RunDone {
		t.Fatalf("run %s: %s — %s", run.State, run.Error, stepError(run, "open"))
	}

	var opened struct{ Base, Head, Title, Body string }
	if err := json.Unmarshal([]byte(hub.bodies[len(hub.bodies)-1]), &opened); err != nil {
		t.Fatal(err)
	}
	if opened.Title != "Tidy the beat" {
		t.Errorf("titled %q", opened.Title)
	}
	if opened.Body != "It was untidy." {
		t.Errorf("described %q", opened.Body)
	}
	if opened.Base != "trunk" || opened.Head != "work" {
		t.Errorf("opened %s onto %s", opened.Head, opened.Base)
	}
}

// A pull request from a branch onto itself is nothing to open, and saying so beats asking GitHub
// to refuse it.
func TestAPullOntoItsOwnBranchStops(t *testing.T) {
	board := `{"version": 1, "nodes": [
  {"id": "t", "kind": "trigger.manual", "name": "Trigger manually", "x": 80, "y": 120},
  {"id": "say", "kind": "agent.shell", "name": "Write it", "x": 240, "y": 120, "command": "echo 'Do it'"},
  {"id": "open", "kind": "agent.github.pull", "name": "Open it", "x": 400, "y": 120}
], "edges": [{"from": "t", "to": "say"}, {"from": "say", "to": "open"}]}`
	one := standing(t, map[string]string{"a.task": board})
	hub := answering(map[string]any{"default_branch": "main"})
	one.connected(hub, "a/b", "main")

	if _, err := one.store.Run(doc.Ref{Root: doc.Project, Path: "a.task"}, "", false); err != nil {
		t.Fatal(err)
	}
	run := settled(t, one, "a.task", 1)[0]
	if run.State != taskrun.RunError {
		t.Fatalf("ended as %s", run.State)
	}
	if !strings.Contains(stepError(run, "open"), "nothing to open") {
		t.Errorf("failed with %q", stepError(run, "open"))
	}
	if len(hub.bodies) > 1 {
		t.Error("asked GitHub to open it anyway")
	}
}

func stepError(run taskrun.Run, node string) string {
	for _, step := range run.Steps {
		if step.Node == node {
			return step.Error
		}
	}
	return ""
}
