// A turn: what the model says, what it asks for, what it is told back, and where one message ends
// and the next begins.

package llm_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/llm"

	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

// events is a stream of them, written the way the API writes one.
func events(lines ...string) string {
	var out strings.Builder
	for _, line := range lines {
		out.WriteString("event: whatever\ndata: " + line + "\n\n")
	}
	return out.String()
}

func text(said string) string {
	body, _ := json.Marshal(said)
	return `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":` +
		string(body) + `}}`
}

func use(index int, id, name, input string) []string {
	body, _ := json.Marshal(input)
	return []string{
		`{"type":"content_block_start","index":` + itoa(index) +
			`,"content_block":{"type":"tool_use","id":"` + id + `","name":"` + name + `"}}`,
		`{"type":"content_block_delta","index":` + itoa(index) +
			`,"delta":{"type":"input_json_delta","partial_json":` + string(body) + `}}`,
	}
}

func itoa(value int) string {
	body, _ := json.Marshal(value)
	return string(body)
}

// hub answers each request in turn, and keeps what it was sent.
type hub struct {
	replies []Reply
	sent    []map[string]any
}

func answering(bodies ...string) *hub {
	held := &hub{}
	for _, body := range bodies {
		held.replies = append(held.replies, Reply{
			Status: 200, Body: io.NopCloser(strings.NewReader(body)),
		})
	}
	return held
}

func (h *hub) io(_ context.Context, _ string, body []byte) (Reply, error) {
	var said map[string]any
	json.Unmarshal(body, &said)
	h.sent = append(h.sent, said)
	if len(h.replies) == 0 {
		return Reply{Status: 200, Body: io.NopCloser(strings.NewReader(events()))}, nil
	}
	reply := h.replies[0]
	h.replies = h.replies[1:]
	return reply, nil
}

func speaking(hub *hub) Streamer {
	return New(func(string) string { return "sk-test" }, hub.io)
}

// gathered is everything a turn produced, in the order it arrived.
type gathered struct {
	said   strings.Builder
	parts  []Part
	breaks int
}

func (g *gathered) take(part Part) {
	g.parts = append(g.parts, part)
	switch part.Kind {
	case TextPart:
		g.said.WriteString(part.Text)
	case BreakPart:
		g.breaks++
	}
}

func (g *gathered) steps() []Part {
	held := []Part{}
	for _, one := range g.parts {
		if one.Kind == StepPart {
			held = append(held, one)
		}
	}
	return held
}

func ask(said string) Ask {
	return Ask{Model: "claude-opus-5", Messages: []Message{{Role: "user", Text: said}}}
}

// The plainest turn: words in, words out.
func TestATurnThatOnlyTalks(t *testing.T) {
	hub := answering(events(text("Hello"), text(" there")))
	held := &gathered{}
	if err := speaking(hub).Stream(context.Background(), ask("hi"), held.take); err != nil {
		t.Fatal(err)
	}
	if held.said.String() != "Hello there" {
		t.Errorf("said %q", held.said.String())
	}
	if len(hub.sent) != 1 {
		t.Errorf("asked the model %d times for a turn with no tools", len(hub.sent))
	}
}

// A tool is announced before it runs and rewritten when it lands, under the same id — so the row
// on screen changes rather than doubling.
func TestAToolIsAnnouncedThenLanded(t *testing.T) {
	first := events(append(use(0, "call-1", "read_doc", `{"path":"a.md"}`),
		`{"type":"message_delta"}`)...)
	hub := answering(first, events(text("it says hello")))

	held := &gathered{}
	ran := ""
	err := speaking(hub).Stream(context.Background(), Ask{
		Model:    "claude-opus-5",
		Messages: []Message{{Role: "user", Text: "what does a.md say?"}},
		Tools: []Tool{{
			Name: "read_doc", Description: "read one",
			Schema: map[string]any{"type": "object"},
			Run: func(_ context.Context, _ string, input json.RawMessage) string {
				ran = string(input)
				return "hello"
			},
		}},
		Title: func(name string, _ json.RawMessage) string { return "read a.md" },
	}, held.take)
	if err != nil {
		t.Fatal(err)
	}
	if ran != `{"path":"a.md"}` {
		t.Errorf("the tool was handed %q", ran)
	}
	steps := held.steps()
	if len(steps) != 2 {
		t.Fatalf("%d steps, want 2", len(steps))
	}
	if steps[0].Step.State != "running" || steps[0].Step.Summary != "read a.md" {
		t.Errorf("the first step is %+v", steps[0].Step)
	}
	if steps[1].Step.State != "done" || steps[1].Step.ID != steps[0].Step.ID {
		t.Errorf("the second step is %+v", steps[1].Step)
	}
	if held.said.String() != "it says hello" {
		t.Errorf("said %q", held.said.String())
	}
}

