// GitHub, as a task can see it: four things to watch and two things to do.
//
// The device flow and the repo picker are in `client.go`, and each asks one question; this asks
// the same question every few minutes for as long as the app is open, which is a different job
// and is why it is a service.
//
// Two properties come from that. Every read is conditional — the caller hands back the cursor it
// was given, this sends its ETag, and a 304 is an answer costing nothing against the hour's
// budget, which is what makes polling honest rather than rude. And the budget itself is the
// token's, not any one task's, so when GitHub says it is spent this holds every caller off until
// it is refilled instead of each trigger discovering it alone.
//
// Nothing here knows about tasks: a watch takes a cursor and answers with what fired and the
// cursor to save next time. Whose cursor it is, and how often to ask, is the trigger's.

package github

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Cursor is whatever the source hands out that says "seen up to here" — the same small JSON a
// trigger saves between checks.
type Cursor map[string]any

func (c Cursor) text(key string) string {
	value, _ := c[key].(string)
	return value
}

// Item is one thing that happened, in the only shape a step downstream needs it in.
type Item struct {
	Repo string
	// Number is the issue or pull number. Nil for a check, which is about a commit.
	Number *int
	Title  string
	URL    string
	Author string
	Body   string
	SHA    string
}

// Watch is what one look turned up, and where to look from next time.
type Watch struct {
	Items  []Item
	Cursor Cursor
}

// Reply is one answer from GitHub, before any of it is read. The one call the service makes, so a
// test can answer it without a network.
type Reply struct {
	Status  int
	Headers http.Header
	Body    []byte
}

type IO func(path string, method string, headers http.Header, body []byte) (Reply, error)

// addressed are the four reasons a notification is yours: something wants you, rather than
// something you once touched moving again.
var addressed = map[string]bool{
	"mention": true, "team_mention": true, "review_requested": true, "assign": true,
}

// blindWait is how long to sit out when GitHub gives no reset to wait for.
const blindWait = time.Minute

const perPage = 20

type Service struct {
	token string
	io    IO
	now   func() time.Time

	mutex sync.Mutex
	// waitUntil is when the budget is next worth asking about. Held here rather than per trigger:
	// it is the token that is spent, and every watch shares one.
	waitUntil time.Time
}

type ServiceOptions struct {
	IO  IO
	Now func() time.Time
}

func NewService(token string, options ServiceOptions) *Service {
	held := &Service{token: token, io: options.IO, now: options.Now}
	if held.io == nil {
		held.io = fetch
	}
	if held.now == nil {
		held.now = time.Now
	}
	return held
}

// Resting is whether the token is being rested — the tasks page's answer for "why so quiet".
func (s *Service) Resting() bool {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.now().Before(s.waitUntil)
}

func fetch(path, method string, headers http.Header, body []byte) (Reply, error) {
	var carried *bytes.Reader
	if body != nil {
		carried = bytes.NewReader(body)
	}
	var request *http.Request
	var err error
	if carried == nil {
		request, err = http.NewRequest(method, apiBase+path, nil)
	} else {
		request, err = http.NewRequest(method, apiBase+path, carried)
	}
	if err != nil {
		return Reply{}, fail("could not reach GitHub — check the network")
	}
	request.Header = headers
	response, raw, err := send(request, apiTimeout)
	if err != nil {
		return Reply{}, err
	}
	// A 304 carries no body at all, and reading one as JSON reads as a broken answer.
	if response.StatusCode == http.StatusNotModified {
		raw = nil
	}
	return Reply{Status: response.StatusCode, Headers: response.Header, Body: raw}, nil
}

// answer is what an ask came back as. Unchanged is the source not having moved since the cursor
// was made; waiting is the budget being spent, or GitHub asking to be left alone — nothing fired,
// ask later.
type answer struct {
	kind string
	body []byte
	etag string
}

const (
	answerOK        = "ok"
	answerUnchanged = "unchanged"
	answerWaiting   = "waiting"
)

