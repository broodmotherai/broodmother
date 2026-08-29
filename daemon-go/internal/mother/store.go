// Everything Mother has noticed, said and been told: one SQLite file in the broodmother home,
// beside the runs and the chats. The digest on a moment is the dedup — the same fact observed
// twice is one moment, so nothing is raised twice.

package mother

import (
	"database/sql"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"

	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

// defaultCFA is where the frequency slider sits before anybody moves it.
const defaultCFA = 0.5

// feedShown is how much of the feed the page draws.
const feedShown = 50

const schema = `
CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  root TEXT,
  path TEXT,
  evidence TEXT NOT NULL,
  p_need REAL NOT NULL,
  seen_at INTEGER NOT NULL,
  outcome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment INTEGER NOT NULL UNIQUE,
  text TEXT NOT NULL,
  record TEXT,
  shown_at INTEGER NOT NULL,
  verdict TEXT
);
CREATE TABLE IF NOT EXISTS rules (
  rule TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  shown INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

type Store struct{ db *sql.DB }

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

// Feed is the page's: moments newest first, each with its suggestion where one was made.
func (s *Store) Feed() []Item {
	rows, err := s.db.Query(
		`SELECT id, rule, root, path, evidence, p_need, seen_at, outcome FROM moments
		 ORDER BY id DESC LIMIT ?`, feedShown)
	if err != nil {
		return []Item{}
	}
	defer rows.Close()
	moments := []Moment{}
	for rows.Next() {
		if one, ok := scanMoment(rows); ok {
			moments = append(moments, one)
		}
	}

	found := make([]Item, 0, len(moments))
	for _, one := range moments {
		item := Item{Moment: one}
		if held, ok := s.suggestionOf(rowID(one.ID), one); ok {
			item.Suggestion = &held
		}
		found = append(found, item)
	}
	return found
}

type scanner interface{ Scan(...any) error }

func scanMoment(rows scanner) (Moment, bool) {
	var (
		id                     int64
		rule, evidence, result string
		root, path             sql.NullString
		pNeed                  float64
		seenAt                 int64
	)
	if rows.Scan(&id, &rule, &root, &path, &evidence, &pNeed, &seenAt, &result) != nil {
		return Moment{}, false
	}
	one := Moment{
		ID: "moment-" + strconv.FormatInt(id, 10), Rule: rule, Evidence: evidence,
		PNeed: pNeed, SeenAt: seenAt, Outcome: Outcome(result),
	}
	if root.Valid && path.Valid {
		one.Ref = &doc.Ref{Root: doc.Root(root.String), Path: doc.Path(path.String)}
	}
	return one, true
}

func (s *Store) suggestionOf(moment int64, about Moment) (Suggestion, bool) {
	var (
		id              int64
		text            string
		record, verdict sql.NullString
		shownAt         int64
	)
	err := s.db.QueryRow(
		`SELECT id, text, record, shown_at, verdict FROM suggestions WHERE moment = ?`, moment).
		Scan(&id, &text, &record, &shownAt, &verdict)
	if err != nil {
		return Suggestion{}, false
	}
	return Suggestion{
		ID: "suggestion-" + strconv.FormatInt(id, 10), Moment: about.ID, Rule: about.Rule,
		Text: text, Ref: about.Ref, Record: record.String, ShownAt: shownAt,
		Verdict: Verdict(verdict.String),
	}, true
}

// suggestion is one by its own id, with the moment it is about read alongside — a suggestion says
// which rule raised it and what it is about, and both of those live on the moment.
func (s *Store) suggestion(id int64) (Suggestion, bool) {
	var moment int64
	if s.db.QueryRow(`SELECT moment FROM suggestions WHERE id = ?`, id).Scan(&moment) != nil {
		return Suggestion{}, false
	}
	rows, err := s.db.Query(
		`SELECT id, rule, root, path, evidence, p_need, seen_at, outcome FROM moments WHERE id = ?`, moment)
	if err != nil {
		return Suggestion{}, false
	}
	defer rows.Close()
	if !rows.Next() {
		return Suggestion{}, false
	}
	about, ok := scanMoment(rows)
	if !ok {
		return Suggestion{}, false
	}
	rows.Close()
	return s.suggestionOf(moment, about)
}

// Verdict is what you told a suggestion. One already answered keeps the answer it had: a verdict
// is a thing you said once, and the tally underneath it is counted once too.
func (s *Store) Verdict(id string, verdict Verdict) (Suggestion, bool) {
	held, found := s.suggestion(rowID(id))
	if !found {
		return Suggestion{}, false
	}
	if held.Verdict == Accepted || held.Verdict == Dismissed {
		return held, true
	}
	if _, err := s.db.Exec(`UPDATE suggestions SET verdict = ? WHERE id = ?`, string(verdict), rowID(id)); err != nil {
		return Suggestion{}, false
	}
	if verdict == Accepted {
		s.db.Exec(`UPDATE rules SET accepted = accepted + 1 WHERE rule = ?`, held.Rule)
	}
	return s.suggestion(rowID(id))
}

// Rules is every rule the file knows of and how it has been received.
func (s *Store) Rules() []RuleStatus {
	rows, err := s.db.Query(`SELECT rule, enabled, shown, accepted FROM rules ORDER BY rule`)
	if err != nil {
		return []RuleStatus{}
	}
	defer rows.Close()
	found := []RuleStatus{}
	for rows.Next() {
		var (
			rule                     string
			enabled, shown, accepted int64
		)
		if rows.Scan(&rule, &enabled, &shown, &accepted) == nil {
			found = append(found, RuleStatus{Rule: rule, Enabled: enabled == 1, Shown: shown, Accepted: accepted})
		}
	}
	return found
}

// Enable turns one rule on or off. A rule nothing has said anything about yet is on, so this is
// the first row it gets.
func (s *Store) Enable(rule string, enabled bool) {
	held := 0
	if enabled {
		held = 1
	}
	s.db.Exec(`INSERT INTO rules (rule, enabled) VALUES (?, ?)
		ON CONFLICT (rule) DO UPDATE SET enabled = excluded.enabled`, rule, held)
}

func (s *Store) Settings() Settings {
	held := Settings{On: true, CFA: defaultCFA}
	if on, said := s.setting("on"); said {
		held.On = on == "1"
	}
	if cfa, said := s.setting("cfa"); said {
		if number, err := strconv.ParseFloat(cfa, 64); err == nil {
			held.CFA = number
		}
	}
	return held
}

// Configure writes what a settings request said, and says nothing about what it left out.
func (s *Store) Configure(on *bool, cfa *float64) Settings {
	if on != nil {
		held := "0"
		if *on {
			held = "1"
		}
		s.set("on", held)
	}
	if cfa != nil {
		s.set("cfa", strconv.FormatFloat(*cfa, 'f', -1, 64))
	}
	return s.Settings()
}

func (s *Store) SweptAt() *int64 {
	held, said := s.setting("swept_at")
	if !said {
		return nil
	}
	at, err := strconv.ParseInt(held, 10, 64)
	if err != nil {
		return nil
	}
	return &at
}

// Swept records that a look happened, whether or not it found anything.
func (s *Store) Swept(at int64) { s.set("swept_at", strconv.FormatInt(at, 10)) }

func (s *Store) setting(key string) (string, bool) {
	var value string
	if s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value) != nil {
		return "", false
	}
	return value, true
}

func (s *Store) set(key, value string) {
	s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
}

func rowID(id string) int64 {
	if at := strings.IndexByte(id, '-'); at >= 0 {
		id = id[at+1:]
	}
	number, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return 0
	}
	return number
}
