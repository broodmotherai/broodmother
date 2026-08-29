// Mother: what the rules notice, what the gate lets through, and what a deliberation's answer does
// to the feed.

package mother_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/mother"

	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/activity"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entities"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entity"
	"github.com/broodmotherai/broodmother/daemon-go/internal/syncloop"
	"github.com/broodmotherai/broodmother/daemon-go/internal/taskrun"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tasks"
)

const now = int64(1756400000000)

func opened(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "mother.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func ruleNamed(name string) Rule {
	for _, one := range Rules {
		if one.Rule == name {
			return one
		}
	}
	panic("no rule called " + name)
}

func seen(name string, sight Sight) []Noticed {
	sight.Now = now
	return ruleNamed(name).See(sight)
}

// A failed last run is a moment, and its evidence names the run — which is what keeps the same
// failure from being noticed twice.
func TestAFailedRunIsNoticedOnce(t *testing.T) {
	ref := doc.Ref{Root: doc.Project, Path: "a.task"}
	held := seen("run-failed", Sight{Tasks: []tasks.Summary{{
		Ref: ref, Name: "Nightly",
		LastRun: &taskrun.Run{ID: "run-3", State: taskrun.RunError, Error: "the step fell over"},
	}}})
	if len(held) != 1 {
		t.Fatalf("noticed %d", len(held))
	}
	if !strings.Contains(held[0].Evidence, "run-3") || !strings.Contains(held[0].Evidence, "fell over") {
		t.Errorf("said %q", held[0].Evidence)
	}

	store := opened(t)
	one := New{Rule: "run-failed", Ref: held[0].Ref, Evidence: held[0].Evidence, PNeed: 0.6, SeenAt: now}
	if _, fresh := store.File(one); !fresh {
		t.Fatal("the first sighting was not fresh")
	}
	if _, fresh := store.File(one); fresh {
		t.Error("the same fact was noticed twice")
	}
}

// A run that gave no reason still says so, rather than trailing off.
func TestAFailedRunWithNoReasonSaysSo(t *testing.T) {
	held := seen("run-failed", Sight{Tasks: []tasks.Summary{{
		Ref: doc.Ref{Root: doc.Project, Path: "a.task"}, Name: "Nightly",
		LastRun: &taskrun.Run{ID: "run-3", State: taskrun.RunError},
	}}})
	if len(held) != 1 || !strings.Contains(held[0].Evidence, "no reason given") {
		t.Errorf("said %+v", held)
	}
}

// Three failures in a row is a different thing from one, and only three make it.
func TestThreeFailuresInARowIsFailing(t *testing.T) {
	ref := doc.Ref{Root: doc.Project, Path: "a.task"}
	failed := func(id string) taskrun.Run {
		return taskrun.Run{ID: id, Ref: ref, State: taskrun.RunError, Error: "again"}
	}
	if held := seen("run-failing", Sight{Runs: []taskrun.Run{failed("run-3"), failed("run-2")}}); len(held) != 0 {
		t.Fatalf("two failures read as failing: %+v", held)
	}
	held := seen("run-failing", Sight{Runs: []taskrun.Run{failed("run-4"), failed("run-3"), failed("run-2")}})
	if len(held) != 1 || !strings.Contains(held[0].Evidence, "3 runs in a row") {
		t.Fatalf("said %+v", held)
	}
	// The streak is broken by anything that did not fail.
	mixed := []taskrun.Run{failed("run-4"), {ID: "run-3", Ref: ref, State: taskrun.RunDone}, failed("run-2")}
	if held := seen("run-failing", Sight{Runs: mixed}); len(held) != 0 {
		t.Errorf("a broken streak read as failing: %+v", held)
	}
	// A run still going is not an outcome, so it neither breaks a streak nor counts in one.
	running := []taskrun.Run{{ID: "run-5", Ref: ref, State: taskrun.RunRunning},
		failed("run-4"), failed("run-3"), failed("run-2")}
	if held := seen("run-failing", Sight{Runs: running}); len(held) != 1 {
		t.Errorf("a run still going broke the streak: %+v", held)
	}
}

