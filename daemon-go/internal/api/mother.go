// What Mother has noticed, said and been told.
//
// The noticing is the watch's: it beats on its own, and these are how the page reads what it has
// found, answers a suggestion, moves the slider, and asks for a sweep by hand.

package api

import (
	"encoding/json"
	"math"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/mother"
)

var motherTable = Table{
	"GET /api/mother": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return ctx.MotherStatus(), nil
	},

	"POST /api/mother/verdict": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, motherVerdictBody)
		if err != nil {
			return nil, err
		}
		held, err := ctx.MotherVerdict(input.Suggestion, input.Verdict)
		if err != nil {
			return nil, err
		}
		return map[string]any{"suggestion": held}, nil
	},

	/* The knobs the Mother page turns: the off switch, PRISM's C_FA worn as the frequency
	   slider, and the per-rule switches. All optional — a settings write says what moved. */
	"PUT /api/mother/settings": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, motherSettingsBody)
		if err != nil {
			return nil, err
		}
		settings, rules := ctx.ConfigureMother(input.On, input.CFA, input.Rules)
		// A struct rather than a map: encoding/json sorts a map's keys, and the rules would come
		// out ahead of the settings they hang off.
		return configured{Settings: settings, Rules: rules}, nil
	},

	"POST /api/mother/sweep": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"sweptAt": ctx.Sweep()}, nil
	},
}

// configured is the settings as they now stand, and every rule with them.
type configured struct {
	Settings mother.Settings     `json:"settings"`
	Rules    []mother.RuleStatus `json:"rules"`
}

type motherVerdict struct {
	Suggestion string
	Verdict    mother.Verdict
}

func motherVerdictBody(raw json.RawMessage) (motherVerdict, error) {
	var body struct {
		Suggestion string `json:"suggestion"`
		Verdict    string `json:"verdict"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Suggestion == "" {
		return motherVerdict{}, apperr.BadRequestf("body must name the suggestion and the verdict")
	}
	held := mother.Verdict(body.Verdict)
	if !held.Valid() {
		return motherVerdict{}, apperr.BadRequestf(
			`a verdict is "accepted", "dismissed" or "expired"`)
	}
	return motherVerdict{Suggestion: body.Suggestion, Verdict: held}, nil
}

type motherSettings struct {
	On    *bool
	CFA   *float64
	Rules map[string]bool
}

func motherSettingsBody(raw json.RawMessage) (motherSettings, error) {
	var body struct {
		On    *bool           `json:"on"`
		CFA   *float64        `json:"cfa"`
		Rules map[string]bool `json:"rules"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return motherSettings{}, apperr.BadRequestf("body must be the settings that moved")
	}
	// The slider has ends: a cost of nothing would say everything and a cost past ten is the same
	// as off, said less clearly.
	if body.CFA != nil {
		if math.IsNaN(*body.CFA) || *body.CFA <= 0 || *body.CFA > 10 {
			return motherSettings{}, apperr.BadRequestf("cfa is more than zero and at most ten")
		}
	}
	return motherSettings{On: body.On, CFA: body.CFA, Rules: body.Rules}, nil
}
