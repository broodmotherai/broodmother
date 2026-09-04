// One reply, from the question being written down to the row it finally stands in.

package chats

import (
	"context"
	"slices"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/chat"
	"github.com/broodmotherai/broodmother/daemon/internal/llm"
)

// reply: the question is stored before the answer is asked for, so a reply that never comes still
// leaves a conversation that says what was asked.
func (c *Chats) reply(id string, said Delivery) *chat.Message {
	if strings.TrimSpace(said.Text) == "" {
		return nil
	}
	asked, err := c.deps.Store.Add(id, "user", said.Text, c.deps.Now().UnixMilli(), said.From)
	if err != nil {
		return nil
	}
	found, ok := c.deps.Store.Chat(id)
	if !ok {
		return nil
	}
	// A delivery is the one message that lands in a thread without the browser having put it there
	// itself, so it is sent on: what a person types, the page has already drawn.
	if said.From != "" {
		if watcher := c.watcherOf(id); watcher != nil {
			watcher.Said(asked)
		}
	}

	answer, err := c.deps.Store.Add(id, "assistant", "", c.deps.Now().UnixMilli(), "")
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	held := &live{
		// Whoever has the thread open, which for a delivery is nobody as often as not: the answer
		// is written down either way and the next socket to ask is told what it missed.
		watcher: c.watcherOf(id),
		message: answer.ID,
		cancel:  cancel,
		saved:   c.deps.Now(),
		titles:  map[string]string{},
		hops:    said.Hops,
	}
	c.mutex.Lock()
	c.live[id] = held
	c.mutex.Unlock()
	c.onLive(id, true)
	defer cancel()

	turn, err := c.deps.Turn(found, func(call, note string) { c.note(held, call, note) })
	if err != nil {
		c.settle(id, held)
		c.tell(held, func(w Watcher) { w.Failed(err.Error()) })
		return c.ended(held)
	}

	messages := make([]llm.Message, 0, len(found.Messages))
	for _, one := range found.Messages {
		// Only what was said, never what was done: replaying a step summary as a tool result would
		// be handing the model a transcript of its own work with the shapes filed off, and reading
		// a document again is cheap and true.
		if one.Text != "" {
			messages = append(messages, llm.Message{Role: one.Role, Text: one.Text})
		}
	}

	err = c.deps.Stream.Stream(ctx, llm.Ask{
		Model:    said.Model,
		Messages: messages,
		System:   turn.System,
		Tools:    turn.Tools,
		Rounds:   turn.Rounds,
		Title:    turn.Title,
	}, func(part llm.Part) { c.took(id, held, part) })

	c.settle(id, held)
	switch {
	case err == nil, ctx.Err() != nil:
		// An abort is somebody pressing stop, and what arrived is theirs to keep.
		c.tell(held, func(w Watcher) { w.Done(c.finished(held)) })
	default:
		c.tell(held, func(w Watcher) { w.Failed(err.Error()) })
	}
	return c.ended(held)
}

// took is one part of the turn, landed.
func (c *Chats) took(id string, held *live, part llm.Part) {
	switch part.Kind {
	case llm.TextPart:
		held.mutex.Lock()
		held.text += part.Text
		save := c.deps.Now().Sub(held.saved) > saveEvery
		held.mutex.Unlock()
		c.tell(held, func(w Watcher) { w.Delta(part.Text) })
		// Saved on a timer rather than per token: a crash costs a sentence.
		if save {
			c.save(held)
		}
	case llm.BreakPart:
		c.advance(id, held)
	case llm.StepPart:
		held.mutex.Lock()
		// The same step twice — once starting, once landed — so it is filed by its id rather than
		// appended, and the row on screen changes instead of doubling.
		at := slices.IndexFunc(held.steps, func(one chat.Step) bool { return one.ID == part.Step.ID })
		if at == -1 {
			held.steps = append(held.steps, part.Step)
		} else {
			held.steps[at] = part.Step
		}
		if part.Step.State == "running" {
			held.titles[part.Step.ID] = part.Step.Summary
		}
		held.mutex.Unlock()
		c.tell(held, func(w Watcher) { w.Step(part.Step) })
		// Steps are rare and each one is something that happened to the project, so every one of
		// them is written down as it lands.
		c.save(held)
	}
}

