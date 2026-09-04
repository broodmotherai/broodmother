// Package chats is the replies being written right now.
//
// A socket closing does not stop a reply, for the same reason closing a terminal tab does not kill
// the shell — a lid, a sleep and a reload all look like this, and none of them is somebody saying
// they did not want the answer. The reply goes on arriving, is written down as it does, and the
// next socket to ask for that conversation is told what it missed.
package chats

import (
	"context"
	"slices"
	"sync"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/chat"
	"github.com/broodmotherai/broodmother/daemon/internal/llm"
)

// saveEvery is how often the reply as it stands is written down while it is still arriving. Often
// enough that a crash costs a sentence, rarely enough that it is not a write per token.
const saveEvery = 500 * time.Millisecond

// Watcher is whoever has a thread open — a socket, as far as this is concerned. Every method is
// something the page is told.
type Watcher interface {
	Ready(chat string, streaming bool, text string, steps []chat.Step, message string)
	Delta(text string)
	Step(step chat.Step)
	Said(message chat.Message)
	Done(message chat.Message)
	Failed(reason string)
	Close()
}

// Turn is what a turn is answered with: who is speaking, and how far they may reach. Built per
// turn, because the room moves under a conversation that stays open.
type Turn struct {
	System string
	Tools  []llm.Tool
	Title  llm.Titler
	Rounds int
}

// Delivery is something said into a thread by another agent rather than by somebody typing.
type Delivery struct {
	Text  string
	Model string
	// From is who said it: an agent id.
	From string
	// Hops is how many sends deep into an exchange this one is.
	Hops int
}

type Deps struct {
	Store *chat.Store
	// Project is the project chats belong to, asked each time: the open project changes under it.
	Project func() string
	// Stream is what answers a conversation. Injected so the store, the socket and the protocol
	// can be tested without a model at the end of them.
	Stream llm.Streamer
	// Turn is the voice and the reach for a turn in this conversation — the page's own, or an
	// agent's where the chat is theirs. `note` is for a tool with something to say while it is
	// still running: filed by the call's id, worn by that step's row until it lands.
	Turn func(held chat.Chat, note func(id, text string)) (Turn, error)
	// OnLive is a reply starting or landing, for whoever draws presence — an agent's dot in the
	// rail.
	OnLive func(chat string, working bool)
	Now    func() time.Time
}

// live is a reply being written right now: what has arrived, what it did, and the way to stop it.
type live struct {
	mutex   sync.Mutex
	watcher Watcher
	text    string
	steps   []chat.Step
	// message is the row the reply is being written into, so a save is an update rather than a
	// duplicate.
	message string
	cancel  context.CancelFunc
	saved   time.Time
	// titles is what each running step was called before a note was hung on it, by id.
	titles map[string]string
	// hops is how far along an exchange between agents this turn is, for the tools it is given to
	// count from. Zero for anything a person asked for.
	hops int
	// last is the message this turn finished with, where it has already handed one over and begun
	// another — so what it said survives a trailing row that said nothing.
	last *chat.Message
}

type Chats struct {
	deps Deps

	mutex sync.Mutex
	live  map[string]*live
	// tail is the last reply asked for on each thread, so the next one can wait for it.
	tail map[string]chan struct{}
	// watching is whoever has each thread open right now, whether or not anything is being written
	// into it. A reply nobody asked for through a socket — one agent messaging another — is still
	// drawn as it arrives for whoever happens to have the thread open.
	watching map[string]Watcher
}

func New(deps Deps) *Chats {
	if deps.Now == nil {
		deps.Now = time.Now
	}
	return &Chats{
		deps:     deps,
		live:     map[string]*live{},
		tail:     map[string]chan struct{}{},
		watching: map[string]Watcher{},
	}
}

// Chat is one conversation, whole — with the reply that is still arriving folded in, so a page that
// has just loaded reads the same thing the socket is about to continue.
func (c *Chats) Chat(id string) (chat.Chat, error) {
	found, ok := c.deps.Store.Chat(id)
	if !ok {
		return chat.Chat{}, apperr.NotFoundf("no such chat")
	}
	held := c.held(id)
	if held == nil {
		return found, nil
	}
	// What is on disk is up to half a second behind a reply still arriving, and the page that
	// asked is about to draw it.
	held.mutex.Lock()
	defer held.mutex.Unlock()
	for at, message := range found.Messages {
		if message.ID == held.message {
			found.Messages[at].Text = held.text
			found.Messages[at].Steps = slices.Clone(held.steps)
		}
	}
	return found, nil
}

func (c *Chats) Working(id string) bool { return c.held(id) != nil }

