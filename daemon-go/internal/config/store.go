// The file, read and written. A read never fails: a config that would not parse costs its bad
// fields and nothing else, and a config that is not there is a first run.

package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

// Store holds the config the daemon is running on. Every request reads it and a few write it,
// so unlike the single thread this is ported from it has a lock.
type Store struct {
	File string

	mutex   sync.RWMutex
	current Config
	reset   []string
}

func NewStore(file string, defaults Config) *Store {
	return &Store{File: file, current: defaults, reset: []string{}}
}

func (s *Store) Config() Config {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	return s.current.Clone()
}

// Reset names the fields the last read had to throw away. Never nil: it is written into a JSON
// answer, and a caller reading the list has to find an empty one rather than a null.
func (s *Store) Reset() []string {
	s.mutex.RLock()
	defer s.mutex.RUnlock()
	return append(make([]string, 0, len(s.reset)), s.reset...)
}

func (s *Store) Load() Loaded {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	body, err := os.ReadFile(s.File)
	if errors.Is(err, fs.ErrNotExist) {
		s.reset = []string{}
		return Loaded{Config: s.current.Clone(), Reset: []string{}, Bindings: map[string]string{}}
	}

	// Anything else — an unreadable file, a file that is not JSON — is repaired from nothing,
	// which is what says every field was lost.
	var source json.RawMessage
	if err == nil && json.Unmarshal(body, &source) != nil {
		source = nil
	}
	loaded := Repair(source, s.current)
	s.current = loaded.Config
	s.reset = loaded.Reset
	return loaded
}

func (s *Store) Save(config Config) (Config, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	dir := filepath.Dir(s.File)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Config{}, err
	}
	// App state, not project content: a self-ignoring directory keeps the sync loop from
	// committing it without touching a .gitignore the user owns.
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte("*\n"), 0o644); err != nil {
		return Config{}, err
	}
	body, err := Marshal(config)
	if err != nil {
		return Config{}, err
	}
	if err := utils.AtomicWrite(s.File, body, 0o644); err != nil {
		return Config{}, err
	}
	s.current = config.Clone()
	s.reset = []string{}
	return s.current, nil
}

// Marshal is the file's bytes: two-space JSON with a trailing newline, and no HTML escaping —
// a project path with an ampersand in it is a path, not a document.
func Marshal(config Config) ([]byte, error) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(config); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
