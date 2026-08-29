// Package mother is what Mother has noticed, said, and been told.
//
// The noticing is `rules.go` — deterministic looks at state the daemon already holds — and the
// deciding is `beat.go`, which spends a deliberation only on what clears the gate. Around them is
// everything this file holds: the record of what has been surfaced, the verdicts you gave it, the
// per-rule tally those verdicts add up to, and the two settings that decide whether any of it
// happens at all.
package mother

import (
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

// Outcome is where a moment got to. Held is the gate saying no; quiet is deliberated and nothing
// worth saying; surfaced is a suggestion made.
type Outcome string

const (
	Held     Outcome = "held"
	Quiet    Outcome = "quiet"
	Surfaced Outcome = "surfaced"
)

// Verdict is what you told a suggestion.
type Verdict string

const (
	Accepted  Verdict = "accepted"
	Dismissed Verdict = "dismissed"
	Expired   Verdict = "expired"
)

func (v Verdict) Valid() bool { return v == Accepted || v == Dismissed || v == Expired }

// Moment is one thing noticed. The field order is the wire order, and it is the TypeScript's:
// what was noticed, then — only where there is one — what it was about.
type Moment struct {
	ID   string `json:"id"`
	Rule string `json:"rule"`
	// Evidence is what was seen, in words a deliberation can weigh.
	Evidence string `json:"evidence"`
	// PNeed is how much the rule thinks you need to hear it.
	PNeed   float64  `json:"pNeed"`
	SeenAt  int64    `json:"seenAt"`
	Outcome Outcome  `json:"outcome"`
	Ref     *doc.Ref `json:"ref,omitempty"`
}

type Suggestion struct {
	ID      string   `json:"id"`
	Moment  string   `json:"moment"`
	Rule    string   `json:"rule"`
	Text    string   `json:"text"`
	ShownAt int64    `json:"shownAt"`
	Ref     *doc.Ref `json:"ref,omitempty"`
	// Record is the entity written alongside, where the deliberation found something durable.
	Record  string  `json:"record,omitempty"`
	Verdict Verdict `json:"verdict,omitempty"`
}

// RuleStatus is one rule and how it has been received: shown is the denominator, accepted the
// numerator.
type RuleStatus struct {
	Rule     string `json:"rule"`
	Enabled  bool   `json:"enabled"`
	Shown    int64  `json:"shown"`
	Accepted int64  `json:"accepted"`
}

type Settings struct {
	On bool `json:"on"`
	// CFA is PRISM's cost of a false alarm against a missed help held at 1. The frequency
	// slider: higher is quieter, because the gate's threshold rises with it.
	CFA float64 `json:"cfa"`
}

// Item is one row of the page's feed: what was noticed, and what was said about it where
// anything was.
type Item struct {
	Moment     Moment      `json:"moment"`
	Suggestion *Suggestion `json:"suggestion,omitempty"`
}

// Status is the whole of what the page draws.
type Status struct {
	Settings Settings     `json:"settings"`
	Rules    []RuleStatus `json:"rules"`
	Items    []Item       `json:"items"`
	SweptAt  *int64       `json:"sweptAt"`
}
