// A reply: what the page is told as it arrives, what is written down on the way, and what happens
// to the row when it ends.

package chats_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/chats"

	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/chat"
	"github.com/broodmotherai/broodmother/daemon-go/internal/llm"
)

// page is a watcher that only remembers, so a test can read what a socket would have been sent.
type page struct {
	mutex   sync.Mutex
	ready   *readied
	deltas  strings.Builder
	steps   []chat.Step
	said    []chat.Message
	done    *chat.Message
	failure string
	closed  bool
}

type readied struct {
	streaming bool
	text      string
	steps     []chat.Step
	message   string
}

func (p *page) Ready(_ string, streaming bool, text string, steps []chat.Step, message string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.ready = &readied{streaming: streaming, text: text, steps: steps, message: message}
}

func (p *page) Delta(text string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.deltas.WriteString(text)
}

func (p *page) Step(step chat.Step) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.steps = append(p.steps, step)
}

func (p *page) Said(message chat.Message) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.said = append(p.said, message)
}

func (p *page) Done(message chat.Message) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.done = &message
}

func (p *page) Failed(reason string) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.failure = reason
}

func (p *page) Close() {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	p.closed = true
}

func (p *page) read(work func()) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	work()
}

// speaker is a model that answers with the parts it was handed.
type speaker struct {
	parts []llm.Part
	err   error
	// blocked, where a test wants a reply that is still arriving, is closed to let it finish.
	blocked chan struct{}
	mutex   sync.Mutex
	asked   []llm.Ask
}

