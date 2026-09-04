// The socket half of the server. One upgrade endpoint per route, dispatched by path: `path` on
// two of them would 400 the other's route.

package api

import (
	"net/http"
	"strings"

	"github.com/coder/websocket"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
)

// sockets are the WebSocket routes this daemon answers.
func sockets(mux *http.ServeMux, ctx *app.Context) {
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		socket, err := accept(w, r)
		if err != nil {
			return
		}
		ctx.Relay.Accept(socket)
	})
	// A shell opens in the root it was asked for, so a terminal started in one repo does not
	// follow the scope somewhere else between the click and the spawn. A socket that names a
	// session is one coming back to a shell it left running.
	mux.HandleFunc("/terminal", func(w http.ResponseWriter, r *http.Request) {
		terminalSocket(w, r, ctx)
	})
	// One socket per conversation on screen, named the way a terminal names its shell: a page that
	// reloads mid-answer asks for the same chat back and is told what it missed.
	mux.HandleFunc("/chat", func(w http.ResponseWriter, r *http.Request) {
		chatSocket(w, r, ctx)
	})
	// The kernel proxy is the notebook plan's phase 2. Until it lands the route answers by hanging
	// up, and no client dials it — which is what it does on the other side too.
	mux.HandleFunc("/kernel", func(w http.ResponseWriter, r *http.Request) {
		if socket, err := accept(w, r); err == nil {
			socket.Close(websocket.StatusNormalClosure, "")
		}
	})
}

// accept takes the upgrade, and checks the origin against the same list CORS uses.
//
// This is deliberately stricter than the implementation it is ported from, which checks nothing.
// A WebSocket is not covered by CORS — a browser will open one across origins and hand the page
// every byte that comes back — so on a loopback server with no auth, any page the user happens to
// visit could otherwise open `/ws` and watch their tree. A request with no Origin at all is still
// allowed, which is every client that is not a browser.
func accept(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	return websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: hostsOf(constants.WebOrigins()),
	})
}

// hostsOf is the origins as the socket library wants them: host and port, without the scheme.
func hostsOf(origins []string) []string {
	hosts := make([]string, 0, len(origins))
	for _, origin := range origins {
		if _, host, found := strings.Cut(origin, "://"); found {
			hosts = append(hosts, host)
		}
	}
	return hosts
}
