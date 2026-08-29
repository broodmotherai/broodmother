// The people-shaped agents under the chats: who there is, whose thread is whose, and the chart.
//
// How one answers is `agentturn.go`; what this holds is who they are.

package app

import (
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chat"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/personas"
)

// AgentSummary is an agent as a list draws one.
type AgentSummary struct {
	chat.Agent
	// Working is whether a reply of theirs is being written right now — the presence dot.
	Working bool `json:"working"`
	// LastAt is when the last thing was said in their thread, or nil when nothing has been.
	LastAt *int64 `json:"lastAt"`
}

// AgentInOrg is the same, with where they stand.
type AgentInOrg struct {
	AgentSummary
	Lead  *string     `json:"lead"`
	Place *chat.Place `json:"place"`
}

// ListAgents is every agent in the open project, by name. Nowhere to work is nobody rather than
// an error, the way the conversations answer.
func (c *Context) ListAgents() []AgentSummary {
	open := c.Workspace.Project()
	if open == nil || c.Chats == nil {
		return []AgentSummary{}
	}
	held := c.Chats.Agents(open.Path)
	found := make([]AgentSummary, 0, len(held))
	for _, one := range held {
		found = append(found, c.summarize(one))
	}
	return found
}

// Org is the chart: everyone, with who they report to and where they stand.
func (c *Context) Org() []AgentInOrg {
	open := c.Workspace.Project()
	if open == nil || c.Chats == nil {
		return []AgentInOrg{}
	}
	held := c.Chats.Org(open.Path)
	found := make([]AgentInOrg, 0, len(held))
	for _, one := range held {
		found = append(found, AgentInOrg{
			AgentSummary: c.summarize(one.Agent), Lead: one.Lead, Place: one.Place,
		})
	}
	return found
}

func (c *Context) summarize(one chat.Agent) AgentSummary {
	working := c.Live != nil && c.Live.Working(one.Chat)
	return AgentSummary{Agent: one, Working: working, LastAt: c.Chats.LastSaidAt(one.Chat)}
}

// AddAgent is a new colleague. The persona has to be one the project carries and the model one
// the app serves — an agent made with neither would be a name that answers nothing. Their
// attachments folder is made now, so it is in the tree from the first message and there is a
// place to point at before anything is in it.
func (c *Context) AddAgent(input chat.NewAgent) (chat.Agent, error) {
	open, err := c.Workspace.RequireProject()
	if err != nil {
		return chat.Agent{}, err
	}
	if c.Chats == nil {
		return chat.Agent{}, apperr.Chatf("there is nowhere to keep an agent")
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		return chat.Agent{}, apperr.Chatf("an agent needs a name")
	}
	held, err := c.Root(doc.Project)
	if err != nil {
		return chat.Agent{}, err
	}
	if !carries(held.Personas(), input.Persona) {
		return chat.Agent{}, apperr.Chatf("no persona called %s in this project", input.Persona)
	}
	if chat.ProviderOf(input.Model) == "" {
		return chat.Agent{}, apperr.Chatf("no such model: %s", input.Model)
	}

	made, err := c.Chats.CreateAgent(open.Path, input)
	if err != nil {
		return chat.Agent{}, err
	}
	held.Tree.Mkdir(made.Attachments)
	return made, nil
}

func carries(held []personas.Persona, name string) bool {
	for _, one := range held {
		if one.Name == name {
			return true
		}
	}
	return false
}

// RemoveAgent takes the agent and their conversation together; the attachments folder stays,
// since what they made is yours.
func (c *Context) RemoveAgent(id string) error {
	held, err := c.requireAgent(id)
	if err != nil {
		return err
	}
	if err := c.RemoveChat(held.Chat); err != nil {
		return err
	}
	c.Chats.RemoveAgent(held.ID)
	return nil
}

// ClearAgent takes what was said in their thread; the agent stays to be said to again.
func (c *Context) ClearAgent(id string) error {
	held, err := c.requireAgent(id)
	if err != nil {
		return err
	}
	c.Live.Clear(held.Chat)
	return nil
}

// SetAgentModel is which model answers as them, changed on somebody who already exists. Refused
// for a model the app does not serve, the way hiring is — an agent pointed at nothing is a name
// that answers nothing, and it would only be found out at the next thing said to them.
func (c *Context) SetAgentModel(id, model string) (chat.Agent, error) {
	held, err := c.requireAgent(id)
	if err != nil {
		return chat.Agent{}, err
	}
	if chat.ProviderOf(model) == "" {
		return chat.Agent{}, apperr.Chatf("no such model: %s", model)
	}
	c.Chats.SetAgentModel(held.ID, model)
	again, _ := c.Chats.Agent(held.ID)
	return again, nil
}

// SetLead is who somebody reports to, or nobody. A loop is refused by walking upward from the
// proposed lead: meeting the agent on the way is the line closing on itself, and a chart asked
// who to escalate to would have no answer. Both ends have to be in this project — the chart is
// per-project the way the agents are.
func (c *Context) SetLead(agent string, lead *string) error {
	open, err := c.Workspace.RequireProject()
	if err != nil {
		return err
	}
	if c.Chats == nil {
		return apperr.Chatf("no such agent")
	}
	chart := map[string]chat.Placed{}
	for _, one := range c.Chats.Org(open.Path) {
		chart[one.ID] = one
	}
	held, found := chart[agent]
	if !found {
		return apperr.Chatf("no such agent")
	}
	if lead == nil {
		c.Chats.SetLead(agent, nil)
		return nil
	}
	if *lead == agent {
		return apperr.Chatf("%s cannot report to themselves", held.Name)
	}
	above, found := chart[*lead]
	if !found {
		return apperr.Chatf("no such agent")
	}
	for step := above.Lead; step != nil; {
		if *step == agent {
			return apperr.Chatf("that would make a loop: %s already reports to %s", above.Name, held.Name)
		}
		next, found := chart[*step]
		if !found {
			break
		}
		step = next.Lead
	}
	c.Chats.SetLead(agent, lead)
	return nil
}

// PlaceAgent is where they stand, after a drag.
func (c *Context) PlaceAgent(agent string, x, y float64) error {
	held, err := c.requireAgent(agent)
	if err != nil {
		return err
	}
	c.Chats.PlaceAgent(held.ID, x, y)
	return nil
}

func (c *Context) requireAgent(id string) (chat.Agent, error) {
	if c.Chats == nil {
		return chat.Agent{}, apperr.Chatf("no such agent")
	}
	held, found := c.Chats.Agent(id)
	if !found {
		return chat.Agent{}, apperr.Chatf("no such agent")
	}
	return held, nil
}
