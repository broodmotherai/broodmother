package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const aFinding = `{"kind":"finding","name":"Sync stalls when the remote refuses a push",` +
	`"fields":{"claim":"the loop stops","evidence":"the log ends mid-push"},` +
	`"from":[{"relation":"derives-from","target":"README"}],"body":"The prose.","by":"agent/priya"}`

// recording writes a record and answers with the summary and whether it was written or found.
func recording(t *testing.T, server *Server, body string) (map[string]any, bool) {
	t.Helper()
	answer := sent(t, server, http.MethodPost, "/api/entities", body)
	held, _ := answer["entity"].(map[string]any)
	created, _ := answer["created"].(bool)
	return held, created
}

func listed(t *testing.T, server *Server) []map[string]any {
	t.Helper()
	answer := sent(t, server, http.MethodGet, "/api/entities", "")
	raw, _ := answer["entities"].([]any)
	found := make([]map[string]any, 0, len(raw))
	for _, one := range raw {
		held, _ := one.(map[string]any)
		found = append(found, held)
	}
	return found
}

// A project with a README for a record to point at, since a record with no provenance is refused.
func recordingHome(t *testing.T) (*Server, string) {
	t.Helper()
	home, checkout := projectHome(t, map[string]string{"README.md": "# notes\n"})
	return servingIn(t, home, ""), checkout
}

// Static, and served rather than duplicated, so the page's rail and the catalogue cannot drift.
func TestServesTheKindsAndRelationsItRefusesBy(t *testing.T) {
	server := serving(t, "")
	answer := sent(t, server, http.MethodGet, "/api/entities/catalogue", "")
	kinds, _ := answer["kinds"].([]any)
	relations, _ := answer["relations"].([]any)
	if len(kinds) != 8 || len(relations) != 6 {
		t.Fatalf("catalogued %d kinds and %d relations", len(kinds), len(relations))
	}
	first, _ := kinds[0].(map[string]any)
	if first["kind"] != "person" || first["note"] == "" {
		t.Errorf("the first kind is %+v", first)
	}
	required, _ := first["required"].([]any)
	if len(required) != 1 || required[0] != "role" {
		t.Errorf("a person needs %+v", required)
	}
}

// The same record twice is one record, so a tool can be re-run without forking the graph — and
// the answer is the path that already said it rather than a second copy.
func TestWritesARecordOnceHoweverOftenItIsToldTo(t *testing.T) {
	server, checkout := recordingHome(t)

	written, created := recording(t, server, aFinding)
	if !created {
		t.Fatal("found a record nobody had written")
	}
	want := "entities/finding/sync-stalls-when-the-remote-refuses-a-push.md"
	if written["path"] != want {
		t.Fatalf("filed it at %+v", written["path"])
	}
	if _, err := os.Stat(filepath.Join(checkout, filepath.FromSlash(want))); err != nil {
		t.Fatal(err)
	}
	// The source is resolved once here rather than guessed at by every caller.
	from, _ := written["from"].([]any)
	source, _ := from[0].(map[string]any)
	if source["target"] != "README" || source["path"] != "README.md" {
		t.Errorf("the source is %+v", source)
	}

	// The fields in the other order: a different request, the same record.
	again, created := recording(t, server, strings.Replace(aFinding,
		`{"claim":"the loop stops","evidence":"the log ends mid-push"}`,
		`{"evidence":"the log ends mid-push","claim":"the loop stops"}`, 1))
	if created {
		t.Error("wrote it twice")
	}
	if again["path"] != written["path"] {
		t.Errorf("the second answer points at %+v", again["path"])
	}
	if found := listed(t, server); len(found) != 1 {
		t.Errorf("the project holds %d records", len(found))
	}
}

// The rule the whole idea rests on: a record is what a tool wrote, and what it came from has to
// be something the project can be pointed at.
func TestRefusesARecordThatCameFromNothing(t *testing.T) {
	server, _ := recordingHome(t)
	said := refused(t, server, http.MethodPost, "/api/entities",
		strings.Replace(aFinding, `"target":"README"`, `"target":"nowhere"`, 1))
	if !strings.Contains(said, "nothing in the project answers to [[nowhere]]") {
		t.Errorf("refused with %s", said)
	}
	// Refused before anything is written, not after.
	if found := listed(t, server); len(found) != 0 {
		t.Errorf("wrote %+v", found)
	}
	// A kind's own keys are the codec's to insist on, in the codec's words.
	said = refused(t, server, http.MethodPost, "/api/entities",
		`{"kind":"decision","name":"Write it in Go","fields":{},"from":[],"origin":true,"body":""}`)
	if !strings.Contains(said, "choice") {
		t.Errorf("refused with %s", said)
	}
}

// A record either came from something or is where something began.
func TestWritesARecordThatIsWhereSomethingBegan(t *testing.T) {
	server, _ := recordingHome(t)
	written, created := recording(t, server,
		`{"kind":"decision","name":"Write it in Go","fields":{"choice":"Go","because":"one binary"},`+
			`"from":[],"origin":true,"body":""}`)
	if !created || written["origin"] != true {
		t.Fatalf("wrote %+v", written)
	}
	said := refused(t, server, http.MethodPost, "/api/entity/link",
		`{"path":"entities/decision/write-it-in-go.md","relation":"cites","target":"README"}`)
	if !strings.Contains(said, "where a line of work began") {
		t.Errorf("refused with %s", said)
	}
}

