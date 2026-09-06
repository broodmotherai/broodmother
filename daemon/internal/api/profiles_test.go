package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const anIdentity = `"color":"#8fb8d8","gitAuthor":{"name":"Ada","email":"ada@localhost"},` +
	`"sshKeyPath":null,"agentCommands":{"claude":"claude --go"},"soul":null`

func sent(t *testing.T, server *Server, method, path, body string) map[string]any {
	t.Helper()
	response, answer := send(t, server, method, path, body, "")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("%s %s answered %d: %s", method, path, response.StatusCode, answer)
	}
	var held map[string]any
	if err := json.Unmarshal(answer, &held); err != nil {
		t.Fatalf("%s %s answered %s: %v", method, path, answer, err)
	}
	return held
}

func refused(t *testing.T, server *Server, method, path, body string) string {
	t.Helper()
	response, answer := send(t, server, method, path, body, "")
	if response.StatusCode == http.StatusOK {
		t.Fatalf("%s %s was accepted: %s", method, path, answer)
	}
	return string(answer)
}

// A profile made from the project menu is one you meant to work as, so it is worked as on the
// spot — and it holds no projects yet, which is the first-run state with a name on it.
func TestMakesAProfileAndWorksAsIt(t *testing.T) {
	server := serving(t, "")
	made := sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)
	held, _ := made["profile"].(map[string]any)
	if held["name"] != "Ada" || held["color"] != "#8fb8d8" {
		t.Fatalf("made %+v", made)
	}
	if made["project"] != nil {
		t.Errorf("a new profile opened a project: %+v", made["project"])
	}
	// The soul comes back filled in even though the file says nothing, which is the rule the
	// brief follows: the page opens on the prompt its agents are actually held to.
	if soul, written := held["soul"].(string); !written || soul == "" {
		t.Errorf("answered with no soul: %+v", held)
	}

	listed := sent(t, server, http.MethodGet, "/api/profiles", "")
	active, _ := listed["active"].(map[string]any)
	if active == nil || active["name"] != "Ada" {
		t.Errorf("working as %+v", listed["active"])
	}
	// Written where a profile lives, and readable by nobody else.
	file := filepath.Join(server.Context.Home, "Ada", "profile.json")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("the profile is %o", mode)
	}
}

func TestRefusesAProfileItCannotWriteWhole(t *testing.T) {
	server := serving(t, "")
	for what, body := range map[string]string{
		"no name":       `{` + anIdentity + `}`,
		"no colour":     `{"name":"Ada","gitAuthor":{"name":"Ada","email":"a@b"},"sshKeyPath":null,"agentCommands":{},"soul":null}`,
		"a bad colour":  `{"name":"Ada","color":"blue","gitAuthor":{"name":"Ada","email":"a@b"},"sshKeyPath":null,"agentCommands":{},"soul":null}`,
		"no author":     `{"name":"Ada","color":"#8fb8d8","sshKeyPath":null,"agentCommands":{},"soul":null}`,
		"a blank line":  `{"name":"Ada","color":"#8fb8d8","gitAuthor":{"name":"Ada","email":"a@b"},"sshKeyPath":null,"agentCommands":{"claude":""},"soul":null}`,
		"a shell agent": `{"name":"Ada","color":"#8fb8d8","gitAuthor":{"name":"Ada","email":"a@b"},"sshKeyPath":null,"agentCommands":{"shell":"sh"},"soul":null}`,
	} {
		t.Run(what, func(t *testing.T) { refused(t, server, http.MethodPost, "/api/profiles", body) })
	}
}

