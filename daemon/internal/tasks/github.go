// The two things a task does on GitHub.
//
// Neither writes a word of its own: what the step before it wrote is the comment, or the pull
// request's description — a step whose text came from a field on the node would be a step that
// says the same thing every time, and the point of putting an agent in front of it is that it
// does not.
//
// Where to say it is answered in the order it is known: what the node was told, then what the run
// is about, then the checkout's own remote. Every one of those failing is a sentence, not a
// silence: an action that quietly did nothing is worse than one that stops.

package tasks

import (
	"regexp"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/github"
	"github.com/broodmotherai/broodmother/daemon/internal/task"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
)

func reachOf(ctx stepCtx) (*GithubReach, error) {
	reach := ctx.reaches.Github
	if reach == nil || reach.Service == nil {
		return nil, apperr.Taskf("no GitHub connection — connect GitHub in Settings first")
	}
	return reach, nil
}

// subjectOf is what the run is about, where that is something on GitHub. A subject another
// provider wrote is not this step's to act on, so it reads as nothing rather than as a repository.
func subjectOf(ctx stepCtx) *taskrun.Subject {
	about := readSubject(ctx.scratch)
	if about == nil || about.Provider != "github" {
		return nil
	}
	return about
}

func runGithubComment(node task.Node, ctx stepCtx) (stepResult, error) {
	reach, err := reachOf(ctx)
	if err != nil {
		return stepResult{}, err
	}
	about := subjectOf(ctx)
	where := given(node.Repo, "")
	if where == "" && about != nil {
		where = about.Repo
	}
	if where == "" {
		where = reach.Slug
	}
	if where == "" {
		return stepResult{}, apperr.Taskf(
			"nothing says which repository to comment in — name one on the node, or run this in a checkout with a GitHub remote")
	}
	issue := 0
	if node.Number != nil {
		issue = int(*node.Number)
	} else if about != nil && about.Number != nil {
		issue = *about.Number
	}
	if issue == 0 {
		return stepResult{}, apperr.Taskf(
			"nothing says which issue to comment on — name a number on the node, or feed this from a GitHub trigger")
	}
	body := strings.TrimSpace(ctx.input)
	if body == "" {
		return stepResult{}, apperr.Taskf("nothing to say: the step before this one wrote no output")
	}
	at, err := reach.Service.Comment(where, issue, body)
	if err != nil {
		return stepResult{}, err
	}
	return stepResult{output: at}, nil
}

func runGithubPull(node task.Node, ctx stepCtx) (stepResult, error) {
	reach, err := reachOf(ctx)
	if err != nil {
		return stepResult{}, err
	}
	where := given(node.Repo, reach.Slug)
	if where == "" {
		return stepResult{}, apperr.Taskf(
			"nothing says which repository to open a pull request in — name one on the node")
	}
	head := given(node.Head, reach.Branch)
	if head == "" {
		return stepResult{}, apperr.Taskf(
			"nothing says which branch to open the pull request from — name one on the node")
	}
	base := given(node.Base, "")
	if base == "" {
		if base, err = reach.Service.DefaultBranch(where); err != nil {
			return stepResult{}, err
		}
	}
	if base == head {
		return stepResult{}, apperr.Taskf(
			"%s is what it would be opened against, so there is nothing to open", head)
	}
	title, body := titled(node.Title, ctx.input)
	if title == "" {
		return stepResult{}, apperr.Taskf(
			"nothing to open it with: the step before this one wrote no output")
	}
	at, err := reach.Service.OpenPull(where, github.Pull{
		Base: base, Head: head, Title: title, Body: body, Draft: node.Draft != nil && *node.Draft,
	})
	if err != nil {
		return stepResult{}, err
	}
	return stepResult{output: at}, nil
}

// titled is the title and the description out of one piece of writing: the first line of what the
// step was handed, unless the node carries a title of its own — a commit message's shape, because
// it is the shape anybody writing for this already writes in.
func titled(node *string, input string) (title, body string) {
	text := strings.TrimSpace(input)
	if node != nil && *node != "" {
		return *node, text
	}
	first, rest, _ := strings.Cut(text, "\n")
	return strings.TrimSpace(heading.ReplaceAllString(first, "")), strings.TrimSpace(rest)
}

// heading is a markdown heading's marker, so a title written as one is a title rather than a line
// starting with a hash.
var heading = regexp.MustCompile(`^#+\s*`)