// ended is what the turn ended up having said — the row it finished in, or the last one it handed
// over where it went quiet after that. Nothing for a turn that said nothing at all.
func (c *Chats) ended(held *live) *chat.Message {
	held.mutex.Lock()
	empty := held.text == "" && len(held.steps) == 0
	last := held.last
	held.mutex.Unlock()
	if !empty {
		answer := c.finished(held)
		return &answer
	}
	return last
}

// settle is the reply as it finally stands, however it ended. Nothing at all is a row taken out
// again rather than an empty bubble, which would read as an answer of nothing — but a turn that
// wrote a file and said nothing is not nothing, and its steps are the only record that the project
// changed.
func (c *Chats) settle(id string, held *live) {
	c.mutex.Lock()
	if c.live[id] == held {
		delete(c.live, id)
	}
	c.mutex.Unlock()

	held.mutex.Lock()
	empty := held.text == "" && len(held.steps) == 0
	message := held.message
	held.mutex.Unlock()
	if empty {
		c.deps.Store.RemoveMessage(message)
	} else {
		c.save(held)
	}
	c.onLive(id, false)
}

// advance: one message ends mid-turn and the next begins. What has arrived is written down and
// handed over as said, and a fresh row takes what follows. A message that said nothing is not
// advanced past — there is nothing to hand over, and the row is reused rather than removed.
func (c *Chats) advance(id string, held *live) {
	held.mutex.Lock()
	empty := held.text == "" && len(held.steps) == 0
	held.mutex.Unlock()
	if empty {
		return
	}
	c.save(held)
	answer := c.finished(held)

	held.mutex.Lock()
	held.last = &answer
	held.mutex.Unlock()
	c.tell(held, func(w Watcher) { w.Said(answer) })

	next, err := c.deps.Store.Add(id, "assistant", "", c.deps.Now().UnixMilli(), "")
	if err != nil {
		return
	}
	held.mutex.Lock()
	held.message = next.ID
	held.text = ""
	held.steps = nil
	held.saved = c.deps.Now()
	held.mutex.Unlock()
}

// note is a word from a tool still at work, hung on its step's row: "claude: write the one-pager —
// Read notes/Risks.md". Sent but not saved — the row is rewritten when the tool lands, and what it
// was doing on the way is not part of the record.
func (c *Chats) note(held *live, call, text string) {
	held.mutex.Lock()
	at := slices.IndexFunc(held.steps, func(one chat.Step) bool { return one.ID == call })
	if at == -1 || held.steps[at].State != "running" {
		held.mutex.Unlock()
		return
	}
	title := held.titles[call]
	if title == "" {
		title = held.steps[at].Summary
	}
	held.steps[at].Summary = title + " — " + text
	step := held.steps[at]
	held.mutex.Unlock()
	c.tell(held, func(w Watcher) { w.Step(step) })
}

func (c *Chats) save(held *live) {
	held.mutex.Lock()
	message, text, steps := held.message, held.text, slices.Clone(held.steps)
	held.saved = c.deps.Now()
	held.mutex.Unlock()
	c.deps.Store.SetText(message, text, steps)
}

// finished is what the page is handed when a message is done with: the row as it stands, with what
// arrived and what was done — read back rather than rebuilt, so its time is the store's.
func (c *Chats) finished(held *live) chat.Message {
	held.mutex.Lock()
	id, text, steps := held.message, held.text, slices.Clone(held.steps)
	held.mutex.Unlock()

	message, ok := c.deps.Store.Message(id)
	if !ok {
		message = chat.Message{ID: id, Role: "assistant", At: c.deps.Now().UnixMilli()}
	}
	message.Text = text
	message.Steps = steps
	if len(steps) == 0 {
		message.Steps = nil
	}
	return message
}

func (c *Chats) tell(held *live, say func(Watcher)) {
	held.mutex.Lock()
	watcher := held.watcher
	held.mutex.Unlock()
	if watcher != nil {
		say(watcher)
	}
}

func (c *Chats) watcherOf(id string) Watcher {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.watching[id]
}

func (c *Chats) onLive(id string, working bool) {
	if c.deps.OnLive != nil {
		c.deps.OnLive(id, working)
	}
}
