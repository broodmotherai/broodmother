// How an agent answers: the app brief in the agent's room, then who they are and how they talk,
// with hands that know whose they are.
//
// Built each turn, since the persona on disk and the checkout under the hands both move while a
// conversation stays open.

package app

import (
	"path/filepath"

	"github.com/broodmotherai/broodmother/daemon-go/internal/brief"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chat"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chats"
	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/errand"
	"github.com/broodmotherai/broodmother/daemon-go/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tools"
)

func (c *Context) agentTurn(agent chat.Agent, note func(call, text string)) (chats.Turn, error) {
	body := c.persona(agent.Persona)
	attachments := agent.Attachments
	if open, err := c.Root(doc.Project); err == nil {
		attachments = filepath.Join(open.Path, agent.Attachments)
	}

	voice := brief.Voice{
		Name:           agent.Name,
		Persona:        agent.Persona,
		PersonaBody:    body,
		Profile:        c.profileName(),
		AttachmentsAbs: attachments,
		Attachments:    agent.Attachments,
		Team:           c.team(agent),
	}
	by := ledger.Actor{
		Kind: ledger.AgentActor, ID: agent.ID, Name: agent.Name,
		Persona: agent.Persona, Model: agent.Model, Context: agent.Chat,
	}
	return chats.Turn{
		System: brief.Agent(c.Brief(brief.AgentIn), voice),
		Tools: tools.Agent(tools.AgentDeps{
			Deps:     c.toolDeps(by, "agent/"+agent.Name),
			Checkout: c.Here,
			Env:      c.agentEnv,
			// The terminal brief for the hands: they have a shell.
			Brief:       func() string { return c.Brief(brief.Terminal) },
			Persona:     body,
			Name:        agent.Name,
			Attachments: attachments,
			Progress:    note,
			Message: func(to, message string) string {
				return c.sendBetweenAgents(agent, to, message)
			},
			// The hands work on the real disk rather than through the door, so what they changed
			// is filed here instead: the checkout they ran in is the scoped one, and the errand is
			// the finest grain there is.
			NoteErrand: func(paths []doc.Path, said string) {
				scope := c.Scope()
				for _, changed := range paths {
					c.RecordAct(ledger.New{
						Root: scope, Path: changed, Action: ledger.Errand, Actor: by, Note: said,
					})
				}
			},
			Marks: errand.MarksOf,
			Changed: func(before, after errand.Marks) []doc.Path {
				return errand.ChangedBetween(before, after)
			},
		}),
		Title:  tools.Title,
		Rounds: constants.AgentRounds,
	}, nil
}

func (c *Context) profileName() string {
	if held := c.Profiles.Active(); held != nil {
		return held.Name
	}
	return ""
}

// team is where an agent stands, for their own prompt: the rungs either side of them by name, and
// everyone else as a row they can message. Nothing where they are the only one — an agent alone is
// told about no room.
func (c *Context) team(agent chat.Agent) *brief.Team {
	open := c.Workspace.Project()
	if open == nil || c.Chats == nil {
		return nil
	}
	chart := c.Chats.Org(open.Path)
	if len(chart) < 2 {
		return nil
	}
	named := map[string]string{}
	for _, one := range chart {
		named[one.ID] = one.Name
	}
	purposes := map[string]string{}
	if held, err := c.Root(doc.Project); err == nil {
		for _, one := range held.Personas() {
			purposes[one.Name] = one.Description
		}
	}

	team := brief.Team{}
	for _, one := range chart {
		if one.ID == agent.ID && one.Lead != nil {
			team.Lead = named[*one.Lead]
		}
		if one.Lead != nil && *one.Lead == agent.ID {
			team.Reports = append(team.Reports, one.Name)
		}
	}
	team.Everyone = downFrom(chart, purposes, named, agent.ID, nil)
	return &team
}

// downFrom is the chart top to bottom: everyone with nobody above them, each followed by whoever
// reports to them, so the order an agent reads is the shape of the team rather than an alphabet.
// The agent being told is walked through and left out — they know who they are.
//
// A cycle would not end here, and cannot be made: setting a lead refuses one on the way in.
func downFrom(chart []chat.Placed, purposes, named map[string]string, skip string, lead *string) []brief.Colleague {
	held := []brief.Colleague{}
	for _, one := range chart {
		if !sameLead(one.Lead, lead) {
			continue
		}
		if one.ID != skip {
			purpose := purposes[one.Persona]
			if purpose == "" {
				purpose = "wears " + one.Persona + ", which is not in this project any more"
			}
			above := ""
			if one.Lead != nil {
				above = named[*one.Lead]
			}
			held = append(held, brief.Colleague{Name: one.Name, Purpose: purpose, Lead: above})
		}
		id := one.ID
		held = append(held, downFrom(chart, purposes, named, skip, &id)...)
	}
	return held
}

func sameLead(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
