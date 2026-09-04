// The always-on watcher: deterministic rules over state the daemon already holds, each a pure
// function from one look at the world to the moments in it.
//
// No model anywhere here — the trigger layer is cheap and structured, and the expensive pass runs
// only on moments that survive the gate.
//
// Evidence doubles as identity: the store digests it, so a rule words its evidence from what stays
// still while the fact holds — a run id, a since-timestamp — and the same fact observed on every
// beat stays one moment.

package mother

import (
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/activity"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/entities"
	"github.com/broodmotherai/broodmother/daemon/internal/entity"
	"github.com/broodmotherai/broodmother/daemon/internal/syncloop"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
	"github.com/broodmotherai/broodmother/daemon/internal/tasks"
)

// Sight is one look at everything Mother watches, assembled by whoever holds the services.
type Sight struct {
	Now int64
	// Tasks is every task, as the page reads them.
	Tasks []tasks.Summary
	// Runs are recent runs across every task, newest first.
	Runs     []taskrun.Run
	Sync     syncloop.Status
	Activity map[string]activity.State
	// WaitingSince is when each checkout's agent started waiting, by path — the watcher's own
	// clock, carried across beats because a snapshot cannot say how long.
	WaitingSince map[string]int64
	Entities     []entities.Summary
}

// Noticed is one thing a rule saw.
type Noticed struct {
	Ref      *doc.Ref
	Evidence string
}

type Rule struct {
	Rule string
	// PNeed is the rule's static prior that help is needed — PRISM's p_need.
	PNeed float64
	// Prior is where the rule's acceptance rate starts before anybody has answered one.
	Prior float64
	See   func(sight Sight) []Noticed
}

const (
	// waitingFor is how long an agent waits unseen before it is a moment.
	waitingFor = 20 * time.Minute
	// questionFor is how long a question sits unanswered before it is one.
	questionFor = 3 * 24 * time.Hour
	// streak is how many failures in a row make a task "failing", not just "failed".
	streak = 3
)

