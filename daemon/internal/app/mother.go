// What Mother has noticed, said and been told. The noticing itself is `motherwatch.go`.

package app

import (
	"context"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/mother"
)

// MotherStatus is the whole of what the page draws.
func (c *Context) MotherStatus() mother.Status {
	if c.Mother == nil {
		return mother.Status{Settings: mother.Settings{On: true}, Rules: []mother.RuleStatus{}, Items: []mother.Item{}}
	}
	return mother.Status{
		Settings: c.Mother.Settings(),
		Rules:    c.Mother.Rules(),
		Items:    c.Mother.Feed(),
		SweptAt:  c.Mother.SweptAt(),
	}
}

func (c *Context) MotherVerdict(suggestion string, verdict mother.Verdict) (mother.Suggestion, error) {
	if c.Mother == nil {
		return mother.Suggestion{}, apperr.NotFoundf("no suggestion %s", suggestion)
	}
	held, found := c.Mother.Verdict(suggestion, verdict)
	if !found {
		return mother.Suggestion{}, apperr.NotFoundf("no suggestion %s", suggestion)
	}
	return held, nil
}

// ConfigureMother writes what the request said and leaves alone what it did not — a settings
// write says what moved.
func (c *Context) ConfigureMother(on *bool, cfa *float64, rules map[string]bool) (mother.Settings, []mother.RuleStatus) {
	if c.Mother == nil {
		return mother.Settings{On: true}, []mother.RuleStatus{}
	}
	settings := c.Mother.Configure(on, cfa)
	for rule, enabled := range rules {
		c.Mother.Enable(rule, enabled)
	}
	return settings, c.Mother.Rules()
}

// Sweep is the periodic look, asked for by hand: one budgeted deliberation over the whole picture,
// whose expected answer is NOTHING.
func (c *Context) Sweep() int64 {
	if c.Watching == nil {
		at := time.Now().UnixMilli()
		if c.Mother != nil {
			c.Mother.Swept(at)
		}
		return at
	}
	return c.Watching.Sweep(context.Background())
}
