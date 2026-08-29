// The overseer's beat: on every one she looks at what the daemon already knows, files what the
// rules notice, and spends a deliberation only on the fresh moments that clear the gate.
//
// Everything lands in the feed; only gated, non-NOTHING suggestions ride the socket. She observes
// and suggests — nothing here edits, runs, or sends on anybody's behalf.

package mother

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/activity"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

const (
	beatEvery  = 30 * time.Second
	sweepEvery = 30 * time.Minute
	// cfn is the cost of a missed help, PRISM's C_FN, held at 1 — the slider moves C_FA against it.
	cfn = 1
	// smooth is how many imagined showings the prior is worth before real answers outweigh it.
	smooth = 4
)

// PAcceptOf is the rule's calibrated acceptance rate: its count smoothed from its prior, so a rule
// nobody has answered starts where its author guessed and moves with every verdict.
func PAcceptOf(status *RuleStatus, prior float64) float64 {
	shown, accepted := float64(0), float64(0)
	if status != nil {
		shown, accepted = float64(status.Shown), float64(status.Accepted)
	}
	return (accepted + smooth*prior) / (shown + smooth)
}

// Tau is PRISM's decision boundary: intervene only when pAccept clears it. C_FA up is quieter,
// because the threshold rises everywhere at once.
func Tau(pNeed, cfa float64) float64 { return cfa / (cfa + pNeed*cfn) }

// WatchDeps is everything the beat reaches through.
type WatchDeps struct {
	Store *Store
	// Sight is one look at everything she watches, asked each beat.
	Sight func() Sight
	// Deliberate is the expensive pass, spent only past the gate.
	Deliberate Deliberator
	// Record writes a durable observation down as a record — the entities store's own writer,
	// which answers "already written" instead of forking, and that answer is the signal to stay
	// quiet.
	Record func(finding Finding, ref *doc.Ref) (path string, created bool, err error)
	// Surfaced is a suggestion reaching whoever has the app open.
	Surfaced func(suggestion Suggestion)
	Now      func() time.Time
}

// Watch is Mother, watching.
type Watch struct {
	deps WatchDeps

	mutex sync.Mutex
	// waitingSince is when each checkout's agent started waiting — the clock a snapshot cannot
	// carry.
	waitingSince map[string]int64
	beating      chan struct{}
	beaten       chan struct{}
	// looking is whether a beat is still going: a deliberation mid-flight is a beat still going,
	// and two at once would spend twice.
	looking bool
}

func NewWatch(deps WatchDeps) *Watch {
	if deps.Now == nil {
		deps.Now = time.Now
	}
	return &Watch{deps: deps, waitingSince: map[string]int64{}}
}

func (w *Watch) Start() { w.StartEvery(beatEvery) }

func (w *Watch) StartEvery(every time.Duration) {
	w.mutex.Lock()
	if w.beating != nil {
		w.mutex.Unlock()
		return
	}
	stop, left := make(chan struct{}), make(chan struct{})
	w.beating, w.beaten = stop, left
	w.mutex.Unlock()

	go func() {
		defer close(left)
		ticker := time.NewTicker(every)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				w.Tick(context.Background())
			}
		}
	}()
}

// Stop stops keeping time, and waits for the beat underway — a deliberation is a process, and one
// left running past the store it writes into would lose what it found.
func (w *Watch) Stop() {
	w.mutex.Lock()
	stop, left := w.beating, w.beaten
	w.beating, w.beaten = nil, nil
	w.mutex.Unlock()
	if stop != nil {
		close(stop)
		<-left
	}
}

// Tick is one beat, never two at once.
func (w *Watch) Tick(ctx context.Context) {
	w.mutex.Lock()
	if w.looking {
		w.mutex.Unlock()
		return
	}
	w.looking = true
	w.mutex.Unlock()
	defer func() {
		w.mutex.Lock()
		w.looking = false
		w.mutex.Unlock()
	}()
	w.look(ctx)
}

func (w *Watch) look(ctx context.Context) {
	if w.deps.Store == nil || !w.deps.Store.Settings().On {
		return
	}
	now := w.deps.Now().UnixMilli()
	sight := w.deps.Sight()
	sight.Now = now
	w.follow(sight.Activity, now)
	sight.WaitingSince = w.waiting()

	statuses := w.deps.Store.Rules()
	settings := w.deps.Store.Settings()
	for _, rule := range Rules {
		for _, noticed := range rule.See(sight) {
			moment, fresh := w.deps.Store.File(New{
				Rule: rule.Rule, Ref: noticed.Ref, Evidence: noticed.Evidence,
				PNeed: rule.PNeed, SeenAt: now,
			})
			if !fresh || !w.deps.Store.Enabled(rule.Rule) {
				continue
			}
			if !gated(rule, statuses, settings.CFA) {
				continue
			}
			w.deliberate(ctx, moment)
		}
	}

	swept := w.deps.Store.SweptAt()
	// The first look starts the heartbeat's clock rather than spending a call on a project she has
	// only just opened her eyes on.
	if swept == nil {
		w.deps.Store.Swept(now)
	} else if now-*swept >= sweepEvery.Milliseconds() {
		w.Sweep(ctx)
	}
}