// HopsIn is how far into an exchange between agents the reply being written right now is, so the
// turn's own tools know what is left of the budget. Zero for a thread nobody has messaged into,
// which is every thread a person is typing in.
func (c *Chats) HopsIn(id string) int {
	held := c.held(id)
	if held == nil {
		return 0
	}
	held.mutex.Lock()
	defer held.mutex.Unlock()
	return held.hops
}

// Remove takes the conversation and stops whatever was being written into it.
func (c *Chats) Remove(id string) error {
	c.stop(id)
	c.mutex.Lock()
	delete(c.live, id)
	delete(c.tail, id)
	delete(c.watching, id)
	c.mutex.Unlock()
	return c.deps.Store.Remove(id)
}

// Clear empties a thread, and stops any reply on its way: what it was answering is gone, so nobody
// is told how it ended — the row it was being written into is not there to keep it.
func (c *Chats) Clear(id string) {
	if held := c.held(id); held != nil {
		held.mutex.Lock()
		held.watcher = nil
		held.mutex.Unlock()
	}
	c.stop(id)
	c.deps.Store.Clear(id)
}

// Close leaves nothing running when the server goes.
func (c *Chats) Close() {
	c.mutex.Lock()
	held := make([]*live, 0, len(c.live))
	for _, one := range c.live {
		held = append(held, one)
	}
	c.live = map[string]*live{}
	c.tail = map[string]chan struct{}{}
	c.watching = map[string]Watcher{}
	c.mutex.Unlock()
	for _, one := range held {
		one.cancel()
		one.mutex.Lock()
		watcher := one.watcher
		one.mutex.Unlock()
		if watcher != nil {
			watcher.Close()
		}
	}
}

// Attach is a watcher taking over a conversation. Two windows cannot watch one reply — the second
// would see half of it — so the one that was there is let go and this watcher has it.
func (c *Chats) Attach(id string, watcher Watcher) bool {
	if _, ok := c.deps.Store.Chat(id); id == "" || !ok {
		watcher.Failed("no such chat")
		watcher.Close()
		return false
	}

	c.mutex.Lock()
	previous := c.watching[id]
	c.watching[id] = watcher
	held := c.live[id]
	c.mutex.Unlock()
	if previous != nil && previous != watcher {
		previous.Close()
	}

	if held == nil {
		watcher.Ready(id, false, "", nil, "")
		return true
	}
	held.mutex.Lock()
	held.watcher = watcher
	watcher.Ready(id, true, held.text, slices.Clone(held.steps), held.message)
	held.mutex.Unlock()
	return true
}

// Detach says a watcher went away. Not a stop: what closed may be a laptop lid.
func (c *Chats) Detach(id string, watcher Watcher) {
	c.mutex.Lock()
	if c.watching[id] == watcher {
		delete(c.watching, id)
	}
	held := c.live[id]
	c.mutex.Unlock()
	if held == nil {
		return
	}
	held.mutex.Lock()
	if held.watcher == watcher {
		held.watcher = nil
	}
	held.mutex.Unlock()
}

// Said is somebody typing. A thread that is already answering is told so rather than put in the
// line: a person who pressed send twice meant it once, and the second one would arrive as an
// answer to a question they had forgotten asking.
func (c *Chats) Said(id string, watcher Watcher, text, model string) {
	if c.held(id) != nil {
		watcher.Failed("a reply is already on its way")
		return
	}
	go c.queue(id, Delivery{Text: text, Model: model})
}

// Deliver is another agent saying something into this thread. The answer is written down as it
// arrives whether or not anybody has the thread open, and where somebody does, they watch it
// arrive.
//
// It waits its turn rather than being refused: an agent handed work while it is working should get
// it when it is free. What comes back is the reply as it finally stood, for whoever asked to hear
// about it.
func (c *Chats) Deliver(id string, said Delivery) *chat.Message {
	return c.queue(id, said)
}

// Stop ends the reply being written into a thread.
func (c *Chats) Stop(id string) { c.stop(id) }

func (c *Chats) stop(id string) {
	if held := c.held(id); held != nil {
		held.cancel()
	}
}

func (c *Chats) held(id string) *live {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.live[id]
}

// queue: one thread answers one thing at a time — the model is speaking as somebody, and two
// answers being written at once is two of them.
func (c *Chats) queue(id string, said Delivery) *chat.Message {
	c.mutex.Lock()
	before := c.tail[id]
	mine := make(chan struct{})
	c.tail[id] = mine
	c.mutex.Unlock()

	if before != nil {
		<-before
	}
	answer := c.reply(id, said)
	close(mine)
	return answer
}
