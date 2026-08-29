package doc_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/doc"

	"encoding/json"
	"testing"
)

func TestARootRoundTripsThroughItsWireForm(t *testing.T) {
	for _, root := range []Root{Project, RepoRoot("broodmother")} {
		back, err := ParseRoot(string(root))
		if err != nil || back != root {
			t.Errorf("%q came back as %q (%v)", root, back, err)
		}
	}
}

func TestNamesTheRepoARootNames(t *testing.T) {
	if _, found := Project.Repo(); found {
		t.Error("the project named a repo")
	}
	name, found := RepoRoot("website").Repo()
	if !found || name != "website" {
		t.Errorf("named %q (%v)", name, found)
	}
}

func TestRefusesARootThatNamesNothing(t *testing.T) {
	for _, raw := range []string{"repo:", "notes", ""} {
		if _, err := ParseRoot(raw); err == nil {
			t.Errorf("%q was accepted", raw)
		}
	}
}

func TestATreeEventSerialisesTheWayTheBrowserReadsIt(t *testing.T) {
	moved, _ := json.Marshal(Event{Type: Moved, From: "a.md", To: "b.md"})
	if string(moved) != `{"type":"moved","from":"a.md","to":"b.md"}` {
		t.Errorf("moved event is %s", moved)
	}
	changed, _ := json.Marshal(Event{Type: Changed, Path: "a.md"})
	if string(changed) != `{"type":"changed","path":"a.md"}` {
		t.Errorf("changed event is %s", changed)
	}
}
