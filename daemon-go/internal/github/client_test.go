package github

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// answering stands a server in front of the two handshake endpoints and the API, and points this
// package at it for the length of one test.
func answering(t *testing.T, routes map[string]string) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, said := routes[r.URL.Path]
		if !said {
			http.Error(w, `{"message":"no such route"}`, http.StatusNotFound)
			return
		}
		// A body written as `NNN <json>` answers with that status.
		status := http.StatusOK
		if head, rest, cut := strings.Cut(body, " "); cut && len(head) == 3 {
			if code := map[string]int{"401": 401, "404": 404, "422": 422}[head]; code != 0 {
				status, body = code, rest
			}
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)

	before := []string{deviceCodeURL, tokenURL, apiBase}
	deviceCodeURL, tokenURL, apiBase = server.URL+"/device", server.URL+"/token", server.URL
	t.Cleanup(func() { deviceCodeURL, tokenURL, apiBase = before[0], before[1], before[2] })
	t.Setenv("BROODMOTHER_GITHUB_CLIENT_ID", "Iv1.test")
}

// There is no secret here — but there is a client id, and a build without one cannot sign in as
// anybody.
func TestSaysWhenThisBuildCannotConnectAtAll(t *testing.T) {
	t.Setenv("BROODMOTHER_GITHUB_CLIENT_ID", "  ")
	if Configured() {
		t.Error("said it could connect")
	}
	if _, err := StartDevice(); err == nil || !strings.Contains(err.Error(), "BROODMOTHER_GITHUB_CLIENT_ID") {
		t.Errorf("started anyway: %v", err)
	}
	t.Setenv("BROODMOTHER_GITHUB_CLIENT_ID", "Iv1.test")
	if !Configured() {
		t.Error("said it could not connect")
	}
}

func TestOpensACodeForTheBrowserToAnswer(t *testing.T) {
	answering(t, map[string]string{"/device": `{"device_code":"held","user_code":"ABCD-1234",` +
		`"verification_uri":"https://github.com/login/device","interval":10}`})
	held, err := StartDevice()
	if err != nil {
		t.Fatal(err)
	}
	if held.Code != "held" || held.UserCode != "ABCD-1234" {
		t.Errorf("opened %+v", held)
	}
	// Seconds on the wire, milliseconds in the answer.
	if held.Interval != 10000 {
		t.Errorf("asks to be left alone for %d", held.Interval)
	}
}

// GitHub saying little is not GitHub saying nothing: the page it names has a default, and so
// does the interval.
func TestFillsInWhatGitHubLeftOut(t *testing.T) {
	answering(t, map[string]string{"/device": `{"device_code":"held","user_code":"ABCD-1234"}`})
	held, err := StartDevice()
	if err != nil {
		t.Fatal(err)
	}
	if held.VerificationURI != "https://github.com/login/device" || held.Interval != 5000 {
		t.Errorf("opened %+v", held)
	}
}

func TestSaysWhyGitHubWouldNotStart(t *testing.T) {
	answering(t, map[string]string{"/device": `{"error":"unauthorized_client","error_description":"this app is not allowed"}`})
	if _, err := StartDevice(); err == nil || err.Error() != "this app is not allowed" {
		t.Errorf("started: %v", err)
	}
}

