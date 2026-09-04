// The schedule half of a beat, behind one verb so the two clocks are two wirings.
//
// The laptop mirrors schedules into the system crontab, because its server might not be running
// when the clock strikes and cron will be. A long-lived process keeps time itself and fires the
// run in-process.

package tasks

import (
	"sync"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
)

type Scheduler interface {
	Sync(found []Scheduled) error
}

type crontabScheduler struct {
	cron *Crontab
	url  func() string
}

// CrontabScheduler holds the user's crontab to one line per live schedule trigger. A server with
// no URL yet has nothing to write a line about, so it writes none rather than a broken one.
func CrontabScheduler(cron *Crontab, url func() string) Scheduler {
	return crontabScheduler{cron: cron, url: url}
}

func (s crontabScheduler) Sync(found []Scheduled) error {
	at := s.url()
	if at == "" {
		return nil
	}
	return s.cron.Sync(ScheduleLines(found, at))
}

// TimerScheduler fires on the beat that crosses a due moment. An interval trigger is armed at
// first sight and fires a full interval later; a time trigger fires on the beat that passes its
// HH:MM. A moment the process slept through is missed, exactly as it is under cron.
type TimerScheduler struct {
	run func(ref doc.Ref)
	now func() time.Time

	mutex sync.Mutex
	// armed is when each interval trigger last fired or was first seen, by task and node.
	armed map[string]time.Time
	// last is the previous beat, so a time trigger can be asked what the two of them crossed.
	// Nil until the first beat, which crosses nothing.
	last *time.Time
}

func NewTimerScheduler(run func(ref doc.Ref), now func() time.Time) *TimerScheduler {
	if now == nil {
		now = time.Now
	}
	return &TimerScheduler{run: run, now: now, armed: map[string]time.Time{}}
}

func (s *TimerScheduler) Sync(found []Scheduled) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	beat := s.now()
	previous := s.last
	s.last = &beat

	alive := map[string]bool{}
	for _, one := range found {
		wired := map[string]bool{}
		for _, edge := range one.Task.Edges {
			wired[edge.From] = true
		}
		for _, node := range one.Task.Nodes {
			// A trigger switched off keeps no time: it is armed by nothing and, when it comes
			// back on, starts its interval over rather than firing for the wait.
			if !task.Fires(node, wired) {
				continue
			}
			key := refKey(one.Ref) + "#" + node.ID
			switch node.Kind {
			case task.IntervalTrigger:
				if node.Minutes == nil {
					continue
				}
				alive[key] = true
				since, armed := s.armed[key]
				every := time.Duration(*node.Minutes * float64(time.Minute))
				if !armed {
					s.armed[key] = beat
				} else if beat.Sub(since) >= every {
					s.armed[key] = beat
					s.run(one.Ref)
				}
			case task.TimeTrigger:
				alive[key] = true
				if previous == nil {
					continue
				}
				due := timeToday(node.At, beat)
				if due.After(*previous) && !due.After(beat) && onDay(node.Days, due) {
					s.run(one.Ref)
				}
			}
		}
	}
	for key := range s.armed {
		if !alive[key] {
			delete(s.armed, key)
		}
	}
	return nil
}

// onDay is whether a due moment falls on a day the trigger keeps to. No days is every day, which
// is what a trigger written before days existed means.
func onDay(days []task.Weekday, due time.Time) bool {
	if len(days) == 0 {
		return true
	}
	for _, day := range days {
		if day == task.Weekdays[int(due.Weekday())] {
			return true
		}
	}
	return false
}

// timeToday is the trigger's HH:MM on the day the beat falls in, read locally — a schedule is
// written in the hours of whoever wrote it.
func timeToday(at string, beat time.Time) time.Time {
	hours, minutes := clockOf(at)
	return time.Date(beat.Year(), beat.Month(), beat.Day(), hours, minutes, 0, 0, beat.Location())
}
