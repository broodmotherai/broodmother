// The ledger's store: one row per act, one SQLite file in the broodmother home, beside the chats
// and the runs. On disk for the same reason they are — the question it answers is asked about work
// done yesterday, by an agent that was not running when it happened.
//
// Rows rather than a document, because half the paths are in repos, which are not the project's
// tree, and the actors are ids the app already keeps in SQLite.

package ledger

import (
	"database/sql"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
)

// keep is how many acts a project holds. A cap by count is arbitrary where a cap by age would be
// honest, and nobody has a number for the second one yet.
const keep = 5000

const schema = `
CREATE TABLE IF NOT EXISTS acts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  project TEXT NOT NULL,
  root TEXT NOT NULL,
  path TEXT NOT NULL,
  action TEXT NOT NULL,
  created INTEGER,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  actor_persona TEXT,
  actor_model TEXT,
  context TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS acts_by_path ON acts (project, root, path, id);
CREATE INDEX IF NOT EXISTS acts_by_project ON acts (project, id);
`

type Store struct {
	db *sql.DB
	// Now is the clock, for a test that needs to move it.
	Now func() time.Time
}

// Open makes the file if it is not there. A single connection: SQLite takes one writer at a time
// and the pool would otherwise hand two goroutines two of them and let the second find the file
// locked.
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
	return &Store{db: db, Now: time.Now}, nil
}

func (s *Store) Record(entry New) error {
	at := s.Now().UnixMilli()
	_, err := s.db.Exec(
		`INSERT INTO acts
		   (at, project, root, path, action, created, actor_kind, actor_id, actor_name,
		    actor_persona, actor_model, context, note)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		at, entry.Project, string(entry.Root), entry.Path, string(entry.Action),
		created(entry.Created), string(entry.Actor.Kind),
		null(entry.Actor.ID), null(entry.Actor.Name), null(entry.Actor.Persona),
		null(entry.Actor.Model), null(entry.Actor.Context), null(entry.Note))
	if err != nil {
		return err
	}
	return s.prune(entry.Project)
}

// prune drops the oldest once a project has more than it keeps. By cutoff rather than by NOT IN,
// because this runs on every write and the ledger is written to far more often than the runs are:
// one seek down the project's index finds the id to cut at, and the delete is a range rather than
// a scan.
func (s *Store) prune(project string) error {
	var cutoff int64
	err := s.db.QueryRow(
		`SELECT id FROM acts WHERE project = ? ORDER BY id DESC LIMIT 1 OFFSET ?`,
		project, keep).Scan(&cutoff)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`DELETE FROM acts WHERE project = ? AND id <= ?`, project, cutoff)
	return err
}

// ForPath is what was done to one path, newest first — because a row says what was true when it
// was written and nothing has told the ledger since.
func (s *Store) ForPath(project string, root doc.Root, path doc.Path, limit int) []Entry {
	return s.read(`SELECT at, project, root, path, action, created, actor_kind, actor_id,
	                      actor_name, actor_persona, actor_model, context, note
	               FROM acts WHERE project = ? AND root = ? AND path = ?
	               ORDER BY id DESC LIMIT ?`, project, string(root), path, limit)
}

// Recent is everything one project's ledger holds, newest first.
func (s *Store) Recent(project string, limit int) []Entry {
	return s.read(`SELECT at, project, root, path, action, created, actor_kind, actor_id,
	                      actor_name, actor_persona, actor_model, context, note
	               FROM acts WHERE project = ? ORDER BY id DESC LIMIT ?`, project, limit)
}

// read answers with what it found and nothing about what stopped it: a ledger that cannot be
// read is a document with no provenance, which is what a document had before any of this existed.
func (s *Store) read(query string, args ...any) []Entry {
	found := []Entry{}
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return found
	}
	defer rows.Close()
	for rows.Next() {
		var entry Entry
		var madeIt sql.NullInt64
		var id, name, persona, model, context, note sql.NullString
		if rows.Scan(&entry.At, &entry.Project, &entry.Root, &entry.Path, &entry.Action,
			&madeIt, &entry.Actor.Kind, &id, &name, &persona, &model, &context, &note) != nil {
			return found
		}
		entry.Actor.ID, entry.Actor.Name = id.String, name.String
		entry.Actor.Persona, entry.Actor.Model = persona.String, model.String
		entry.Actor.Context, entry.Note = context.String, note.String
		if madeIt.Valid {
			was := madeIt.Int64 != 0
			entry.Created = &was
		}
		found = append(found, entry)
	}
	return found
}

func (s *Store) Close() error { return s.db.Close() }

func null(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func created(said *bool) any {
	if said == nil {
		return nil
	}
	if *said {
		return 1
	}
	return 0
}
