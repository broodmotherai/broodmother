// The cursors a watch keeps between beats.

package tasks

import (
	"bytes"
	"encoding/json"
	"os"
	"sync"

	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

// TriggerState is what a trigger remembers between checks: a small JSON cursor — an mtime, an
// etag, a last-seen id — whatever the source hands out that says "seen up to here".
type TriggerState map[string]any

// TriggerStore is all of them, one small JSON file keyed by task and node. On disk rather than in
// memory so a restarted server picks up where the last one stood instead of refiring — or missing
// — everything it was watching. The same file the TypeScript keeps, so the two daemons hand the
// watch back and forth rather than each starting over.
type TriggerStore struct {
	file string

	mutex  sync.Mutex
	states map[string]TriggerState
}

func NewTriggerStore(file string) *TriggerStore { return &TriggerStore{file: file} }

// load reads the file once. A file that will not read is an empty one: the cost is a baseline
// taken again, not a daemon that will not watch.
func (s *TriggerStore) load() map[string]TriggerState {
	if s.states != nil {
		return s.states
	}
	s.states = map[string]TriggerState{}
	if body, err := os.ReadFile(s.file); err == nil {
		json.Unmarshal(body, &s.states)
	}
	if s.states == nil {
		s.states = map[string]TriggerState{}
	}
	return s.states
}

// Get is where a trigger stood when it was last looked at, or nil where it never has been — which
// is the baseline every event trigger takes before it fires anything.
func (s *TriggerStore) Get(key string) TriggerState {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.load()[key]
}

func (s *TriggerStore) Set(key string, state TriggerState) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	states := s.load()
	if same(states[key], state) {
		return
	}
	states[key] = state
	s.save()
}

// Prune drops the cursors of triggers that are no longer there, so the file tracks the tasks.
func (s *TriggerStore) Prune(live map[string]bool) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	states := s.load()
	dropped := false
	for key := range states {
		if !live[key] {
			delete(states, key)
			dropped = true
		}
	}
	if dropped {
		s.save()
	}
}

func (s *TriggerStore) save() {
	body, err := json.MarshalIndent(s.states, "", "  ")
	if err != nil {
		return
	}
	utils.AtomicWrite(s.file, append(body, '\n'), 0o644)
}

// same compares two cursors the way the file does, since a cursor is whatever JSON the source
// handed back and there is nothing else to compare it as.
func same(before, after TriggerState) bool {
	first, err := json.Marshal(before)
	if err != nil {
		return false
	}
	second, err := json.Marshal(after)
	if err != nil {
		return false
	}
	return bytes.Equal(first, second)
}
