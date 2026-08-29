package ledger

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

func store(t *testing.T) *Store {
	t.Helper()
	held, err := Open(filepath.Join(t.TempDir(), "deep", "ledger.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { held.Close() })
	return held
}

func write(t *testing.T, held *Store, path string, actor Actor) {
	t.Helper()
	if err := held.Record(New{Project: "/p", Root: doc.Project, Path: path, Action: Write, Actor: actor}); err != nil {
		t.Fatal(err)
	}
}

// Newest first, because a row says what was true when it was written and nothing has told the
// ledger since.
func TestAnswersNewestFirst(t *testing.T) {
	held := store(t)
	write(t, held, "a.md", Person())
	write(t, held, "a.md", Actor{Kind: AgentActor, ID: "a1", Name: "Priya"})

	acts := held.ForPath("/p", doc.Project, "a.md", 5)
	if len(acts) != 2 {
		t.Fatalf("found %d acts", len(acts))
	}
	if acts[0].Actor.Kind != AgentActor || acts[1].Actor.Kind != PersonActor {
		t.Errorf("in the order %v", []ActorKind{acts[0].Actor.Kind, acts[1].Actor.Kind})
	}
}

// "Priya made it, Rafa changed it" is the thing the ledger exists to be able to say.
func TestRemembersWhoMadeItAndWhoChangedIt(t *testing.T) {
	held := store(t)
	made, changed := true, false
	for _, one := range []struct {
		actor   Actor
		created *bool
	}{
		{Actor{Kind: AgentActor, Name: "Priya"}, &made},
		{Actor{Kind: AgentActor, Name: "Rafa"}, &changed},
	} {
		if err := held.Record(New{Project: "/p", Root: doc.Project, Path: "a.md",
			Action: Write, Actor: one.actor, Created: one.created}); err != nil {
			t.Fatal(err)
		}
	}
	acts := held.ForPath("/p", doc.Project, "a.md", 5)
	if acts[1].Created == nil || !*acts[1].Created || acts[1].Actor.Name != "Priya" {
		t.Errorf("who made it is %+v", acts[1])
	}
	if acts[0].Created == nil || *acts[0].Created || acts[0].Actor.Name != "Rafa" {
		t.Errorf("who changed it is %+v", acts[0])
	}
}

// Every field of an actor survives the round trip, and an empty one comes back empty rather than
// as a string saying so.
func TestKeepsEveryFieldOfAClaim(t *testing.T) {
	held := store(t)
	whole := Actor{Kind: AgentActor, ID: "a1", Name: "Priya", Persona: "dev/chad", Model: "opus", Context: "chat/7"}
	write(t, held, "a.md", whole)
	write(t, held, "b.md", Actor{Kind: PersonActor})

	if got := held.ForPath("/p", doc.Project, "a.md", 1)[0].Actor; got != whole {
		t.Errorf("read back %+v", got)
	}
	if got := held.ForPath("/p", doc.Project, "b.md", 1)[0].Actor; got != (Actor{Kind: PersonActor}) {
		t.Errorf("a bare person read back as %+v", got)
	}
}

// One project's ledger is not another's, and neither is one path's.
func TestKeepsProjectsAndPathsApart(t *testing.T) {
	held := store(t)
	write(t, held, "a.md", Person())
	if err := held.Record(New{Project: "/other", Root: doc.Project, Path: "a.md", Action: Write, Actor: Person()}); err != nil {
		t.Fatal(err)
	}
	if err := held.Record(New{Project: "/p", Root: doc.RepoRoot("code"), Path: "a.md", Action: Write, Actor: Person()}); err != nil {
		t.Fatal(err)
	}

	if got := len(held.ForPath("/p", doc.Project, "a.md", 10)); got != 1 {
		t.Errorf("the project's path has %d acts", got)
	}
	if got := len(held.Recent("/p", 100)); got != 2 {
		t.Errorf("the project has %d acts", got)
	}
	if got := len(held.Recent("/other", 100)); got != 1 {
		t.Errorf("the other project has %d acts", got)
	}
}

func TestAnswersNothingAboutAPathNobodyHasTouched(t *testing.T) {
	held := store(t)
	if got := held.ForPath("/p", doc.Project, "nowhere.md", 5); len(got) != 0 {
		t.Errorf("found %v", got)
	}
}

// The oldest go once a project has more than it keeps.
func TestDropsTheOldestPastWhatItKeeps(t *testing.T) {
	held := store(t)
	for range keep + 20 {
		write(t, held, "a.md", Person())
	}
	if got := len(held.Recent("/p", keep*2)); got > keep+1 {
		t.Errorf("kept %d acts, which is more than %d", got, keep)
	}
	// And another project's are untouched by the pruning of this one.
	if err := held.Record(New{Project: "/other", Root: doc.Project, Path: "a.md", Action: Write, Actor: Person()}); err != nil {
		t.Fatal(err)
	}
	if got := len(held.Recent("/other", 10)); got != 1 {
		t.Errorf("the other project has %d acts", got)
	}
}

// The clock is the store's, the way it is for a chat's messages.
func TestStampsAnActWithTheStoresOwnClock(t *testing.T) {
	held := store(t)
	at := time.Unix(1700000000, 0)
	held.Now = func() time.Time { return at }
	write(t, held, "a.md", Person())
	if got := held.ForPath("/p", doc.Project, "a.md", 1)[0].At; got != at.UnixMilli() {
		t.Errorf("stamped %d, want %d", got, at.UnixMilli())
	}
}
