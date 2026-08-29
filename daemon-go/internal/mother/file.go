// Filing what was noticed, and surfacing what survived the gate.
//
// Evidence doubles as identity: the digest is taken over the rule, what it was about and the words
// themselves, so a rule wording its evidence from what stays still while the fact holds — a run id,
// a since-timestamp — sees the same fact on every beat as one moment.

package mother

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

// keep is how many moments the file holds. What was noticed a thousand moments ago is not what the
// feed is for.
const keep = 500

// New is a moment as it is filed.
type New struct {
	Rule     string
	Ref      *doc.Ref
	Evidence string
	PNeed    float64
	SeenAt   int64
}

// File is the moment filed as held, or the one already filed for the same fact — and whether this
// was the first sighting, which is what decides whether anything is spent on it.
func (s *Store) File(one New) (Moment, bool) {
	digest := digestOf(one)
	var root, path any
	if one.Ref != nil {
		root, path = string(one.Ref.Root), string(one.Ref.Path)
	}
	result, err := s.db.Exec(
		`INSERT INTO moments (rule, digest, root, path, evidence, p_need, seen_at, outcome)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 'held') ON CONFLICT (digest) DO NOTHING`,
		one.Rule, digest, root, path, one.Evidence, one.PNeed, one.SeenAt)
	if err != nil {
		return Moment{}, false
	}
	changed, _ := result.RowsAffected()
	fresh := changed > 0
	if fresh {
		s.prune()
	}
	held, found := scanMoment(s.db.QueryRow(
		`SELECT id, rule, root, path, evidence, p_need, seen_at, outcome FROM moments WHERE digest = ?`,
		digest))
	return held, found && fresh
}

// Outcome is what became of a moment: quiet where the deliberation had nothing to say, surfaced
// where it did.
func (s *Store) Outcome(id string, outcome Outcome) {
	s.db.Exec(`UPDATE moments SET outcome = ? WHERE id = ?`, string(outcome), rowID(id))
}

// Suggest files the suggestion, marks its moment surfaced, and counts the showing against the rule
// — the denominator of its acceptance rate.
func (s *Store) Suggest(moment, text, record string, shownAt int64) (Suggestion, bool) {
	row := rowID(moment)
	var held any
	if record != "" {
		held = record
	}
	result, err := s.db.Exec(
		`INSERT INTO suggestions (moment, text, record, shown_at) VALUES (?, ?, ?, ?)`,
		row, text, held, shownAt)
	if err != nil {
		return Suggestion{}, false
	}
	s.db.Exec(`UPDATE moments SET outcome = 'surfaced' WHERE id = ?`, row)

	var rule string
	s.db.QueryRow(`SELECT rule FROM moments WHERE id = ?`, row).Scan(&rule)
	s.db.Exec(`INSERT INTO rules (rule) VALUES (?) ON CONFLICT DO NOTHING`, rule)
	s.db.Exec(`UPDATE rules SET shown = shown + 1 WHERE rule = ?`, rule)

	id, err := result.LastInsertId()
	if err != nil {
		return Suggestion{}, false
	}
	return s.suggestion(id)
}

// Enabled is whether a rule is switched on. One nobody has said anything about is: a rule added in
// a later version starts working rather than starting silent.
func (s *Store) Enabled(rule string) bool {
	var enabled int
	if s.db.QueryRow(`SELECT enabled FROM rules WHERE rule = ?`, rule).Scan(&enabled) != nil {
		return true
	}
	return enabled == 1
}

// prune keeps the file to [keep] moments, and takes their suggestions with them.
func (s *Store) prune() {
	s.db.Exec(`DELETE FROM suggestions WHERE moment IN
		(SELECT id FROM moments WHERE id NOT IN
		 (SELECT id FROM moments ORDER BY id DESC LIMIT ?))`, keep)
	s.db.Exec(`DELETE FROM moments WHERE id NOT IN
		(SELECT id FROM moments ORDER BY id DESC LIMIT ?)`, keep)
}

func digestOf(one New) string {
	root, path := "", ""
	if one.Ref != nil {
		root, path = string(one.Ref.Root), string(one.Ref.Path)
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{one.Rule, root, path, one.Evidence}, "\n")))
	return hex.EncodeToString(sum[:])
}
