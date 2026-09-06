// Package relay is every open `/ws` client, and one way to reach them all: the tree, the
// repository and the sync loop report, and nothing is sent the other way.
package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/broodmotherai/broodmother/daemon/internal/activity"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/mother"
	"github.com/broodmotherai/broodmother/daemon/internal/syncloop"
)

// Message is what the server says. The `type` names which of them it is, the way the browser
// reads it — a tagged union spelt as one struct, since Go has no other way to write one.
type Message struct {
	Type string `json:"type"`
	// Tree and sync are the two this daemon sends.
	Root  doc.Root         `json:"root,omitempty"`
	Event *doc.Event       `json:"event,omitempty"`
	Sync  *syncloop.Status `json:"status,omitempty"`
	// What is at work in each checkout, by checkout path.
	States map[string]activity.State `json:"activity,omitempty"`
	Error  string                    `json:"message,omitempty"`
	// What a notification says. The tasks nudge carries nothing at all: the page already knows
	// how to ask, and a payload would be a second answer to disagree with the first.
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`
	// How an agent stands: who, whether a reply of theirs is on its way, and how much of their
	// thread has not been read. The two travel together because they move at the same moments —
	// a turn starting, a turn landing, a thread being read — and a window holding a dot from one
	// instant beside a count from another would be drawing a state nothing was ever in.
	Agent   string `json:"id,omitempty"`
	Working *bool  `json:"working,omitempty"`
	Unseen  *int   `json:"unseen,omitempty"`
	// What Mother has surfaced, where anything survived the gate.
	Suggestion *mother.Suggestion `json:"suggestion,omitempty"`
}

// TreeEvent is one document moving, named for the tree it moved in.
func TreeEvent(root doc.Root, event doc.Event) Message {
	return Message{Type: "tree", Root: root, Event: &event}
}

// SyncStatus is where the sync loop stands.
func SyncStatus(status syncloop.Status) Message {
	return Message{Type: "sync", Sync: &status}
}

// Activity is what is at work in each checkout, once the picture has moved.
func Activity(states map[string]activity.State) Message {
	return Message{Type: "activity", States: states}
}

// Notify is something to put in front of whoever has the app open.
func Notify(title, body string) Message {
	return Message{Type: "notify", Title: title, Body: body}
}

// TaskMoved is the nudge that tells the tasks page a run has moved.
func TaskMoved() Message { return Message{Type: "task"} }

// AgentState is an agent's dot in the rail and the count on their name: a reply of theirs starting
// or landing, or their thread being read.
func AgentState(agent string, working bool, unseen int) Message {
	return Message{Type: "agent", Agent: agent, Working: &working, Unseen: &unseen}
}

// Suggested is something Mother has decided is worth interrupting for.
func Suggested(suggestion mother.Suggestion) Message {
	return Message{Type: "mother", Suggestion: &suggestion}
}

// howLongToSend is how long a client has to take a message before it is treated as gone. A
// browser that has stopped reading must not hold up everyone else's redraw.
const howLongToSend = 5 * time.Second

type connection struct {
	socket *websocket.Conn
	once   sync.Once
}

type Relay struct {
	mutex sync.RWMutex
	held  map[*connection]bool
}

func New() *Relay { return &Relay{held: map[*connection]bool{}} }

func (r *Relay) Broadcast(message Message) {
	body, err := encode(message)
	if err != nil {
		return
	}
	r.mutex.RLock()
	open := make([]*connection, 0, len(r.held))
	for one := range r.held {
		open = append(open, one)
	}
	r.mutex.RUnlock()

	for _, one := range open {
		ctx, cancel := context.WithTimeout(context.Background(), howLongToSend)
		err := one.socket.Write(ctx, websocket.MessageText, body)
		cancel()
		if err != nil {
			r.drop(one)
		}
	}
}

// Accept takes a socket and holds it until the far end goes. Nothing is read off it: the relay
// only reports, so a client that sends something is a client saying nothing anybody listens for
// — but the read has to happen anyway, or the library never notices the close.
func (r *Relay) Accept(socket *websocket.Conn) {
	one := &connection{socket: socket}
	r.mutex.Lock()
	r.held[one] = true
	r.mutex.Unlock()

	for {
		if _, _, err := socket.Read(context.Background()); err != nil {
			r.drop(one)
			return
		}
	}
}

func (r *Relay) drop(one *connection) {
	r.mutex.Lock()
	delete(r.held, one)
	r.mutex.Unlock()
	one.once.Do(func() { one.socket.Close(websocket.StatusNormalClosure, "") })
}

func (r *Relay) Close() {
	r.mutex.Lock()
	open := make([]*connection, 0, len(r.held))
	for one := range r.held {
		open = append(open, one)
	}
	r.held = map[*connection]bool{}
	r.mutex.Unlock()
	for _, one := range open {
		one.once.Do(func() { one.socket.Close(websocket.StatusGoingAway, "") })
	}
}

// encode is the message as the browser reads it: no HTML escaping, and no trailing newline —
// the same bytes `JSON.stringify` hands `socket.send`.
func encode(message Message) ([]byte, error) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(message); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(out.Bytes(), []byte("\n")), nil
}
