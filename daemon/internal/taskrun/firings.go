// The firings a watch owes a run: what a look at a source turned up, kept until a run has
// carried it.
//
// On disk beside the runs because a watch that saw something while nothing was listening still
// owes a run — a server that noticed an issue and then restarted would otherwise have moved its
// cursor past a firing nothing will ever see again.

package taskrun

import (
	"database/sql"
	"encoding/json"
	"strconv"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
)

// firingsSchema is the TypeScript's, written here too so a home that has only ever run this
// daemon still answers rather than failing on a table that is not there.
const firingsSchema = `
CREATE TABLE IF NOT EXISTS firings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root TEXT NOT NULL,
  path TEXT NOT NULL,
  node TEXT NOT NULL,
  payload TEXT NOT NULL,
  about TEXT,
  created_at INTEGER NOT NULL,
  run_id TEXT
);
CREATE INDEX IF NOT EXISTS firings_pending ON firings (root, path, run_id, id);
`

// Subject is what a firing was about, where the source has something a later step can act on:
// the issue to answer, the commit that went red.
//
// Tagged by provider rather than shaped like whichever service happened to be first: a step that
// reads one checks whose it is before trusting the rest, so a second service is another member
// here rather than a second file in the run's folder.
type Subject struct {
	Provider string `json:"provider"`
	Repo     string `json:"repo"`
	Number   *int   `json:"number,omitempty"`
	URL      string `json:"url"`
	SHA      string `json:"sha,omitempty"`
}

// Firing is one thing a look turned up. Payload becomes the trigger node's output, so the graph
// downstream reads what happened.
type Firing struct {
	Payload string   `json:"payload"`
	About   *Subject `json:"about,omitempty"`
}

// Pending is a firing waiting for a run, and the id that claims it.
type Pending struct {
	ID     string
	Node   string
	Firing Firing
}

// Enqueue writes down what a watch saw. Written the moment it is seen and claimed only when a run
// starts on it, so a batch of three arrives as three runs one after another and a firing that
// lands mid-run waits its turn instead of vanishing.
func (s *Store) Enqueue(ref doc.Ref, node string, firing Firing, at int64) error {
	var about any
	if firing.About != nil {
		encoded, err := json.Marshal(firing.About)
		if err != nil {
			return err
		}
		about = string(encoded)
	}
	_, err := s.db.Exec(
		`INSERT INTO firings (root, path, node, payload, about, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		string(ref.Root), string(ref.Path), node, firing.Payload, about, at)
	return err
}

// Pending is the oldest firing nothing has run yet, for one task.
func (s *Store) Pending(ref doc.Ref) *Pending {
	var (
		id            int64
		node, payload string
		about         sql.NullString
	)
	row := s.db.QueryRow(
		`SELECT id, node, payload, about FROM firings WHERE root = ? AND path = ? AND run_id IS NULL
		 ORDER BY id LIMIT 1`, string(ref.Root), string(ref.Path))
	if row.Scan(&id, &node, &payload, &about) != nil {
		return nil
	}
	held := Pending{ID: strconv.FormatInt(id, 10), Node: node, Firing: Firing{Payload: payload}}
	if about.Valid {
		var subject Subject
		if json.Unmarshal([]byte(about.String), &subject) == nil {
			held.Firing.About = &subject
		}
	}
	return &held
}

// Waiting is the tasks with a firing nothing has run yet, so a drain asks about those and no
// others.
func (s *Store) Waiting() []doc.Ref {
	rows, err := s.db.Query(
		`SELECT DISTINCT root, path FROM firings WHERE run_id IS NULL ORDER BY root, path`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var waiting []doc.Ref
	for rows.Next() {
		var root, path string
		if rows.Scan(&root, &path) == nil {
			waiting = append(waiting, doc.Ref{Root: doc.Root(root), Path: doc.Path(path)})
		}
	}
	return waiting
}

// Claim marks a firing as the reason a run exists.
func (s *Store) Claim(id, runID string) error {
	number, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE firings SET run_id = ? WHERE id = ?`, runID, number)
	return err
}

// PruneFirings drops what is queued for tasks that are no longer there, the way the trigger
// cursors go. A claimed firing stays: it is part of why a run in the record happened.
func (s *Store) PruneFirings(live map[string]bool) {
	for _, ref := range s.Waiting() {
		if live[string(ref.Root)+":"+string(ref.Path)] {
			continue
		}
		s.db.Exec(`DELETE FROM firings WHERE root = ? AND path = ? AND run_id IS NULL`,
			string(ref.Root), string(ref.Path))
	}
}
