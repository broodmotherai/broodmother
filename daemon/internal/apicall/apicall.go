// Package apicall is what a conversation may ask the app to do, and the one door it asks through.
//
// Default deny. A route that is not named here is refused with the list, so a model that guessed
// learns what there was to guess at and tries again — a step spent, rather than an answer that
// quietly did nothing.
//
// The list is by hand, and a route added to the server is invisible to it until somebody adds it
// here. That is the point: reaching the app is a decision per route rather than a door that widens
// on its own. What is on it is what the brief already documents.
//
// The app talks to itself over its own front door. It could reach into the context instead, but
// then a tool and the route beside it would be two implementations of one promise, free to drift;
// this way what a tool does *is* what the route does, error contract and all — the same
// `{"error": "..."}` the brief already tells the model to expect.
package apicall

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
)

// allowed is every route a conversation may call.
//
// Denied by not being here, and worth saying why:
//
//	DELETE /api/data            empties the broodmother home; nothing recovers it
//	PUT /api/config, /api/git   the app's own state — `## Here` already says never to
//	POST /api/scope             moves the ground under the person you are talking to
//	/api/projects, /api/repos   creating, opening and deleting where somebody works
//	/api/profiles, /api/model-keys   a conversation that could rewrite the key it speaks with
//	/api/github                 device-flow auth, and making repositories on a host
//	DELETE /api/terminal        ends somebody's shell
//	/api/chat, /api/chats       a conversation reading or deleting conversations, its own
//	                            included, while its reply is still being written into one
//	/api/agent, /api/agents     an agent making, clearing or removing agents — itself included,
//	                            mid-sentence. The org chart is the exception and is below: who
//	                            reports to whom is worth an agent knowing, while POST
//	                            /api/agent/lead and /api/agent/place are a decision about the
//	                            team, which the person makes. POST /api/agent/seen is denied for
//	                            a plainer reason: an agent clearing the badge on a thread is an
//	                            agent deciding what the person has read
//	GET /api/file               bytes rather than JSON; nothing a model can read
var allowed = []string{
	// Reading: the trees, the documents, and what the app knows about itself.
	"GET /api/tree",
	"GET /api/doc",
	"GET /api/links",
	"GET /api/ledger",
	"GET /api/config",
	"GET /api/projects",
	"GET /api/repos",
	"GET /api/branches",
	"GET /api/git",
	"GET /api/sync",
	"GET /api/tasks",
	"GET /api/task/runs",
	"GET /api/task/log",
	"GET /api/diagrams",
	"GET /api/entities",
	"GET /api/entities/catalogue",
	"GET /api/personas",
	"GET /api/skills",
	"GET /api/agents/org",
	"GET /api/activity",
	"GET /api/diff",
	"GET /api/diff/file",
	// Writing: documents, the folders holding them, branches, sync, and the task runner.
	"PUT /api/doc",
	"DELETE /api/doc",
	"POST /api/doc/move",
	"POST /api/folder",
	"POST /api/branches",
	"POST /api/branches/open",
	"DELETE /api/branches",
	"POST /api/sync/now",
	"POST /api/sync/clear-conflict",
	"POST /api/git/check",
	"POST /api/entities",
	"POST /api/entity/link",
	"POST /api/task/run",
	"POST /api/task/stop",
}

var permitted = func() map[string]bool {
	held := map[string]bool{}
	for _, one := range allowed {
		held[one] = true
	}
	return held
}()

// Call reaches one of the app's own routes, on loopback.
type Call func(method, route string, params map[string]any) (string, error)

// New is the door, opened for whoever is taking the turn. That claim rides along in a header, so a
// document written through it is filed in the ledger as theirs — a claim rather than a credential,
// as everything on loopback is, and an absent one is a person typing, which is what the editor is.
//
// Where the parameters go is decided here rather than asked of the model: GET and DELETE take a
// query string, POST and PUT take a body. The brief says as much in prose, and a rule enforced is
// a class of failure that cannot happen.
func New(base func() string, by *ledger.Actor) Call {
	return func(method, route string, params map[string]any) (string, error) {
		if !permitted[method+" "+route] {
			return "", apperr.Chatf("%s %s is not a route you can call. These are: %s",
				method, route, strings.Join(allowed, ", "))
		}
		at := base()
		if at == "" {
			return "", apperr.Chatf("the app is not listening yet")
		}
		target, err := url.Parse(at + route)
		if err != nil {
			return "", apperr.Chatf("the app is not listening yet")
		}

		var carried io.Reader
		if method == http.MethodGet || method == http.MethodDelete {
			query := target.Query()
			// Sorted, so one call twice is one request twice: a map has no order, and a URL that
			// differs run to run is one nothing can be held to.
			for _, key := range sortedKeys(params) {
				query.Set(key, said(params[key]))
			}
			target.RawQuery = query.Encode()
		} else {
			body, err := json.Marshal(params)
			if err != nil {
				return "", err
			}
			carried = bytes.NewReader(body)
		}

		request, err := http.NewRequest(method, target.String(), carried)
		if err != nil {
			return "", apperr.Chatf("the app is not listening yet")
		}
		if carried != nil {
			request.Header.Set("content-type", "application/json")
		}
		if by != nil {
			if encoded, err := json.Marshal(by); err == nil {
				request.Header.Set(ledger.Header, string(encoded))
			}
		}

		client := http.Client{Timeout: time.Minute}
		response, err := client.Do(request)
		if err != nil {
			return "", apperr.Chatf("the app did not answer: %s", err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			return "", apperr.Chatf("the app did not answer: %s", err)
		}
		answer := string(raw)
		// A refusal is not an answer. Without this a tool that only reports what it did would say
		// it wrote the document the app had just turned down.
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return "", apperr.Chatf("%s", reasonIn(answer))
		}
		return Cut(answer), nil
	}
}

// Cut is how much of an answer is worth carrying back. Past this the model is reading a file it
// asked for by mistake, and paying for it by the token.
func Cut(answer string) string {
	if len(answer) <= constants.MaxAnswer {
		return answer
	}
	return answer[:constants.MaxAnswer] + "\n\n[…cut: the answer was " +
		strconv.Itoa(len(answer)) + " characters]"
}

// reasonIn: the app says why in `{"error": "..."}`; anything else is handed back as it came.
func reasonIn(body string) string {
	var held struct {
		Error string `json:"error"`
	}
	if json.Unmarshal([]byte(body), &held) == nil && held.Error != "" {
		return held.Error
	}
	if len(body) > 500 {
		return body[:500]
	}
	return body
}

// said is a parameter in a query string. Everything is a string on the wire, and the shapes a
// model sends — a number, a bool, a list — are spelled the way JSON spells them rather than the
// way Go prints them.
func said(value any) string {
	switch held := value.(type) {
	case string:
		return held
	case nil:
		return ""
	default:
		if encoded, err := json.Marshal(held); err == nil {
			return strings.Trim(string(encoded), `"`)
		}
		return ""
	}
}

func sortedKeys(params map[string]any) []string {
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}
