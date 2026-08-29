// The system crontab, as one block of it.
//
// A laptop's server might not be running when the clock strikes, and cron will be — so a schedule
// trigger is mirrored into the user's crontab as a line that curls the run route back in. Which
// means the lines are a promise to a program this daemon does not own: they have to be exactly
// the ones the TypeScript writes, or switching daemons rewrites everybody's crontab.

package tasks

import (
	"os/exec"
	"strconv"
	"strings"
	"sync"

	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/jsjson"
	"github.com/broodmotherai/broodmother/daemon-go/internal/task"
)

const (
	begin = "# BROODMOTHER BEGIN — schedules managed by broodmother, edits here are overwritten"
	end   = "# BROODMOTHER END"
)

// CrontabIO is the system crontab as two verbs, so a test can hand in a string instead of the
// laptop.
type CrontabIO interface {
	Read() (string, error)
	Write(text string) error
}

type systemCrontab struct{}

// SystemCrontab is the real one.
func SystemCrontab() CrontabIO { return systemCrontab{} }

// Read answers with nothing where there is nothing: `crontab -l` exits 1 on a user with no
// crontab yet, which is an empty one.
func (systemCrontab) Read() (string, error) {
	out, err := exec.Command("crontab", "-l").Output()
	if err != nil {
		return "", nil
	}
	return string(out), nil
}

func (systemCrontab) Write(text string) error {
	command := exec.Command("crontab", "-")
	command.Stdin = strings.NewReader(text)
	return command.Run()
}

// Scheduled is a task and where it lives, which is all a cron line needs to name it.
type Scheduled struct {
	Ref  doc.Ref
	Task task.Task
}

// cronOf is a schedule trigger as cron says it, or empty for a node that is not one.
func cronOf(node task.Node) string {
	switch node.Kind {
	case task.TimeTrigger:
		hours, minutes := clockOf(node.At)
		// Cron's own day-of-week field, which is where the names came from.
		days := "*"
		if len(node.Days) > 0 {
			named := make([]string, 0, len(node.Days))
			for _, day := range node.Days {
				named = append(named, string(day))
			}
			days = strings.Join(named, ",")
		}
		return strconv.Itoa(minutes) + " " + strconv.Itoa(hours) + " * * " + days
	case task.IntervalTrigger:
		if node.Minutes == nil {
			return ""
		}
		every := *node.Minutes
		if every <= 59 {
			return "*/" + spelled(every) + " * * * *"
		}
		// Cron cannot say "every 90 minutes"; the nearest whole hours are what it can.
		return "0 */" + strconv.Itoa(min(23, max(1, rounded(every/60)))) + " * * *"
	default:
		return ""
	}
}

// clockOf reads an HH:MM. A field that is not a number is a zero, which is what the other side
// gets from Number of an empty string.
func clockOf(at string) (hours, minutes int) {
	fields := strings.SplitN(at, ":", 2)
	hours = whole(fields[0])
	if len(fields) > 1 {
		minutes = whole(fields[1])
	}
	return hours, minutes
}

func whole(field string) int {
	value, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
	if err != nil {
		return 0
	}
	return int(value)
}

// spelled is a number as JavaScript prints one: the codec takes any minutes at or above 1, so a
// task saying 2.5 writes a line saying 2.5 — nonsense to cron, but the same nonsense on both
// sides rather than two different ones.
func spelled(value float64) string { return strconv.FormatFloat(value, 'g', -1, 64) }

// rounded is JavaScript's Math.round: a half goes up, including a negative half.
func rounded(value float64) int {
	if value < 0 {
		return -int(-value + 0.5)
	}
	return int(value + 0.5)
}

// quote is a word the shell and cron both leave alone: cron turns a bare % into a newline, and
// the shell ends a single-quoted word at a quote.
func quote(text string) string {
	held := strings.ReplaceAll(text, "'", `'\''`)
	return "'" + strings.ReplaceAll(held, "%", `\%`) + "'"
}

// ScheduleLines is one line per live schedule trigger — wired and switched on: cron fires curl,
// curl asks the server to run. A trigger switched off leaves the crontab, so the laptop stops
// waking for it at all.
func ScheduleLines(found []Scheduled, url string) []string {
	lines := []string{}
	for _, one := range found {
		wired := map[string]bool{}
		for _, edge := range one.Task.Edges {
			wired[edge.From] = true
		}
		for _, node := range one.Task.Nodes {
			beat := cronOf(node)
			if beat == "" || !task.Fires(node, wired) {
				continue
			}
			body := jsjson.NewObject()
			body.Set("root", string(one.Ref.Root))
			body.Set("path", string(one.Ref.Path))
			lines = append(lines,
				beat+" /usr/bin/curl -fsS -m 600 -X POST -H 'content-type: application/json' "+
					"-d "+quote(jsjson.Compact(body))+" "+quote(url+"/api/task/run")+" >/dev/null 2>&1")
		}
	}
	return lines
}

// Crontab keeps one block of the user's crontab: everything between the markers is broodmother's
// to rewrite, everything outside is theirs and passes through untouched.
type Crontab struct {
	io CrontabIO

	mutex sync.Mutex
	// installed is the lines last written, so a quiet beat costs nothing — not even a read.
	installed *string
}

func NewCrontab(io CrontabIO) *Crontab { return &Crontab{io: io} }

func (c *Crontab) Sync(lines []string) error {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	wanted := strings.Join(lines, "\n")
	if c.installed != nil && *c.installed == wanted {
		return nil
	}
	current, err := c.io.Read()
	if err != nil {
		return err
	}
	kept := foreign(current)
	var block []string
	if len(lines) > 0 {
		block = append(append([]string{begin}, lines...), end)
	}
	parts := kept
	if len(kept) > 0 && len(block) > 0 {
		parts = append(parts, "")
	}
	parts = append(parts, block...)
	next := ""
	if len(parts) > 0 {
		next = strings.Join(parts, "\n") + "\n"
	}
	if next != current {
		if err := c.io.Write(next); err != nil {
			return err
		}
	}
	c.installed = &wanted
	return nil
}

// foreign is everything outside the managed block, kept byte for byte.
func foreign(crontab string) []string {
	kept := []string{}
	inside := false
	for _, line := range strings.Split(crontab, "\n") {
		switch line {
		case begin:
			inside = true
		case end:
			inside = false
		default:
			if !inside {
				kept = append(kept, line)
			}
		}
	}
	for len(kept) > 0 && kept[len(kept)-1] == "" {
		kept = kept[:len(kept)-1]
	}
	return kept
}