func TestRefusesASecondProfileOfTheSameName(t *testing.T) {
	server := serving(t, "")
	sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)
	if said := refused(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`); !strings.Contains(said, "already exists") {
		t.Errorf("refused with %s", said)
	}
}

// Saving who you commit as is not signing out of anywhere, and it is not throwing away a key
// nothing here has heard of either.
func TestSavesAnIdentityWithoutLosingTheRestOfTheFile(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "Ada"), 0o755); err != nil {
		t.Fatal(err)
	}
	// The order is the point: a key written first stays first, which a Go map would not manage.
	before := `{"zzz":"kept","connections":{"github":{"login":"ada","token":"secret"}},"color":"#000000"}` + "\n"
	file := filepath.Join(home, "Ada", "profile.json")
	if err := os.WriteFile(file, []byte(before), 0o600); err != nil {
		t.Fatal(err)
	}

	server := servingIn(t, home, "")
	sent(t, server, http.MethodPut, "/api/profiles", `{`+anIdentity+`}`)

	body, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	written := string(body)
	if !strings.HasPrefix(written, "{\n  \"zzz\": \"kept\",\n  \"connections\"") {
		t.Errorf("rewrote the file as:\n%s", written)
	}
	if !strings.Contains(written, `"token": "secret"`) {
		t.Errorf("lost the connection:\n%s", written)
	}
	if !strings.Contains(written, `"color": "#8fb8d8"`) {
		t.Errorf("did not save the colour:\n%s", written)
	}
	// The soul the page opened on is the default's own text, and what that means is that nobody
	// has written one — so what goes in the file is nothing.
	if !strings.Contains(written, `"soul": null`) {
		t.Errorf("stored a soul nobody wrote:\n%s", written)
	}

	listed := sent(t, server, http.MethodGet, "/api/profiles", "")
	active, _ := listed["active"].(map[string]any)
	connections, _ := active["connections"].(map[string]any)
	if connections["github"] != "ada" {
		t.Errorf("the connection came back as %+v", connections)
	}
}

// A key is a password belonging to whoever the profile is: what the browser is told is which
// providers are held, and not a character of what they are held as.
func TestHoldsAModelKeyAndNeverHandsItOut(t *testing.T) {
	server := serving(t, "")
	sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)

	saved := sent(t, server, http.MethodPut, "/api/model-keys", `{"provider":"anthropic","key":"sk-secret"}`)
	held, _ := saved["profile"].(map[string]any)
	models, _ := held["models"].([]any)
	if len(models) != 1 || models[0] != "anthropic" {
		t.Fatalf("holds %+v", held["models"])
	}
	response, answer := send(t, server, http.MethodGet, "/api/profiles", "", "")
	if response.StatusCode != http.StatusOK || strings.Contains(string(answer), "sk-secret") {
		t.Errorf("the key reached the browser: %s", answer)
	}

	// Dropping a key is not signing out of the rest of your life, but it is signing out of this.
	gone := sent(t, server, http.MethodDelete, "/api/model-keys?provider=anthropic", "")
	held, _ = gone["profile"].(map[string]any)
	if models, _ := held["models"].([]any); len(models) != 0 {
		t.Errorf("still holds %+v", held["models"])
	}
	body, err := os.ReadFile(filepath.Join(server.Context.Home, "Ada", "profile.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "sk-secret") {
		t.Errorf("the key is still on disk:\n%s", body)
	}
}

// A provider nobody serves is refused rather than written and never read.
func TestRefusesAProviderItServesNoModelFrom(t *testing.T) {
	server := serving(t, "")
	sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)
	refused(t, server, http.MethodPut, "/api/model-keys", `{"provider":"openai","key":"sk-x"}`)
	refused(t, server, http.MethodPut, "/api/model-keys", `{"provider":"anthropic","key":""}`)
}

// The whole list whether connected or not: connecting is done from this page, so a page of only
// the connected ones would have nothing to connect from.
func TestListsTheServicesATaskCanReach(t *testing.T) {
	server := serving(t, "")
	sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)
	answer := sent(t, server, http.MethodGet, "/api/integrations", "")
	offered, _ := answer["integrations"].([]any)
	if len(offered) != 1 {
		t.Fatalf("offered %+v", answer)
	}
	one, _ := offered[0].(map[string]any)
	if one["id"] != "github" || one["connect"] != "device" || one["label"] != "GitHub" {
		t.Errorf("offered %+v", one)
	}
	if connected, said := one["connectedAs"]; !said || connected != nil {
		t.Errorf("connected as %+v", one["connectedAs"])
	}
}

// A key is refused where one is already there: replacing it silently is taking away access to
// everything the old one opened.
func TestMakesAKeyOnceAndPointsTheProfileAtIt(t *testing.T) {
	if _, err := exec.LookPath("ssh-keygen"); err != nil {
		t.Skip("no ssh-keygen on this machine")
	}
	server := serving(t, "")
	sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)
	if answer := sent(t, server, http.MethodGet, "/api/profiles/key", ""); answer["publicKey"] != nil {
		t.Errorf("a profile with no key answered %+v", answer["publicKey"])
	}

	made := sent(t, server, http.MethodPost, "/api/profiles/key", "")
	public, _ := made["publicKey"].(string)
	if !strings.HasPrefix(public, "ssh-ed25519 ") || !strings.HasSuffix(public, "Ada@broodmother") {
		t.Fatalf("made %q", public)
	}
	held, _ := made["profile"].(map[string]any)
	want := filepath.Join(server.Context.Home, "Ada", "profile.key")
	if held["sshKeyPath"] != want {
		t.Errorf("points at %+v, want %s", held["sshKeyPath"], want)
	}
	if answer := sent(t, server, http.MethodGet, "/api/profiles/key", ""); answer["publicKey"] != public {
		t.Errorf("read back %+v", answer["publicKey"])
	}
	if said := refused(t, server, http.MethodPost, "/api/profiles/key", ""); !strings.Contains(said, "already has a key") {
		t.Errorf("made a second key: %s", said)
	}
}

// Nothing that writes a profile works before there is one to write.
func TestRefusesToWriteAProfileThatIsNotThere(t *testing.T) {
	server := serving(t, "")
	for _, one := range []struct{ method, path, body string }{
		{http.MethodPut, "/api/profiles", `{` + anIdentity + `}`},
		{http.MethodPost, "/api/profiles/key", ""},
		{http.MethodPut, "/api/model-keys", `{"provider":"anthropic","key":"sk-x"}`},
	} {
		response, answer := send(t, server, one.method, one.path, one.body, "")
		if response.StatusCode != http.StatusConflict {
			t.Errorf("%s %s answered %d: %s", one.method, one.path, response.StatusCode, answer)
		}
	}
}

// Switching a theme is a click, not a form: it carries a theme id and nothing else, and what it
// answers with is the profile so that whatever is on screen takes the new appearance from the
// same reply that saved it.
func TestSwitchesTheThemeWithoutCarryingTheRestOfTheProfile(t *testing.T) {
	server := serving(t, "")
	made := sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)
	held, _ := made["profile"].(map[string]any)
	appearance, _ := held["appearance"].(map[string]any)
	if appearance == nil || appearance["theme"] != "sand" {
		t.Fatalf("a new profile opened on %+v", held["appearance"])
	}

	saved := sent(t, server, http.MethodPut, "/api/appearance", `{"theme":"ink"}`)
	held, _ = saved["profile"].(map[string]any)
	appearance, _ = held["appearance"].(map[string]any)
	if appearance["theme"] != "ink" {
		t.Fatalf("answered with %+v", held["appearance"])
	}
	// The colour it was made with is still the colour it has: a theme is not an identity.
	if held["color"] != "#8fb8d8" {
		t.Errorf("the switch touched the identity: %+v", held)
	}

	// It survives a restart, which is the whole reason it is on disk rather than in the browser.
	listed := sent(t, server, http.MethodGet, "/api/profiles", "")
	active, _ := listed["active"].(map[string]any)
	appearance, _ = active["appearance"].(map[string]any)
	if appearance["theme"] != "ink" {
		t.Errorf("came back as %+v", active["appearance"])
	}
	body, err := os.ReadFile(filepath.Join(server.Context.Home, "Ada", "profile.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"theme": "ink"`) {
		t.Errorf("is not on disk:\n%s", body)
	}
}

// What a theme id means is settled in the frontend, so the route proves the shape and leaves the
// meaning alone — a name it has never heard of is saved, and no name at all is refused.
func TestRefusesARequestThatNamesNoTheme(t *testing.T) {
	server := serving(t, "")
	sent(t, server, http.MethodPost, "/api/profiles", `{"name":"Ada",`+anIdentity+`}`)
	sent(t, server, http.MethodPut, "/api/appearance", `{"theme":"midnight"}`)
	refused(t, server, http.MethodPut, "/api/appearance", `{"theme":""}`)
	refused(t, server, http.MethodPut, "/api/appearance", `{}`)
}