func (s *speaker) Stream(ctx context.Context, ask llm.Ask, part func(llm.Part)) error {
	s.mutex.Lock()
	s.asked = append(s.asked, ask)
	s.mutex.Unlock()
	for _, one := range s.parts {
		part(one)
	}
	if s.blocked != nil {
		select {
		case <-s.blocked:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return s.err
}

func text(said string) llm.Part { return llm.Part{Kind: llm.TextPart, Text: said} }
func brk() llm.Part             { return llm.Part{Kind: llm.BreakPart} }
func step(id, state string) llm.Part {
	return llm.Part{Kind: llm.StepPart, Step: chat.Step{ID: id, Tool: "read_doc", Summary: "read a.md", State: state}}
}

// standing is a store and its live half, with a model a test writes the answers for.
func standing(t *testing.T, model *speaker) (*Chats, *chat.Store, string) {
	t.Helper()
	store, err := chat.Open(filepath.Join(t.TempDir(), "chats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })

	held := New(Deps{
		Store:   store,
		Project: func() string { return "/p" },
		Stream:  model,
		Turn: func(chat.Chat, func(string, string)) (Turn, error) {
			return Turn{System: "you are a chat"}, nil
		},
	})
	t.Cleanup(held.Close)

	made, err := store.Create("/p", "claude-opus-5")
	if err != nil {
		t.Fatal(err)
	}
	return held, store, made.ID
}

func until(t *testing.T, what string, ready func() bool) {
	t.Helper()
	for range 400 {
		if ready() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("never %s", what)
}

// The plainest turn: what was asked is written down before the answer is asked for, the answer
// arrives a word at a time, and the row it lands in is what the page is handed.
func TestAReplyArrivesAndIsWrittenDown(t *testing.T) {
	held, store, id := standing(t, &speaker{parts: []llm.Part{text("Hello"), text(" there")}})
	watcher := &page{}
	held.Attach(id, watcher)

	held.Said(id, watcher, "hi", "claude-opus-5")
	until(t, "answered", func() bool {
		var done bool
		watcher.read(func() { done = watcher.done != nil })
		return done
	})

	watcher.read(func() {
		if watcher.deltas.String() != "Hello there" {
			t.Errorf("the page saw %q", watcher.deltas.String())
		}
		if watcher.done.Text != "Hello there" {
			t.Errorf("the row is %q", watcher.done.Text)
		}
	})
	found, _ := store.Chat(id)
	if len(found.Messages) != 2 {
		t.Fatalf("%d messages, want 2", len(found.Messages))
	}
	if found.Messages[0].Text != "hi" || found.Messages[1].Text != "Hello there" {
		t.Errorf("stored %+v", found.Messages)
	}
	// A conversation still called what it was born as takes its name from the first thing said.
	if found.Title != "hi" {
		t.Errorf("named %q", found.Title)
	}
}

// A step is filed by its id, so the same step twice — once starting, once landed — changes the row
// on screen rather than doubling it.
func TestAStepLandsOnTheRowItStarted(t *testing.T) {
	held, store, id := standing(t, &speaker{parts: []llm.Part{
		step("call-1", "running"), step("call-1", "done"), text("read it"),
	}})
	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "read a.md", "claude-opus-5")
	until(t, "answered", func() bool {
		var done bool
		watcher.read(func() { done = watcher.done != nil })
		return done
	})

	watcher.read(func() {
		if len(watcher.steps) != 2 {
			t.Fatalf("the page saw %d step messages", len(watcher.steps))
		}
		if len(watcher.done.Steps) != 1 || watcher.done.Steps[0].State != "done" {
			t.Errorf("the row carries %+v", watcher.done.Steps)
		}
	})
	found, _ := store.Chat(id)
	if len(found.Messages[1].Steps) != 1 {
		t.Errorf("stored %+v", found.Messages[1].Steps)
	}
}

// One message ends mid-turn and the next begins: what has arrived is handed over as said, and a
// fresh row takes what follows.
func TestABreakHandsOverOneMessageAndStartsAnother(t *testing.T) {
	held, store, id := standing(t, &speaker{parts: []llm.Part{
		text("on it"), brk(), text("done — it says hello"),
	}})
	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "read a.md", "claude-opus-5")
	until(t, "answered", func() bool {
		var done bool
		watcher.read(func() { done = watcher.done != nil })
		return done
	})

	watcher.read(func() {
		if len(watcher.said) != 1 || watcher.said[0].Text != "on it" {
			t.Fatalf("handed over %+v", watcher.said)
		}
		if watcher.done.Text != "done — it says hello" {
			t.Errorf("finished on %q", watcher.done.Text)
		}
	})
	found, _ := store.Chat(id)
	if len(found.Messages) != 3 {
		t.Fatalf("%d messages, want 3", len(found.Messages))
	}
}

// A turn that said nothing at all is a row taken out again: an empty bubble reads as an answer of
// nothing, which is not what happened.
func TestATurnThatSaidNothingLeavesNoRow(t *testing.T) {
	held, store, id := standing(t, &speaker{})
	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "hi", "claude-opus-5")
	until(t, "answered", func() bool {
		var done bool
		watcher.read(func() { done = watcher.done != nil })
		return done
	})

	found, _ := store.Chat(id)
	if len(found.Messages) != 1 {
		t.Errorf("%d messages left, want 1: %+v", len(found.Messages), found.Messages)
	}
}

// A break with nothing before it is not advanced past — there is nothing to hand over, and the row
// is reused rather than removed.
func TestABreakWithNothingBeforeItReusesTheRow(t *testing.T) {
	held, store, id := standing(t, &speaker{parts: []llm.Part{brk(), text("straight to it")}})
	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "go", "claude-opus-5")
	until(t, "answered", func() bool {
		var done bool
		watcher.read(func() { done = watcher.done != nil })
		return done
	})

	found, _ := store.Chat(id)
	if len(found.Messages) != 2 {
		t.Fatalf("%d messages, want 2", len(found.Messages))
	}
	if found.Messages[1].Text != "straight to it" {
		t.Errorf("the row is %q", found.Messages[1].Text)
	}
}

// A socket closing does not stop a reply, and the next one to ask for that conversation is told
// what it missed.
func TestASocketGoingAwayLeavesTheReplyArriving(t *testing.T) {
	model := &speaker{parts: []llm.Part{text("half an answer")}, blocked: make(chan struct{})}
	held, _, id := standing(t, model)
	first := &page{}
	held.Attach(id, first)
	held.Said(id, first, "hi", "claude-opus-5")
	until(t, "started", func() bool { return held.Working(id) })
	until(t, "said anything", func() bool {
		var said string
		first.read(func() { said = first.deltas.String() })
		return said != ""
	})

	held.Detach(id, first)

	second := &page{}
	held.Attach(id, second)
	second.read(func() {
		if second.ready == nil || !second.ready.streaming {
			t.Fatalf("the second page was told %+v", second.ready)
		}
		if second.ready.text != "half an answer" {
			t.Errorf("it missed %q", second.ready.text)
		}
	})

	close(model.blocked)
	until(t, "answered", func() bool {
		var done bool
		second.read(func() { done = second.done != nil })
		return done
	})
}

// Two windows cannot watch one reply — the second would see half of it — so the one that was there
// is let go.
func TestASecondPageTakesTheThreadFromTheFirst(t *testing.T) {
	held, _, id := standing(t, &speaker{})
	first := &page{}
	held.Attach(id, first)
	held.Attach(id, &page{})

	var closed bool
	first.read(func() { closed = first.closed })
	if !closed {
		t.Error("the first page was left watching")
	}
}

// A thread already answering is told so rather than put in the line: a person who pressed send
// twice meant it once.
func TestSendingTwiceIsRefusedRatherThanQueued(t *testing.T) {
	model := &speaker{parts: []llm.Part{text("working")}, blocked: make(chan struct{})}
	held, _, id := standing(t, model)
	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "first", "claude-opus-5")
	until(t, "started", func() bool { return held.Working(id) })

	held.Said(id, watcher, "second", "claude-opus-5")
	var failure string
	watcher.read(func() { failure = watcher.failure })
	if !strings.Contains(failure, "already on its way") {
		t.Errorf("said %q", failure)
	}
	close(model.blocked)
}

