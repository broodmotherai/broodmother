package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"database/sql"

	_ "modernc.org/sqlite"
)

func mothering(t *testing.T, write func(*sql.DB)) *Server {
	t.Helper()
	home := t.TempDir()
	if write != nil {
		db, err := sql.Open("sqlite", filepath.Join(home, "mother.db"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(motherSchema); err != nil {
			t.Fatal(err)
		}
		write(db)
		db.Close()
	}
	return servingIn(t, home, "")
}

// The schema the daemon writes, so a test can put something in the file before it opens.
const motherSchema = `
CREATE TABLE IF NOT EXISTS moments (id INTEGER PRIMARY KEY AUTOINCREMENT, rule TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE, root TEXT, path TEXT, evidence TEXT NOT NULL, p_need REAL NOT NULL,
  seen_at INTEGER NOT NULL, outcome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, moment INTEGER NOT NULL
  UNIQUE, text TEXT NOT NULL, record TEXT, shown_at INTEGER NOT NULL, verdict TEXT);
CREATE TABLE IF NOT EXISTS rules (rule TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
  shown INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

func motherStatus(t *testing.T, server *Server) map[string]any {
	t.Helper()
	return sent(t, server, http.MethodGet, "/api/mother", "")
}

// Before anything has noticed anything: on, the slider where it sits, and nothing to show.
func TestMotherStartsOnWithNothingToSay(t *testing.T) {
	server := mothering(t, nil)
	answer := motherStatus(t, server)
	settings, _ := answer["settings"].(map[string]any)
	if settings["on"] != true || settings["cfa"] != 0.5 {
		t.Fatalf("settings are %+v", settings)
	}
	if items, _ := answer["items"].([]any); len(items) != 0 {
		t.Errorf("shows %+v", items)
	}
	if rules, _ := answer["rules"].([]any); len(rules) != 0 {
		t.Errorf("knows of %+v", rules)
	}
	if answer["sweptAt"] != nil {
		t.Errorf("has swept at %+v", answer["sweptAt"])
	}
}

// A settings write says what moved and leaves alone what it did not.
func TestMotherSettingsSayWhatMoved(t *testing.T) {
	server := mothering(t, nil)
	answer := sent(t, server, http.MethodPut, "/api/mother/settings", `{"cfa":2.5}`)
	settings, _ := answer["settings"].(map[string]any)
	if settings["cfa"] != 2.5 || settings["on"] != true {
		t.Fatalf("settings are %+v", settings)
	}
	answer = sent(t, server, http.MethodPut, "/api/mother/settings", `{"on":false}`)
	settings, _ = answer["settings"].(map[string]any)
	if settings["on"] != false || settings["cfa"] != 2.5 {
		t.Errorf("settings are %+v", settings)
	}
	// The slider has ends.
	for _, body := range []string{`{"cfa":0}`, `{"cfa":-1}`, `{"cfa":11}`} {
		refused(t, server, http.MethodPut, "/api/mother/settings", body)
	}
	if settings, _ := motherStatus(t, server)["settings"].(map[string]any); settings["cfa"] != 2.5 {
		t.Errorf("a refused write moved it: %+v", settings)
	}
}

// A rule nothing has said anything about is on; turning one off is the first row it gets.
func TestMotherRemembersWhichRulesAreOff(t *testing.T) {
	server := mothering(t, nil)
	answer := sent(t, server, http.MethodPut, "/api/mother/settings",
		`{"rules":{"sweep":false,"waiting":true}}`)
	rules, _ := answer["rules"].([]any)
	if len(rules) != 2 {
		t.Fatalf("knows of %+v", rules)
	}
	held := map[string]any{}
	for _, one := range rules {
		row, _ := one.(map[string]any)
		held[row["rule"].(string)] = row["enabled"]
	}
	if held["sweep"] != false || held["waiting"] != true {
		t.Errorf("rules are %+v", held)
	}
}

// A sweep records that a look happened. What it would have found is the deliberation's, and there
// is none here.
func TestASweepMarksTheTime(t *testing.T) {
	server := mothering(t, nil)
	answer := sent(t, server, http.MethodPost, "/api/mother/sweep", "")
	at, _ := answer["sweptAt"].(float64)
	if at <= 0 {
		t.Fatalf("swept at %+v", answer["sweptAt"])
	}
	if held, _ := motherStatus(t, server)["sweptAt"].(float64); held != at {
		t.Errorf("remembers %+v, swept at %v", held, at)
	}
}

// The feed is what was noticed, newest first, each with what was said about it.
func TestMotherShowsWhatWasNoticedNewestFirst(t *testing.T) {
	server := mothering(t, func(db *sql.DB) {
		db.Exec(`INSERT INTO moments (rule, digest, root, path, evidence, p_need, seen_at, outcome)
			VALUES ('waiting','d1','project','notes/a.md','a shell has been waiting',0.7,1000,'surfaced')`)
		db.Exec(`INSERT INTO moments (rule, digest, root, path, evidence, p_need, seen_at, outcome)
			VALUES ('sweep','d2',NULL,NULL,'a periodic look',1,2000,'quiet')`)
		db.Exec(`INSERT INTO suggestions (moment, text, record, shown_at)
			VALUES (1,'Something is waiting on you','entities/finding/x.md',1500)`)
		db.Exec(`INSERT INTO rules (rule, enabled, shown, accepted) VALUES ('waiting',1,3,1)`)
	})

	answer := motherStatus(t, server)
	items, _ := answer["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("shows %+v", items)
	}
	// Newest first: the sweep, then the waiting shell.
	first, _ := items[0].(map[string]any)
	moment, _ := first["moment"].(map[string]any)
	if moment["rule"] != "sweep" || moment["outcome"] != "quiet" {
		t.Errorf("the first is %+v", moment)
	}
	// A moment about nothing in particular carries no ref at all.
	if _, said := moment["ref"]; said {
		t.Errorf("the sweep is about %+v", moment["ref"])
	}
	if _, said := first["suggestion"]; said {
		t.Errorf("nothing was said about it, but it carries %+v", first["suggestion"])
	}

	second, _ := items[1].(map[string]any)
	moment, _ = second["moment"].(map[string]any)
	ref, _ := moment["ref"].(map[string]any)
	if ref["root"] != "project" || ref["path"] != "notes/a.md" {
		t.Errorf("the second is about %+v", moment["ref"])
	}
	said, _ := second["suggestion"].(map[string]any)
	if said == nil || said["text"] != "Something is waiting on you" {
		t.Fatalf("what was said is %+v", second["suggestion"])
	}
	// A suggestion wears the rule and the ref of the moment it is about.
	if said["rule"] != "waiting" || said["record"] != "entities/finding/x.md" {
		t.Errorf("what was said is %+v", said)
	}
	if _, waiting := said["verdict"]; waiting {
		t.Errorf("it already has a verdict: %+v", said["verdict"])
	}
}

// A verdict is a thing you said once, and the tally underneath it is counted once too.
func TestAVerdictIsGivenOnceAndCounted(t *testing.T) {
	server := mothering(t, func(db *sql.DB) {
		db.Exec(`INSERT INTO moments (rule, digest, root, path, evidence, p_need, seen_at, outcome)
			VALUES ('waiting','d1',NULL,NULL,'something',0.7,1000,'surfaced')`)
		db.Exec(`INSERT INTO suggestions (moment, text, shown_at) VALUES (1,'Do the thing',1500)`)
		db.Exec(`INSERT INTO rules (rule, enabled, shown, accepted) VALUES ('waiting',1,1,0)`)
	})

	answer := sent(t, server, http.MethodPost, "/api/mother/verdict",
		`{"suggestion":"suggestion-1","verdict":"accepted"}`)
	said, _ := answer["suggestion"].(map[string]any)
	if said["verdict"] != "accepted" {
		t.Fatalf("answered %+v", said)
	}
	rules, _ := motherStatus(t, server)["rules"].([]any)
	row, _ := rules[0].(map[string]any)
	if row["accepted"] != 1.0 || row["shown"] != 1.0 {
		t.Fatalf("the tally is %+v", row)
	}

	// Said again, it keeps the answer it had — and the tally does not move.
	answer = sent(t, server, http.MethodPost, "/api/mother/verdict",
		`{"suggestion":"suggestion-1","verdict":"dismissed"}`)
	said, _ = answer["suggestion"].(map[string]any)
	if said["verdict"] != "accepted" {
		t.Errorf("changed its mind to %+v", said["verdict"])
	}
	rules, _ = motherStatus(t, server)["rules"].([]any)
	row, _ = rules[0].(map[string]any)
	if row["accepted"] != 1.0 {
		t.Errorf("counted it twice: %+v", row)
	}
}

func TestRefusesAVerdictItCannotGive(t *testing.T) {
	server := mothering(t, nil)
	for _, body := range []string{
		`{"suggestion":"suggestion-1"}`,
		`{"suggestion":"suggestion-1","verdict":"maybe"}`,
		`{"verdict":"accepted"}`,
	} {
		refused(t, server, http.MethodPost, "/api/mother/verdict", body)
	}
	// A suggestion that is not there is not found, rather than a bad request.
	response, body := send(t, server, http.MethodPost, "/api/mother/verdict",
		`{"suggestion":"suggestion-404","verdict":"accepted"}`, "")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	var held map[string]any
	if err := json.Unmarshal(body, &held); err != nil {
		t.Fatal(err)
	}
	if said, _ := held["error"].(string); !strings.Contains(said, "no suggestion") {
		t.Errorf("refused with %s", said)
	}
}
