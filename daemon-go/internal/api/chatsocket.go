// The chat socket. One per conversation on screen, named the way a terminal names its shell: a
// page that reloads mid-answer asks for the same chat back and is told what it missed.

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/coder/websocket"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chat"
)

// thread is one socket watching one conversation. The chats know nothing about sockets; this is
// the adapter, and the only thing here that knows a frame is JSON.
type thread struct {
	socket *websocket.Conn
	ctx    context.Context

	mutex  sync.Mutex
	closed bool
}

func (t *thread) send(message any) {
	t.mutex.Lock()
	defer t.mutex.Unlock()
	if t.closed {
		return
	}
	body, err := json.Marshal(message)
	if err != nil {
		return
	}
	t.socket.Write(t.ctx, websocket.MessageText, body)
}

func (t *thread) Ready(id string, streaming bool, text string, steps []chat.Step, message string) {
	said := map[string]any{
		"type": "ready", "chat": id, "streaming": streaming, "text": text, "steps": stepsOrEmpty(steps),
	}
	if message != "" {
		said["message"] = message
	}
	t.send(said)
}

func (t *thread) Delta(text string) {
	t.send(map[string]any{"type": "delta", "text": text})
}

func (t *thread) Step(step chat.Step) {
	t.send(map[string]any{"type": "step", "step": step})
}

func (t *thread) Said(message chat.Message) {
	t.send(map[string]any{"type": "said", "message": message})
}

func (t *thread) Done(message chat.Message) {
	t.send(map[string]any{"type": "done", "message": message})
}

func (t *thread) Failed(reason string) {
	t.send(map[string]any{"type": "error", "message": reason})
}

func (t *thread) Close() {
	t.mutex.Lock()
	if t.closed {
		t.mutex.Unlock()
		return
	}
	t.closed = true
	t.mutex.Unlock()
	t.socket.Close(websocket.StatusNormalClosure, "")
}

// stepsOrEmpty: a page drawing `steps` wants a list, and null is not one.
func stepsOrEmpty(steps []chat.Step) []chat.Step {
	if steps == nil {
		return []chat.Step{}
	}
	return steps
}

func chatSocket(w http.ResponseWriter, r *http.Request, ctx *app.Context) {
	socket, err := accept(w, r)
	if err != nil {
		return
	}
	// A reply outlives the request that asked for it, so what it writes cannot be bound to the
	// request's context — that one is cancelled the moment this function returns.
	held, cancel := context.WithCancel(context.Background())
	defer cancel()

	id := r.URL.Query().Get("chat")
	watcher := &thread{socket: socket, ctx: held}
	if ctx.Live == nil || !ctx.Live.Attach(id, watcher) {
		return
	}

	for {
		kind, body, err := socket.Read(r.Context())
		if err != nil {
			// Not a stop: what closed may be a laptop lid.
			ctx.Live.Detach(id, watcher)
			return
		}
		if kind != websocket.MessageText {
			continue
		}
		var said struct {
			Type  string `json:"type"`
			Text  string `json:"text"`
			Model string `json:"model"`
		}
		// A frame nobody can read is dropped rather than answered, the way the terminal's are.
		if json.Unmarshal(body, &said) != nil {
			continue
		}
		switch said.Type {
		case "send":
			ctx.Live.Said(id, watcher, said.Text, said.Model)
		case "stop":
			ctx.Live.Stop(id)
		}
	}
}
