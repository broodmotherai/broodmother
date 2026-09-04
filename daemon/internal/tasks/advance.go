// Walking the graph from wherever the run stands.

package tasks

import (
	"context"
	"path/filepath"
	"sync"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/diagrams"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

// standing is what one step's turn answers: whether the walk can go on. A step waiting on a
// person, or one the stop button reached, leaves the run standing exactly where it is rather than
// finishing it.
type standing bool

const (
	goOn  standing = true
	stand standing = false
)

func (s *Store) advance(site diagrams.Site, held task.Task, one *walking, ctx context.Context, seed map[string]taskrun.Firing) {
	order := task.RunOrder(held)
	if order == nil {
		one.mutex.Lock()
		s.wreck(one.run, apperr.Taskf("the task has a cycle — untangle it first"))
		one.mutex.Unlock()
		return
	}
	byID := nodesByID(held)
	scratch := openScratch(s.deps.Scratch(), one.run.ID)
	// What the run is about, where its trigger knew: one file of the run's own, so a step three
	// along can still answer the issue the first one was handed.
	for _, firing := range seed {
		if firing.About != nil {
			writeSubject(scratch, firing.About)
			break
		}
	}

	// A layer is everything whose upstream has finished, so its members cannot feed each other
	// and are free to run at once. They are settled rather than raced: a run half stopped
	// mid-layer would leave steps saying `running` with nothing running them.
	for _, layer := range order {
		for at := 0; at < len(layer); at += lanes {
			end := min(at+lanes, len(layer))
			answers := make([]standing, end-at)
			var group sync.WaitGroup
			for index, id := range layer[at:end] {
				group.Add(1)
				go func() {
					defer group.Done()
					answers[index] = s.walkStep(site, held, byID, one, ctx, seed, scratch, id)
				}()
			}
			group.Wait()
			for _, answer := range answers {
				if answer == stand {
					return
				}
			}
		}
	}

	one.mutex.Lock()
	defer one.mutex.Unlock()
	if one.run.State == taskrun.RunRunning {
		one.run.State = taskrun.RunDone
	}
	finished := s.now().UnixMilli()
	one.run.FinishedAt = &finished
	s.save(one.run)
}

// wreck is what a walk that could not start ends as. Left alone the run would say `running` for
// ever; instead it errors with the reason, and whatever never got to run is skipped.
func (s *Store) wreck(run *taskrun.Run, cause error) {
	run.State = taskrun.RunError
	if run.Error == "" {
		run.Error = cause.Error()
	}
	if run.FinishedAt == nil {
		at := s.now().UnixMilli()
		run.FinishedAt = &at
	}
	skipUnwalked(run)
	s.save(run)
}

// walkStep is one node: what fed it, what it did, and what that ruled out.
func (s *Store) walkStep(
	site diagrams.Site, held task.Task, byID map[string]task.Node,
	one *walking, ctx context.Context, seed map[string]taskrun.Firing, scratch, id string,
) standing {
	one.mutex.Lock()
	at := -1
	for index, step := range one.run.Steps {
		if step.Node == id {
			at = index
			break
		}
	}
	// Anything not still waiting is behind us — walked on this pass or on the one that paused.
	// The held step whose answer brought us back is settled by then too.
	if at < 0 || one.run.Steps[at].State != taskrun.Waiting {
		one.mutex.Unlock()
		return goOn
	}
	if one.run.State == taskrun.RunError {
		one.run.Steps[at].State = taskrun.Skipped
		one.mutex.Unlock()
		return goOn
	}
	node, found := byID[id]
	if !found {
		one.mutex.Unlock()
		return goOn
	}

	var step files
	if scratch != "" {
		step = stepFiles(scratch, node.ID)
	}

	if task.IsTrigger(node.Kind) {
		// What the trigger saw opens the run — an empty word for a manual one, and for one
		// switched off, which saw nothing because it was not watching.
		firing, said := seed[node.ID]
		opening := ""
		if !node.Off {
			opening = openingContext(node, firing.Payload, said)
		}
		one.run.Steps[at].Output = &opening
		one.run.Steps[at].State = taskrun.Done
		if node.Off {
			one.run.Steps[at].State = taskrun.Off
		}
		one.mutex.Unlock()
		writeFile(step.opening, opening)
		return goOn
	}

	// Edges a gate held, a verdict passed over or a stop ended: what is fed only through them
	// never runs.
	pruned := map[string]bool{}
	for _, edge := range one.run.Pruned {
		pruned[edge] = true
	}
	var feeds, live []task.Edge
	for _, edge := range held.Edges {
		if edge.To != node.ID {
			continue
		}
		feeds = append(feeds, edge)
		if !pruned[wire(edge.From, edge.To)] {
			live = append(live, edge)
		}
	}
	if len(feeds) > 0 && len(live) == 0 {
		one.run.Pruned = cutFrom(one.run.Pruned, held, node.ID, nil)
		one.run.Steps[at].State = taskrun.Skipped
		s.save(one.run)
		one.mutex.Unlock()
		return goOn
	}

	fed := make([]feed, 0, len(live))
	for _, edge := range live {
		name := edge.From
		if from, found := byID[edge.From]; found {
			name = from.Name
		}
		fed = append(fed, feed{name: name, output: outputOf(one.run, edge.From)})
	}
	input := composeInput(fed)

	// Switched off: the node is a wire. What fed it goes straight on to what it feeds, so the
	// branch keeps running and only this step's work is missing.
	if node.Off {
		one.run.Steps[at].Output = &input
		one.run.Steps[at].State = taskrun.Off
		s.save(one.run)
		one.mutex.Unlock()
		writeFile(step.input, input)
		writeFile(step.output, input)
		return goOn
	}

	routes := make([]string, 0)
	for _, edge := range held.Edges {
		if edge.From != node.ID {
			continue
		}
		name := edge.To
		if to, found := byID[edge.To]; found {
			name = to.Name
		}
		routes = append(routes, name)
	}
	one.run.Steps[at].State = taskrun.Running
	s.save(one.run)
	one.mutex.Unlock()

	writeFile(step.input, input)
	result, err := s.perform(site, node, input, step, routes, ctx)

	one.mutex.Lock()
	defer one.mutex.Unlock()
	if err != nil {
		// Stopped from outside: the ending is already written, and the process dying is how that
		// happened rather than something of its own to report.
		if ctx.Err() != nil {
			return stand
		}
		one.run.Steps[at].State = taskrun.Errored
		one.run.Steps[at].Error = err.Error()
		one.run.State = taskrun.RunError
		one.run.Error = node.Name + ": " + err.Error()
		s.save(one.run)
		return goOn
	}

	one.run.Steps[at].Output = &result.output
	writeFile(step.output, result.output)
	switch {
	case result.hold != "":
		// Waiting on a person. The run keeps its place and its ruled-out edges; what answers the
		// step sets it done or stopped and sends the walk back in here.
		one.run.Steps[at].State = taskrun.Held
		one.run.Steps[at].Asked = result.hold
		one.run.State = taskrun.RunPaused
		s.save(one.run)
		return stand
	case result.halted:
		// A deliberate halt is an outcome, not a failure: the run still finishes.
		one.run.Steps[at].State = taskrun.Stopped
		one.run.Steps[at].Halted = result.stop
		one.run.Pruned = cutFrom(one.run.Pruned, held, node.ID, nil)
	default:
		one.run.Steps[at].State = taskrun.Done
		if result.chose {
			keep, err := chosen(held, byID, node.ID, result.next)
			if err != nil {
				one.run.Steps[at].State = taskrun.Errored
				one.run.Steps[at].Error = err.Error()
				one.run.State = taskrun.RunError
				one.run.Error = node.Name + ": " + err.Error()
				s.save(one.run)
				return goOn
			}
			one.run.Pruned = cutFrom(one.run.Pruned, held, node.ID, keep)
		}
	}
	s.save(one.run)
	if ctx.Err() != nil {
		return stand
	}
	return goOn
}

func outputOf(run *taskrun.Run, node string) string {
	for _, step := range run.Steps {
		if step.Node == node && step.Output != nil {
			return *step.Output
		}
	}
	return ""
}

// chosen is the nodes a verdict picked, by name or id — a name no path answers to is an error,
// because a decision that silently went nowhere would read as one that was obeyed.
func chosen(held task.Task, byID map[string]task.Node, from string, next []string) (map[string]bool, error) {
	keep := map[string]bool{}
	for _, choice := range next {
		hits := 0
		for _, edge := range held.Edges {
			if edge.From != from {
				continue
			}
			if edge.To == choice || byID[edge.To].Name == choice {
				keep[edge.To] = true
				hits++
			}
		}
		if hits == 0 {
			return nil, apperr.Taskf("no path onward named %q", choice)
		}
	}
	return keep, nil
}

// perform hands the node to whatever runs its kind.
func (s *Store) perform(
	site diagrams.Site, node task.Node, input string, step files, routes []string, ctx context.Context,
) (stepResult, error) {
	run, found := blocks[node.Kind]
	if !found {
		return stepResult{}, apperr.Taskf("nothing here runs a %s step", node.Kind)
	}
	cwd := sitePath(site)
	// The run's folder is where the step's files sit, which is the one place a step can read
	// what the run as a whole is about.
	scratch := ""
	if step.output != "" {
		scratch = filepath.Dir(step.output)
	}
	return run(node, stepCtx{
		cwd:     cwd,
		project: s.project(),
		input:   input,
		files:   step,
		routes:  routes,
		env:     s.env(),
		brief:   s.brief(),
		persona: s.persona(node.Persona),
		scratch: scratch,
		reaches: s.reaching(cwd),
		ctx:     ctx,
		notify:  s.notify,
	})
}

func sitePath(site diagrams.Site) string {
	if site.Tree == nil {
		return ""
	}
	return site.Tree.Root
}
