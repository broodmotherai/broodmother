// Mother, wired: what she looks at, what she spends on it, and where what she learns goes.

package app

import (
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/brief"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/entities"
	"github.com/broodmotherai/broodmother/daemon/internal/entity"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon/internal/mother"
	"github.com/broodmotherai/broodmother/daemon/internal/relay"
)

// motherActor is the built-in actor Mother writes as. Not an agent row — she comes pre with
// broodmother, and a magic row in every project's store is a lie the first deleted row exposes.
var motherActor = ledger.Actor{Kind: ledger.AgentActor, ID: "mother", Name: "Mother"}

func (c *Context) startMother() {
	if c.Mother == nil {
		return
	}
	c.Watching = mother.NewWatch(mother.WatchDeps{
		Store: c.Mother,
		Sight: func() mother.Sight {
			held := mother.Sight{Activity: c.Activity.States()}
			if c.sync != nil {
				held.Sync = c.sync.State()
			}
			if c.Tasks != nil {
				held.Tasks = c.Tasks.Summaries()
				held.Runs = c.Tasks.Log()
			}
			// A list that will not read is a beat with nothing to say about the records rather
			// than a beat that does not happen.
			if c.Entities != nil {
				held.Entities, _ = c.Entities.List()
			}
			return held
		},
		Deliberate: mother.NewDeliberator(mother.DeliberateDeps{
			Cwd: func() string {
				if open, err := c.Root(doc.Project); err == nil {
					return open.Path
				}
				return c.Home
			},
			Persona: func() string { return c.persona("mother") },
			Brief:   func() string { return c.Brief(brief.Terminal) },
			Env:     c.agentEnv,
			Anchor: func(ref doc.Ref) string {
				open, err := c.Root(ref.Root)
				if err != nil {
					return ""
				}
				body, err := open.Tree.Read(string(ref.Path))
				if err != nil {
					return ""
				}
				return body
			},
		}),
		Record:   c.recordFinding,
		Surfaced: func(one mother.Suggestion) { c.Broadcast(relay.Suggested(one)) },
	})
	c.Watching.Start()
}

// recordFinding writes what a deliberation learned down as a record. The entities store answers
// "already written" instead of forking, and that answer is what tells Mother to stay quiet.
func (c *Context) recordFinding(finding mother.Finding, ref *doc.Ref) (string, bool, error) {
	if c.Entities == nil {
		return "", false, apperr.Chatf("there is nowhere to write a record")
	}
	from := []entity.From{}
	if ref != nil && ref.Root == doc.Project {
		from = append(from, entity.From{
			Relation: entity.DerivesFrom,
			Target:   strings.TrimSuffix(string(ref.Path), ".md"),
		})
	}
	held, created, err := c.Entities.Record(entities.New{
		Kind:   entity.Finding,
		Name:   finding.Name,
		Fields: map[string]string{"claim": finding.Claim, "evidence": finding.Evidence},
		From:   from,
		Origin: len(from) == 0,
		By:     "agent/mother",
	}, motherActor)
	if err != nil {
		return "", false, err
	}
	return string(held.Path), created, nil
}