func (s *Service) ask(path string, cursor Cursor, method string, body []byte) (answer, error) {
	if s.Resting() {
		return answer{kind: answerWaiting}, nil
	}
	headers := http.Header{}
	headers.Set("accept", "application/vnd.github+json")
	headers.Set("authorization", "Bearer "+s.token)
	headers.Set("content-type", "application/json")
	headers.Set("x-github-api-version", "2022-11-28")
	if etag := cursor.text("etag"); etag != "" && method == http.MethodGet {
		headers.Set("if-none-match", etag)
	}

	reply, err := s.io(path, method, headers, body)
	if err != nil {
		return answer{}, err
	}

	switch {
	case reply.Status == http.StatusNotModified:
		return answer{kind: answerUnchanged}, nil
	case reply.Status == http.StatusUnauthorized:
		return answer{}, fail("GitHub no longer accepts this connection — connect again")
	case reply.Status == http.StatusForbidden, reply.Status == http.StatusTooManyRequests:
		// Two different 403s wear the same code: the budget being spent, which is a matter of
		// waiting, and a permission this connection was never granted, which is not.
		if reply.Headers.Get("x-ratelimit-remaining") == "0" || reply.Status == http.StatusTooManyRequests {
			s.rest(reply.Headers)
			return answer{kind: answerWaiting}, nil
		}
		return answer{}, fail("%s", said(reply.Body, "GitHub refused this connection"))
	case reply.Status < 200 || reply.Status >= 300:
		return answer{}, fail("%s", said(reply.Body, "GitHub answered "+strconv.Itoa(reply.Status)))
	}
	return answer{kind: answerOK, body: reply.Body, etag: reply.Headers.Get("etag")}, nil
}

// said is what GitHub complained, or the sentence to use where it complained nothing readable.
func said(body []byte, fallback string) string {
	var answer held
	if json.Unmarshal(body, &answer) == nil {
		if message := answer.text("message"); message != "" {
			return message
		}
	}
	return fallback
}

// rest holds every watch off until the budget refills, as GitHub says — a second past it, so the
// next ask is inside the new window rather than on its edge. A header nobody sent buys a flat
// minute.
func (s *Service) rest(headers http.Header) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	now := s.now()
	if retry, err := strconv.ParseFloat(headers.Get("retry-after"), 64); err == nil && retry > 0 {
		s.waitUntil = now.Add(time.Duration(retry * float64(time.Second)))
		return
	}
	if reset, err := strconv.ParseFloat(headers.Get("x-ratelimit-reset"), 64); err == nil && reset > 0 {
		s.waitUntil = time.UnixMilli(int64(reset*1000) + 1000)
		return
	}
	s.waitUntil = now.Add(blindWait)
}

// Issues is an issue opened or updated. Updated rather than opened, because a task waiting on an
// issue is usually waiting on the conversation in it.
func (s *Service) Issues(repo, query string, cursor Cursor) (Watch, error) {
	return s.threads(repo, query, cursor, "issue")
}

// Pulls is a pull request opened or pushed to. `query` is where "review-requested:@me" goes.
func (s *Service) Pulls(repo, query string, cursor Cursor) (Watch, error) {
	return s.threads(repo, query, cursor, "pr")
}

func (s *Service) threads(repo, query string, cursor Cursor, kind string) (Watch, error) {
	since := cursor.text("since")
	held, err := s.ask(threadPath(repo, query, kind, since), cursor, http.MethodGet, nil)
	if err != nil {
		return Watch{}, err
	}
	if held.kind != answerOK {
		return unmoved(cursor), nil
	}

	// The search API wraps its answers; the repository routes hand back the list itself.
	raw := listOf(held.body)
	items := []Item{}
	newest := since
	for _, one := range raw {
		if kind == "pr" {
			if !isPull(one) && query == "" {
				continue
			}
		} else if isPull(one) {
			continue
		}
		at := one.text("updated_at")
		newest = later(newest, at)
		// The first check is the baseline — no cursor, nothing fires: what is already there is
		// not news, and a task switched on at noon should not answer a month of issues.
		if since != "" && at > since {
			items = append(items, threadItem(repo, one))
		}
	}
	return Watch{Items: items, Cursor: cursorOf(held.etag, "since", newest)}, nil
}

