package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
)

// memoryCrontab is a crontab that is only a string, so no test ever edits the machine's real one.
// Every server a test starts is handed one, since a schedule trigger in a fixture is otherwise a
// line written into whoever is running the suite.
type memoryCrontab struct{ text string }

func (c *memoryCrontab) Read() (string, error)   { return c.text, nil }
func (c *memoryCrontab) Write(next string) error { c.text = next; return nil }

// A port of -1 is whichever the OS has free, so a test never claims the one a real daemon wants.
func serving(t *testing.T, config string) *Server {
	t.Helper()
	return servingIn(t, t.TempDir(), config)
}

func servingIn(t *testing.T, home, config string) *Server {
	t.Helper()
	if config != "" {
		if err := os.WriteFile(filepath.Join(home, "config.json"), []byte(config), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	server, err := Start(Options{
		Options: app.Options{Home: home, Cron: &memoryCrontab{}}, Port: -1,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close(context.Background()) })
	return server
}

func get(t *testing.T, server *Server, path string, origin string) (*http.Response, []byte) {
	t.Helper()
	return send(t, server, http.MethodGet, path, "", origin)
}

// send is any request, with a body where the method takes one.
func send(t *testing.T, server *Server, method, path, body, origin string) (*http.Response, []byte) {
	t.Helper()
	var carried io.Reader
	if body != "" {
		carried = strings.NewReader(body)
	}
	request, err := http.NewRequest(method, server.URL+path, carried)
	if err != nil {
		t.Fatal(err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	answer, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response, answer
}

func TestServesTheConfigItIsRunningOn(t *testing.T) {
	// A project whose folder is really there, or startup would resolve it away — which is the
	// point of the test below it. Inside a real profile, or the migration would read the folder
	// above it as a project from the layout before profiles existed and move it.
	home := t.TempDir()
	open := filepath.Join(home, "Michael", "notes")
	if err := os.MkdirAll(open, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "Michael", "profile.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := servingIn(t, home, `{"projectPath":`+quoted(open)+`,"profile":"Michael","checkouts":{},"git":{},"repo":{},"repoBranch":{}}`)
	response, body := get(t, server, "/api/config", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	var answer GetConfig
	if err := json.Unmarshal(body, &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Config.ProjectPath == nil || *answer.Config.ProjectPath != open {
		t.Errorf("answered with %+v", answer.Config)
	}
	if answer.Reset == nil {
		t.Error("reset came back as null rather than an empty list")
	}
}

// A file that will not parse costs its fields and nothing else — starting is what matters, since
// refusing to would leave nobody an interface to fix the file in.
func TestStartsOnAConfigItCouldNotRead(t *testing.T) {
	server := serving(t, "{not json")
	response, body := get(t, server, "/api/config", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	var answer GetConfig
	if err := json.Unmarshal(body, &answer); err != nil {
		t.Fatal(err)
	}
	if len(answer.Reset) == 0 {
		t.Error("said nothing about the fields it lost")
	}
}

func TestAFirstRunHasNothingOpen(t *testing.T) {
	server := serving(t, "")
	_, body := get(t, server, "/api/config", "")
	var answer GetConfig
	if err := json.Unmarshal(body, &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Config.ProjectPath != nil {
		t.Errorf("opened %q on a first run", *answer.Config.ProjectPath)
	}
	if len(answer.Reset) != 0 {
		t.Errorf("a home with no config reset %v", answer.Reset)
	}
}

func TestARouteStillInTheTypeScriptSaysSoRatherThanHangingUp(t *testing.T) {
	server := serving(t, "")
	response, body := get(t, server, "/api/terminal", "")
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	var said problem
	if err := json.Unmarshal(body, &said); err != nil || said.Error == "" {
		t.Errorf("answered %q", body)
	}
}

func TestTellsTheBrowserWhichOriginItWillTakeAndVariesOnIt(t *testing.T) {
	t.Setenv("BROODMOTHER_WEB_ORIGINS", "http://localhost:4243,http://127.0.0.1:4243")
	server := serving(t, "")

	response, _ := get(t, server, "/api/config", "http://127.0.0.1:4243")
	if got := response.Header.Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:4243" {
		t.Errorf("allowed %q", got)
	}
	if got := response.Header.Values("Vary"); len(got) != 1 || got[0] != "Origin" {
		t.Errorf("varied on %q", got)
	}
	// An origin that is not on the list is told nothing rather than told the wrong thing, and
	// neither is a request that names no origin at all.
	for _, origin := range []string{"http://evil.invalid", ""} {
		response, _ = get(t, server, "/api/config", origin)
		if got := response.Header.Get("Access-Control-Allow-Origin"); got != "" {
			t.Errorf("allowed %q for origin %q", got, origin)
		}
	}
}

// quoted is a path as a JSON string, for the config a test writes.
func quoted(value string) string {
	out, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(out)
}

func TestAnswersAPreflightWithoutReachingTheRoute(t *testing.T) {
	t.Setenv("BROODMOTHER_WEB_ORIGINS", "http://localhost:4243")
	server := serving(t, "")
	request, err := http.NewRequest(http.MethodOptions, server.URL+"/api/config", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Origin", "http://localhost:4243")
	request.Header.Set("Access-Control-Request-Method", "PUT")
	request.Header.Set("Access-Control-Request-Headers", "content-type")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("answered %d", response.StatusCode)
	}
	if got := response.Header.Get("Access-Control-Allow-Methods"); got != allowMethods {
		t.Errorf("allowed %q", got)
	}
	if got := response.Header.Get("Access-Control-Allow-Headers"); got != "content-type" {
		t.Errorf("allowed headers %q", got)
	}
	// One Vary naming both, not two Vary headers — which is what the middleware writes.
	if got := response.Header.Values("Vary"); len(got) != 1 || got[0] != "Origin, Access-Control-Request-Headers" {
		t.Errorf("varied on %q", got)
	}
	if got := response.Header.Get("Content-Type"); got != "" {
		t.Errorf("a preflight described a body it does not have: %q", got)
	}
}

// The answer is the bytes the middleware this is ported from writes: no trailing newline, so a
// caller comparing the two daemons compares equal.
func TestAnswersWithoutATrailingNewline(t *testing.T) {
	server := serving(t, "")
	_, body := get(t, server, "/api/config", "")
	if len(body) == 0 || body[len(body)-1] == '\n' {
		t.Errorf("answered %q", body)
	}
}

// Startup resolves what is really open: a project whose folder has gone is not open, whatever
// the file still says.
func TestForgetsAProjectWhoseFolderHasGone(t *testing.T) {
	server := serving(t, `{"projectPath":"/tmp/nothing-is-here","profile":"Michael","checkouts":{},"git":{},"repo":{},"repoBranch":{}}`)
	_, body := get(t, server, "/api/config", "")
	var answer GetConfig
	if err := json.Unmarshal(body, &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Config.ProjectPath != nil {
		t.Errorf("still open on %q", *answer.Config.ProjectPath)
	}
}

// A profile is a folder holding a profile.json, and the listing is in the browser's order —
// which puts a lowercase name before a capital, where Go's own sort would not.
func TestListsProfilesTheWayTheBrowserOrdersThem(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"Zoe", "alice", "Michael"} {
		if err := os.MkdirAll(filepath.Join(home, name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(home, name, "profile.json"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A folder with no profile.json is not a profile — it is a project from the layout before
	// profiles existed, and the migration hands it to the first of them.
	if err := os.MkdirAll(filepath.Join(home, "stray"), 0o755); err != nil {
		t.Fatal(err)
	}

	server := servingIn(t, home, "")
	_, body := get(t, server, "/api/profiles", "")
	var answer GetProfiles
	if err := json.Unmarshal(body, &answer); err != nil {
		t.Fatal(err)
	}
	var named []string
	for _, one := range answer.Profiles {
		named = append(named, one.Name)
	}
	want := []string{"alice", "Michael", "Zoe"}
	if len(named) != len(want) {
		t.Fatalf("listed %v", named)
	}
	for index := range want {
		if named[index] != want[index] {
			t.Fatalf("listed %v, want %v", named, want)
		}
	}
	// The stray folder landed in the first profile and opened as its project, so that profile is
	// who you are.
	if answer.Active == nil || answer.Active.Name != "alice" {
		t.Errorf("working as %+v", answer.Active)
	}
}

// A WebSocket is not covered by CORS, so the origin is checked at the upgrade — a page on
// another origin opening `/ws` would be watching this tree.
func TestRefusesASocketFromAnOriginItDoesNotKnow(t *testing.T) {
	t.Setenv("BROODMOTHER_WEB_ORIGINS", "http://localhost:4243")
	server := serving(t, "")

	for _, one := range []struct {
		origin string
		want   int
	}{
		{"http://localhost:4243", http.StatusSwitchingProtocols},
		{"http://evil.invalid", http.StatusForbidden},
		// No origin at all is every client that is not a browser.
		{"", http.StatusSwitchingProtocols},
	} {
		request, err := http.NewRequest(http.MethodGet, server.URL+"/ws", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Connection", "Upgrade")
		request.Header.Set("Upgrade", "websocket")
		request.Header.Set("Sec-WebSocket-Version", "13")
		request.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		if one.origin != "" {
			request.Header.Set("Origin", one.origin)
		}
		response, err := http.DefaultTransport.RoundTrip(request)
		if err != nil {
			t.Fatalf("origin %q: %v", one.origin, err)
		}
		if response.StatusCode != one.want {
			t.Errorf("origin %q answered %d, want %d", one.origin, response.StatusCode, one.want)
		}
		if response.Body != nil {
			response.Body.Close()
		}
	}
}
