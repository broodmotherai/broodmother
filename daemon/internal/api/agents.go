// The people-shaped agents under the chats: who there is, and the chart they stand on.
//
// How one answers is a turn on the chat socket, beside this. These eight are
// who they are.

package api

import (
	"encoding/json"
	"math"
	"net/http"
	"regexp"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/chat"
	"github.com/broodmotherai/broodmother/daemon/internal/jstext"
)

var agentsTable = Table{
	"GET /api/agents": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"agents": ctx.ListAgents()}, nil
	},

	/* The chart: everyone, with who they report to and where they stand. */
	"GET /api/agents/org": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"agents": ctx.Org()}, nil
	},

	"POST /api/agents": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, newAgentBody)
		if err != nil {
			return nil, err
		}
		made, err := ctx.AddAgent(input)
		if err != nil {
			return nil, err
		}
		return map[string]any{"agent": made}, nil
	},

	/* The agent and their conversation go together; the attachments folder stays, since what
	   they made is yours. */
	"DELETE /api/agent": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		id, err := query(r, "agent")
		if err != nil {
			return nil, err
		}
		if err := ctx.RemoveAgent(id); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	},

	"POST /api/agent/clear": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		id, err := parse(r, named("agent"))
		if err != nil {
			return nil, err
		}
		if err := ctx.ClearAgent(id); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	},

	"POST /api/agent/model": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, agentModelBody)
		if err != nil {
			return nil, err
		}
		saved, err := ctx.SetAgentModel(input.Agent, input.Model)
		if err != nil {
			return nil, err
		}
		return map[string]any{"agent": saved}, nil
	},

	/* Who reports to whom. Null is nobody, which is how a line is dragged off. Whether the pair
	   makes a loop is the chart's to say. */
	"POST /api/agent/lead": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, agentLeadBody)
		if err != nil {
			return nil, err
		}
		if err := ctx.SetLead(input.Agent, input.Lead); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	},

	"POST /api/agent/place": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, agentPlaceBody)
		if err != nil {
			return nil, err
		}
		if err := ctx.PlaceAgent(input.Agent, input.X, input.Y); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	},
}

// nameMax is how long an agent's name may be, counted the way the browser counts it.
const nameMax = 60

var colorHex = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func newAgentBody(raw json.RawMessage) (chat.NewAgent, error) {
	var body struct {
		Name    string `json:"name"`
		Persona string `json:"persona"`
		Model   string `json:"model"`
		Color   string `json:"color"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return chat.NewAgent{}, apperr.BadRequestf("body must be an agent")
	}
	name := jstext.Trim(body.Name)
	if name == "" || jstext.Length(name) > nameMax {
		return chat.NewAgent{}, apperr.BadRequestf("an agent's name is one to %d characters", nameMax)
	}
	if body.Persona == "" {
		return chat.NewAgent{}, apperr.BadRequestf("an agent wears a persona the project carries")
	}
	if chat.ProviderOf(body.Model) == "" {
		return chat.NewAgent{}, apperr.BadRequestf("%q is not a model this daemon serves", body.Model)
	}
	if !colorHex.MatchString(body.Color) {
		return chat.NewAgent{}, apperr.BadRequestf("color must be #rrggbb")
	}
	return chat.NewAgent{Name: name, Persona: body.Persona, Model: body.Model, Color: body.Color}, nil
}

type agentModel struct {
	Agent string `json:"agent"`
	Model string `json:"model"`
}

func agentModelBody(raw json.RawMessage) (agentModel, error) {
	var body agentModel
	if json.Unmarshal(raw, &body) != nil || body.Agent == "" {
		return agentModel{}, apperr.BadRequestf("body must name the agent and the model")
	}
	if chat.ProviderOf(body.Model) == "" {
		return agentModel{}, apperr.BadRequestf("%q is not a model this daemon serves", body.Model)
	}
	return body, nil
}

type agentLead struct {
	Agent string
	// Lead is nil for nobody, which is how a line is dragged off.
	Lead *string
}

func agentLeadBody(raw json.RawMessage) (agentLead, error) {
	var body struct {
		Agent string  `json:"agent"`
		Lead  *string `json:"lead"`
	}
	// The key has to be there — an absent one is a body that forgot to say, and saying nobody is
	// what null is for.
	var held map[string]json.RawMessage
	if json.Unmarshal(raw, &held) != nil || json.Unmarshal(raw, &body) != nil || body.Agent == "" {
		return agentLead{}, apperr.BadRequestf("body must name the agent and who they report to")
	}
	if _, said := held["lead"]; !said {
		return agentLead{}, apperr.BadRequestf("body must name the agent and who they report to")
	}
	if body.Lead != nil && *body.Lead == "" {
		return agentLead{}, apperr.BadRequestf("a lead is an agent, or null for nobody")
	}
	return agentLead{Agent: body.Agent, Lead: body.Lead}, nil
}

// agentPlace is where a drag put somebody.
type agentPlace struct {
	Agent string
	X, Y  float64
}

func agentPlaceBody(raw json.RawMessage) (agentPlace, error) {
	var body struct {
		Agent string   `json:"agent"`
		X     *float64 `json:"x"`
		Y     *float64 `json:"y"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Agent == "" || body.X == nil || body.Y == nil {
		return agentPlace{}, apperr.BadRequestf("body must name the agent and where they stand")
	}
	for _, one := range []float64{*body.X, *body.Y} {
		if math.IsInf(one, 0) || math.IsNaN(one) {
			return agentPlace{}, apperr.BadRequestf("a place is two numbers")
		}
	}
	return agentPlace{Agent: body.Agent, X: *body.X, Y: *body.Y}, nil
}