// A conflicted sync is anchored on the first conflicted path, so the suggestion opens somewhere.
func TestAConflictedSyncIsAnchoredOnAPath(t *testing.T) {
	held := seen("sync-conflict", Sight{Sync: syncloop.Status{
		State: syncloop.Conflict, Conflicted: []doc.Path{"a.md", "b.md"},
	}})
	if len(held) != 1 || held[0].Ref == nil || held[0].Ref.Path != "a.md" {
		t.Fatalf("noticed %+v", held)
	}
	if !strings.Contains(held[0].Evidence, "a.md, b.md") {
		t.Errorf("said %q", held[0].Evidence)
	}
	// And a conflict with no paths still says something.
	bare := seen("sync-conflict", Sight{Sync: syncloop.Status{State: syncloop.Conflict}})
	if len(bare) != 1 || bare[0].Ref != nil || !strings.Contains(bare[0].Evidence, "the project") {
		t.Errorf("noticed %+v", bare)
	}
	if held := seen("sync-conflict", Sight{Sync: syncloop.Status{State: syncloop.Idle}}); len(held) != 0 {
		t.Errorf("a sync that is fine was noticed: %+v", held)
	}
}

// An agent waiting is only a moment where it has waited a while and work is going on elsewhere: a
// project where nothing else is happening is one nobody is being kept from.
func TestAnAgentWaitingIsOnlyAMomentWhileWorkGoesOnElsewhere(t *testing.T) {
	long := now - (21 * time.Minute).Milliseconds()
	alone := Sight{
		WaitingSince: map[string]int64{"/p/local": long},
		Activity:     map[string]activity.State{"/p/local": activity.Waiting},
	}
	if held := seen("agent-waiting", alone); len(held) != 0 {
		t.Fatalf("noticed an agent waiting in a quiet project: %+v", held)
	}
	busy := alone
	busy.Activity = map[string]activity.State{"/p/local": activity.Waiting, "/p/repo": activity.Busy}
	if held := seen("agent-waiting", busy); len(held) != 1 {
		t.Fatalf("noticed %+v", held)
	}
	brief := busy
	brief.WaitingSince = map[string]int64{"/p/local": now - time.Minute.Milliseconds()}
	if held := seen("agent-waiting", brief); len(held) != 0 {
		t.Errorf("a minute's wait was noticed: %+v", held)
	}
}

// A question nothing answers, standing long enough, is a moment — and one something answers is not.
func TestAnOpenQuestionIsNoticedAndAnAnsweredOneIsNot(t *testing.T) {
	kind := entity.Question
	old := time.UnixMilli(now - (4 * 24 * time.Hour).Milliseconds()).UTC().Format(time.RFC3339)
	question := entities.Summary{Path: "q.md", Kind: &kind, Made: old}
	if held := seen("question-open", Sight{Entities: []entities.Summary{question}}); len(held) != 1 {
		t.Fatalf("noticed %+v", held)
	}

	answered := doc.Path("q.md")
	finding := entity.Finding
	with := entities.Summary{Path: "f.md", Kind: &finding, Made: old, From: []entities.Source{
		{Relation: entity.Answers, Target: "q", Path: &answered},
	}}
	if held := seen("question-open", Sight{Entities: []entities.Summary{question, with}}); len(held) != 0 {
		t.Errorf("an answered question was noticed: %+v", held)
	}
	fresh := question
	fresh.Made = time.UnixMilli(now - time.Hour.Milliseconds()).UTC().Format(time.RFC3339)
	if held := seen("question-open", Sight{Entities: []entities.Summary{fresh}}); len(held) != 0 {
		t.Errorf("a question asked an hour ago was noticed: %+v", held)
	}
}

// The gate: a rule nobody has answered starts where its author guessed, and moves with every
// verdict. C_FA up is quieter, because the threshold rises everywhere at once.
func TestTheGateMovesWithTheVerdictsAndTheSlider(t *testing.T) {
	if got := PAcceptOf(nil, 0.6); got != 0.6 {
		t.Errorf("a rule nobody has answered sits at %v", got)
	}
	dismissed := PAcceptOf(&RuleStatus{Shown: 4, Accepted: 0}, 0.6)
	if dismissed >= 0.6 {
		t.Errorf("four dismissals left it at %v", dismissed)
	}
	accepted := PAcceptOf(&RuleStatus{Shown: 4, Accepted: 4}, 0.6)
	if accepted <= 0.6 {
		t.Errorf("four acceptances left it at %v", accepted)
	}

	quiet, loud := Tau(0.6, 0.9), Tau(0.6, 0.1)
	if quiet <= loud {
		t.Errorf("a higher C_FA was not quieter: %v against %v", quiet, loud)
	}
	// A rule that badly needs to be heard clears a lower bar than one that does not.
	if Tau(0.9, 0.5) >= Tau(0.3, 0.5) {
		t.Error("a rule with a higher p_need did not clear a lower bar")
	}
}

