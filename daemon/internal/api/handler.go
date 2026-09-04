// The app around the routes: what CORS lets through, and the one place an error becomes a
// status. Anything that is not an error a caller could act on is a 500, which is the truthful
// answer for a bug.

package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
)

// New is the daemon's handler: the routes, with CORS in front of the ones under /api.
func New(ctx *app.Context) http.Handler {
	mux := http.NewServeMux()
	for pattern, handler := range routes() {
		mux.HandleFunc(pattern, answer(handler, ctx))
	}
	sockets(mux, ctx)
	// A method nothing serves still has to reach the CORS middleware, or a preflight for a route
	// this daemon does not have yet is refused before the browser is told why.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		write(w, http.StatusNotFound, problem{"no such route"})
	})
	return cors(mux, constants.WebOrigins())
}

type problem struct {
	Error string `json:"error"`
}

func answer(handler Handler, ctx *app.Context) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := handler(w, r, ctx)
		if err != nil {
			status, said := statusOf(err)
			write(w, status, problem{said})
			return
		}
		if _, itself := body.(Written); itself {
			return
		}
		write(w, http.StatusOK, body)
	}
}

// statusOf is the ladder the TypeScript's onError is: an error a caller can act on carries its
// own status, a missing file is a 404 whoever raised it, and everything else is a bug.
func statusOf(err error) (int, string) {
	var known *apperr.Error
	if errors.As(err, &known) {
		return known.Status(), known.Message
	}
	if errors.Is(err, fs.ErrNotExist) {
		return http.StatusNotFound, err.Error()
	}
	return http.StatusInternalServerError, err.Error()
}

// write is the body as the middleware this is ported from writes it: no HTML escaping, and no
// trailing newline — Encode adds one and `c.json` does not, and a byte is a byte while two
// daemons are meant to be interchangeable.
func write(w http.ResponseWriter, status int, body any) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(body); err != nil {
		out.Reset()
		status = http.StatusInternalServerError
		encoder.Encode(problem{err.Error()})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(bytes.TrimSuffix(out.Bytes(), []byte("\n")))
}

// allowMethods are the verbs the middleware this is ported from allows by default, in its order.
const allowMethods = "GET,HEAD,PUT,POST,DELETE,PATCH,QUERY"

// cors answers the browser the way that middleware answers it. An origin not on the list — and a
// request that names no origin at all, which is every curl — is told nothing rather than told the
// wrong thing: the header is omitted, not set to something the browser would refuse.
func cors(next http.Handler, origins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		head := w.Header()
		if origin := r.Header.Get("Origin"); allowed(origin, origins) {
			head.Set("Access-Control-Allow-Origin", origin)
		}
		// One Vary rather than a repeat of it. The two are the same header to anything reading
		// them, and the middleware this is ported from writes one.
		head.Set("Vary", "Origin")

		if r.Method != http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		head.Set("Access-Control-Allow-Methods", allowMethods)
		if asked := requestedHeaders(r); asked != "" {
			head.Set("Access-Control-Allow-Headers", asked)
			head.Set("Vary", "Origin, Access-Control-Request-Headers")
		}
		// A preflight is an answer with no body, and says so by carrying neither of the headers
		// that would describe one.
		head.Del("Content-Type")
		w.WriteHeader(http.StatusNoContent)
	})
}

func allowed(origin string, origins []string) bool {
	for _, one := range origins {
		if one == origin {
			return true
		}
	}
	return false
}

// requestedHeaders is what the browser asked to send, split and trimmed and joined back without
// the spaces — which is the spelling the middleware answers with.
func requestedHeaders(r *http.Request) string {
	asked := r.Header.Get("Access-Control-Request-Headers")
	if asked == "" {
		return ""
	}
	named := strings.Split(asked, ",")
	for index, one := range named {
		named[index] = strings.TrimSpace(one)
	}
	return strings.Join(named, ",")
}
