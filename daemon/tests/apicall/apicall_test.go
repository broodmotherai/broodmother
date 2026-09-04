// The one door a conversation asks the app through. Default deny is the whole point of it, so it
// is the thing worth holding.

package apicall_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/apicall"

	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
)

// asked is one request the door made.
type asked struct {
	method  string
	path    string
	query   string
	body    string
	actor   string
	content string
}

// standing is the app, as a test can answer it.
func standing(t *testing.T, answer func(w http.ResponseWriter, r *http.Request)) (Call, *[]asked, *sync.Mutex) {
	t.Helper()
	seen := &[]asked{}
	mutex := &sync.Mutex{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mutex.Lock()
		*seen = append(*seen, asked{
			method: r.Method, path: r.URL.Path, query: r.URL.RawQuery, body: string(body),
			actor: r.Header.Get(ledger.Header), content: r.Header.Get("content-type"),
		})
		mutex.Unlock()
		answer(w, r)
	}))
	t.Cleanup(server.Close)

	by := ledger.Actor{Kind: ledger.ChatActor, ID: "chat-1", Model: "claude-opus-5"}
	return New(func() string { return server.URL }, &by), seen, mutex
}

func ok(w http.ResponseWriter, _ *http.Request) {
	w.Write([]byte(`{"ok": true}`))
}

// A route that is not on the list is refused with the list, so a model that guessed learns what
// there was to guess at and tries again.
func TestARouteNobodyAllowedIsRefusedWithTheList(t *testing.T) {
	call, seen, mutex := standing(t, ok)

	_, err := call("DELETE", "/api/data", nil)
	if err == nil {
		t.Fatal("wiped the home")
	}
	if !strings.Contains(err.Error(), "is not a route you can call") {
		t.Errorf("said %q", err)
	}
	// The list is in the refusal, so the next try is an informed one.
	if !strings.Contains(err.Error(), "GET /api/tree") {
		t.Errorf("the refusal named no routes: %q", err)
	}
	mutex.Lock()
	defer mutex.Unlock()
	if len(*seen) != 0 {
		t.Error("a denied route still reached the app")
	}
}

// The routes that would move the ground under the person, rewrite the key the conversation speaks
// with, or end somebody's shell are all denied — and each is denied by not being on the list.
func TestTheRoutesWorthDenyingAreDenied(t *testing.T) {
	call, _, _ := standing(t, ok)
	for _, one := range [][2]string{
		{"DELETE", "/api/data"},
		{"PUT", "/api/config"},
		{"PUT", "/api/git"},
		{"POST", "/api/scope"},
		{"POST", "/api/projects"},
		{"DELETE", "/api/projects"},
		{"POST", "/api/repos"},
		{"PUT", "/api/profiles"},
		{"PUT", "/api/model-keys"},
		{"DELETE", "/api/model-keys"},
		{"POST", "/api/github/connect"},
		{"DELETE", "/api/terminal"},
		{"GET", "/api/chats"},
		{"DELETE", "/api/chat"},
		{"POST", "/api/agents"},
		{"DELETE", "/api/agent"},
		{"POST", "/api/agent/lead"},
		{"POST", "/api/agent/place"},
		{"GET", "/api/file"},
	} {
		if _, err := call(one[0], one[1], nil); err == nil {
			t.Errorf("%s %s was allowed", one[0], one[1])
		}
	}
}

// GET and DELETE take a query string, POST and PUT take a body. Decided here rather than asked of
// the model: a rule enforced is a class of failure that cannot happen.
func TestWhereTheParametersGoIsNotTheModelsProblem(t *testing.T) {
	call, seen, mutex := standing(t, ok)

	if _, err := call("GET", "/api/doc", map[string]any{"root": "project", "path": "a.md"}); err != nil {
		t.Fatal(err)
	}
	if _, err := call("PUT", "/api/doc", map[string]any{"root": "project", "path": "a.md", "markdown": "hi"}); err != nil {
		t.Fatal(err)
	}

	mutex.Lock()
	defer mutex.Unlock()
	read, write := (*seen)[0], (*seen)[1]
	if read.query != "path=a.md&root=project" {
		t.Errorf("the read asked %q", read.query)
	}
	if read.body != "" || read.content != "" {
		t.Errorf("the read carried a body: %q", read.body)
	}
	if write.query != "" {
		t.Errorf("the write put its parameters in the query: %q", write.query)
	}
	var held map[string]any
	if json.Unmarshal([]byte(write.body), &held) != nil || held["markdown"] != "hi" {
		t.Errorf("the write carried %q", write.body)
	}
	if write.content != "application/json" {
		t.Errorf("the write said it was %q", write.content)
	}
}

// Whoever the door is opened for rides along, so a document written through it is filed in the
// ledger as theirs.
func TestWhoeverTheDoorIsOpenedForRidesAlong(t *testing.T) {
	call, seen, mutex := standing(t, ok)
	if _, err := call("GET", "/api/tree", nil); err != nil {
		t.Fatal(err)
	}
	mutex.Lock()
	defer mutex.Unlock()
	var actor ledger.Actor
	if json.Unmarshal([]byte((*seen)[0].actor), &actor) != nil {
		t.Fatalf("the claim was %q", (*seen)[0].actor)
	}
	if actor.Kind != ledger.ChatActor || actor.ID != "chat-1" {
		t.Errorf("travelled as %+v", actor)
	}
}

// A refusal is not an answer. Without this a tool that only reports what it did would say it wrote
// the document the app had just turned down.
func TestARefusalIsNotAnAnswer(t *testing.T) {
	call, _, _ := standing(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error": "that document is not a task"}`))
	})
	_, err := call("PUT", "/api/doc", map[string]any{"root": "project", "path": "a.task"})
	if err == nil {
		t.Fatal("a refusal read as an answer")
	}
	if err.Error() != "that document is not a task" {
		t.Errorf("said %q", err)
	}
}

// An answer too long to be worth carrying is cut, and says it was.
func TestALongAnswerIsCut(t *testing.T) {
	call, _, _ := standing(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(strings.Repeat("x", 30_000)))
	})
	said, err := call("GET", "/api/tree", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(said) >= 30_000 || !strings.Contains(said, "the answer was 30000 characters") {
		t.Errorf("carried back %d characters ending %q", len(said), said[max(0, len(said)-60):])
	}
}

// A daemon that is not listening yet says so, rather than failing at a URL nobody can read.
func TestADaemonThatIsNotListeningSaysSo(t *testing.T) {
	call := New(func() string { return "" }, nil)
	if _, err := call("GET", "/api/tree", nil); err == nil ||
		!strings.Contains(err.Error(), "not listening") {
		t.Errorf("said %v", err)
	}
}
