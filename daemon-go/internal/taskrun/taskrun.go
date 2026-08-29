// Package taskrun is the record of every run a task has had: one SQLite file in the broodmother
// home, beside the ledger and the chats.
//
// On disk rather than in memory because the point of a box in the corner running tasks all day is
// being able to come back and read what they did — and because a run either daemon walked is a
// run both of them list.
//
// The firings a watch owes a run are beside them, in `firings.go`.
package taskrun

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"

	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/task"
)

// The schema is the TypeScript's, written here too so a home that has only ever run this daemon
// still answers rather than failing on a table that is not there.
const schema = `
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT NOT NULL,
  path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  state TEXT NOT NULL,
  error TEXT,
  steps TEXT NOT NULL,
  pruned TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_task ON runs (root, path, id);
` + firingsSchema

// StepState is where one step of a walk got to.
type StepState string

const (
	Waiting StepState = "waiting"
	Running StepState = "running"
	Done    StepState = "done"
	Errored StepState = "error"
	Skipped StepState = "skipped"
	// Stopped: the step chose to end the flow — a deliberate halt, not a failure.
	Stopped StepState = "stopped"
	// Off: the node is switched off, so it passed its input straight on and did no work.
	Off StepState = "off"
	// Held: waiting on a person — the step asked for approval and the run is standing at it.
	Held StepState = "held"
)

type Step struct {
	Node  string    `json:"node"`
	Name  string    `json:"name"`
	Kind  task.Kind `json:"kind"`
	State StepState `json:"state"`
	// Output is a pointer because a step that ran and said nothing is not a step that has not
	// run: the first carries an empty string and the second carries no key at all.
	Output *string `json:"output,omitempty"`
	Error  string  `json:"error,omitempty"`
	// Halted is why a stopped step stopped, in the step's own words.
	Halted string `json:"halted,omitempty"`
	// Asked is what a held step is waiting to be told, for the page to put the question to
	// somebody.
	Asked string `json:"asked,omitempty"`
}

// State is where the run as a whole got to. Paused is standing at a held step, waiting on a
// person; it is the one unfinished state a restarted server can pick up again, because it was
// written at a step boundary.
type State string

const (
	RunRunning State = "running"
	RunPaused  State = "paused"
	RunDone    State = "done"
	RunError   State = "error"
)

// The field order is the wire order, and it is the TypeScript's: what a run is, then how far it
// got, then the three things only some runs have anything to say about.
type Run struct {
	ID        string  `json:"id"`
	Ref       doc.Ref `json:"ref"`
	StartedAt int64   `json:"startedAt"`
	State     State   `json:"state"`
	Steps     []Step  `json:"steps"`

	FinishedAt *int64 `json:"finishedAt,omitempty"`
	Error      string `json:"error,omitempty"`
	// Pruned are the edges a gate held, a verdict passed over or a stop ended, as `from>to`.
	// Absent rather than empty where nothing was ruled out: a run carrying `[]` reads as one
	// that had something to say about its edges.
	Pruned []string `json:"pruned,omitempty"`
	// Scratch is the run's folder of hand-off files — what each step read and wrote. Derived
	// rather than stored: the base and the id say it all.
	Scratch string `json:"scratch,omitempty"`
}

// Clone is a run nothing else holds a reference into. A run handed out while its walk is still
// moving would otherwise share the steps being written, and the answer would be encoded from
// under it.
func (r Run) Clone() Run {
	held := r
	held.Steps = slices.Clone(r.Steps)
	held.Pruned = slices.Clone(r.Pruned)
	if r.FinishedAt != nil {
		at := *r.FinishedAt
		held.FinishedAt = &at
	}
	return held
}

type Store struct{ db *sql.DB }

