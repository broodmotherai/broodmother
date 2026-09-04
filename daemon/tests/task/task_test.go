package task_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/task"

	"reflect"
	"testing"
)

func TestATaskIsBornRunnableByHand(t *testing.T) {
	born := Empty()
	if len(born.Nodes) != 1 || born.Nodes[0].Kind != ManualTrigger {
		t.Fatalf("born as %+v", born.Nodes)
	}
	if RunOrder(born) == nil {
		t.Error("born with a cycle in it")
	}
}

func TestAnIDSaysWhatItIsAndWhichOne(t *testing.T) {
	for _, one := range []struct{ kind, want Kind }{
		{ClaudeAgent, "claude-1"},
		{IntervalTrigger, "interval-1"},
		// Three segments, and the last is the only one that says anything.
		{GithubCommentAgent, "comment-1"},
		{GithubPullTrigger, "pull-1"},
	} {
		if got := FreshID(Task{}, one.kind); got != string(one.want) {
			t.Errorf("FreshID(%q) = %q, want %q", one.kind, got, one.want)
		}
	}
	held := Task{Nodes: []Node{{ID: "claude-1"}, {ID: "claude-2"}}}
	if got := FreshID(held, ClaudeAgent); got != "claude-3" {
		t.Errorf("stepped over what was taken to %q", got)
	}
}

func TestRunsEverythingAfterWhateverFeedsIt(t *testing.T) {
	chain := Task{
		Version: 1,
		Nodes: []Node{
			{ID: "trigger", Kind: ManualTrigger},
			{ID: "a", Kind: NotifyAgent},
			{ID: "b", Kind: NotifyAgent},
			{ID: "join", Kind: NotifyAgent},
		},
		Edges: []Edge{{From: "trigger", To: "a"}, {From: "trigger", To: "b"}, {From: "a", To: "join"}, {From: "b", To: "join"}},
	}
	want := [][]string{{"trigger"}, {"a", "b"}, {"join"}}
	if got := RunOrder(chain); !reflect.DeepEqual(got, want) {
		t.Errorf("walked %v, want %v", got, want)
	}
}

// A cycle is the one graph there is no order for, and the answer is nothing rather than a
// partial walk that would run half the task and stop.
func TestRefusesAGraphThatComesBackOnItself(t *testing.T) {
	loop := Task{
		Version: 1,
		Nodes:   []Node{{ID: "a", Kind: NotifyAgent}, {ID: "b", Kind: NotifyAgent}},
		Edges:   []Edge{{From: "a", To: "b"}, {From: "b", To: "a"}},
	}
	if got := RunOrder(loop); got != nil {
		t.Errorf("walked a cycle as %v", got)
	}
}

func TestOnlyAWiredTriggerThatIsOnFires(t *testing.T) {
	wired := map[string]bool{"on": true, "off": true}
	for _, one := range []struct {
		node Node
		want bool
	}{
		{Node{ID: "on"}, true},
		{Node{ID: "off", Off: true}, false},
		{Node{ID: "loose"}, false},
	} {
		if got := Fires(one.node, wired); got != one.want {
			t.Errorf("Fires(%+v) = %v, want %v", one.node, got, one.want)
		}
	}
}

func TestATriggerReadsAsASentenceAndAnAgentDoesNot(t *testing.T) {
	minutes := func(value float64) *float64 { return &value }
	text := func(value string) *string { return &value }
	for _, one := range []struct {
		node Node
		want string
	}{
		{Node{Kind: ManualTrigger}, "triggered manually"},
		{Node{Kind: IntervalTrigger, Minutes: minutes(1)}, "every 1 minute"},
		{Node{Kind: IntervalTrigger, Minutes: minutes(30)}, "every 30 minutes"},
		{Node{Kind: TimeTrigger, At: "09:00"}, "at 09:00"},
		{Node{Kind: TimeTrigger, At: "09:00", Days: []Weekday{"mon", "fri"}}, "at 09:00 on mon, fri"},
		{Node{Kind: GithubIssueTrigger}, "when an issue changes in this repo"},
		{Node{Kind: GithubIssueTrigger, Repo: text("a/b"), Query: text("label:bug")},
			"when an issue changes in a/b matching label:bug"},
		{Node{Kind: GithubCheckTrigger}, "when checks change on this branch"},
		{Node{Kind: ClaudeAgent}, ""},
	} {
		if got := TriggerLabel(one.node); got != one.want {
			t.Errorf("TriggerLabel(%q) = %q, want %q", one.node.Kind, got, one.want)
		}
	}
}

func TestEveryKindIsNamedAndTheGithubOnesAreKnownByTheirMiddleName(t *testing.T) {
	for _, kind := range Kinds {
		if KindLabel[kind] == "" {
			t.Errorf("%q has no name in the menu", kind)
		}
	}
	if len(GithubKinds) != 6 {
		t.Errorf("found %d kinds that reach GitHub", len(GithubKinds))
	}
	for _, kind := range GithubKinds {
		if !IsGithub(kind) {
			t.Errorf("%q is not one of them", kind)
		}
	}
	if !IsGithubWatch(GithubIssueTrigger) || IsGithubWatch(GithubCommentAgent) {
		t.Error("a watch and a write are not told apart")
	}
}

// The seed is what the kind cannot open without: an interval with no minutes and a time with no
// hour are the two nodes the codec would refuse the moment they were saved.
func TestANodeArrivesWithTheFieldsItsKindCannotOpenWithout(t *testing.T) {
	interval := MakeNode(Task{}, IntervalTrigger, 9, 25)
	if interval.Minutes == nil || *interval.Minutes != 30 {
		t.Errorf("an interval arrived with %v", interval.Minutes)
	}
	if interval.X != 16 || interval.Y != 32 {
		t.Errorf("arrived off the grid at %v,%v", interval.X, interval.Y)
	}
	if at := MakeNode(Task{}, TimeTrigger, 0, 0).At; at != "09:00" {
		t.Errorf("a time arrived at %q", at)
	}
	if name := MakeNode(Task{}, ShellAgent, 0, 0).Name; name != KindLabel[ShellAgent] {
		t.Errorf("arrived named %q", name)
	}
}