var Rules = []Rule{
	{
		Rule: "run-failed", PNeed: 0.6, Prior: 0.6,
		See: func(sight Sight) []Noticed {
			held := []Noticed{}
			for _, one := range sight.Tasks {
				if one.LastRun == nil || one.LastRun.State != taskrun.RunError {
					continue
				}
				ref := one.Ref
				held = append(held, Noticed{Ref: &ref, Evidence: "run " + one.LastRun.ID +
					" of " + one.Name + " failed: " + orNoReason(one.LastRun.Error)})
			}
			return held
		},
	},
	{
		Rule: "run-failing", PNeed: 0.8, Prior: 0.7,
		See: func(sight Sight) []Noticed {
			order := []string{}
			byTask := map[string][]taskrun.Run{}
			for _, run := range sight.Runs {
				key := string(run.Ref.Root) + ":" + string(run.Ref.Path)
				if _, seen := byTask[key]; !seen {
					order = append(order, key)
				}
				byTask[key] = append(byTask[key], run)
			}
			held := []Noticed{}
			for _, key := range order {
				settled := []taskrun.Run{}
				for _, run := range byTask[key] {
					if run.State != taskrun.RunRunning {
						settled = append(settled, run)
					}
				}
				failures := 0
				for _, run := range settled {
					if run.State != taskrun.RunError {
						break
					}
					failures++
				}
				if failures < streak {
					continue
				}
				latest := settled[0]
				ref := latest.Ref
				held = append(held, Noticed{Ref: &ref, Evidence: strconv.Itoa(failures) +
					" runs in a row have failed, the latest " + latest.ID + ": " + orNoReason(latest.Error)})
			}
			return held
		},
	},
	{
		Rule: "task-broken", PNeed: 0.7, Prior: 0.6,
		See: func(sight Sight) []Noticed {
			held := []Noticed{}
			for _, one := range sight.Tasks {
				if one.Broken == "" {
					continue
				}
				ref := one.Ref
				held = append(held, Noticed{Ref: &ref, Evidence: "the task will not parse: " + one.Broken})
			}
			return held
		},
	},
	{
		Rule: "trigger-trouble", PNeed: 0.5, Prior: 0.5,
		See: func(sight Sight) []Noticed {
			held := []Noticed{}
			for _, one := range sight.Tasks {
				for _, trigger := range one.Triggers {
					if trigger.Error == "" {
						continue
					}
					ref := one.Ref
					held = append(held, Noticed{Ref: &ref, Evidence: trigger.Label + ": " + trigger.Error})
				}
			}
			return held
		},
	},
	{
		Rule: "sync-conflict", PNeed: 0.9, Prior: 0.7,
		See: func(sight Sight) []Noticed {
			if sight.Sync.State != syncloop.Conflict {
				return nil
			}
			paths := make([]string, 0, len(sight.Sync.Conflicted))
			for _, one := range sight.Sync.Conflicted {
				paths = append(paths, string(one))
			}
			where := strings.Join(paths, ", ")
			if where == "" {
				where = "the project"
			}
			one := Noticed{Evidence: "sync is conflicted on " + where}
			if len(sight.Sync.Conflicted) > 0 {
				one.Ref = &doc.Ref{Root: doc.Project, Path: sight.Sync.Conflicted[0]}
			}
			return []Noticed{one}
		},
	},
	{
		Rule: "agent-waiting", PNeed: 0.5, Prior: 0.5,
		See: func(sight Sight) []Noticed {
			busyElsewhere := func(cwd string) bool {
				for other, state := range sight.Activity {
					if other != cwd && state == activity.Busy {
						return true
					}
				}
				return false
			}
			held := []Noticed{}
			for _, cwd := range sortedKeys(sight.WaitingSince) {
				since := sight.WaitingSince[cwd]
				if sight.Now-since < waitingFor.Milliseconds() || !busyElsewhere(cwd) {
					continue
				}
				held = append(held, Noticed{Evidence: "an agent in " + cwd +
					" has been waiting to be told what next since " + iso(since) +
					", while work goes on elsewhere"})
			}
			return held
		},
	},
	{
		Rule: "record-broken", PNeed: 0.6, Prior: 0.5,
		See: func(sight Sight) []Noticed {
			held := []Noticed{}
			for _, one := range sight.Entities {
				if one.Broken == "" {
					continue
				}
				held = append(held, Noticed{
					Ref:      &doc.Ref{Root: doc.Project, Path: one.Path},
					Evidence: "the record will not parse: " + one.Broken,
				})
			}
			return held
		},
	},
	{
		Rule: "question-open", PNeed: 0.3, Prior: 0.4,
		See: func(sight Sight) []Noticed {
			answered := map[doc.Path]bool{}
			for _, one := range sight.Entities {
				for _, source := range one.From {
					if source.Relation == entity.Answers && source.Path != nil {
						answered[*source.Path] = true
					}
				}
			}
			held := []Noticed{}
			for _, one := range sight.Entities {
				if one.Kind == nil || *one.Kind != entity.Question || answered[one.Path] {
					continue
				}
				made, ok := millisOf(one.Made)
				if !ok || sight.Now-made < questionFor.Milliseconds() {
					continue
				}
				held = append(held, Noticed{
					Ref:      &doc.Ref{Root: doc.Project, Path: one.Path},
					Evidence: "open since " + one.Made + ", and nothing answers it",
				})
			}
			return held
		},
	},
}

func orNoReason(said string) string {
	if said == "" {
		return "no reason given"
	}
	return said
}

func iso(at int64) string {
	return time.UnixMilli(at).UTC().Format("2006-01-02T15:04:05") + "Z"
}

func millisOf(at string) (int64, bool) {
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05Z0700", time.RFC3339Nano} {
		if held, err := time.Parse(layout, at); err == nil {
			return held.UnixMilli(), true
		}
	}
	return 0, false
}

// sortedKeys keeps a map's rules in an order that does not move between beats: a moment is
// digested from its evidence, and one filed in a different order is still one moment, but a feed
// whose rows shuffled every beat would read as a watcher that had noticed something new.
func sortedKeys(held map[string]int64) []string {
	keys := make([]string, 0, len(held))
	for key := range held {
		keys = append(keys, key)
	}
	for at := 1; at < len(keys); at++ {
		for back := at; back > 0 && keys[back] < keys[back-1]; back-- {
			keys[back], keys[back-1] = keys[back-1], keys[back]
		}
	}
	return keys
}
