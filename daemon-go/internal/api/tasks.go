// What the open checkouts hold that something runs or draws: the tasks, what they have done, the
// diagrams, and the two folders a checkout carries for the agents it opens.
//
// The two GitHub steps are the one thing a run here cannot do. A task holding one is refused at
// that step rather than half-walked: the walk stops with the reason, and what never ran is skipped.

package api

import (
	"encoding/json"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/diagrams"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/personas"
	"github.com/broodmotherai/broodmother/daemon-go/internal/skills"
)

var tasksTable = Table{
	"POST /api/task/run": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, runTaskBody)
		if err != nil {
			return nil, err
		}
		run, err := ctx.Tasks.Run(input.Ref, input.Input, input.Said)
		if err != nil {
			return nil, err
		}
		return map[string]any{"run": run}, nil
	},

	"POST /api/task/stop": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		ref, err := parse(r, taskRefBody)
		if err != nil {
			return nil, err
		}
		run, err := ctx.Tasks.StopRun(ref)
		if err != nil {
			return nil, err
		}
		return map[string]any{"run": run}, nil
	},

	/* The other half of `agent.approve`: the run standing at a held step is told which way, and
	   walks on from there. */
	"POST /api/task/approve": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, approveTaskBody)
		if err != nil {
			return nil, err
		}
		run, err := ctx.Tasks.Settle(input.Ref, input.Approved, input.Note, input.Run)
		if err != nil {
			return nil, err
		}
		return map[string]any{"run": run}, nil
	},

	"GET /api/tasks": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"tasks": ctx.Tasks.Summaries()}, nil
	},

	"GET /api/task/runs": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		root, err := rootOf(r)
		if err != nil {
			return nil, err
		}
		path, err := query(r, "path")
		if err != nil {
			return nil, err
		}
		return map[string]any{"runs": ctx.Tasks.RunsFor(doc.Ref{Root: root, Path: doc.Path(path)})}, nil
	},

	"GET /api/task/log": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"runs": ctx.Tasks.Log()}, nil
	},

	/* What the open checkout carries for the agents it opens. The project's rather than the
	   scope's: a repo is somebody else's source, and what it keeps in a folder of that name is
	   not this project's to run. */
	"GET /api/skills": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		open, err := ctx.Root(doc.Project)
		if err != nil {
			return map[string]any{"skills": []skills.Skill{}}, nil
		}
		return map[string]any{"skills": open.Skills()}, nil
	},

	"GET /api/personas": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		open, err := ctx.Root(doc.Project)
		if err != nil {
			return map[string]any{"personas": []personas.Persona{}}, nil
		}
		return map[string]any{"personas": open.Personas()}, nil
	},

	/* Every diagram in the open checkouts. A canvas has no runner, so this is all it has: what
	   has been drawn, and what a broken one is broken by. */
	"GET /api/diagrams": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"diagrams": diagrams.Scan(ctx.Sites())}, nil
	},
}

// taskRefBody is which task, which is how most of these are addressed.
func taskRefBody(raw json.RawMessage) (doc.Ref, error) {
	var body struct {
		Root doc.Root `json:"root"`
		Path string   `json:"path"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Root == "" || body.Path == "" {
		return doc.Ref{}, apperr.BadRequestf("body must name a root and a path")
	}
	return doc.Ref{Root: body.Root, Path: doc.Path(body.Path)}, nil
}

type runTask struct {
	Ref doc.Ref
	// Input is what was typed alongside, which opens the run as though a trigger had seen it.
	// Said tells an empty one from none at all.
	Input string
	Said  bool
}

func runTaskBody(raw json.RawMessage) (runTask, error) {
	ref, err := taskRefBody(raw)
	if err != nil {
		return runTask{}, err
	}
	var body struct {
		Input *string `json:"input"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return runTask{}, apperr.BadRequestf("input must be text")
	}
	held := runTask{Ref: ref}
	if body.Input != nil {
		held.Input, held.Said = *body.Input, true
	}
	return held, nil
}

type approveTask struct {
	Ref      doc.Ref
	Approved bool
	Note     string
	// Run is which one, where the page knows — a task can have more than one standing at a
	// question. Unset answers the one that has waited longest.
	Run string
}

func approveTaskBody(raw json.RawMessage) (approveTask, error) {
	ref, err := taskRefBody(raw)
	if err != nil {
		return approveTask{}, err
	}
	var body struct {
		Approved *bool  `json:"approved"`
		Note     string `json:"note"`
		Run      string `json:"run"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Approved == nil {
		return approveTask{}, apperr.BadRequestf("body must say whether it is approved")
	}
	return approveTask{Ref: ref, Approved: *body.Approved, Note: body.Note, Run: body.Run}, nil
}
