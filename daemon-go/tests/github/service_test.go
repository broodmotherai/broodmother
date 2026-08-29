// GitHub as a watch sees it: the conditional read, the shared budget, and what each of the four
// watches counts as news.

package github_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/github"

	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// asked is one request the service made, and the answer a test wrote for it.
type asked struct {
	path    string
	method  string
	headers http.Header
	body    string
}

// fake is GitHub, as a test can answer it: a queue of replies, and a record of what was asked.
type fake struct {
	replies []Reply
	seen    []asked
	now     time.Time
}

func (f *fake) io(path, method string, headers http.Header, body []byte) (Reply, error) {
	f.seen = append(f.seen, asked{path: path, method: method, headers: headers, body: string(body)})
	if len(f.replies) == 0 {
		return Reply{Status: 200, Headers: http.Header{}, Body: []byte("[]")}, nil
	}
	reply := f.replies[0]
	f.replies = f.replies[1:]
	if reply.Headers == nil {
		reply.Headers = http.Header{}
	}
	return reply, nil
}

func standing(t *testing.T, replies ...Reply) (*Service, *fake) {
	t.Helper()
	held := &fake{replies: replies, now: time.Date(2026, 8, 28, 9, 0, 0, 0, time.UTC)}
	return NewService("t0ken", ServiceOptions{
		IO:  held.io,
		Now: func() time.Time { return held.now },
	}), held
}

func ok(headers http.Header, body any) Reply {
	encoded, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	if headers == nil {
		headers = http.Header{}
	}
	return Reply{Status: 200, Headers: headers, Body: encoded}
}

func headers(pairs ...string) http.Header {
	held := http.Header{}
	for at := 0; at+1 < len(pairs); at += 2 {
		held.Set(pairs[at], pairs[at+1])
	}
	return held
}

func issue(number int, title, at string) map[string]any {
	return map[string]any{
		"number": number, "title": title, "updated_at": at, "body": "the body",
		"html_url": "https://github.com/a/b/issues/" + strconv.Itoa(number),
		"user":     map[string]any{"login": "someone"},
	}
}

// since is where a cursor stands, read the way the trigger store reads one — a cursor is whatever
// JSON the source handed back, and nothing here knows more about it than that.
func since(cursor Cursor) string {
	value, _ := cursor["since"].(string)
	return value
}

