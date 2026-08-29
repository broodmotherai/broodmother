// The terminal socket, and the one request that ends a shell.
//
// Nothing here ends one by closing. A socket is how a pane is watching a shell, and every way a
// socket has of going away — a laptop that slept, a tab the browser froze, a reload, moving to
// another repo — is somebody still meaning to come back. Being finished with a shell is said out
// loud instead, over `DELETE /api/terminal`.

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"sync"

	"github.com/coder/websocket"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/terminal"
)

var terminalTable = Table{
	"DELETE /api/terminal": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		session := r.URL.Query().Get("session")
		if session == "" {
			return nil, apperr.BadRequestf("say which session")
		}
		return map[string]any{"closed": ctx.Shells.Finish(session)}, nil
	},
}

// pane is one socket watching one shell. The shells know nothing about sockets; this is the
// adapter, and it is the only thing here that knows a frame is JSON.
type pane struct {
	socket *websocket.Conn
	ctx    context.Context

	mutex  sync.Mutex
	closed bool
}

func (p *pane) send(message any) {
	p.mutex.Lock()
	defer p.mutex.Unlock()
	if p.closed {
		return
	}
	body, err := json.Marshal(message)
	if err != nil {
		return
	}
	p.socket.Write(p.ctx, websocket.MessageText, body)
}

func (p *pane) Output(data string) {
	p.send(map[string]any{"type": "output", "data": data})
}

func (p *pane) Exit(code int) {
	p.send(map[string]any{"type": "exit", "code": code})
}

func (p *pane) Close() {
	p.mutex.Lock()
	if p.closed {
		p.mutex.Unlock()
		return
	}
	p.closed = true
	p.mutex.Unlock()
	p.socket.Close(websocket.StatusNormalClosure, "")
}

// terminalSocket is a pane taking over a shell: the one it names if that shell is still running,
// otherwise a new one in the root it asked for.
func terminalSocket(w http.ResponseWriter, r *http.Request, ctx *app.Context) {
	socket, err := accept(w, r)
	if err != nil {
		return
	}
	// A shell outlives the request that attached to it, so the writes it makes cannot be bound to
	// the request's context — that one is cancelled the moment this function returns.
	held, cancel := context.WithCancel(context.Background())
	defer cancel()

	query := r.URL.Query()
	watcher := &pane{socket: socket, ctx: held}
	id, resumed, missed := ctx.Shells.Attach(watcher, terminal.Request{
		Root:    query.Get("root"),
		Session: query.Get("session"),
		// How wide the terminal waiting for it is. A shell draws its first prompt to the size of
		// the pty it was spawned at, and one spawned at a size nothing on screen has is a line
		// wrapped at one width and erased at another.
		Cols: whole(query.Get("cols")),
		Rows: whole(query.Get("rows")),
	})
	watcher.send(map[string]any{"type": "ready", "session": id, "resumed": resumed})
	// What it missed, before anything live can arrive on top of it.
	if missed != "" {
		watcher.Output(missed)
	}

	for {
		kind, body, err := socket.Read(r.Context())
		if err != nil {
			// Not a kill: what closed may be a laptop lid.
			ctx.Shells.Detach(id, watcher)
			return
		}
		if kind != websocket.MessageText {
			continue
		}
		var said struct {
			Type string `json:"type"`
			Data string `json:"data"`
			Cols int    `json:"cols"`
			Rows int    `json:"rows"`
		}
		// A frame nobody can read is dropped rather than answered.
		if json.Unmarshal(body, &said) != nil {
			continue
		}
		switch said.Type {
		case "input":
			ctx.Shells.Write(id, said.Data)
		case "resize":
			ctx.Shells.Resize(id, said.Cols, said.Rows)
		}
	}
}

func whole(field string) int {
	value, err := strconv.Atoi(field)
	if err != nil {
		return 0
	}
	return value
}
