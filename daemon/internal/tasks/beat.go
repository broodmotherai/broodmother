// The beat: what makes a task run when nobody pressed anything.
//
// On every beat the store finds the tasks in every open checkout, hands the schedules to whoever
// keeps time for them, checks each event trigger against its saved cursor, and carries what the
// watches saw into runs.

package tasks

import (
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

// tick is how often the beat comes round. Fast enough that a file saved is a run within the
// half-minute, slow enough that watching costs nothing.
const tick = 30 * time.Second

// Start keeps time until [Store.Stop]. A store already beating carries on with the one it has.
func (s *Store) Start() { s.StartEvery(tick) }

// StartEvery is the same, at a beat a test can hurry along.
func (s *Store) StartEvery(every time.Duration) {
	s.mutex.Lock()
	if s.beating != nil {
		s.mutex.Unlock()
		return
	}
	stop, left := make(chan struct{}), make(chan struct{})
	s.beating, s.beaten = stop, left
	s.mutex.Unlock()

	go func() {
		defer close(left)
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				s.Tick()
			}
		}
	}()
}

// Stop stops keeping time, and ends what is mid-walk: a process left running past the server is
// one editing a checkout with nobody to read what it did.
//
// It waits for the beat that is underway rather than only telling it to stop, because what closes
// after this closes the stores a beat writes into — a firing landing in a database that has just
// been closed is a firing lost with nothing said about it.
func (s *Store) Stop() {
	s.mutex.Lock()
	stop, left := s.beating, s.beaten
	s.beating, s.beaten = nil, nil
	s.mutex.Unlock()
	if stop != nil {
		close(stop)
		<-left
	}
	s.StopEverything()
}

// Tick is one beat.
func (s *Store) Tick() {
	held := s.parsed()
	s.schedule(held)
	s.watch(held)
	s.drain(held)
}

// parsed is only the tasks that parse: the ones a schedule or a watch can be held to.
func (s *Store) parsed() []found {
	listed := s.listed()
	held := make([]found, 0, len(listed))
	for _, one := range listed {
		if one.task != nil {
			held = append(held, one)
		}
	}
	return held
}

// schedule hands the wired schedule triggers to whoever keeps time for them; the waking is theirs
// to arrange. A scheduler that could not be held to them keeps the ones it had rather than
// failing the beat — the watches still have a beat to run in.
func (s *Store) schedule(held []found) {
	if s.deps.Scheduler == nil {
		return
	}
	scheduled := make([]Scheduled, 0, len(held))
	for _, one := range held {
		scheduled = append(scheduled, Scheduled{Ref: one.ref, Task: *one.task})
	}
	s.deps.Scheduler.Sync(scheduled)
}

// watch looks at every event trigger and writes down what moved. A source that cannot be read
// keeps its cursor and is asked again next beat — but not silently: what went wrong rides on the
// trigger until a look works, since a watch that answered with silence would look exactly like
// one with nothing to report.
func (s *Store) watch(held []found) {
	if s.deps.Triggers == nil || s.deps.Runs == nil {
		return
	}
	alive := map[string]bool{}
	for _, one := range held {
		wired := map[string]bool{}
		for _, edge := range one.task.Edges {
			wired[edge.From] = true
		}
		site, known := s.siteOf(one.ref.Root)
		for _, node := range one.task.Nodes {
			look := eventCheck(node)
			if look == nil || !task.Fires(node, wired) || !known {
				continue
			}
			key := refKey(one.ref) + "#" + node.ID
			alive[key] = true
			cwd := sitePath(site)
			seen, err := look(s.deps.Triggers.Get(key), tools{
				cwd: cwd, reaches: s.reaching(cwd), now: s.now(),
			})
			if err != nil {
				s.trouble(key, err.Error())
				continue
			}
			s.trouble(key, "")
			s.deps.Triggers.Set(key, seen.state)
			// Everything the look turned up is written down, not just the first of it: the
			// cursor has already moved past all of them, so a firing dropped here is a firing
			// nothing will ever see again.
			for _, firing := range seen.firings {
				s.deps.Runs.Enqueue(one.ref, node.ID, firing, s.now().UnixMilli())
			}
		}
	}
	s.deps.Triggers.Prune(alive)
	s.forgetTroubles(alive)
	// Firings go the way the cursors do, and only here: a beat is the one place that has just
	// established what every task is, so a thinner list elsewhere cannot mistake a queue for a
	// task nobody has any more.
	live := map[string]bool{}
	for _, one := range held {
		live[refKey(one.ref)] = true
	}
	s.deps.Runs.PruneFirings(live)
}

// drain carries the queue into runs: for every task with a firing waiting and nothing already
// walking, the oldest firing starts a run and is claimed by it. One at a time per task — a batch
// of three becomes three runs one after another rather than three at once, since they share a
// checkout.
func (s *Store) drain(held []found) {
	if s.deps.Runs == nil {
		return
	}
	byRef := map[string]found{}
	for _, one := range held {
		byRef[refKey(one.ref)] = one
	}
	for _, ref := range s.deps.Runs.Waiting() {
		one, known := byRef[refKey(ref)]
		if !known || s.live(ref) != nil {
			continue
		}
		next := s.deps.Runs.Pending(ref)
		if next == nil {
			continue
		}
		site, standing := s.siteOf(ref.Root)
		if !standing {
			continue
		}
		run, err := s.start(site, ref, *one.task, map[string]taskrun.Firing{next.Node: next.Firing})
		if err != nil {
			continue
		}
		s.deps.Runs.Claim(next.ID, run.ID)
	}
}

// trouble is why a trigger last failed to look. In memory, like a run: it is news about now, and
// a watch that works again clears it.
func (s *Store) trouble(key, why string) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	if why == "" {
		delete(s.troubles, key)
		return
	}
	s.troubles[key] = why
}

func (s *Store) forgetTroubles(alive map[string]bool) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	for key := range s.troubles {
		if !alive[key] {
			delete(s.troubles, key)
		}
	}
}

func (s *Store) troubleWith(ref doc.Ref, node string) string {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.troubles[refKey(ref)+"#"+node]
}
