// Talking to GitHub: signing in without a secret, and the two questions a project asks once it
// has. Nothing here reads your profile, your organisations or anyone else's code.

package github

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
)

// The two ends of the device flow and the API itself. Vars rather than consts so a test can
// stand its own server in front of them; nothing else writes to them.
var (
	deviceCodeURL = "https://github.com/login/device/code"
	tokenURL      = "https://github.com/login/oauth/access_token"
	apiBase       = "https://api.github.com"
)

const (
	handshakeTimeout = 15 * time.Second
	apiTimeout       = 20 * time.Second
)

// scope: pushing to a repository is all this asked for until tasks could watch one. `repo`
// covers private ones, is what making one on your behalf needs, and carries the issues, pulls
// and checks a task's triggers read; `notifications` is the one thing outside a repository —
// what is addressed to you — and is asked for because a task can wait on it.
//
// A connection made before `notifications` was on this list keeps the permissions it was
// granted: the mention trigger says so and asks to be connected again rather than sitting there
// never firing.
const scope = "repo notifications"

func fail(format string, args ...any) error { return apperr.Githubf(format, args...) }

// ClientID is the app as GitHub knows it. There is no secret: the device flow exists because a
// program on someone's laptop cannot keep one, and its client id is as public as the app itself.
// It is read from the environment rather than baked in, so a build of this repo that is not ours
// is not signing in as us.
func ClientID() (string, error) {
	if id := strings.TrimSpace(os.Getenv("BROODMOTHER_GITHUB_CLIENT_ID")); id != "" {
		return id, nil
	}
	return "", fail("this build has no GitHub client id, so it cannot connect — set BROODMOTHER_GITHUB_CLIENT_ID")
}

func Configured() bool {
	return strings.TrimSpace(os.Getenv("BROODMOTHER_GITHUB_CLIENT_ID")) != ""
}

// held is a JSON object as it arrives: read by key, and forgiving of a key that is not there.
type held map[string]json.RawMessage

func (h held) text(key string) string {
	var value string
	if json.Unmarshal(h[key], &value) != nil {
		return ""
	}
	return value
}

func (h held) yes(key string) bool {
	var value bool
	return json.Unmarshal(h[key], &value) == nil && value
}

// number is `Number(json[key]) || fallback`: a value that reads as zero or as nothing at all
// falls back, and anything else is taken as it stands.
func (h held) number(key string, fallback float64) float64 {
	var value float64
	if json.Unmarshal(h[key], &value) == nil && value != 0 {
		return value
	}
	var said string
	if json.Unmarshal(h[key], &said) == nil {
		if parsed, err := strconv.ParseFloat(strings.TrimSpace(said), 64); err == nil && parsed != 0 {
			return parsed
		}
	}
	return fallback
}

func send(request *http.Request, timeout time.Duration) (*http.Response, []byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	response, err := http.DefaultClient.Do(request.WithContext(ctx))
	if err != nil {
		return nil, nil, fail("could not reach GitHub — check the network")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, nil, fail("could not reach GitHub — check the network")
	}
	return response, body, nil
}

// post is the handshake half, which is ordinary JSON to github.com rather than to the API.
func post(url string, body map[string]string) (held, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(encoded))
	if err != nil {
		return nil, fail("could not reach GitHub — check the network")
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/json")

	response, raw, err := send(request, handshakeTimeout)
	if err != nil {
		return nil, err
	}
	var answer held
	if json.Unmarshal(raw, &answer) != nil || answer == nil {
		return nil, fail("GitHub answered %d with nothing to read", response.StatusCode)
	}
	return answer, nil
}

// StartDevice is the first half of the device flow: GitHub hands back a short code and the page
// to type it into. Nothing is granted yet — what comes back is a question waiting to be answered
// in a browser, and the answer is collected by [Poll].
func StartDevice() (Device, error) {
	id, err := ClientID()
	if err != nil {
		return Device{}, err
	}
	answer, err := post(deviceCodeURL, map[string]string{"client_id": id, "scope": scope})
	if err != nil {
		return Device{}, err
	}
	code, userCode := answer.text("device_code"), answer.text("user_code")
	if code == "" || userCode == "" {
		if said := answer.text("error_description"); said != "" {
			return Device{}, fail("%s", said)
		}
		return Device{}, fail("GitHub refused to start")
	}
	uri := answer.text("verification_uri")
	if uri == "" {
		uri = "https://github.com/login/device"
	}
	// GitHub asks not to be polled faster than this, and answers `slow_down` when it is.
	return Device{
		Code:            code,
		UserCode:        userCode,
		VerificationURI: uri,
		Interval:        int(answer.number("interval", 5) * 1000),
	}, nil
}