// One ask, one answer. Waiting is the caller's business.
func TestReadsEveryAnswerTheTokenEndpointGives(t *testing.T) {
	for what, one := range map[string]struct {
		body    string
		pending bool
		token   string
		refused string
	}{
		"signed in":       {`{"access_token":"gho_secret"}`, false, "gho_secret", ""},
		"still waiting":   {`{"error":"authorization_pending"}`, true, "", ""},
		"asked too often": {`{"error":"slow_down"}`, true, "", ""},
		"expired":         {`{"error":"expired_token"}`, false, "", "that code expired — start again"},
		"declined":        {`{"error":"access_denied"}`, false, "", "the request was declined in the browser"},
		"something else":  {`{"error":"whatever","error_description":"GitHub said no"}`, false, "", "GitHub said no"},
		"nothing at all":  {`{}`, false, "", "GitHub refused the sign-in"},
	} {
		t.Run(what, func(t *testing.T) {
			answering(t, map[string]string{"/token": one.body})
			answer, err := Poll("held")
			if one.refused != "" {
				if err == nil || err.Error() != one.refused {
					t.Fatalf("answered %+v / %v", answer, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if answer.Pending != one.pending || answer.Token != one.token {
				t.Errorf("answered %+v", answer)
			}
		})
	}
}

// Only repositories you can write to are worth offering: picking one you cannot push to is a
// failure saved up for the first sync rather than answered here.
func TestOffersOnlyWhatYouCouldPushTo(t *testing.T) {
	answering(t, map[string]string{"/user/repos": `[
		{"full_name":"ada/notes","clone_url":"https://github.com/ada/notes.git","private":true,
		 "default_branch":"trunk","permissions":{"push":true}},
		{"full_name":"someone/read-only","clone_url":"https://github.com/someone/read-only.git",
		 "permissions":{"push":false}},
		{"full_name":"ada/no-url","permissions":{"push":true}},
		{"full_name":"ada/plain","clone_url":"https://github.com/ada/plain.git","permissions":{"push":true}}
	]`})
	found, err := Repos("gho_secret")
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 2 {
		t.Fatalf("offered %+v", found)
	}
	if found[0].FullName != "ada/notes" || !found[0].Private || found[0].DefaultBranch != "trunk" {
		t.Errorf("offered %+v", found[0])
	}
	// A repository that did not say which branch is on the one everything defaults to.
	if found[1].FullName != "ada/plain" || found[1].Private || found[1].DefaultBranch != "main" {
		t.Errorf("offered %+v", found[1])
	}
}

func TestMakesARepositoryWithNothingInIt(t *testing.T) {
	answering(t, map[string]string{"/user/repos": `{"full_name":"ada/fresh",
		"clone_url":"https://github.com/ada/fresh.git","private":true,"default_branch":"main"}`})
	made, err := CreateRepo("gho_secret", NewRepo{Name: "fresh", Private: true})
	if err != nil {
		t.Fatal(err)
	}
	if made.FullName != "ada/fresh" || !made.Private {
		t.Errorf("made %+v", made)
	}
}

func TestAsksWhoTheConnectionIs(t *testing.T) {
	answering(t, map[string]string{"/user": `{"login":"ada"}`})
	if name, err := Login("gho_secret"); err != nil || name != "ada" {
		t.Errorf("answered %q / %v", name, err)
	}
	answering(t, map[string]string{"/user": `{}`})
	if _, err := Login("gho_secret"); err == nil {
		t.Error("took a nameless connection")
	}
}

// A token GitHub no longer accepts is not a network problem and not a bug: it is a connection to
// make again, and saying so is the whole of what the page can act on.
func TestSaysWhenTheConnectionIsNoLongerAccepted(t *testing.T) {
	answering(t, map[string]string{"/user": `401 {"message":"Bad credentials"}`})
	if _, err := Login("gho_secret"); err == nil || !strings.Contains(err.Error(), "connect again") {
		t.Errorf("answered %v", err)
	}
}

// Anything else GitHub refuses is said in GitHub's own words, since they are the ones about the
// thing that was asked for.
func TestSaysWhatGitHubSaidWentWrong(t *testing.T) {
	answering(t, map[string]string{"/user/repos": `422 {"message":"name already exists on this account"}`})
	_, err := CreateRepo("gho_secret", NewRepo{Name: "taken"})
	if err == nil || err.Error() != "name already exists on this account" {
		t.Errorf("answered %v", err)
	}
	answering(t, map[string]string{"/user/repos": `422 {}`})
	if _, err := CreateRepo("gho_secret", NewRepo{Name: "taken"}); err == nil || !strings.Contains(err.Error(), "422") {
		t.Errorf("answered %v", err)
	}
}

// A GitHub that cannot be reached at all is the one failure that is neither ours nor theirs.
func TestSaysWhenGitHubCannotBeReached(t *testing.T) {
	t.Setenv("BROODMOTHER_GITHUB_CLIENT_ID", "Iv1.test")
	before := deviceCodeURL
	// A port nothing is listening on, which is what a machine with no network looks like from
	// here.
	deviceCodeURL = "http://127.0.0.1:1/device"
	t.Cleanup(func() { deviceCodeURL = before })
	if _, err := StartDevice(); err == nil || !strings.Contains(err.Error(), "could not reach GitHub") {
		t.Errorf("answered %v", err)
	}
}
