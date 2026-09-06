// Every conversation and everything said in one, in a SQLite file in the broodmother home —
// beside the runs and the ledger, and on disk for the same reason: a chat you cannot come back to
// tomorrow is a chat you have to hold in your head today.
//
// A conversation belongs to the project it was held in. The project is the absolute path of the
// folder, which is what the config calls one, so a project that moves takes its chats with it only
// if it is opened by the path it moved to — the same bargain every other per-project thing in the
// app makes.
//
// The schema is the whole of the TypeScript's, agents and reports included, because both daemons
// open the same file: one that made only the tables it reads would leave the other to find its own
// half missing, and a file written before a column existed has to reach the head of the list
// whichever of them opens it.

package chat

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chats_by_project ON chats (project, id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  steps TEXT,
  from_agent TEXT
);
CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat, id);
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  persona TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT NOT NULL,
  chat INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_by_project ON agents (project, id);
CREATE TABLE IF NOT EXISTS reports (
  agent INTEGER NOT NULL,
  lead INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_by_agent ON reports (agent);
`

// renames run before the schema: `CREATE TABLE IF NOT EXISTS` would otherwise make an empty table
// beside the rows and leave the rename to find its name taken. Each checks before it acts, the way
// the migrations do.
var renames = []func(*sql.DB){
	func(db *sql.DB) { renameTable(db, "coworkers", "agents") },
	func(db *sql.DB) { renameColumn(db, "chats", "coworker", "agent") },
}

// migrations are the columns added after the first file was written. `CREATE TABLE IF NOT EXISTS`
// does nothing to a table that is already there, so each one is added by hand — and each checks
// before it alters, so the list runs whole on every open and a file at any age ends up at the head
// of it.
var migrations = []func(*sql.DB){
	// Answers grew steps: what a reply did on its way to being written.
	func(db *sql.DB) { addColumn(db, "messages", "steps", "TEXT") },
	// A chat may be an agent's one running conversation, which the chats list leaves out.
	func(db *sql.DB) { addColumn(db, "chats", "agent", "INTEGER") },
	// Where an agent stands on the org chart. Null is nobody has placed it, which is every agent
	// until somebody drags one.
	func(db *sql.DB) { addColumn(db, "agents", "x", "INTEGER") },
	func(db *sql.DB) { addColumn(db, "agents", "y", "INTEGER") },
	// Who said it, where that is another agent rather than the person: an agent id. Null on
	// everything the person typed, which is most of what is in here.
	func(db *sql.DB) { addColumn(db, "messages", "from_agent", "TEXT") },
	// How far into their thread the person has read: the id of the last message they were shown.
	// A message id rather than a time, because ids are monotonic and two messages written in the
	// same millisecond — a delivery and the empty row opened for its answer — cannot be told
	// apart by a clock. Everything already said is marked read as the column arrives, once and
	// only here: a file that predates the count opening to a badge of forty is a badge nobody
	// believes. An agent made after this starts at nothing, over a thread with nothing in it.
	readSoFar,
}

// readSoFar adds the read mark and, in the same breath, marks everything already said as read.
// The backfill belongs to the moment the column arrives rather than to every open: run again over
// an agent who has been messaged since, it would quietly mark the thing they said as read.
func readSoFar(db *sql.DB) {
	if hasColumn(db, "agents", "seen") {
		return
	}
	db.Exec(`ALTER TABLE agents ADD COLUMN seen INTEGER`)
	db.Exec(`UPDATE agents SET seen =
		COALESCE((SELECT MAX(id) FROM messages WHERE messages.chat = agents.chat), 0)`)
}

func hasTable(db *sql.DB, table string) bool {
	var name string
	err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&name)
	return err == nil
}

func columnsOf(db *sql.DB, table string) []string {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var found []string
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil {
			found = append(found, name)
		}
	}
	return found
}

func hasColumn(db *sql.DB, table, column string) bool {
	for _, one := range columnsOf(db, table) {
		if one == column {
			return true
		}
	}
	return false
}

func addColumn(db *sql.DB, table, column, kind string) {
	if hasColumn(db, table, column) {
		return
	}
	db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + kind)
}

// renameTable carries the old table's indexes with it under their old names, so the one the schema
// declares is dropped and made again beside the schema it belongs to.
func renameTable(db *sql.DB, from, to string) {
	if !hasTable(db, from) || hasTable(db, to) {
		return
	}
	db.Exec(`ALTER TABLE ` + from + ` RENAME TO ` + to)
	db.Exec(`DROP INDEX IF EXISTS ` + from + `_by_project`)
}

func renameColumn(db *sql.DB, table, from, to string) {
	if !hasColumn(db, table, from) || hasColumn(db, table, to) {
		return
	}
	db.Exec(`ALTER TABLE ` + table + ` RENAME COLUMN ` + from + ` TO ` + to)
}

type Store struct {
	db *sql.DB
	// Now is the clock, for a test that needs to hold it still.
	Now func() time.Time
}

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
	for _, rename := range renames {
		rename(db)
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	for _, migrate := range migrations {
		migrate(db)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) now() int64 {
	if s.Now != nil {
		return s.Now().UnixMilli()
	}
	return time.Now().UnixMilli()
}

// Create is an empty conversation in a project, named until something is said in it.
func (s *Store) Create(project, model string) (Chat, error) {
	at := s.now()
	result, err := s.db.Exec(
		`INSERT INTO chats (project, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		project, NewChat, model, at, at)
	if err != nil {
		return Chat{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return Chat{}, err
	}
	return Chat{
		Summary:  Summary{ID: chatID(id), Title: NewChat, Model: model, UpdatedAt: at},
		Messages: []Message{},
	}, nil
}

// List is one project's conversations, newest first. Without their messages: the rail beside a
// chat draws names, and reading every word of every conversation to write a list of titles is a
// question nobody asked. An agent's thread is not among them — it is reached through the agent,
// and listing it here would be the same conversation twice in the rail.
func (s *Store) List(project string) []Summary {
	rows, err := s.db.Query(
		`SELECT id, title, model, updated_at FROM chats WHERE project = ? AND agent IS NULL
		 ORDER BY updated_at DESC, id DESC`, project)
	if err != nil {
		return []Summary{}
	}
	defer rows.Close()
	found := []Summary{}
	for rows.Next() {
		var (
			id           int64
			title, model string
			updatedAt    int64
		)
		if rows.Scan(&id, &title, &model, &updatedAt) == nil {
			found = append(found, Summary{ID: chatID(id), Title: title, Model: model, UpdatedAt: updatedAt})
		}
	}
	return found
}

// Chat is one conversation, whole. Not found is a chat that is not there — deleted in another
// window, or an id that outlived the project it was made in.
func (s *Store) Chat(id string) (Chat, bool) {
	var (
		row          int64
		title, model string
		updatedAt    int64
	)
	err := s.db.QueryRow(`SELECT id, title, model, updated_at FROM chats WHERE id = ?`, rowID(id)).
		Scan(&row, &title, &model, &updatedAt)
	if err != nil {
		return Chat{}, false
	}
	return Chat{
		Summary:  Summary{ID: chatID(row), Title: title, Model: model, UpdatedAt: updatedAt},
		Messages: s.messages(rowID(id)),
	}, true
}

func (s *Store) messages(chat int64) []Message {
	rows, err := s.db.Query(
		`SELECT id, role, text, created_at, steps, from_agent FROM messages WHERE chat = ? ORDER BY id`, chat)
	if err != nil {
		return []Message{}
	}
	defer rows.Close()
	found := []Message{}
	for rows.Next() {
		var (
			id          int64
			role, text  string
			at          int64
			steps, from sql.NullString
		)
		if rows.Scan(&id, &role, &text, &at, &steps, &from) != nil {
			continue
		}
		message := Message{ID: messageID(id), Role: role, Text: text, At: at, From: from.String}
		// Absent rather than empty: a message that did nothing has no working to show, and a page
		// drawing an empty list of steps would leave a gap where the answer should start.
		if steps.Valid && steps.String != "" {
			json.Unmarshal([]byte(steps.String), &message.Steps)
		}
		found = append(found, message)
	}
	return found
}

// Remove takes the conversation and everything said in it.
func (s *Store) Remove(id string) error {
	if _, err := s.db.Exec(`DELETE FROM messages WHERE chat = ?`, rowID(id)); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM chats WHERE id = ?`, rowID(id))
	return err
}

func chatID(row int64) string    { return "chat-" + strconv.FormatInt(row, 10) }
func messageID(row int64) string { return "msg-" + strconv.FormatInt(row, 10) }

// rowID is the number an id stands for, which is what every table here is keyed by.
func rowID(id string) int64 {
	for _, prefix := range []string{"chat-", "msg-", "agent-"} {
		if rest, found := strings.CutPrefix(id, prefix); found {
			number, err := strconv.ParseInt(rest, 10, 64)
			if err != nil {
				return 0
			}
			return number
		}
	}
	number, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return 0
	}
	return number
}
