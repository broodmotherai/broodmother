// Anthropic's Messages API, streamed.
//
// Hand-written rather than taken from a package, for the reason `internal/github` is: the daemon
// wants one endpoint and one event shape, and what a test needs is a seam it can answer at. The IO
// is that seam — everything above it is the loop, and the loop is what the app's behaviour is.

package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
)

// base is the API, a var so a test can stand its own server in front of it.
var base = "https://api.anthropic.com"

const (
	version   = "2023-06-01"
	maxTokens = 16000
	// timeout is per request, not per turn: a turn is several requests and a long errand between
	// them, and the thing worth giving up on is one that stopped answering.
	timeout = 10 * time.Minute
)

// Reply is one streamed answer, before any of it is read.
type Reply struct {
	Status int
	// Body is the event stream, read as it arrives. Closed by the caller.
	Body io.ReadCloser
}

// IO is the one call this makes, so a test can answer it without a network.
type IO func(ctx context.Context, key string, body []byte) (Reply, error)

func post(ctx context.Context, key string, body []byte) (Reply, error) {
	held, cancel := context.WithTimeout(ctx, timeout)
	request, err := http.NewRequestWithContext(held, http.MethodPost, base+"/v1/messages",
		bytes.NewReader(body))
	if err != nil {
		cancel()
		return Reply{}, apperr.Chatf("could not reach Anthropic — check the network")
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("accept", "text/event-stream")
	request.Header.Set("x-api-key", key)
	request.Header.Set("anthropic-version", version)

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		cancel()
		return Reply{}, apperr.Chatf("could not reach Anthropic — check the network")
	}
	return Reply{Status: response.StatusCode, Body: closing{response.Body, cancel}}, nil
}

// closing carries the request's own cancel, so the stream's end releases it rather than leaving
// the timer standing until it fires.
type closing struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c closing) Close() error {
	c.cancel()
	return c.ReadCloser.Close()
}

type anthropic struct {
	key string
	io  IO
}

// wire is the request, in the field order the API documents.
type wire struct {
	Model     string     `json:"model"`
	MaxTokens int        `json:"max_tokens"`
	System    string     `json:"system,omitempty"`
	Messages  []wireTurn `json:"messages"`
	Tools     []wireTool `json:"tools,omitempty"`
	Stream    bool       `json:"stream"`
}

type wireTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