// What the tool answered goes back as a tool_result under the call's own id, and the round before
// it is replayed as the assistant's own words.
func TestWhatAToolSaidGoesBackToTheModel(t *testing.T) {
	first := events(append([]string{text("on it")}, use(1, "call-1", "shell", `{"command":"ls"}`)...)...)
	hub := answering(first, events(text("two files")))

	held := &gathered{}
	err := speaking(hub).Stream(context.Background(), Ask{
		Model:    "claude-opus-5",
		Messages: []Message{{Role: "user", Text: "what is in here?"}},
		Tools: []Tool{{
			Name: "shell", Schema: map[string]any{"type": "object"},
			Run: func(context.Context, string, json.RawMessage) string { return "a.md\nb.md" },
		}},
	}, held.take)
	if err != nil {
		t.Fatal(err)
	}
	if len(hub.sent) != 2 {
		t.Fatalf("asked the model %d times", len(hub.sent))
	}
	turns, _ := hub.sent[1]["messages"].([]any)
	if len(turns) != 3 {
		t.Fatalf("the second ask carried %d turns, want 3", len(turns))
	}
	body, _ := json.Marshal(turns[2])
	if !strings.Contains(string(body), `"tool_result"`) ||
		!strings.Contains(string(body), `"call-1"`) ||
		!strings.Contains(string(body), "a.md") {
		t.Errorf("the tool's answer went back as %s", body)
	}
	// Words followed by a tool call are a message on their own — "on it" — and what the tool leads
	// to is the next one.
	if held.breaks != 1 {
		t.Errorf("%d breaks, want 1", held.breaks)
	}
}

// A round that asked for a tool and said nothing first does not break the message: there is
// nothing to hand over.
func TestAToolCallWithNoWordsBeforeItDoesNotBreak(t *testing.T) {
	hub := answering(events(use(0, "call-1", "shell", `{}`)...), events(text("done")))
	held := &gathered{}
	err := speaking(hub).Stream(context.Background(), Ask{
		Model:    "claude-opus-5",
		Messages: []Message{{Role: "user", Text: "go"}},
		Tools: []Tool{{Name: "shell", Schema: map[string]any{"type": "object"},
			Run: func(context.Context, string, json.RawMessage) string { return "ok" }}},
	}, held.take)
	if err != nil {
		t.Fatal(err)
	}
	if held.breaks != 0 {
		t.Errorf("%d breaks, want 0", held.breaks)
	}
}

// The ceiling is said out loud rather than left as an answer that stops mid-thought for no stated
// reason.
func TestRunningOutOfRoundsSaysSo(t *testing.T) {
	looping := events(use(0, "call-1", "shell", `{}`)...)
	hub := answering(looping, looping, looping, looping)
	held := &gathered{}
	err := speaking(hub).Stream(context.Background(), Ask{
		Model:    "claude-opus-5",
		Messages: []Message{{Role: "user", Text: "go"}},
		Rounds:   3,
		Tools: []Tool{{Name: "shell", Schema: map[string]any{"type": "object"},
			Run: func(context.Context, string, json.RawMessage) string { return "again" }}},
	}, held.take)
	if err != nil {
		t.Fatal(err)
	}
	if len(hub.sent) != 3 {
		t.Errorf("asked the model %d times with 3 rounds", len(hub.sent))
	}
	last := held.steps()[len(held.steps())-1]
	if last.Step.State != "error" || !strings.Contains(last.Step.Summary, "3 rounds") {
		t.Errorf("ended on %+v", last.Step)
	}
}