// What the errand answered, read generously.
func TestADeliberationIsReadGenerously(t *testing.T) {
	if said := ParseDeliberation("NOTHING"); said.Say != "" || said.Finding != nil {
		t.Errorf("NOTHING read as %+v", said)
	}
	if said := ParseDeliberation("  NOTHING here is worth saying  "); said.Say != "" {
		t.Errorf("NOTHING dressed up read as %q", said.Say)
	}
	if said := ParseDeliberation("   "); said.Say != "" {
		t.Errorf("silence read as %q", said.Say)
	}

	held := ParseDeliberation(`{"say": "the nightly is red", "finding": {"name": "n", "claim": "c", "evidence": "e"}}`)
	if held.Say != "the nightly is red" || held.Finding == nil || held.Finding.Claim != "c" {
		t.Errorf("read as %+v", held)
	}
	// A finding missing one of its keys is no finding: a record has to be written to be one.
	half := ParseDeliberation(`{"say": "something", "finding": {"name": "n", "claim": ""}}`)
	if half.Say != "something" || half.Finding != nil {
		t.Errorf("read as %+v", half)
	}
	// From a model that answered in prose anyway, the prose is the say.
	prose := ParseDeliberation("The nightly has been failing since Tuesday.")
	if prose.Say != "The nightly has been failing since Tuesday." {
		t.Errorf("read as %q", prose.Say)
	}
	// And JSON with a paragraph around it is still the JSON.
	wrapped := ParseDeliberation("Here you go:\n{\"say\": \"look at the nightly\"}\nHope that helps.")
	if wrapped.Say != "look at the nightly" {
		t.Errorf("read as %q", wrapped.Say)
	}
}

// The beat: a fresh moment that clears the gate is deliberated once, and the same fact on the next
// beat is not deliberated again.
func TestTheBeatSpendsOnceOnEachFreshMoment(t *testing.T) {
	store := opened(t)
	var asked int
	var surfaced []Suggestion
	var mutex sync.Mutex

	watch := NewWatch(WatchDeps{
		Store: store,
		Sight: func() Sight {
			return Sight{Tasks: []tasks.Summary{{
				Ref: doc.Ref{Root: doc.Project, Path: "a.task"}, Name: "Nightly",
				LastRun: &taskrun.Run{ID: "run-3", State: taskrun.RunError, Error: "red"},
			}}}
		},
		Deliberate: func(context.Context, Ask) (Said, error) {
			mutex.Lock()
			asked++
			mutex.Unlock()
			return Said{Say: "the nightly is red"}, nil
		},
		Surfaced: func(one Suggestion) {
			mutex.Lock()
			surfaced = append(surfaced, one)
			mutex.Unlock()
		},
		Now: func() time.Time { return time.UnixMilli(now) },
	})

	watch.Tick(context.Background())
	watch.Tick(context.Background())

	mutex.Lock()
	defer mutex.Unlock()
	if asked != 1 {
		t.Errorf("deliberated %d times over one fact", asked)
	}
	if len(surfaced) != 1 || surfaced[0].Text != "the nightly is red" {
		t.Fatalf("surfaced %+v", surfaced)
	}
	// The showing counts against the rule, which is the denominator of its acceptance rate.
	for _, one := range store.Rules() {
		if one.Rule == "run-failed" && one.Shown != 1 {
			t.Errorf("the rule was shown %d times", one.Shown)
		}
	}
}

// A deliberation that answered NOTHING marks the moment quiet and surfaces nothing.
func TestNothingIsFiledAndSurfacedToNobody(t *testing.T) {
	store := opened(t)
	surfaced := 0
	watch := NewWatch(WatchDeps{
		Store: store,
		Sight: func() Sight {
			return Sight{Tasks: []tasks.Summary{{
				Ref: doc.Ref{Root: doc.Project, Path: "a.task"}, Name: "Nightly", Broken: "not JSON",
			}}}
		},
		Deliberate: func(context.Context, Ask) (Said, error) { return Said{}, nil },
		Surfaced:   func(Suggestion) { surfaced++ },
		Now:        func() time.Time { return time.UnixMilli(now) },
	})
	watch.Tick(context.Background())

	if surfaced != 0 {
		t.Errorf("surfaced %d after NOTHING", surfaced)
	}
	feed := store.Feed()
	if len(feed) != 1 || feed[0].Moment.Outcome != Quiet {
		t.Errorf("filed %+v", feed)
	}
}