// Answer is what one ask of the token endpoint said.
type Answer struct {
	// Pending: still waiting on the browser. Nothing is wrong; ask again after the interval.
	Pending bool   `json:"pending"`
	Token   string `json:"-"`
}

// Poll is the second half: one ask, one answer. Waiting is the caller's business — a poll loop on
// this side would be a request held open for as long as someone takes to find their password, and
// a window that closed halfway through would never be noticed.
func Poll(deviceCode string) (Answer, error) {
	id, err := ClientID()
	if err != nil {
		return Answer{}, err
	}
	answer, err := post(tokenURL, map[string]string{
		"client_id":   id,
		"device_code": deviceCode,
		"grant_type":  "urn:ietf:params:oauth:grant-type:device_code",
	})
	if err != nil {
		return Answer{}, err
	}
	if token := answer.text("access_token"); token != "" {
		return Answer{Pending: false, Token: token}, nil
	}
	switch answer.text("error") {
	case "authorization_pending", "slow_down":
		return Answer{Pending: true}, nil
	case "expired_token":
		return Answer{}, fail("that code expired — start again")
	case "access_denied":
		return Answer{}, fail("the request was declined in the browser")
	}
	if said := answer.text("error_description"); said != "" {
		return Answer{}, fail("%s", said)
	}
	return Answer{}, fail("GitHub refused the sign-in")
}

func api(token, path, method string, body any) ([]byte, error) {
	var carried io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		carried = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, apiBase+path, carried)
	if err != nil {
		return nil, fail("could not reach GitHub — check the network")
	}
	request.Header.Set("accept", "application/vnd.github+json")
	request.Header.Set("authorization", "Bearer "+token)
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-github-api-version", "2022-11-28")

	response, raw, err := send(request, apiTimeout)
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusUnauthorized {
		return nil, fail("GitHub no longer accepts this connection — connect again")
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		var answer held
		if json.Unmarshal(raw, &answer) == nil {
			if said := answer.text("message"); said != "" {
				return nil, fail("%s", said)
			}
		}
		return nil, fail("GitHub answered %d", response.StatusCode)
	}
	return raw, nil
}

// Login is who the token belongs to, which is the only thing about you this ever asks for.
func Login(token string) (string, error) {
	raw, err := api(token, "/user", http.MethodGet, nil)
	if err != nil {
		return "", err
	}
	var answer held
	if json.Unmarshal(raw, &answer) != nil {
		return "", fail("GitHub did not say who this connection is")
	}
	name := answer.text("login")
	if name == "" {
		return "", fail("GitHub did not say who this connection is")
	}
	return name, nil
}

func repoOf(source held) Repo {
	branch := source.text("default_branch")
	if branch == "" {
		branch = "main"
	}
	return Repo{
		FullName:      source.text("full_name"),
		CloneURL:      source.text("clone_url"),
		Private:       source.yes("private"),
		DefaultBranch: branch,
	}
}

// Repos is what you could push to, most recently touched first. Only repositories you can write
// to are worth offering: picking one you cannot push to is a failure saved up for the first sync
// rather than answered here.
func Repos(token string) ([]Repo, error) {
	raw, err := api(token,
		"/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
		http.MethodGet, nil)
	if err != nil {
		return nil, err
	}
	var answer []held
	if json.Unmarshal(raw, &answer) != nil {
		return []Repo{}, nil
	}
	found := []Repo{}
	for _, one := range answer {
		var permissions held
		if json.Unmarshal(one["permissions"], &permissions) != nil || !permissions.yes("push") {
			continue
		}
		if repo := repoOf(one); repo.CloneURL != "" {
			found = append(found, repo)
		}
	}
	return found, nil
}

// NewRepo is a repository to make. Private unless it is said otherwise.
type NewRepo struct {
	Name    string
	Private bool
}

// CreateRepo makes one here rather than in a browser, because a repository that has to exist
// first is the step this whole flow is for.
func CreateRepo(token string, input NewRepo) (Repo, error) {
	raw, err := api(token, "/user/repos", http.MethodPost, map[string]any{
		"name":    input.Name,
		"private": input.Private,
		// Nothing is written into it: broodmother pushes the project it just made, and a repo
		// with a commit already in it is a merge nobody asked for.
		"auto_init": false,
	})
	if err != nil {
		return Repo{}, err
	}
	var answer held
	if json.Unmarshal(raw, &answer) != nil {
		return Repo{}, fail("GitHub answered with nothing to read")
	}
	return repoOf(answer), nil
}