// Messages said back to back by one side are one turn: a provider is owed turns that alternate.
func TestMessagesFromOneSideBecomeOneTurn(t *testing.T) {
	held := Turns([]Message{
		{Role: "user", Text: "first"},
		{Role: "assistant", Text: "on it"},
		{Role: "assistant", Text: "done"},
		{Role: "user", Text: "thanks"},
	})
	if len(held) != 3 {
		t.Fatalf("%d turns, want 3", len(held))
	}
	if held[1].Text != "on it\n\ndone" {
		t.Errorf("the assistant's turn is %q", held[1].Text)
	}
}

// A model nobody serves, and a provider nobody has a key for, are two things somebody can act on
// rather than a wall of provider JSON.
func TestAModelOrAKeyThatIsNotThereSaysWhich(t *testing.T) {
	hub := answering()
	err := speaking(hub).Stream(context.Background(), ask("hi"), func(Part) {})
	if err != nil {
		t.Fatalf("a served model with a key: %v", err)
	}

	err = speaking(hub).Stream(context.Background(), Ask{Model: "gpt-9"}, func(Part) {})
	if err == nil || !strings.Contains(err.Error(), "no such model") {
		t.Errorf("said %v", err)
	}

	unkeyed := New(func(string) string { return "" }, hub.io)
	err = unkeyed.Stream(context.Background(), ask("hi"), func(Part) {})
	if err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Errorf("said %v", err)
	}
}

// What the provider complained is what the person is told; a status nobody can read is the
// fallback rather than the answer.
func TestAProviderRefusalIsSaidInItsOwnWords(t *testing.T) {
	held := &hub{replies: []Reply{{
		Status: 400,
		Body:   io.NopCloser(strings.NewReader(`{"error":{"message":"max_tokens is too large"}}`)),
	}}}
	err := speaking(held).Stream(context.Background(), ask("hi"), func(Part) {})
	if err == nil || !strings.Contains(err.Error(), "max_tokens is too large") {
		t.Errorf("said %v", err)
	}

	unreadable := &hub{replies: []Reply{{Status: 401, Body: io.NopCloser(strings.NewReader("nope"))}}}
	err = speaking(unreadable).Stream(context.Background(), ask("hi"), func(Part) {})
	if err == nil || !strings.Contains(err.Error(), "did not accept this key") {
		t.Errorf("said %v", err)
	}
}

// Somebody pressing stop ends the turn, and the tool that was running is not asked for again.
func TestStoppingEndsTheTurn(t *testing.T) {
	hub := answering(events(use(0, "call-1", "shell", `{}`)...), events(text("never")))
	ctx, stop := context.WithCancel(context.Background())
	held := &gathered{}
	err := speaking(hub).Stream(ctx, Ask{
		Model:    "claude-opus-5",
		Messages: []Message{{Role: "user", Text: "go"}},
		Tools: []Tool{{Name: "shell", Schema: map[string]any{"type": "object"},
			Run: func(context.Context, string, json.RawMessage) string {
				stop()
				return "stopped mid-way"
			}}},
	}, held.take)
	if err == nil {
		t.Fatal("carried on after being stopped")
	}
	if len(hub.sent) != 1 {
		t.Errorf("asked the model %d times after being stopped", len(hub.sent))
	}
}

// A tool the model asked for that is not there is told so, rather than ending the turn.
func TestAToolThatIsNotThereIsAnswered(t *testing.T) {
	hub := answering(events(use(0, "call-1", "invented", `{}`)...), events(text("sorry")))
	held := &gathered{}
	if err := speaking(hub).Stream(context.Background(), Ask{
		Model:    "claude-opus-5",
		Messages: []Message{{Role: "user", Text: "go"}},
	}, held.take); err != nil {
		t.Fatal(err)
	}
	steps := held.steps()
	last := steps[len(steps)-1]
	if last.Step.State != "error" || last.Step.Detail != "no such tool" {
		t.Errorf("said %+v", last.Step)
	}
	if held.said.String() != "sorry" {
		t.Errorf("the turn ended at %q", held.said.String())
	}
}