// follow: waiting is a duration and the snapshot is not, so the clock starts when a checkout turns
// up waiting and stops the moment it is anything else.
func (w *Watch) follow(states map[string]activity.State, now int64) {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	for cwd, state := range states {
		if state == activity.Waiting {
			if _, since := w.waitingSince[cwd]; !since {
				w.waitingSince[cwd] = now
			}
			continue
		}
		delete(w.waitingSince, cwd)
	}
	for cwd := range w.waitingSince {
		if _, still := states[cwd]; !still {
			delete(w.waitingSince, cwd)
		}
	}
}

func (w *Watch) waiting() map[string]int64 {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	held := make(map[string]int64, len(w.waitingSince))
	for cwd, since := range w.waitingSince {
		held[cwd] = since
	}
	return held
}

func gated(rule Rule, statuses []RuleStatus, cfa float64) bool {
	var status *RuleStatus
	for at := range statuses {
		if statuses[at].Rule == rule.Rule {
			status = &statuses[at]
			break
		}
	}
	return PAcceptOf(status, rule.Prior) >= Tau(rule.PNeed, cfa)
}

func (w *Watch) deliberate(ctx context.Context, moment Moment) {
	if w.deps.Deliberate == nil {
		return
	}
	said, err := w.deps.Deliberate(ctx, Ask{
		Rule: moment.Rule, Ref: moment.Ref, Evidence: moment.Evidence,
	})
	if err != nil {
		return
	}
	w.settle(moment, said)
}

// settle is what a deliberation came back with, landed: the record written where one was found —
// and "already written" read as the signal to stay quiet rather than re-raise — then the
// suggestion surfaced, or the moment marked quiet.
func (w *Watch) settle(moment Moment, said Said) {
	record := ""
	fresh := true
	if said.Finding != nil && w.deps.Record != nil {
		if path, created, err := w.deps.Record(*said.Finding, moment.Ref); err == nil {
			record, fresh = path, created
		}
	}
	if said.Say == "" || !fresh {
		w.deps.Store.Outcome(moment.ID, Quiet)
		return
	}
	suggestion, filed := w.deps.Store.Suggest(moment.ID, said.Say, record, w.deps.Now().UnixMilli())
	if filed && w.deps.Surfaced != nil {
		w.deps.Surfaced(suggestion)
	}
}

// Sweep is the heartbeat: one budgeted deliberation over the whole picture, whose expected answer
// is NOTHING — and whose silence is still logged, so "Mother is alive and found nothing" is visible
// rather than assumed. Also how she is tested by hand, through the route.
func (w *Watch) Sweep(ctx context.Context) int64 {
	now := w.deps.Now().UnixMilli()
	if w.deps.Store == nil {
		return now
	}
	w.deps.Store.Swept(now)
	if !w.deps.Store.Settings().On || !w.deps.Store.Enabled("sweep") || w.deps.Deliberate == nil {
		return now
	}
	sight := w.deps.Sight()
	sight.Now = now
	said, err := w.deps.Deliberate(ctx, Ask{Rule: "sweep", Evidence: summarize(sight)})
	if err != nil || (said.Say == "" && said.Finding == nil) {
		return now
	}
	evidence := said.Say
	if evidence == "" && said.Finding != nil {
		evidence = said.Finding.Claim
	}
	moment, fresh := w.deps.Store.File(New{Rule: "sweep", Evidence: evidence, PNeed: 1, SeenAt: now})
	if fresh {
		w.settle(moment, said)
	}
	return now
}

// summarize is the sweep's one look, written down: the standing state a deliberation can weigh
// without being handed the services themselves.
func summarize(sight Sight) string {
	failed, broken := []string{}, 0
	for _, one := range sight.Tasks {
		if one.LastRun != nil && one.LastRun.State == "error" {
			failed = append(failed, one.Name)
		}
		if one.Broken != "" {
			broken++
		}
	}
	records, questions := 0, 0
	for _, one := range sight.Entities {
		if one.Broken != "" {
			continue
		}
		records++
		if one.Kind != nil && string(*one.Kind) == "question" {
			questions++
		}
	}
	named := "none"
	if len(failed) > 0 {
		named = joinWith(failed, ", ")
	}
	states := []string{}
	for _, cwd := range sortedStates(sight.Activity) {
		states = append(states, cwd+" is "+string(sight.Activity[cwd]))
	}
	where := "all quiet"
	if len(states) > 0 {
		where = joinWith(states, "; ")
	}
	return "A periodic look over the whole project. " + joinWith([]string{
		strconv.Itoa(len(sight.Tasks)) + " tasks; " + strconv.Itoa(len(failed)) +
			" with a failed last run (" + named + "); " + strconv.Itoa(broken) + " broken.",
		"Sync is " + string(sight.Sync.State) + ".",
		"Checkout activity: " + where + ".",
		strconv.Itoa(records) + " records, " + strconv.Itoa(questions) + " of them questions.",
	}, " ")
}

func joinWith(parts []string, sep string) string {
	held := ""
	for at, one := range parts {
		if at > 0 {
			held += sep
		}
		held += one
	}
	return held
}

func sortedStates(states map[string]activity.State) []string {
	keys := make([]string, 0, len(states))
	for key := range states {
		keys = append(keys, key)
	}
	for at := 1; at < len(keys); at++ {
		for back := at; back > 0 && keys[back] < keys[back-1]; back-- {
			keys[back], keys[back-1] = keys[back-1], keys[back]
		}
	}
	return keys
}
