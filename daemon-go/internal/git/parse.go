// What git says, read. Every function here is pure: a string in, an answer out, and no process
// anywhere near it — which is what lets the corpus hold both implementations to the same
// answers for output nobody wants to produce on demand.

package git

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

type Status struct {
	Changed    []doc.Path `json:"changed"`
	Conflicted []doc.Path `json:"conflicted"`
	Ahead      int        `json:"ahead"`
	Behind     int        `json:"behind"`
}

// Failure is why a command that reached the network did not do what was asked.
type Failure string

const (
	FailOffline  Failure = "offline"
	FailDiverged Failure = "diverged"
	FailAuth     Failure = "auth"
	FailConflict Failure = "conflict"
	FailOther    Failure = "other"
)

// Result is what a command that can fail for a reason worth naming answers with.
type Result struct {
	OK      bool
	Failure Failure
	Message string
}

var (
	offlineWords  = regexp.MustCompile(`could not resolve host|connection refused|network is unreachable|no route to host|connection timed out|operation timed out|temporary failure in name resolution|failed to connect`)
	divergedWords = regexp.MustCompile(`non-fast-forward|fetch first|updates were rejected|behind its remote`)
	authWords     = regexp.MustCompile(`authentication failed|permission denied|could not read from remote repository|terminal prompts disabled|invalid username or password`)
)

// ClassifyRemoteError is which of the four a remote refused for. Read off what git said, since
// git has no exit code that tells them apart.
func ClassifyRemoteError(text string) Failure {
	lowered := strings.ToLower(text)
	switch {
	case offlineWords.MatchString(lowered):
		return FailOffline
	case divergedWords.MatchString(lowered):
		return FailDiverged
	case authWords.MatchString(lowered):
		return FailAuth
	}
	return FailOther
}

// fieldsAfter is a porcelain record past its first n spaces, which is where the path starts.
// The path itself may hold spaces, so it is what is left rather than a field of its own.
func fieldsAfter(record string, spaces int) string {
	index := -1
	for range spaces {
		next := strings.Index(record[index+1:], " ")
		if next < 0 {
			return ""
		}
		index += next + 1
	}
	return record[index+1:]
}

// changeOf is the one letter a row can wear, out of the two git reports. Staged and unstaged are
// one question to a sidebar with no staging of its own: gone anywhere is gone, new anywhere is
// new, and anything else it has touched is modified.
func changeOf(xy string) Change {
	if strings.Contains(xy, "D") {
		return Removed
	}
	if strings.Contains(xy, "A") {
		return Added
	}
	return Modified
}

// between is `slice(from, to)`, which in JavaScript is short rather than out of range: a record
// too short to hold the two letters gives up neither of them instead of ending the read.
func between(record string, from, to int) string {
	if from >= len(record) {
		return ""
	}
	return record[from:min(to, len(record))]
}

func records(stdout string) []string {
	kept := []string{}
	for _, one := range strings.Split(stdout, "\x00") {
		if one != "" {
			kept = append(kept, one)
		}
	}
	return kept
}

// ParseChanges keeps what became of each path instead of flattening every kind into one list.
func ParseChanges(stdout string) TreeChanges {
	changes := TreeChanges{}
	held := records(stdout)
	for index := 0; index < len(held); index++ {
		record := held[index]
		switch record[0] {
		case '1':
			changes[fieldsAfter(record, 8)] = changeOf(between(record, 2, 4))
		case '2':
			changes[fieldsAfter(record, 9)] = Renamed
			// The original path of a rename is its own NUL-separated field.
			index++
		case 'u':
			changes[fieldsAfter(record, 10)] = Conflicted
		case '?':
			changes[fieldsAfter(record, 1)] = Added
		}
	}
	return changes
}

var aheadBehind = regexp.MustCompile(`^# branch\.ab \+(\d+) -(\d+)$`)

func ParseStatus(stdout string) Status {
	status := Status{Changed: []doc.Path{}, Conflicted: []doc.Path{}}
	held := records(stdout)
	for index := 0; index < len(held); index++ {
		record := held[index]
		switch record[0] {
		case '#':
			if counts := aheadBehind.FindStringSubmatch(record); counts != nil {
				status.Ahead, _ = strconv.Atoi(counts[1])
				status.Behind, _ = strconv.Atoi(counts[2])
			}
		case '1':
			status.Changed = append(status.Changed, fieldsAfter(record, 8))
		case '2':
			status.Changed = append(status.Changed, fieldsAfter(record, 9))
			index++
		case 'u':
			status.Conflicted = append(status.Conflicted, fieldsAfter(record, 10))
		case '?':
			status.Changed = append(status.Changed, fieldsAfter(record, 1))
		}
	}
	return status
}

var letterChange = map[byte]Change{'A': Added, 'D': Removed}

// ParseNameStatus reads `--name-status -z`: every field is NUL-terminated, the status is a field
// of its own, and a rename is three fields rather than two — the old name, then the new one.
func ParseNameStatus(stdout string) []DiffFile {
	fields := records(stdout)
	files := []DiffFile{}
	for index := 0; index < len(fields); index++ {
		letter := fields[index][0]
		if letter == 'R' {
			if index+2 >= len(fields) {
				break
			}
			from := fields[index+1]
			files = append(files, DiffFile{Path: fields[index+2], Change: Renamed, From: &from})
			index += 2
			continue
		}
		if index+1 >= len(fields) {
			break
		}
		index++
		change, named := letterChange[letter]
		if !named {
			change = Modified
		}
		files = append(files, DiffFile{Path: fields[index], Change: change, From: nil})
	}
	return files
}

// ParseSettings is how a project syncs, as a request must send it: every switch there and the
// idle a whole number of milliseconds no shorter than a second. Trailers is defaulted rather
// than required, for the reason the config gives — a settings body written before trailers
// existed is one that still parses.
func ParseSettings(raw json.RawMessage) (Settings, error) {
	var held map[string]json.RawMessage
	if json.Unmarshal(raw, &held) != nil || held == nil {
		return Settings{}, apperr.BadRequestf("settings must be an object")
	}
	var settings Settings
	for _, field := range []struct {
		key  string
		into *bool
	}{
		{"enabled", &settings.Enabled}, {"autoCommit", &settings.AutoCommit},
		{"pull", &settings.Pull}, {"push", &settings.Push},
	} {
		if json.Unmarshal(orNull(held[field.key]), field.into) != nil {
			return Settings{}, apperr.BadRequestf("settings %s is not a boolean", field.key)
		}
	}
	var idle float64
	if json.Unmarshal(orNull(held["idleMs"]), &idle) != nil || idle != math.Trunc(idle) || idle < 1000 {
		return Settings{}, apperr.BadRequestf("settings idleMs is not a whole number of milliseconds, at least 1000")
	}
	settings.IdleMs = int(idle)
	if data, said := held["trailers"]; said && json.Unmarshal(data, &settings.Trailers) != nil {
		return Settings{}, apperr.BadRequestf("settings trailers is not a boolean")
	}
	return settings, nil
}

func orNull(data json.RawMessage) json.RawMessage {
	if data == nil {
		return json.RawMessage("null")
	}
	return data
}
