// The walk: what a run is, and what makes it move.
//
// Everything the walk needs to know beyond the task itself is on the run — a step that has
// already run wears its state and its output, and the edges ruled out are saved beside them — so
// the same code starts a fresh run and picks up one that paused at an approval three steps in.

package tasks

import (
	"context"
	"strings"
	"sync"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/diagrams"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

// lanes is how many steps of one layer run at once. Bounded because they share a checkout and a
// machine: a layer twenty wide is a fork bomb with a friendlier name.
const lanes = 4

// pausedDepth is how far back a settle looks for the question it is answering.
const pausedDepth = 20

// walking is a run underway, and the handle that ends it.
type walking struct {
	run    *taskrun.Run
	cancel context.CancelFunc
	// mutex guards the run while a layer's steps move at once: they share its steps and the
	// edges it has ruled out.
	mutex sync.Mutex
	// done is closed when the walk has left. A stop waits on it, so the run it hands back is the
	// ended one rather than one still being written.
	done chan struct{}
}

// Run starts a run and hands it back already underway; the steps land as they finish. A task
// already running joins that run instead of stacking a second — the Run button and a schedule
// landing mid-run both mean "be running", not "run twice".
func (s *Store) Run(ref doc.Ref, input string, said bool) (taskrun.Run, error) {
	if held := s.live(ref); held != nil {
		return *held, nil
	}
	site, held, err := s.taskAt(ref)
	if err != nil {
		return taskrun.Run{}, err
	}
	// What was typed opens the run, as though a trigger had seen it: every manual trigger gets
	// it, since which one was pressed is not a thing the graph records.
	var seed map[string]taskrun.Firing
	if said {
		seed = map[string]taskrun.Firing{}
		for _, node := range held.Nodes {
			if node.Kind == task.ManualTrigger {
				seed[node.ID] = taskrun.Firing{Payload: input}
			}
		}
	}
	return s.start(site, ref, held, seed)
}

// StopRun ends the run that is walking — the step's own process with it, so the button means what
// it says rather than leaving an agent to run out its timeout.
func (s *Store) StopRun(ref doc.Ref) (taskrun.Run, error) {
	s.mutex.Lock()
	held := s.walking[refKey(ref)]
	s.mutex.Unlock()
	if held == nil {
		return taskrun.Run{}, apperr.Taskf("nothing running to stop")
	}

	held.cancel()
	<-held.done

	held.mutex.Lock()
	defer held.mutex.Unlock()
	run := held.run
	run.State = taskrun.RunError
	run.Error = "stopped"
	at := s.now().UnixMilli()
	run.FinishedAt = &at
	skipUnwalked(run)
	s.save(run)
	return s.placedOne(*run), nil
}

// Settle answers a held step and sets the run walking again from there. Approving passes what fed
// the step straight on; denying ends the branch beyond it the way a held gate does, without
// failing the run — a person saying no is an outcome, not a fault.
//
// The paths beyond a denial are cut here rather than by the walk, because by the time the walk
// sees the step again it is settled and has no way to tell which way it was settled.
func (s *Store) Settle(ref doc.Ref, approved bool, note, id string) (taskrun.Run, error) {
	if s.live(ref) != nil {
		return taskrun.Run{}, apperr.Taskf("that run is already walking")
	}
	if s.deps.Runs == nil {
		return taskrun.Run{}, apperr.Taskf("nothing is waiting to be approved")
	}
	// The run named, or failing that the question that has waited longest — a firing landing
	// while somebody was being asked has a run of its own by now, and may be standing at a
	// question of its own, so the newest run is not reliably the one holding one.
	var run *taskrun.Run
	for _, one := range s.deps.Runs.RunsFor(ref, pausedDepth) {
		if one.State != taskrun.RunPaused {
			continue
		}
		held := one
		if id == "" || one.ID == id {
			run = &held
		}
	}
	if run == nil {
		return taskrun.Run{}, apperr.Taskf("nothing is waiting to be approved")
	}
	at := -1
	for index, step := range run.Steps {
		if step.State == taskrun.Held {
			at = index
			break
		}
	}
	if at < 0 {
		return taskrun.Run{}, apperr.Taskf("nothing is waiting to be approved")
	}
	site, held, err := s.taskAt(ref)
	if err != nil {
		return taskrun.Run{}, err
	}

	if approved {
		run.Steps[at].State = taskrun.Done
	} else {
		run.Steps[at].State = taskrun.Stopped
		halted := strings.TrimSpace(note)
		if halted == "" {
			halted = "not approved"
		}
		run.Steps[at].Halted = halted
		run.Pruned = cutFrom(run.Pruned, held, run.Steps[at].Node, nil)
	}
	run.State = taskrun.RunRunning
	s.save(run)
	return s.launch(site, ref, held, run, nil), nil
}

// start files a fresh run: one waiting step per node, in the order the graph will walk them.
func (s *Store) start(site diagrams.Site, ref doc.Ref, held task.Task, seed map[string]taskrun.Firing) (taskrun.Run, error) {
	order := task.RunOrder(held)
	if order == nil {
		return taskrun.Run{}, apperr.Taskf("the task has a cycle — untangle it first")
	}
	if s.deps.Runs == nil {
		return taskrun.Run{}, apperr.Taskf("there is nowhere to write a run")
	}
	byID := nodesByID(held)

	opened := taskrun.Run{
		Ref:       ref,
		StartedAt: s.now().UnixMilli(),
		State:     taskrun.RunRunning,
		Steps:     []taskrun.Step{},
	}
	for _, layer := range order {
		for _, id := range layer {
			if node, found := byID[id]; found {
				opened.Steps = append(opened.Steps, taskrun.Step{
					Node: id, Name: node.Name, Kind: node.Kind, State: taskrun.Waiting,
				})
			}
		}
	}

	id, dropped, err := s.deps.Runs.Add(opened)
	if err != nil {
		return taskrun.Run{}, err
	}
	s.moved()
	// The rows the store let go take their folders with them.
	pruneScratch(s.deps.Scratch(), dropped)

	opened.ID = id
	return s.launch(site, ref, held, &opened, seed), nil
}

// launch sets a run walking and hands it back mid-flight.
func (s *Store) launch(site diagrams.Site, ref doc.Ref, held task.Task, run *taskrun.Run, seed map[string]taskrun.Firing) taskrun.Run {
	ctx, cancel := context.WithCancel(context.Background())
	one := &walking{run: run, cancel: cancel, done: make(chan struct{})}

	s.mutex.Lock()
	s.walking[refKey(ref)] = one
	s.mutex.Unlock()

	// The answer is taken before the walk starts moving what it is a copy of.
	answer := s.placedOne(*run)
	go func() {
		defer close(one.done)
		defer cancel()
		s.advance(site, held, one, ctx, seed)
		s.mutex.Lock()
		delete(s.walking, refKey(ref))
		s.mutex.Unlock()
	}()
	return answer
}

// StopEverything ends every run that is walking, which is what shutting down owes them.
func (s *Store) StopEverything() {
	s.mutex.Lock()
	held := make([]doc.Ref, 0, len(s.walking))
	for _, one := range s.walking {
		held = append(held, one.run.Ref)
	}
	s.mutex.Unlock()
	for _, ref := range held {
		s.StopRun(ref)
	}
}

func (s *Store) live(ref doc.Ref) *taskrun.Run {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	held, found := s.walking[refKey(ref)]
	if !found {
		return nil
	}
	held.mutex.Lock()
	defer held.mutex.Unlock()
	run := s.placedOne(*held.run)
	return &run
}

// siteOf is the open checkout a root names, or nothing where it is not open.
func (s *Store) siteOf(root doc.Root) (diagrams.Site, bool) {
	for _, site := range s.deps.Sites() {
		if site.Root == root {
			return site, true
		}
	}
	return diagrams.Site{}, false
}

func (s *Store) taskAt(ref doc.Ref) (diagrams.Site, task.Task, error) {
	for _, site := range s.deps.Sites() {
		if site.Root != ref.Root {
			continue
		}
		source, err := site.Tree.Read(string(ref.Path))
		if err != nil {
			// Not found rather than a bad request: the caller asked a well-formed question about
			// a task that is not there.
			return diagrams.Site{}, task.Task{}, apperr.NotFoundf("there is no %s", ref.Path)
		}
		held, err := task.Parse(source)
		if err != nil {
			return diagrams.Site{}, task.Task{}, err
		}
		return site, held, nil
	}
	return diagrams.Site{}, task.Task{}, apperr.Taskf("no open root %s", ref.Root)
}

func refKey(ref doc.Ref) string { return string(ref.Root) + ":" + string(ref.Path) }

func nodesByID(held task.Task) map[string]task.Node {
	byID := make(map[string]task.Node, len(held.Nodes))
	for _, node := range held.Nodes {
		byID[node.ID] = node
	}
	return byID
}

func wire(from, to string) string { return from + ">" + to }

// cutFrom rules out the edges leaving a node, except the ones a verdict kept.
func cutFrom(pruned []string, held task.Task, from string, keep map[string]bool) []string {
	already := map[string]bool{}
	for _, one := range pruned {
		already[one] = true
	}
	for _, edge := range held.Edges {
		if edge.From != from || keep[edge.To] {
			continue
		}
		if !already[wire(edge.From, edge.To)] {
			already[wire(edge.From, edge.To)] = true
			pruned = append(pruned, wire(edge.From, edge.To))
		}
	}
	return pruned
}

func skipUnwalked(run *taskrun.Run) {
	for index, step := range run.Steps {
		if step.State == taskrun.Waiting || step.State == taskrun.Running {
			run.Steps[index].State = taskrun.Skipped
		}
	}
}

func (s *Store) save(run *taskrun.Run) {
	if s.deps.Runs == nil {
		return
	}
	// The scratch path is derived rather than stored, so it does not go back into the row.
	held := *run
	held.Scratch = ""
	s.deps.Runs.Save(held)
	s.moved()
}

// moved tells whoever has the tasks page open that a run has moved. It carries nothing: the page
// already knows how to ask, and a payload would be a second answer to disagree with the first.
func (s *Store) moved() {
	if s.deps.Moved != nil {
		s.deps.Moved()
	}
}

// placedOne is a run as a caller may hold it: a copy of its own, saying where its files are.
// Derived rather than stored — the base and the id say it all.
func (s *Store) placedOne(run taskrun.Run) taskrun.Run {
	held := run.Clone()
	held.Scratch = taskrun.ScratchOf(s.deps.Scratch(), held.ID)
	return held
}
