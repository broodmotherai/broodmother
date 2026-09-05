// The terminal socket's one ordering rule: a pane says what the shell said while nobody was
// watching before it says anything that arrived after.

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// paired is a pane writing down one end of a real socket, and a read of the other end.
func paired(t *testing.T) (*pane, func() string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	made := make(chan *websocket.Conn, 1)
	// Held open until the test is done with it: `httptest` waits on its handlers, so a handler
	// that sat on the socket would be one the teardown sat on in turn.
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		made <- socket
		<-release
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(release) })

	client, _, err := websocket.Dial(ctx, strings.Replace(server.URL, "http", "ws", 1), nil)
	if err != nil {
		t.Fatal(err)
	}
	// `CloseNow`, not a close: the pane's end is nobody's to close politely here, and a close
	// handshake nothing answers is five seconds of waiting per test.
	t.Cleanup(func() { client.CloseNow() })

	return &pane{socket: <-made, ctx: ctx, holding: true}, func() string {
		deadline, done := context.WithTimeout(ctx, 3*time.Second)
		defer done()
		_, body, err := client.Read(deadline)
		if err != nil {
			t.Fatal(err)
		}
		var said struct {
			Data string `json:"data"`
		}
		if err := json.Unmarshal(body, &said); err != nil {
			t.Fatal(err)
		}
		return said.Data
	}
}

// The shell's own goroutine is free to write to a watcher the moment it is installed, which is
// before the backlog it is meant to follow has been written. What it says in that window waits.
func TestAShellSpeakingMidHandshakeIsHeardAfterTheBacklog(t *testing.T) {
	watcher, next := paired(t)

	watcher.Output("live")
	watcher.resume("backlog")

	if first := next(); first != "backlog" {
		t.Fatalf("the backlog was not first; heard %q", first)
	}
	if second := next(); second != "live" {
		t.Errorf("what arrived during the handshake was not second; heard %q", second)
	}
}

// And once it is caught up there is nothing to wait for.
func TestAPaneThatIsCaughtUpWritesStraightOut(t *testing.T) {
	watcher, next := paired(t)
	watcher.resume("")

	watcher.Output("after")
	if said := next(); said != "after" {
		t.Errorf("heard %q", said)
	}
}
