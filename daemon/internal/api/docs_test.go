package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/relay"
)

// The sidebar is one answer: the project's tree and every repo's together, so standing in a
// repo is not a second question the browser has no route to ask.
func TestTheTreeCarriesEveryReposTree(t *testing.T) {
	home, _ := projectHome(t, map[string]string{"index.md": "# hi\n"})
	inRepo := filepath.Join(home, "Ada", "notes", ".repos", "api", "local")
	if err := os.MkdirAll(inRepo, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inRepo, "README.md"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := servingIn(t, home, "")
	response, body := get(t, server, "/api/tree", "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("answered %d: %s", response.StatusCode, body)
	}
	var tree struct {
		Repos []struct {
			Name    string `json:"name"`
			Entries []struct {
				Path string `json:"path"`
			} `json:"entries"`
		} `json:"repos"`
	}
	if err := json.Unmarshal(body, &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree.Repos) != 1 || tree.Repos[0].Name != "api" {
		t.Fatalf("carried %+v", tree.Repos)
	}
	if len(tree.Repos[0].Entries) != 1 || tree.Repos[0].Entries[0].Path != "README.md" {
		t.Errorf("the repo's tree held %+v", tree.Repos[0].Entries)
	}
}

// listening is a `/ws` client, and the next tree message it hears — or nothing, once it has
// waited longer than any watcher takes to say something.
func listening(t *testing.T, server *Server) func() *relay.Message {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	socket, _, err := websocket.Dial(ctx, strings.Replace(server.URL, "http", "ws", 1)+"/ws", nil)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		socket.Close(websocket.StatusNormalClosure, "")
		cancel()
	})
	return func() *relay.Message {
		deadline, done := context.WithTimeout(ctx, 3*time.Second)
		defer done()
		for {
			_, body, err := socket.Read(deadline)
			if err != nil {
				return nil
			}
			var message relay.Message
			if err := json.Unmarshal(body, &message); err != nil {
				t.Fatal(err)
			}
			if message.Type == "tree" {
				return &message
			}
		}
	}
}

// A repo's files are drawn in the sidebar beside the project's, so a write into one from a
// shell has to reach the browser the way a write into the project does.
func TestTheSidebarHearsAboutAWriteInsideARepo(t *testing.T) {
	home, _ := projectHome(t, map[string]string{"index.md": "# hi\n"})
	inRepo := filepath.Join(home, "Ada", "notes", ".repos", "api", "local")
	if err := os.MkdirAll(inRepo, 0o755); err != nil {
		t.Fatal(err)
	}
	server := servingIn(t, home, "")
	next := listening(t, server)

	if err := os.WriteFile(filepath.Join(inRepo, "README.md"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	heard := next()
	if heard == nil {
		t.Fatal("a file written into a repo went unheard")
	}
	if heard.Root != doc.RepoRoot("api") || heard.Event == nil || heard.Event.Path != "README.md" {
		t.Errorf("heard %+v about %+v", heard.Root, heard.Event)
	}
}

// A repository cloned into the repos folder from a shell is a repo — the tree lists it the moment
// it is asked — and the browser has to be told to ask.
func TestTheSidebarHearsAboutARepoDroppedIn(t *testing.T) {
	home, _ := projectHome(t, map[string]string{"index.md": "# hi\n"})
	repos := filepath.Join(home, "Ada", "notes", ".repos")
	if err := os.MkdirAll(filepath.Join(repos, "api", "local"), 0o755); err != nil {
		t.Fatal(err)
	}
	server := servingIn(t, home, "")
	next := listening(t, server)

	dropped := filepath.Join(repos, "site", "local")
	if err := os.MkdirAll(dropped, 0o755); err != nil {
		t.Fatal(err)
	}
	if next() == nil {
		t.Fatal("a repo dropped into the folder went unheard")
	}
	_, body := get(t, server, "/api/tree", "")
	var tree struct {
		Repos []struct {
			Name string `json:"name"`
		} `json:"repos"`
	}
	if err := json.Unmarshal(body, &tree); err != nil {
		t.Fatal(err)
	}
	if len(tree.Repos) != 2 || tree.Repos[1].Name != "site" {
		t.Fatalf("listed %+v", tree.Repos)
	}

	// And it is watched from then on, the way the one that was there at the start is.
	if err := os.WriteFile(filepath.Join(dropped, "README.md"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for {
		heard := next()
		if heard == nil {
			t.Fatal("a file written into the dropped-in repo went unheard")
		}
		if heard.Root == doc.RepoRoot("site") && heard.Event != nil && heard.Event.Path == "README.md" {
			return
		}
	}
}