type wireTurn struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type textBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type useBlock struct {
	Type  string          `json:"type"`
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type resultBlock struct {
	Type      string `json:"type"`
	ToolUseID string `json:"tool_use_id"`
	Content   string `json:"content"`
}

// asked is one tool call the model made in a round.
type asked struct {
	id    string
	name  string
	input strings.Builder
}

// run is the turn: ask, hand on what arrives, answer the tools, ask again. It ends when the model
// stops asking for tools, when the rounds run out, or when the context is cancelled.
func (a anthropic) run(ctx context.Context, ask Ask, rounds int, part func(Part)) error {
	tools := make([]wireTool, 0, len(ask.Tools))
	byName := map[string]Tool{}
	for _, one := range ask.Tools {
		tools = append(tools, wireTool{Name: one.Name, Description: one.Description, InputSchema: one.Schema})
		byName[one.Name] = one
	}

	turns := make([]wireTurn, 0, len(ask.Messages)+2*rounds)
	for _, one := range Turns(ask.Messages) {
		turns = append(turns, wireTurn{Role: one.Role, Content: one.Text})
	}

	for at := range rounds {
		body, err := json.Marshal(wire{
			Model: ask.Model, MaxTokens: maxTokens, System: ask.System,
			Messages: turns, Tools: tools, Stream: true,
		})
		if err != nil {
			return err
		}
		said, calls, err := a.round(ctx, body, part)
		if err != nil {
			return err
		}
		if len(calls) == 0 {
			return nil
		}
		// Words followed by a tool call are a message on their own — "on it" — and what the tool
		// leads to is the next one.
		if strings.TrimSpace(said.text) != "" {
			part(Part{Kind: BreakPart})
		}
		if at == rounds-1 {
			// The ceiling. Said out loud rather than left as an answer that stops mid-thought for
			// no stated reason.
			part(step("rounds", "limit", "error",
				"stopped after "+strconv.Itoa(rounds)+" rounds of tools", "", ""))
			return nil
		}

		content := []any{}
		if said.text != "" {
			content = append(content, textBlock{Type: "text", Text: said.text})
		}
		results := []any{}
		for _, call := range calls {
			input := json.RawMessage(call.input.String())
			if len(strings.TrimSpace(call.input.String())) == 0 {
				input = json.RawMessage("{}")
			}
			content = append(content, useBlock{Type: "tool_use", ID: call.id, Name: call.name, Input: input})

			part(step(call.id, call.name, "running", titleOf(ask.Title, call.name, input), "", ""))

			tool, known := byName[call.name]
			if !known {
				results = append(results, resultBlock{
					Type: "tool_result", ToolUseID: call.id,
					Content: `{"error": "there is no tool called ` + call.name + `"}`,
				})
				part(step(call.id, call.name, "error", call.name, "", "no such tool"))
				continue
			}
			answer := tool.Run(ctx, call.id, input)
			results = append(results, resultBlock{Type: "tool_result", ToolUseID: call.id, Content: answer})
			part(step(call.id, call.name, "done", "", summarise(answer), ""))
			if ctx.Err() != nil {
				return ctx.Err()
			}
		}
		turns = append(turns,
			wireTurn{Role: "assistant", Content: content},
			wireTurn{Role: "user", Content: results})
	}
	return nil
}

// spoke is what one request produced: everything the model said, and everything it asked for.
type spoke struct{ text string }

func (a anthropic) round(ctx context.Context, body []byte, part func(Part)) (spoke, []*asked, error) {
	reply, err := a.io(ctx, a.key, body)
	if err != nil {
		return spoke{}, nil, err
	}
	defer reply.Body.Close()

	if reply.Status < 200 || reply.Status >= 300 {
		raw, _ := io.ReadAll(reply.Body)
		return spoke{}, nil, apperr.Chatf("%s", complaint(raw, reply.Status))
	}

	var said spoke
	var calls []*asked
	// blocks are the content blocks of this message, by the index the stream files them under.
	blocks := map[int]*asked{}

	scanner := bufio.NewScanner(reply.Body)
	// A tool's arguments arrive as one long JSON string across many deltas, and a document written
	// by a tool call is as big as the document.
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line, found := strings.CutPrefix(scanner.Text(), "data:")
		if !found {
			continue
		}
		var event streamEvent
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &event) != nil {
			continue
		}
		switch event.Type {
		case "content_block_start":
			if event.ContentBlock.Type != "tool_use" {
				continue
			}
			held := &asked{id: event.ContentBlock.ID, name: event.ContentBlock.Name}
			blocks[event.Index] = held
			calls = append(calls, held)
		case "content_block_delta":
			switch event.Delta.Type {
			case "text_delta":
				if event.Delta.Text != "" {
					said.text += event.Delta.Text
					part(Part{Kind: TextPart, Text: event.Delta.Text})
				}
			case "input_json_delta":
				if held := blocks[event.Index]; held != nil {
					held.input.WriteString(event.Delta.PartialJSON)
				}
			}
		case "error":
			return spoke{}, nil, apperr.Chatf("%s", said1(event.Error.Message, "Anthropic ended the stream"))
		}
		if ctx.Err() != nil {
			return said, calls, ctx.Err()
		}
	}
	if err := scanner.Err(); err != nil {
		// A stream cut short mid-answer: what arrived is still the caller's, and the reason is
		// theirs to report.
		return said, calls, apperr.Chatf("the answer stopped arriving: %s", err)
	}
	// Every tool call is announced before it is answered, so the row is on screen while the tool
	// is still working.
	return said, calls, nil
}

// streamEvent is the sliver of the event stream this reads. Everything else — usage, stop reasons,
// message metadata — is the provider's bookkeeping and no business of the conversation's.
type streamEvent struct {
	Type         string `json:"type"`
	Index        int    `json:"index"`
	ContentBlock struct {
		Type string `json:"type"`
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"content_block"`
	Delta struct {
		Type        string `json:"type"`
		Text        string `json:"text"`
		PartialJSON string `json:"partial_json"`
	} `json:"delta"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// complaint is what the provider said went wrong, or the bare status where it said nothing a
// person could read. An unauthenticated request otherwise comes back as a wall of provider JSON.
func complaint(raw []byte, status int) string {
	var held struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &held) == nil && held.Error.Message != "" {
		return held.Error.Message
	}
	if status == http.StatusUnauthorized {
		return "Anthropic did not accept this key — check it in Settings"
	}
	return "Anthropic answered " + strconv.Itoa(status)
}

func said1(text, fallback string) string {
	if strings.TrimSpace(text) == "" {
		return fallback
	}
	return text
}
