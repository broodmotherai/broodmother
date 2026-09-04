// One folder per run, under the broodmother home: the files the steps handed each other, kept
// after the run as its inspectable record and pruned with its row in the store.

package tasks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

// subjectFile is what the run is about, for the steps that come after the one that knows. A
// trigger's payload only ever reaches the first step, so an action three along — comment on the
// issue we have been discussing — would have nothing to go on; this is the one file in the folder
// that is the run's rather than a step's.
//
// One file whatever the service, tagged with which one it was: a step reads it and checks whose
// subject it is, so a run started by one provider cannot be acted on by another's step reading a
// shape that happens to fit.
const subjectFile = "about.json"

// writeSubject is best-effort, like the rest of the folder: a run whose files have nowhere to go
// still runs.
func writeSubject(dir string, about *taskrun.Subject) {
	if dir == "" || about == nil {
		return
	}
	body, err := json.MarshalIndent(about, "", "  ")
	if err != nil {
		return
	}
	os.WriteFile(filepath.Join(dir, subjectFile), append(body, '\n'), 0o644)
}

// readSubject is what the trigger that started this run knew, for a step three along. Nothing
// where the run had no subject, which is every run somebody started by hand.
func readSubject(dir string) *taskrun.Subject {
	if dir == "" {
		return nil
	}
	body, err := os.ReadFile(filepath.Join(dir, subjectFile))
	if err != nil {
		return nil
	}
	var about taskrun.Subject
	if json.Unmarshal(body, &about) != nil {
		return nil
	}
	return &about
}

// files are the four one step reads and writes, named for the flow they serve.
type files struct {
	opening string
	input   string
	output  string
	verdict string
}

func stepFiles(dir, id string) files {
	stem := filepath.Join(dir, safeName(id))
	return files{
		opening: stem + ".md",
		input:   stem + ".in.md",
		output:  stem + ".out.md",
		verdict: stem + ".verdict.json",
	}
}

// safeName keeps a node id to what a filename may hold: the id is the editor's, and somebody can
// type one.
func safeName(id string) string {
	var out strings.Builder
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			out.WriteRune(r)
		default:
			out.WriteByte('-')
		}
	}
	if out.Len() == 0 {
		return "node"
	}
	return out.String()
}

// openScratch makes the run's folder, or answers with nothing where it cannot — a run whose
// hand-off files have nowhere to go still runs, passing its context in memory.
func openScratch(base, runID string) string {
	dir := taskrun.ScratchOf(base, runID)
	if os.MkdirAll(dir, 0o755) != nil {
		return ""
	}
	return dir
}

// pruneScratch takes away the folders of the runs the store let go.
func pruneScratch(base string, runIDs []string) {
	for _, id := range runIDs {
		os.RemoveAll(taskrun.ScratchOf(base, id))
	}
}

// openingContext is what the trigger saw, rendered as the run's opening file. A manual run opens
// on nothing; a file trigger names the file that moved and carries what it now says; every other
// trigger's payload already is the context.
func openingContext(node task.Node, payload string, said bool) string {
	if !said {
		return ""
	}
	if node.Kind == task.FileTrigger && payload != "" {
		body, err := os.ReadFile(payload)
		if err != nil {
			return payload
		}
		return payload + "\n\n" + string(body)
	}
	return payload
}

// feed is one edge into a step: which node said it, and what it said.
type feed struct {
	name   string
	output string
}

// composeInput is one file in, whatever fed it: a single feed passes through whole, and a join
// names each part after the node that said it.
func composeInput(feeds []feed) string {
	live := make([]feed, 0, len(feeds))
	for _, one := range feeds {
		if one.output != "" {
			live = append(live, one)
		}
	}
	if len(live) == 0 {
		return ""
	}
	if len(live) == 1 {
		return live[0].output
	}
	parts := make([]string, 0, len(live))
	for _, one := range live {
		parts = append(parts, "## from "+one.name+"\n\n"+one.output)
	}
	return strings.Join(parts, "\n\n")
}

// writeFile and readFile are best-effort: the scratch folder is a record of the run, not the run.
func writeFile(path, body string) {
	if path != "" {
		os.WriteFile(path, []byte(body), 0o644)
	}
}

func readFile(path string) (string, bool) {
	if path == "" {
		return "", false
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	return string(body), true
}