// A finding the project already holds is the signal to stay quiet: the record answers "already
// written" rather than forking, and a suggestion about it would be one nobody needed twice.
func TestAFindingAlreadyWrittenStaysQuiet(t *testing.T) {
	store := opened(t)
	surfaced := 0
	watch := NewWatch(WatchDeps{
		Store: store,
		Sight: func() Sight {
			return Sight{Tasks: []tasks.Summary{{
				Ref: doc.Ref{Root: doc.Project, Path: "a.task"}, Name: "Nightly", Broken: "not JSON",
			}}}
		},
		Deliberate: func(context.Context, Ask) (Said, error) {
			return Said{Say: "worth knowing", Finding: &Finding{Name: "n", Claim: "c", Evidence: "e"}}, nil
		},
		Record: func(Finding, *doc.Ref) (string, bool, error) {
			return "entities/n.md", false, nil
		},
		Surfaced: func(Suggestion) { surfaced++ },
		Now:      func() time.Time { return time.UnixMilli(now) },
	})
	watch.Tick(context.Background())

	if surfaced != 0 {
		t.Errorf("surfaced %d about a record already written", surfaced)
	}
	if feed := store.Feed(); len(feed) != 1 || feed[0].Moment.Outcome != Quiet {
		t.Errorf("filed %+v", feed)
	}
}

// Switched off, she notices nothing at all.
func TestSwitchedOffSheDoesNotLook(t *testing.T) {
	store := opened(t)
	off := false
	store.Configure(&off, nil)
	asked := 0
	watch := NewWatch(WatchDeps{
		Store: store,
		Sight: func() Sight {
			return Sight{Tasks: []tasks.Summary{{
				Ref: doc.Ref{Root: doc.Project, Path: "a.task"}, Name: "Nightly", Broken: "not JSON",
			}}}
		},
		Deliberate: func(context.Context, Ask) (Said, error) { asked++; return Said{}, nil },
		Now:        func() time.Time { return time.UnixMilli(now) },
	})
	watch.Tick(context.Background())

	if asked != 0 || len(store.Feed()) != 0 {
		t.Errorf("looked while switched off: %d asks, %d filed", asked, len(store.Feed()))
	}
}

// A rule switched off is not deliberated on, though what it noticed is still filed — the feed is
// the record of what was seen, not only of what was said.
func TestARuleSwitchedOffIsFiledAndNotSpentOn(t *testing.T) {
	store := opened(t)
	store.Enable("task-broken", false)
	asked := 0
	watch := NewWatch(WatchDeps{
		Store: store,
		Sight: func() Sight {
			return Sight{Tasks: []tasks.Summary{{
				Ref: doc.Ref{Root: doc.Project, Path: "a.task"}, Name: "Nightly", Broken: "not JSON",
			}}}
		},
		Deliberate: func(context.Context, Ask) (Said, error) { asked++; return Said{Say: "x"}, nil },
		Now:        func() time.Time { return time.UnixMilli(now) },
	})
	watch.Tick(context.Background())

	if asked != 0 {
		t.Errorf("deliberated %d times on a rule that is off", asked)
	}
	if len(store.Feed()) != 1 {
		t.Errorf("the moment was not filed: %+v", store.Feed())
	}
}

// The sweep is the heartbeat: it marks the time whether or not it found anything, so "Mother is
// alive and found nothing" is visible rather than assumed.
func TestASweepMarksTheTimeEitherWay(t *testing.T) {
	store := opened(t)
	watch := NewWatch(WatchDeps{
		Store:      store,
		Sight:      func() Sight { return Sight{Sync: syncloop.Status{State: syncloop.Idle}} },
		Deliberate: func(context.Context, Ask) (Said, error) { return Said{}, nil },
		Now:        func() time.Time { return time.UnixMilli(now) },
	})
	if at := watch.Sweep(context.Background()); at != now {
		t.Errorf("swept at %d", at)
	}
	if swept := store.SweptAt(); swept == nil || *swept != now {
		t.Errorf("marked %v", swept)
	}
	if len(store.Feed()) != 0 {
		t.Errorf("a sweep that found nothing filed %+v", store.Feed())
	}
}
