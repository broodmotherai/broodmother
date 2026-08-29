package entity_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/entity"

	"reflect"
	"strings"
	"testing"
)

func TestOnlyTheKeySaysARecordIsOne(t *testing.T) {
	if !IsEntity("---\nentity: finding\n---\n") {
		t.Error("a record did not say so")
	}
	for _, one := range []string{"---\nname: A note\n---\n", "Just prose.\n", "---\nentity:\n---\n"} {
		if IsEntity(one) {
			t.Errorf("%q said it was a record", one)
		}
	}
}

func TestANameIsOneLineAndCutRatherThanRefused(t *testing.T) {
	if got := FlatName("  What   happens\tnext  "); got != "What happens next" {
		t.Errorf("FlatName gave %q", got)
	}
	long := FlatName(strings.Repeat("a", MaxName+50))
	if len([]rune(long)) != MaxName {
		t.Errorf("a long name came back %d characters", len([]rune(long)))
	}
	if !strings.HasSuffix(long, "…") {
		t.Errorf("a cut name did not say it was cut: %q", long)
	}
	if got := FlatName(strings.Repeat("a", MaxName)); strings.HasSuffix(got, "…") {
		t.Error("a name exactly at the limit was cut")
	}
}

func TestARecordIsFiledUnderItsKindAndASlugOfItsName(t *testing.T) {
	for _, one := range []struct {
		kind Kind
		name string
		want string
	}{
		{Finding, "Sync stalls when the remote refuses a push",
			"entities/finding/sync-stalls-when-the-remote-refuses-a-push.md"},
		{Person, "Priya", "entities/person/priya.md"},
		{Term, "  --  ", "entities/term/untitled.md"},
		{Term, "日本語", "entities/term/untitled.md"},
		{Decision, "Go, rather than Rust!", "entities/decision/go-rather-than-rust.md"},
	} {
		if got := Path(one.kind, one.name); got != one.want {
			t.Errorf("Path(%q, %q) = %q, want %q", one.kind, one.name, got, one.want)
		}
	}
}

const written = `---
entity: finding
name: Sync stalls when the remote refuses a push
made: 2026-08-24T14:02:11Z
by: agent/priya
sha: 9f2c
claim: the loop stops
evidence: the log ends mid-push
from:
  - derives-from [[notes/sync]]
  - cites [[docs/plans/2026-08-24-browser]]
---

The prose a person reads, under the fence.
`

func TestReadsARecordBackAsItWasWritten(t *testing.T) {
	record, err := Parse(written)
	if err != nil {
		t.Fatalf("refused a record: %v", err)
	}
	if record.Kind != Finding || record.By != "agent/priya" || record.Origin {
		t.Errorf("read as %+v", record)
	}
	want := []From{
		{Relation: DerivesFrom, Target: "notes/sync"},
		{Relation: Cites, Target: "docs/plans/2026-08-24-browser"},
	}
	if !reflect.DeepEqual(record.From, want) {
		t.Errorf("sources are %+v", record.From)
	}
	if record.Get("claim") != "the loop stops" || record.Get("evidence") != "the log ends mid-push" {
		t.Errorf("fields are %+v", record.Fields)
	}
	if got := Serialize(record); got != written {
		t.Errorf("wrote different bytes:\n got %q\nwant %q", got, written)
	}
}

// The digest is what makes "have I written this before" answerable, so the two parts of a record
// that are about the writing rather than about the record stay out of it.
func TestTheDigestIgnoresWhenItWasWrittenAndTheDigestItself(t *testing.T) {
	record, err := Parse(written)
	if err != nil {
		t.Fatal(err)
	}
	again := record
	again.Made = "2019-01-01T00:00:00Z"
	again.Sha = "not the same at all"
	if DigestOf(record) != DigestOf(again) {
		t.Error("the stamp reached the digest")
	}
	// And what the record says does reach it, including who said it.
	for _, changed := range []func(*Entity){
		func(e *Entity) { e.By = "agent/someone-else" },
		func(e *Entity) { e.Body += " and one more thing" },
		func(e *Entity) { e.Fields[0].Value = "the loop keeps going" },
	} {
		other, _ := Parse(written)
		changed(&other)
		if DigestOf(record) == DigestOf(other) {
			t.Errorf("a change to %+v left the digest alone", other)
		}
	}
	if strings.Contains(CanonicalOf(record), "made:") {
		t.Error("the canonical form kept the stamp")
	}
}

func TestARecordWithNoProseIsAHeaderAndNothingElse(t *testing.T) {
	bare := Entity{Kind: Question, Name: "A question", Origin: true, Fields: []Field{{Key: "asks", Value: "something"}}}
	want := "---\nentity: question\nname: A question\nasks: something\nfrom:\n  - origin\n---\n"
	if got := Serialize(bare); got != want {
		t.Errorf("wrote %q, want %q", got, want)
	}
	again, err := Parse(want)
	if err != nil {
		t.Fatalf("refused what it wrote: %v", err)
	}
	if !again.Origin || len(again.From) != 0 || again.Body != "" {
		t.Errorf("read back as %+v", again)
	}
}

// The relation is read back out of the line the link index already kept, rather than by opening
// every document again to ask.
func TestReadsARelationOutOfTheLineTheIndexKept(t *testing.T) {
	for _, one := range []struct {
		in   string
		want Relation
	}{
		{"- derives-from [[notes/sync]]", DerivesFrom},
		{"- cites [[a]]", Cites},
		{"- inspires [[a]]", ""},
		{"- origin", ""},
		{"derives-from [[notes/sync]]", ""},
		{"see [[notes/sync]] for more", ""},
	} {
		if got := RelationOf(one.in); got != one.want {
			t.Errorf("RelationOf(%q) = %q, want %q", one.in, got, one.want)
		}
	}
}