// Mentions is what is addressed to you, across everything you watch: a mention, a review asked
// for, an assignment. This is the one thing outside a repository, and the one thing a connection
// made before it was asked for cannot read — hence the sentence.
func (s *Service) Mentions(cursor Cursor) (Watch, error) {
	since := cursor.text("since")
	path := "/notifications?participating=true&per_page=" + strconv.Itoa(perPage)
	if since != "" {
		path += "&since=" + url.QueryEscape(since)
	}
	held, err := s.ask(path, cursor, http.MethodGet, nil)
	if err != nil {
		if scoped.MatchString(err.Error()) {
			return Watch{}, fail("this GitHub connection cannot read your notifications — connect GitHub again to allow it")
		}
		return Watch{}, err
	}
	if held.kind != answerOK {
		return unmoved(cursor), nil
	}

	items := []Item{}
	newest := since
	for _, one := range listOf(held.body) {
		at := one.text("updated_at")
		newest = later(newest, at)
		reason := one.text("reason")
		if !addressed[reason] {
			continue
		}
		// No baseline here, unlike the thread watches: a mention watch switched on answers what
		// is already addressed to you. That is what the implementation this is held to does, and
		// two daemons sharing one cursor file cannot disagree about it.
		if since != "" && at <= since {
			continue
		}
		subject := one.object("subject")
		where := one.object("repository").text("full_name")
		asked := subject.text("url")
		items = append(items, Item{
			Repo:   where,
			Number: numberIn(asked),
			Title:  subject.text("title"),
			URL:    webURL(asked),
			Author: reason,
			Body:   reason + " in " + where + ": " + subject.text("title"),
		})
	}
	return Watch{Items: items, Cursor: cursorOf(held.etag, "since", newest)}, nil
}

// scoped is the shape of the refusal a connection made before notifications were asked for gets.
var scoped = regexp.MustCompile(`(?i)scope|not accessible|permission`)

// Checks is whether a branch is green. One request for the combined state of its head, and a
// firing only where the answer has settled into something other than what was saved — a run in
// progress is not news, and the same red twice is the same red.
func (s *Service) Checks(repo, branch string, cursor Cursor) (Watch, error) {
	held, err := s.ask("/repos/"+repo+"/commits/"+url.PathEscape(branch)+"/status",
		cursor, http.MethodGet, nil)
	if err != nil {
		return Watch{}, err
	}
	if held.kind != answerOK {
		return unmoved(cursor), nil
	}

	body := objectOf(held.body)
	state, sha := body.text("state"), body.text("sha")
	known, seen := cursor.text("state"), cursor.text("sha")
	settled := state == "success" || state == "failure" || state == "error"
	moved := state != known || sha != seen

	items := []Item{}
	if settled && moved && known != "" {
		short := sha
		if len(short) > 7 {
			short = short[:7]
		}
		items = append(items, Item{
			Repo:   repo,
			Title:  "checks " + state + " on " + branch,
			URL:    "https://github.com/" + repo + "/commit/" + sha,
			Author: "github",
			Body:   "checks " + state + " on " + branch + " at " + short,
			SHA:    sha,
		})
	}
	next := Cursor{"sha": sha, "state": state}
	if held.etag != "" {
		next["etag"] = held.etag
	}
	return Watch{Items: items, Cursor: next}, nil
}

// DefaultBranch is what a pull request is opened against where nobody said: the repository's own
// answer to that question, rather than a guess at "main" that is wrong on the older ones.
func (s *Service) DefaultBranch(repo string) (string, error) {
	held, err := s.ask("/repos/"+repo, nil, http.MethodGet, nil)
	if err != nil {
		return "", err
	}
	if held.kind != answerOK {
		return "", fail("could not ask GitHub what %s branches from", repo)
	}
	if branch := objectOf(held.body).text("default_branch"); branch != "" {
		return branch, nil
	}
	return "main", nil
}

func (s *Service) Comment(repo string, issue int, body string) (string, error) {
	encoded, err := json.Marshal(map[string]string{"body": body})
	if err != nil {
		return "", err
	}
	held, err := s.ask("/repos/"+repo+"/issues/"+strconv.Itoa(issue)+"/comments",
		nil, http.MethodPost, encoded)
	if err != nil {
		return "", err
	}
	if held.kind != answerOK {
		return "", fail("GitHub is rate limiting this connection — nothing was posted")
	}
	return objectOf(held.body).text("html_url"), nil
}

// Pull is what to open, once every question about where has been answered.
type Pull struct {
	Base  string `json:"base"`
	Head  string `json:"head"`
	Title string `json:"title"`
	Body  string `json:"body"`
	Draft bool   `json:"draft,omitempty"`
}

func (s *Service) OpenPull(repo string, pull Pull) (string, error) {
	encoded, err := json.Marshal(pull)
	if err != nil {
		return "", err
	}
	held, err := s.ask("/repos/"+repo+"/pulls", nil, http.MethodPost, encoded)
	if err != nil {
		return "", err
	}
	if held.kind != answerOK {
		return "", fail("GitHub is rate limiting this connection — nothing was opened")
	}
	return objectOf(held.body).text("html_url"), nil
}