// Stopping ends the turn, and what arrived is theirs to keep.
func TestStoppingKeepsWhatArrived(t *testing.T) {
	model := &speaker{parts: []llm.Part{text("as far as this")}, blocked: make(chan struct{})}
	held, store, id := standing(t, model)
	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "go", "claude-opus-5")
	until(t, "started", func() bool { return held.Working(id) })
	until(t, "said anything", func() bool {
		var said string
		watcher.read(func() { said = watcher.deltas.String() })
		return said != ""
	})

	held.Stop(id)
	until(t, "ended", func() bool {
		var done bool
		watcher.read(func() { done = watcher.done != nil })
		return done
	})

	found, _ := store.Chat(id)
	if len(found.Messages) != 2 || found.Messages[1].Text != "as far as this" {
		t.Errorf("kept %+v", found.Messages)
	}
	var failure string
	watcher.read(func() { failure = watcher.failure })
	if failure != "" {
		t.Errorf("a stop was reported as a failure: %q", failure)
	}
}

// Only what was said goes to the model, never what was done: replaying a step summary as a tool
// result would be handing it a transcript of its own work with the shapes filed off.
func TestOnlyWhatWasSaidGoesBackToTheModel(t *testing.T) {
	model := &speaker{parts: []llm.Part{text("second answer")}}
	held, store, id := standing(t, model)
	store.Add(id, "user", "first question", 0, "")
	store.Add(id, "assistant", "first answer", 0, "")
	store.SetText("msg-2", "first answer", []chat.Step{{ID: "s", Tool: "read_doc", State: "done"}})

	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "second question", "claude-opus-5")
	until(t, "answered", func() bool {
		var done bool
		watcher.read(func() { done = watcher.done != nil })
		return done
	})

	model.mutex.Lock()
	defer model.mutex.Unlock()
	if len(model.asked) != 1 {
		t.Fatalf("asked %d times", len(model.asked))
	}
	for _, one := range model.asked[0].Messages {
		if strings.Contains(one.Text, "read_doc") {
			t.Errorf("a step reached the model: %q", one.Text)
		}
	}
	if len(model.asked[0].Messages) != 3 {
		t.Errorf("carried %+v", model.asked[0].Messages)
	}
}

// One agent messaging another waits its turn rather than being refused: an agent handed work while
// it is working should get it when it is free.
func TestADeliveryWaitsItsTurn(t *testing.T) {
	model := &speaker{parts: []llm.Part{text("answered")}, blocked: make(chan struct{})}
	held, store, id := standing(t, model)
	watcher := &page{}
	held.Attach(id, watcher)
	held.Said(id, watcher, "first", "claude-opus-5")
	until(t, "started", func() bool { return held.Working(id) })

	landed := make(chan *chat.Message, 1)
	go func() {
		landed <- held.Deliver(id, Delivery{Text: "from a colleague", Model: "claude-opus-5",
			From: "agent-1", Hops: 1})
	}()

	// Nothing has been said into the thread yet: the delivery is still waiting.
	time.Sleep(50 * time.Millisecond)
	found, _ := store.Chat(id)
	if len(found.Messages) != 2 {
		t.Fatalf("the delivery jumped the queue: %+v", found.Messages)
	}

	close(model.blocked)
	answer := <-landed
	if answer == nil || answer.Text != "answered" {
		t.Fatalf("the delivery answered %+v", answer)
	}
	found, _ = store.Chat(id)
	if len(found.Messages) != 4 {
		t.Errorf("%d messages after both, want 4", len(found.Messages))
	}
	// A delivery is the one message that lands without the browser having put it there itself, so
	// it is sent on.
	var sent bool
	watcher.read(func() {
		for _, one := range watcher.said {
			if one.From == "agent-1" {
				sent = true
			}
		}
	})
	if !sent {
		t.Error("the delivered message was not sent on to whoever had the thread open")
	}
}

// A turn whose room could not be built says why rather than answering nothing.
func TestATurnThatCannotBeBuiltSaysWhy(t *testing.T) {
	store, err := chat.Open(filepath.Join(t.TempDir(), "chats.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	held := New(Deps{
		Store:   store,
		Project: func() string { return "/p" },
		Stream:  &speaker{},
		Turn: func(chat.Chat, func(string, string)) (Turn, error) {
			return Turn{}, errNoRoom
		},
	})
	t.Cleanup(held.Close)
	made, _ := store.Create("/p", "claude-opus-5")

	watcher := &page{}
	held.Attach(made.ID, watcher)
	held.Said(made.ID, watcher, "hi", "claude-opus-5")
	until(t, "failed", func() bool {
		var failure string
		watcher.read(func() { failure = watcher.failure })
		return failure != ""
	})
	var failure string
	watcher.read(func() { failure = watcher.failure })
	if !strings.Contains(failure, "no room") {
		t.Errorf("said %q", failure)
	}
}

type roomless string

func (r roomless) Error() string { return string(r) }

const errNoRoom = roomless("no room to answer in")
