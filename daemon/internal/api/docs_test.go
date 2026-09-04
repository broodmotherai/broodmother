package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
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
