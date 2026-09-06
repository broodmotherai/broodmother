// What an agent has said that nobody has read: what counts towards the badge, what does not, and
// what clears it.

package chat_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/chat"

	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

const project = "/p"

func opened(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "chats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func hired(t *testing.T, store *Store, name string) Agent {
	t.Helper()
	made, err := store.CreateAgent(project, NewAgent{
		Name: name, Persona: "dev/hand", Model: "claude-opus-5", Color: "#aabbcc",
	})
	if err != nil {
		t.Fatal(err)
	}
	return made
}

func said(t *testing.T, store *Store, chat, role, text, from string) {
	t.Helper()
	if _, err := store.Add(chat, role, text, 0, from); err != nil {
		t.Fatal(err)
	}
}

// The thing the badge is for: an agent answers while nobody is looking, and the answer is waiting.
func TestWhatAnAgentSaidIsUnseen(t *testing.T) {
	store := opened(t)
	one := hired(t, store, "Priya")
	said(t, store, one.Chat, "user", "how does sync stall?", "")
	said(t, store, one.Chat, "assistant", "the push is refused", "")

	if held := store.Unseen(one.ID); held != 1 {
		t.Fatalf("unseen is %d, want 1 — only what they said counts", held)
	}
}

// A message another agent delivered into the thread is something to come back for too: nobody in
// this app typed it.
func TestADeliveryFromAnotherAgentIsUnseen(t *testing.T) {
	store := opened(t)
	one := hired(t, store, "Priya")
	two := hired(t, store, "Sam")
	said(t, store, one.Chat, "user", "have a look at the sync loop", two.ID)

	if held := store.Unseen(one.ID); held != 1 {
		t.Fatalf("unseen is %d, want 1", held)
	}
}

// The row a reply is being written into is empty until it lands. Counting it would put a badge up
// the moment somebody started talking, and clicking it would open onto nothing.
func TestAnEmptyAnswerIsNotUnseen(t *testing.T) {
	store := opened(t)
	one := hired(t, store, "Priya")
	said(t, store, one.Chat, "assistant", "", "")

	if held := store.Unseen(one.ID); held != 0 {
		t.Fatalf("unseen is %d, want 0", held)
	}
}

// Reading is what clears it, and what is said after is unread again.
func TestReadingClearsItAndTheNextThingDoesNot(t *testing.T) {
	store := opened(t)
	one := hired(t, store, "Priya")
	said(t, store, one.Chat, "assistant", "the push is refused", "")
	store.MarkSeen(one.ID)

	if held := store.Unseen(one.ID); held != 0 {
		t.Fatalf("unseen is %d after reading, want 0", held)
	}
	said(t, store, one.Chat, "assistant", "and here is why", "")
	if held := store.Unseen(one.ID); held != 1 {
		t.Fatalf("unseen is %d after they said another thing, want 1", held)
	}
}

// One agent's thread is not another's.
func TestTheCountIsPerAgent(t *testing.T) {
	store := opened(t)
	one := hired(t, store, "Priya")
	two := hired(t, store, "Sam")
	said(t, store, one.Chat, "assistant", "mine", "")
	said(t, store, two.Chat, "assistant", "and mine", "")
	store.MarkSeen(one.ID)

	if held := store.Unseen(one.ID); held != 0 {
		t.Fatalf("Priya's unseen is %d, want 0", held)
	}
	if held := store.Unseen(two.ID); held != 1 {
		t.Fatalf("Sam's unseen is %d, want 1", held)
	}
}

// An emptied thread has nothing unread in it, and the mark cannot be left pointing at a row that
// is gone.
func TestClearingTheConversationClearsTheCount(t *testing.T) {
	store := opened(t)
	one := hired(t, store, "Priya")
	said(t, store, one.Chat, "assistant", "the push is refused", "")
	store.Clear(one.Chat)

	if held := store.Unseen(one.ID); held != 0 {
		t.Fatalf("unseen is %d after clearing, want 0", held)
	}
	said(t, store, one.Chat, "assistant", "starting again", "")
	if held := store.Unseen(one.ID); held != 1 {
		t.Fatalf("unseen is %d after they said something into the empty thread, want 1", held)
	}
}

// A file written before any of this existed opens to a badge of nothing rather than to a badge of
// everything ever said, which is the only reading of it anybody believes.
func TestAFileFromBeforeTheMarkOpensRead(t *testing.T) {
	file := filepath.Join(t.TempDir(), "chats.db")
	before, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	one := hired(t, before, "Priya")
	said(t, before, one.Chat, "assistant", "said long ago", "")
	before.Close()

	// The column back off again, which is the file as an older build left it.
	db, err := sql.Open("sqlite", file)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE agents DROP COLUMN seen`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	after, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer after.Close()

	if held := after.Unseen(one.ID); held != 0 {
		t.Fatalf("unseen is %d in a file that predates the mark, want 0", held)
	}
	said(t, after, one.Chat, "assistant", "and something new", "")
	if held := after.Unseen(one.ID); held != 1 {
		t.Fatalf("unseen is %d after something new, want 1", held)
	}
}