// Open makes the file if it is not there. A single connection, for the reason the ledger's gives:
// SQLite takes one writer at a time.
func Open(file string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", file)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

// RunsFor is one task's runs, newest first.
func (s *Store) RunsFor(ref doc.Ref, limit int) []Run {
	return s.query(`SELECT id, root, path, started_at, finished_at, state, error, steps, pruned
		FROM runs WHERE root = ? AND path = ? ORDER BY id DESC LIMIT ?`, ref.Root, ref.Path, limit)
}

// Recent is every task's runs together, newest first — the page's log.
func (s *Store) Recent(limit int) []Run {
	return s.query(`SELECT id, root, path, started_at, finished_at, state, error, steps, pruned
		FROM runs ORDER BY id DESC LIMIT ?`, limit)
}

// query answers with what it could read. A store that will not answer is a page with no log,
// which is worth less than the rest of the daemon.
func (s *Store) query(statement string, args ...any) []Run {
	rows, err := s.db.Query(statement, args...)
	if err != nil {
		return []Run{}
	}
	defer rows.Close()

	found := []Run{}
	for rows.Next() {
		var (
			id                     int64
			root, path, state      string
			startedAt              int64
			finishedAt             sql.NullInt64
			failure, steps, pruned sql.NullString
		)
		if rows.Scan(&id, &root, &path, &startedAt, &finishedAt, &state, &failure, &steps, &pruned) != nil {
			continue
		}
		run := Run{
			ID:        "run-" + strconv.FormatInt(id, 10),
			Ref:       doc.Ref{Root: doc.Root(root), Path: doc.Path(path)},
			StartedAt: startedAt,
			State:     State(state),
			Steps:     []Step{},
			Error:     failure.String,
		}
		if finishedAt.Valid {
			at := finishedAt.Int64
			run.FinishedAt = &at
		}
		if steps.Valid {
			json.Unmarshal([]byte(steps.String), &run.Steps)
		}
		if run.Steps == nil {
			run.Steps = []Step{}
		}
		if pruned.Valid {
			json.Unmarshal([]byte(pruned.String), &run.Pruned)
		}
		if len(run.Pruned) == 0 {
			run.Pruned = nil
		}
		found = append(found, run)
	}
	return found
}

// keep is how many runs one task holds. Runs a task has already had are history worth keeping;
// keeping every one of them for ever is not.
const keep = 100

// Add files a run: the id it will be saved under from here on, and the ids the trim let go — so
// whatever those runs left on disk can go with them.
func (s *Store) Add(run Run) (string, []string, error) {
	steps, err := json.Marshal(run.Steps)
	if err != nil {
		return "", nil, err
	}
	pruned, err := json.Marshal(orEmpty(run.Pruned))
	if err != nil {
		return "", nil, err
	}
	result, err := s.db.Exec(
		`INSERT INTO runs (root, path, started_at, finished_at, state, error, steps, pruned)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		string(run.Ref.Root), string(run.Ref.Path), run.StartedAt, finishedOr(run),
		string(run.State), nullable(run.Error), string(steps), string(pruned))
	if err != nil {
		return "", nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return "", nil, err
	}
	return "run-" + strconv.FormatInt(id, 10), s.trim(run.Ref), nil
}

// trim takes the oldest runs of one task past [keep], and answers with what it let go. Read
// before the delete, since afterwards there is nothing left to name.
func (s *Store) trim(ref doc.Ref) []string {
	const over = `SELECT id FROM runs WHERE root = ? AND path = ? AND id NOT IN
		(SELECT id FROM runs WHERE root = ? AND path = ? ORDER BY id DESC LIMIT ?)`
	root, path := string(ref.Root), string(ref.Path)
	var dropped []string
	rows, err := s.db.Query(over, root, path, root, path, keep)
	if err != nil {
		return nil
	}
	for rows.Next() {
		var old int64
		if rows.Scan(&old) == nil {
			dropped = append(dropped, "run-"+strconv.FormatInt(old, 10))
		}
	}
	rows.Close()
	if len(dropped) == 0 {
		return nil
	}
	s.db.Exec(`DELETE FROM runs WHERE root = ? AND path = ? AND id NOT IN
		(SELECT id FROM runs WHERE root = ? AND path = ? ORDER BY id DESC LIMIT ?)`,
		root, path, root, path, keep)
	return dropped
}

func finishedOr(run Run) any {
	if run.FinishedAt != nil {
		return *run.FinishedAt
	}
	return nil
}

// Unfinished is the runs that were not finished when they were last written: one the server died
// mid-walk, one waiting on somebody to approve it. Told apart by their state.
func (s *Store) Unfinished() []Run {
	return s.query(`SELECT id, root, path, started_at, finished_at, state, error, steps, pruned
		FROM runs WHERE state IN ('running', 'paused') ORDER BY id`)
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// Save writes the whole run again, steps and all.
func (s *Store) Save(run Run) error {
	steps, err := json.Marshal(run.Steps)
	if err != nil {
		return err
	}
	pruned, err := json.Marshal(orEmpty(run.Pruned))
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`UPDATE runs SET finished_at = ?, state = ?, error = ?, steps = ?, pruned = ? WHERE id = ?`,
		finishedOr(run), string(run.State), nullable(run.Error), string(steps), string(pruned), rowID(run.ID))
	return err
}

func orEmpty(held []string) []string {
	if held == nil {
		return []string{}
	}
	return held
}

func rowID(id string) int64 {
	number, err := strconv.ParseInt(strings.TrimPrefix(id, "run-"), 10, 64)
	if err != nil {
		return 0
	}
	return number
}

// ScratchOf is where a run's files are: one folder per run, under the base the home gives it.
func ScratchOf(base, id string) string { return filepath.Join(base, id) }

// ScratchBase is where all of them go, which is the home's `tasks/runs`.
func ScratchBase(home string) string { return filepath.Join(home, "tasks", "runs") }