// unmoved is what a watch answers when it did not look: nothing fired, and the cursor it was
// given is the cursor to keep.
func unmoved(cursor Cursor) Watch {
	if cursor == nil {
		cursor = Cursor{}
	}
	return Watch{Items: []Item{}, Cursor: cursor}
}

func cursorOf(etag, key, value string) Cursor {
	cursor := Cursor{key: value}
	if etag != "" {
		cursor["etag"] = etag
	}
	return cursor
}

// later is the newest of two timestamps, as GitHub writes them — ISO, so a string compare is a
// time compare and no clock on this machine is involved.
func later(a, b string) string {
	if a > b {
		return a
	}
	return b
}

// threadPath is where to read from: the repository's own list where nothing was asked of it, and
// the search index where something was — search is what understands "review-requested:@me", and
// the plain route is what understands "since" without spending a search a minute.
func threadPath(repo, query, kind, since string) string {
	if query != "" {
		q := strings.TrimSpace("repo:" + repo + " is:" + kind + " " + query)
		return "/search/issues?q=" + url.QueryEscape(q) +
			"&sort=updated&order=desc&per_page=" + strconv.Itoa(perPage)
	}
	if kind == "pr" {
		return "/repos/" + repo + "/pulls?state=open&sort=updated&direction=desc&per_page=" +
			strconv.Itoa(perPage)
	}
	path := "/repos/" + repo + "/issues?state=all&sort=updated&direction=desc&per_page=" +
		strconv.Itoa(perPage)
	if since != "" {
		path += "&since=" + url.QueryEscape(since)
	}
	return path
}

// isPull tells the two apart: GitHub's issue list carries pull requests too, marked by one field.
func isPull(one held) bool {
	if _, found := one["pull_request"]; found {
		return true
	}
	return strings.Contains(one.text("html_url"), "/pull/")
}

func threadItem(repo string, one held) Item {
	where := one.object("base").object("repo").text("full_name")
	if where == "" {
		where = repo
	}
	return Item{
		Repo:   where,
		Number: one.count("number"),
		Title:  one.text("title"),
		URL:    one.text("html_url"),
		Author: one.object("user").text("login"),
		Body:   one.text("body"),
		SHA:    one.object("head").text("sha"),
	}
}

// numberIn is the number out of an API url — `/repos/o/n/issues/123`.
var issueNumber = regexp.MustCompile(`/(?:issues|pulls)/(\d+)$`)

func numberIn(at string) *int {
	match := issueNumber.FindStringSubmatch(at)
	if match == nil {
		return nil
	}
	number, err := strconv.Atoi(match[1])
	if err != nil {
		return nil
	}
	return &number
}

// webURL is the same thing a person can open: the API's own url is not a page.
var apiIssue = regexp.MustCompile(`/repos/([^/]+)/([^/]+)/(issues|pulls)/(\d+)$`)

func webURL(at string) string {
	match := apiIssue.FindStringSubmatch(at)
	if match == nil {
		return at
	}
	kind := match[3]
	if kind == "pulls" {
		kind = "pull"
	}
	return "https://github.com/" + match[1] + "/" + match[2] + "/" + kind + "/" + match[4]
}

// The readers a JSON answer is taken apart with. GitHub's shapes are wide and mostly not this
// daemon's business, so a field is read where it is wanted and a field that is missing, null or
// of the wrong type reads as nothing — which is what the implementation this is held to does.
func (h held) object(key string) held {
	var value held
	if json.Unmarshal(h[key], &value) != nil {
		return nil
	}
	return value
}

// count is a number as a JSON number, and nothing for anything else — a string that looks like
// one included, since the field it reads is an id rather than a setting.
func (h held) count(key string) *int {
	var value float64
	if json.Unmarshal(h[key], &value) != nil {
		return nil
	}
	number := int(value)
	return &number
}

func objectOf(raw []byte) held {
	var value held
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return value
}

// listOf is the answer as a list, whichever way it arrived: the search API wraps its answers in
// an object with `items`, and the repository routes hand back the list itself.
func listOf(raw []byte) []held {
	var list []held
	if json.Unmarshal(raw, &list) == nil {
		return list
	}
	return objectOf(raw).list("items")
}

func (h held) list(key string) []held {
	var value []held
	if json.Unmarshal(h[key], &value) != nil {
		return nil
	}
	return value
}