// The one edit that cannot be a re-record, and the loop it is refused over.
func TestAddsASourceAndRefusesTheLoopItWouldClose(t *testing.T) {
	server, _ := recordingHome(t)
	recording(t, server, aFinding)
	recording(t, server, `{"kind":"term","name":"Latched conflict",`+
		`"fields":{"definition":"a sync that will not resume"},`+
		`"from":[{"relation":"derives-from","target":"sync-stalls-when-the-remote-refuses-a-push"}],`+
		`"body":"what it means"}`)

	answer := sent(t, server, http.MethodPost, "/api/entity/link",
		`{"path":"entities/term/latched-conflict.md","relation":"cites","target":"README"}`)
	held, _ := answer["entity"].(map[string]any)
	from, _ := held["from"].([]any)
	if len(from) != 2 {
		t.Fatalf("comes from %+v", from)
	}
	// The record is rewritten with a digest of what it now says, so it does not read as edited.
	if held["edited"] != false {
		t.Errorf("reads as edited: %+v", held)
	}

	for what, body := range map[string]string{
		"a loop": `{"path":"entities/finding/sync-stalls-when-the-remote-refuses-a-push.md",` +
			`"relation":"cites","target":"latched-conflict"}`,
		"a source it already has": `{"path":"entities/term/latched-conflict.md",` +
			`"relation":"cites","target":"README"}`,
		"itself":                     `{"path":"entities/term/latched-conflict.md","relation":"cites","target":"latched-conflict"}`,
		"nothing":                    `{"path":"entities/term/latched-conflict.md","relation":"cites","target":"nowhere"}`,
		"a record that is not there": `{"path":"entities/term/nothing.md","relation":"cites","target":"README"}`,
	} {
		t.Run(what, func(t *testing.T) { refused(t, server, http.MethodPost, "/api/entity/link", body) })
	}
}

// A broken record gets a row saying what is wrong with it rather than being left out: a broken
// record hidden is a broken record nobody fixes.
func TestListsABrokenRecordWithWhatIsWrongWithIt(t *testing.T) {
	server, checkout := recordingHome(t)
	recording(t, server, aFinding)

	broken := filepath.Join(checkout, "entities", "finding", "half-written.md")
	if err := os.WriteFile(broken, []byte("---\nentity: finding\nname: Half written\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	found := listed(t, server)
	if len(found) != 2 {
		t.Fatalf("listed %+v", found)
	}
	var row map[string]any
	for _, one := range found {
		if one["path"] == "entities/finding/half-written.md" {
			row = one
		}
	}
	if row == nil {
		t.Fatalf("left it out: %+v", found)
	}
	if row["kind"] != nil || row["name"] != "half-written" {
		t.Errorf("drew it as %+v", row)
	}
	if said, _ := row["broken"].(string); said == "" {
		t.Errorf("said nothing about what is wrong: %+v", row)
	}
}

// The digest on disk no longer matching the `sha` it was written with is somebody having edited
// it since. Not broken — edited, which is what a document is for.
func TestSaysWhenSomebodyHasEditedARecordSince(t *testing.T) {
	server, checkout := recordingHome(t)
	written, _ := recording(t, server, aFinding)
	path, _ := written["path"].(string)

	full := filepath.Join(checkout, filepath.FromSlash(path))
	body, err := os.ReadFile(full)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, append(body, []byte("\nsomebody added a line.\n")...), 0o644); err != nil {
		t.Fatal(err)
	}

	found := listed(t, server)
	if len(found) != 1 || found[0]["edited"] != true {
		t.Errorf("listed %+v", found)
	}
}

// Two records that deserve the same filename are two records: the digest already proved they are
// not the same one.
func TestFilesASecondRecordOfTheSameNameBesideTheFirst(t *testing.T) {
	server, _ := recordingHome(t)
	first, _ := recording(t, server, aFinding)
	second, created := recording(t, server, strings.Replace(aFinding, `"body":"The prose."`, `"body":"Different prose."`, 1))
	if !created {
		t.Fatal("read a different record as the same one")
	}
	if second["path"] == first["path"] {
		t.Fatalf("wrote both to %+v", first["path"])
	}
	if second["path"] != "entities/finding/sync-stalls-when-the-remote-refuses-a-push-2.md" {
		t.Errorf("filed the second at %+v", second["path"])
	}
}

// Entities are a project idea, for the same reason wikilinks and sync are.
func TestHoldsNoRecordsBeforeThereIsAProject(t *testing.T) {
	server := serving(t, "")
	if found := listed(t, server); len(found) != 0 {
		t.Errorf("listed %+v", found)
	}
	response, body := send(t, server, http.MethodPost, "/api/entities", aFinding, "")
	if response.StatusCode != http.StatusConflict {
		t.Errorf("answered %d: %s", response.StatusCode, body)
	}
	var held map[string]any
	if err := json.Unmarshal(body, &held); err != nil {
		t.Fatal(err)
	}
	if said, _ := held["error"].(string); !strings.Contains(said, "no project is open") {
		t.Errorf("refused with %s", said)
	}
}