// The first look is the baseline: what is already there is not news, and a task switched on at
// noon should not answer a month of issues.
func TestTheFirstLookAtIssuesFiresNothing(t *testing.T) {
	service, _ := standing(t, ok(nil, []any{issue(1, "one", "2026-08-01T00:00:00Z")}))

	watch, err := service.Issues("a/b", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(watch.Items) != 0 {
		t.Fatalf("fired on the baseline: %+v", watch.Items)
	}
	if since(watch.Cursor) != "2026-08-01T00:00:00Z" {
		t.Errorf("kept %v", watch.Cursor)
	}
}

// Only what moved past the cursor is news, and the cursor moves to the newest either way.
func TestOnlyIssuesNewerThanTheCursorFire(t *testing.T) {
	service, _ := standing(t, ok(nil, []any{
		issue(2, "new", "2026-08-05T00:00:00Z"),
		issue(1, "old", "2026-08-01T00:00:00Z"),
	}))

	watch, err := service.Issues("a/b", "", Cursor{"since": "2026-08-03T00:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	if len(watch.Items) != 1 || watch.Items[0].Title != "new" {
		t.Fatalf("fired %+v", watch.Items)
	}
	if since(watch.Cursor) != "2026-08-05T00:00:00Z" {
		t.Errorf("cursor stood at %v", watch.Cursor)
	}
}

// GitHub's issue list carries pull requests too, and an issue watch is not a pull watch.
func TestAnIssueWatchLeavesPullRequestsAlone(t *testing.T) {
	pull := issue(2, "a pull", "2026-08-05T00:00:00Z")
	pull["pull_request"] = map[string]any{"url": "https://api.github.com/repos/a/b/pulls/2"}
	service, _ := standing(t, ok(nil, []any{pull, issue(3, "an issue", "2026-08-04T00:00:00Z")}))

	watch, err := service.Issues("a/b", "", Cursor{"since": "2026-08-01T00:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	if len(watch.Items) != 1 || watch.Items[0].Title != "an issue" {
		t.Errorf("fired %+v", watch.Items)
	}
}

// A query goes to the search index, which is what understands "review-requested:@me"; without one
// the plain repository route is asked, which understands "since" without spending a search.
func TestAQueryGoesToSearchAndNothingElseDoes(t *testing.T) {
	service, held := standing(t,
		ok(nil, map[string]any{"items": []any{}}),
		ok(nil, []any{}),
	)
	if _, err := service.Pulls("a/b", "review-requested:@me", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Pulls("a/b", "", nil); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(held.seen[0].path, "/search/issues?q=") {
		t.Errorf("a query asked %s", held.seen[0].path)
	}
	if !strings.Contains(held.seen[0].path, "is%3Apr") {
		t.Errorf("the search did not say what kind: %s", held.seen[0].path)
	}
	if !strings.HasPrefix(held.seen[1].path, "/repos/a/b/pulls?") {
		t.Errorf("no query asked %s", held.seen[1].path)
	}
}

// The cursor's ETag rides on the next read, and what comes back unchanged costs nothing and
// fires nothing.
func TestAnUnchangedSourceIsAskedConditionallyAndFiresNothing(t *testing.T) {
	service, held := standing(t, Reply{Status: 304, Headers: http.Header{}})

	before := Cursor{"since": "2026-08-01T00:00:00Z", "etag": `W/"abc"`}
	watch, err := service.Issues("a/b", "", before)
	if err != nil {
		t.Fatal(err)
	}
	if got := held.seen[0].headers.Get("if-none-match"); got != `W/"abc"` {
		t.Errorf("asked with %q", got)
	}
	if len(watch.Items) != 0 {
		t.Fatalf("fired on a 304: %+v", watch.Items)
	}
	if since(watch.Cursor) != "2026-08-01T00:00:00Z" {
		t.Errorf("a 304 moved the cursor to %v", watch.Cursor)
	}
}

// The budget is the token's, so one watch finding it spent holds every other watch off too —
// rather than each of them discovering it alone, which is what spends the rest of it.
func TestASpentBudgetRestsEveryWatch(t *testing.T) {
	spent := Reply{
		Status:  403,
		Headers: headers("x-ratelimit-remaining", "0", "retry-after", "120"),
	}
	service, held := standing(t, spent)

	if _, err := service.Issues("a/b", "", nil); err != nil {
		t.Fatal(err)
	}
	if !service.Resting() {
		t.Fatal("did not rest after a spent budget")
	}
	if _, err := service.Pulls("a/b", "", nil); err != nil {
		t.Fatal(err)
	}
	if len(held.seen) != 1 {
		t.Errorf("asked GitHub %d times while resting", len(held.seen))
	}

	held.now = held.now.Add(3 * time.Minute)
	if service.Resting() {
		t.Error("still resting past the retry-after")
	}
}

// A 403 that is a permission rather than a budget is a fault, not a wait: nothing to sit out.
func TestARefusalThatIsNotABudgetIsAnError(t *testing.T) {
	service, _ := standing(t, Reply{
		Status:  403,
		Headers: headers("x-ratelimit-remaining", "57"),
		Body:    []byte(`{"message":"Resource not accessible by personal access token"}`),
	})

	_, err := service.Issues("a/b", "", nil)
	if err == nil {
		t.Fatal("rested on a permission it was never granted")
	}
	if !strings.Contains(err.Error(), "not accessible") {
		t.Errorf("said %q", err)
	}
	if service.Resting() {
		t.Error("rested on a permission refusal")
	}
}

// A connection made before notifications were asked for says so, rather than sitting there
// never firing.
func TestAMentionWatchWithoutTheScopeSaysSo(t *testing.T) {
	service, _ := standing(t, Reply{
		Status:  403,
		Headers: headers("x-ratelimit-remaining", "57"),
		Body:    []byte(`{"message":"Missing the notifications scope"}`),
	})

	_, err := service.Mentions(nil)
	if err == nil || !strings.Contains(err.Error(), "connect GitHub again") {
		t.Errorf("said %v", err)
	}
}

// Only what is addressed to you: a mention, a review asked for, an assignment. Something you
// once touched moving again is not.
func TestMentionsKeepOnlyWhatIsAddressedToYou(t *testing.T) {
	service, _ := standing(t, ok(nil, []any{
		notification("mention", "2026-08-05T00:00:00Z", 12),
		notification("subscribed", "2026-08-06T00:00:00Z", 13),
	}))

	watch, err := service.Mentions(Cursor{"since": "2026-08-01T00:00:00Z"})
	if err != nil {
		t.Fatal(err)
	}
	if len(watch.Items) != 1 {
		t.Fatalf("fired %+v", watch.Items)
	}
	one := watch.Items[0]
	// The API's own url is not a page: what fires is the thing a person can open.
	if one.URL != "https://github.com/a/b/issues/12" {
		t.Errorf("url is %s", one.URL)
	}
	if one.Number == nil || *one.Number != 12 {
		t.Errorf("number is %v", one.Number)
	}
	// The cursor moves past everything the look saw, addressed or not — the next read asks
	// GitHub for what is newer than this, so a cursor left behind re-reads what was ignored.
	if since(watch.Cursor) != "2026-08-06T00:00:00Z" {
		t.Errorf("cursor stood at %v", watch.Cursor)
	}
}

func notification(reason, at string, number int) map[string]any {
	return map[string]any{
		"reason": reason, "updated_at": at,
		"repository": map[string]any{"full_name": "a/b"},
		"subject": map[string]any{
			"title": "something",
			"url":   "https://api.github.com/repos/a/b/issues/" + strconv.Itoa(number),
		},
	}
}

// Checks fire when the answer settles into something other than what was saved. A run still going
// is not news, and the same red twice is the same red.
func TestChecksFireOnlyWhenTheAnswerSettlesSomewhereNew(t *testing.T) {
	green := map[string]any{"state": "success", "sha": "abcdef1234"}
	running := map[string]any{"state": "pending", "sha": "abcdef1234"}
	service, _ := standing(t, ok(nil, running), ok(nil, green), ok(nil, green))

	// A first look with a cursor that has never settled fires nothing.
	first, err := service.Checks("a/b", "main", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 0 {
		t.Fatalf("fired on the baseline: %+v", first.Items)
	}

	second, err := service.Checks("a/b", "main", first.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 1 || second.Items[0].SHA != "abcdef1234" {
		t.Fatalf("fired %+v", second.Items)
	}
	if !strings.Contains(second.Items[0].Body, "abcdef1") {
		t.Errorf("said %q", second.Items[0].Body)
	}

	third, err := service.Checks("a/b", "main", second.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(third.Items) != 0 {
		t.Errorf("the same green fired twice: %+v", third.Items)
	}
}

// The two things a task does are POSTs, and a POST is never conditional: an ETag on one would
// ask GitHub to skip the very thing it was called to do.
func TestPostingCarriesTheBodyAndNoETag(t *testing.T) {
	service, held := standing(t, ok(nil, map[string]any{
		"html_url": "https://github.com/a/b/issues/3#issuecomment-1",
	}))

	at, err := service.Comment("a/b", 3, "well said")
	if err != nil {
		t.Fatal(err)
	}
	if at != "https://github.com/a/b/issues/3#issuecomment-1" {
		t.Errorf("answered %q", at)
	}
	one := held.seen[0]
	if one.method != http.MethodPost || one.path != "/repos/a/b/issues/3/comments" {
		t.Errorf("asked %s %s", one.method, one.path)
	}
	if one.headers.Get("if-none-match") != "" {
		t.Error("a POST went out conditional")
	}
	if !strings.Contains(one.body, "well said") {
		t.Errorf("posted %q", one.body)
	}
}

// A pull request that is not a draft says nothing about being one, rather than saying false.
func TestOpeningAPullSendsOnlyWhatWasAsked(t *testing.T) {
	service, held := standing(t, ok(nil, map[string]any{"html_url": "https://github.com/a/b/pull/9"}))

	if _, err := service.OpenPull("a/b", Pull{
		Base: "main", Head: "work", Title: "Do it", Body: "because",
	}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(held.seen[0].body, "draft") {
		t.Errorf("posted %q", held.seen[0].body)
	}
}

// A repository is asked what it branches from rather than guessed at: "main" is wrong on the
// older ones.
func TestTheDefaultBranchIsAskedFor(t *testing.T) {
	service, held := standing(t, ok(nil, map[string]any{"default_branch": "trunk"}))

	branch, err := service.DefaultBranch("a/b")
	if err != nil {
		t.Fatal(err)
	}
	if branch != "trunk" {
		t.Errorf("branches from %q", branch)
	}
	if held.seen[0].path != "/repos/a/b" {
		t.Errorf("asked %s", held.seen[0].path)
	}
}

// A token GitHub no longer takes is a thing to fix, not a thing to wait out.
func TestARevokedTokenSaysToConnectAgain(t *testing.T) {
	service, _ := standing(t, Reply{Status: 401, Headers: http.Header{}})

	_, err := service.Issues("a/b", "", nil)
	if err == nil || !strings.Contains(err.Error(), "connect again") {
		t.Errorf("said %v", err)
	}
}
