package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A home holding one profile connected to GitHub, written the way the daemon writes one.
func connectedHome(t *testing.T, file string) (*Server, string) {
	t.Helper()
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "Ada"), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, "Ada", "profile.json")
	if err := os.WriteFile(path, []byte(file), 0o600); err != nil {
		t.Fatal(err)
	}
	return servingIn(t, home, ""), path
}

// A button that cannot work is worse than no button, so the page is told before it draws one —
// and the route says the same thing if it is asked anyway.
func TestSaysWhetherThisBuildCanConnectToGithubAtAll(t *testing.T) {
	t.Setenv("BROODMOTHER_GITHUB_CLIENT_ID", "")
	server := serving(t, "")
	if answer := sent(t, server, http.MethodGet, "/api/profiles", ""); answer["githubReady"] != false {
		t.Errorf("said it was ready: %+v", answer["githubReady"])
	}
	said := refused(t, server, http.MethodPost, "/api/github/device", "")
	if !strings.Contains(said, "BROODMOTHER_GITHUB_CLIENT_ID") {
		t.Errorf("refused with %s", said)
	}
}

// A picker with nothing in it and no reason why is worse than being told the connection is gone.
func TestRefusesToAskGithubForAProfileThatIsNotConnected(t *testing.T) {
	server, _ := connectedHome(t, "{}\n")
	for _, one := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/github/repos", ""},
		{http.MethodPost, "/api/github/repos", `{"name":"fresh","private":true}`},
	} {
		said := refused(t, server, one.method, one.path, one.body)
		if !strings.Contains(said, "Ada is not connected to GitHub") {
			t.Errorf("%s %s refused with %s", one.method, one.path, said)
		}
	}
}

// Nothing that connects works before there is a profile to connect.
func TestRefusesToConnectBeforeThereIsAProfile(t *testing.T) {
	t.Setenv("BROODMOTHER_GITHUB_CLIENT_ID", "Iv1.test")
	server := serving(t, "")
	for _, one := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/github/connect", `{"deviceCode":"held"}`},
		{http.MethodDelete, "/api/github", ""},
		{http.MethodGet, "/api/github/repos", ""},
	} {
		response, body := send(t, server, one.method, one.path, one.body, "")
		if response.StatusCode != http.StatusConflict {
			t.Errorf("%s %s answered %d: %s", one.method, one.path, response.StatusCode, body)
		}
	}
}

// The token goes and nothing else does: what was pushed with it stays pushed, and who you commit
// as is untouched. This is a credential, not a relationship.
func TestDisconnectingTakesTheTokenAndNothingElse(t *testing.T) {
	server, path := connectedHome(t, `{"zzz":"kept","color":"#123456",`+
		`"connections":{"github":{"login":"ada","token":"gho_secret"}}}`+"\n")

	before := sent(t, server, http.MethodGet, "/api/profiles", "")
	active, _ := before["active"].(map[string]any)
	connections, _ := active["connections"].(map[string]any)
	if connections["github"] != "ada" {
		t.Fatalf("started as %+v", connections)
	}

	answer := sent(t, server, http.MethodDelete, "/api/github", "")
	held, _ := answer["profile"].(map[string]any)
	if connections, _ := held["connections"].(map[string]any); len(connections) != 0 {
		t.Errorf("still connected as %+v", connections)
	}
	if held["color"] != "#123456" {
		t.Errorf("forgot who you commit as: %+v", held)
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	written := string(body)
	if strings.Contains(written, "gho_secret") {
		t.Errorf("the token is still on disk:\n%s", written)
	}
	if !strings.Contains(written, `"zzz": "kept"`) {
		t.Errorf("lost a key nothing here has heard of:\n%s", written)
	}
}

// A token kept under the key it used to live at still reads — and the first write drops that key,
// so a disconnect cannot be undone by the fallback that read it.
func TestDisconnectingDropsTheOlderPlaceATokenWasKept(t *testing.T) {
	server, path := connectedHome(t, `{"github":{"login":"ada","token":"gho_legacy"}}`+"\n")

	before := sent(t, server, http.MethodGet, "/api/profiles", "")
	active, _ := before["active"].(map[string]any)
	if connections, _ := active["connections"].(map[string]any); connections["github"] != "ada" {
		t.Fatalf("did not read the older place: %+v", active["connections"])
	}

	sent(t, server, http.MethodDelete, "/api/github", "")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "gho_legacy") {
		t.Errorf("the token is still on disk:\n%s", body)
	}

	after := sent(t, server, http.MethodGet, "/api/profiles", "")
	active, _ = after["active"].(map[string]any)
	if connections, _ := active["connections"].(map[string]any); len(connections) != 0 {
		t.Errorf("came back connected as %+v", connections)
	}
}

// The token is what this daemon pushes with, and it never leaves the server.
func TestNeverHandsTheTokenToTheBrowser(t *testing.T) {
	server, _ := connectedHome(t, `{"connections":{"github":{"login":"ada","token":"gho_secret"}}}`+"\n")
	for _, path := range []string{"/api/profiles", "/api/integrations"} {
		_, body := get(t, server, path, "")
		if strings.Contains(string(body), "gho_secret") {
			t.Errorf("%s answered with the token: %s", path, body)
		}
	}
	answer := sent(t, server, http.MethodGet, "/api/integrations", "")
	offered, _ := answer["integrations"].([]any)
	one, _ := offered[0].(map[string]any)
	if one["connectedAs"] != "ada" {
		t.Errorf("says it is connected as %+v", one["connectedAs"])
	}
}

func TestRefusesARepositoryItCannotName(t *testing.T) {
	server, _ := connectedHome(t, `{"connections":{"github":{"login":"ada","token":"gho_secret"}}}`+"\n")
	for _, body := range []string{`{}`, `{"name":"fresh"}`, `{"private":true}`, `{"name":"","private":true}`} {
		response, answer := send(t, server, http.MethodPost, "/api/github/repos", body, "")
		if response.StatusCode != http.StatusBadRequest {
			t.Errorf("%s answered %d: %s", body, response.StatusCode, answer)
		}
		var held map[string]any
		if err := json.Unmarshal(answer, &held); err != nil {
			t.Fatal(err)
		}
		if said, _ := held["error"].(string); !strings.Contains(said, "name the repository") {
			t.Errorf("%s refused with %s", body, said)
		}
	}
}
