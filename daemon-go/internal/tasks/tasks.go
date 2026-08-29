// Package tasks is what tasks the open checkouts hold, what they have done, the walk that runs
// one, and the beat that decides when to.
//
// Everything the page draws before anything runs is here — the task files found and parsed, the
// triggers that would fire them, and the runs the store remembers.
package tasks

import (
	"strings"
	"sync"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/diagrams"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/task"
	"github.com/broodmotherai/broodmother/daemon-go/internal/taskrun"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tree"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

// runsShown and logShown are how many the two listings carry, which is the TypeScript's.
const (
	runsShown = 20
	logShown  = 50
)

type Deps struct {
	// Sites is every checkout a board can live in: the project, and every repo it holds. Tasks
	// run from them and diagrams are drawn in them, and both are found the same way.
	Sites func() []diagrams.Site
	// Runs is the record of what has already happened, and the firings a watch owes a run. Nil
	// where the store would not open, which is a page with no log rather than no page.
	Runs *taskrun.Store
	// Scheduler is who keeps time for the schedule triggers: the system crontab on a laptop,
	// whose server may not be up when the clock strikes, or this process's own clock.
	Scheduler Scheduler
	// Triggers is where the event triggers keep their cursors between beats.
	Triggers *TriggerStore
	// Scratch is where a run's folder of hand-off files goes, so a listing can say where to look.
	Scratch func() string
	// Project is where `agent.note` writes: notes are a project idea, wherever the task lives.
	Project func() *tree.Tree
	// Env is what an agent step's process starts with beyond the ambient environment.
	Env func() map[string]string
	// Persona is what a named persona says, out of the checkout that carries it.
	Persona func(name string) string
	// Brief is the standing brief an agent step opens with — the same one the terminals get.
	Brief func() string
	// Reach is whichever service a step or a watch asks for, as the checkout it runs in can
	// reach it. Empty where no profile is connected to any of them.
	Reach Reach
	// Notify puts something in front of whoever has the app open, and Moved says a run has.
	Notify func(title, body string)
	Moved  func()
	// Now is the clock, for a test that needs to move it.
	Now func() time.Time
}

type Store struct {
	deps Deps

	mutex   sync.Mutex
	walking map[string]*walking
	// troubles is why a trigger last failed to look, by task and node. In memory, like a run:
	// it is news about now, and a watch that works again clears it.
	troubles map[string]string
	// beating is closed to stop the beat, and beaten is closed by the beat once it has left.
	// Both nil when nothing is keeping time.
	beating chan struct{}
	beaten  chan struct{}
}

func NewStore(deps Deps) *Store {
	return &Store{deps: deps, walking: map[string]*walking{}, troubles: map[string]string{}}
}

type Trigger struct {
	Kind task.Kind `json:"kind"`
	// Label is the trigger read as a sentence — "every 5 minutes", "when in.md changes".
	Label string `json:"label"`
	// Error is why its last look failed, where one did — a watch that answered with silence
	// would look exactly like one with nothing to report.
	Error string `json:"error,omitempty"`
}

// Summary is one row of the tasks page: a task, what fires it, and how its last run went. The
// field order is the wire order, and it is the TypeScript's.
type Summary struct {
	Ref     doc.Ref      `json:"ref"`
	Name    string       `json:"name"`
	LastRun *taskrun.Run `json:"lastRun"`
	// Triggers are only the wired ones — the ones that would actually fire it.
	Triggers []Trigger `json:"triggers"`
	// Broken is why the file would not parse, where it would not. A broken task fires nothing,
	// and saying so is the only way anybody learns why it stopped.
	Broken string `json:"broken,omitempty"`
}

// found is one task file, parsed or not.
type found struct {
	ref    doc.Ref
	task   *task.Task
	broken string
}

// Recover ends the runs a start finds still walking. A run interrupted mid-step cannot be picked
// up where it was left — the step that was running may have half-done something the world can see,
// and doing it again would comment twice — so it is ended with the reason rather than resumed.
//
// A paused run was written deliberately at a step boundary and is left exactly where it stands,
// for whoever answers the question it is holding to set walking again.
func (s *Store) Recover() {
	if s.deps.Runs == nil {
		return
	}
	for _, run := range s.deps.Runs.Unfinished() {
		if run.State != taskrun.RunRunning {
			continue
		}
		run.State = taskrun.RunError
		run.Error = "the server stopped mid-run"
		at := s.now().UnixMilli()
		run.FinishedAt = &at
		for index, step := range run.Steps {
			if step.State == taskrun.Waiting || step.State == taskrun.Running {
				run.Steps[index].State = taskrun.Skipped
			}
		}
		s.deps.Runs.Save(run)
	}
}

// The deps a step is given, each answered where there is one and left empty where there is not:
// a step runs without a brief, and an agent with no persona is an agent with no persona.
func (s *Store) project() *tree.Tree {
	if s.deps.Project == nil {
		return nil
	}
	return s.deps.Project()
}

func (s *Store) env() map[string]string {
	if s.deps.Env == nil {
		return map[string]string{}
	}
	return s.deps.Env()
}

func (s *Store) brief() string {
	if s.deps.Brief == nil {
		return ""
	}
	return s.deps.Brief()
}

func (s *Store) persona(name *string) string {
	if s.deps.Persona == nil || name == nil || *name == "" {
		return ""
	}
	return s.deps.Persona(*name)
}

func (s *Store) notify(title, body string) {
	if s.deps.Notify != nil {
		s.deps.Notify(title, body)
	}
}

func (s *Store) now() time.Time {
	if s.deps.Now != nil {
		return s.deps.Now()
	}
	return time.Now()
}

// listed is every task file in every open checkout, the ones that would not parse among them.
func (s *Store) listed() []found {
	listed := []found{}
	for _, site := range s.deps.Sites() {
		for _, path := range diagrams.Files(site.Tree, task.IsTaskPath) {
			one := found{ref: doc.Ref{Root: site.Root, Path: path}}
			source, err := site.Tree.Read(string(path))
			if err == nil {
				var parsed task.Task
				parsed, err = task.Parse(source)
				if err == nil {
					one.task = &parsed
				}
			}
			if err != nil {
				one.broken = err.Error()
			}
			listed = append(listed, one)
		}
	}
	return listed
}

func (s *Store) Summaries() []Summary {
	listed := s.listed()
	summaries := make([]Summary, 0, len(listed))
	for _, one := range listed {
		summary := Summary{
			Ref:      one.ref,
			Name:     strings.TrimSuffix(utils.Base(string(one.ref.Path)), task.Extension),
			Triggers: []Trigger{},
			LastRun:  s.lastRun(one.ref),
		}
		if one.task == nil {
			summary.Broken = one.broken
			summaries = append(summaries, summary)
			continue
		}
		wired := map[string]bool{}
		for _, edge := range one.task.Edges {
			wired[edge.From] = true
		}
		for _, node := range one.task.Nodes {
			label := task.TriggerLabel(node)
			if label == "" || !task.Fires(node, wired) {
				continue
			}
			summary.Triggers = append(summary.Triggers, Trigger{
				Kind: node.Kind, Label: label, Error: s.troubleWith(one.ref, node.ID),
			})
		}
		summaries = append(summaries, summary)
	}
	return summaries
}

// lastRun is not placed. A row of the tasks page says how the last run went, not where its files
// are — that is the run page's question, and the TypeScript answers it in the same two places.
func (s *Store) lastRun(ref doc.Ref) *taskrun.Run {
	if s.deps.Runs == nil {
		return nil
	}
	held := s.deps.Runs.RunsFor(ref, 1)
	if len(held) == 0 {
		return nil
	}
	return &held[0]
}

// RunsFor is one task's runs, newest first.
func (s *Store) RunsFor(ref doc.Ref) []taskrun.Run {
	if s.deps.Runs == nil {
		return []taskrun.Run{}
	}
	return s.placed(s.deps.Runs.RunsFor(ref, runsShown))
}

// Log is every task's runs together, newest first.
func (s *Store) Log() []taskrun.Run {
	if s.deps.Runs == nil {
		return []taskrun.Run{}
	}
	return s.placed(s.deps.Runs.Recent(logShown))
}

// placed says where each run's files are. Derived rather than stored: the base and the id say it
// all.
func (s *Store) placed(runs []taskrun.Run) []taskrun.Run {
	base := s.deps.Scratch()
	for index := range runs {
		runs[index].Scratch = taskrun.ScratchOf(base, runs[index].ID)
	}
	return runs
}
