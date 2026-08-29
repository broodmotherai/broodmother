// One agent saying something to another.
//
// The message lands in the recipient's thread as the prompt for a turn of theirs, answered by
// their persona with their own hands, and their answer comes back the same way — so an exchange
// between two agents is legible in both threads and in neither does it read as something the
// person said.
//
// Nothing here waits: it answers as soon as the message is on its way. Waiting would mean one
// agent's turn blocking inside a tool call for as long as another agent's whole turn, which with
// `claude_code` on the other end is twenty minutes. The answer arrives when it arrives, in the
// thread, which is how messaging a colleague works.

package app

import (
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/chat"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chats"
)

// maxHops is how far an exchange may go before it is cut. Two agents with a message tool and no
// counter will answer each other politely until the key runs out, and every round of it is a full
// turn with a real model. This is the whole of what stands between the app and that.
const maxHops = 4

// sendBetweenAgents says it, and answers the sender with what became of it — as text, the way an
// agent's hands answer, because a refusal the model can read and act on beats an exception that
// ends its turn mid-sentence.
func (c *Context) sendBetweenAgents(sender chat.Agent, to, message string) string {
	roster := c.Org()
	if !inRoster(roster, sender.ID) {
		return "you are not in this project any more"
	}

	meant := matching(roster, to)
	if len(meant) > 1 {
		names := make([]string, 0, len(meant))
		for _, one := range meant {
			names = append(names, one.Name)
		}
		return "more than one of them answers to " + to + " — say which: " + strings.Join(names, ", ")
	}
	if len(meant) == 0 {
		others := []string{}
		for _, one := range roster {
			if one.ID != sender.ID {
				others = append(others, one.Name)
			}
		}
		if len(others) == 0 {
			return "nobody here is called " + to + ", and there is nobody else in this project"
		}
		return "nobody here is called " + to + " — there is " + strings.Join(others, ", ")
	}
	found := meant[0]
	if found.ID == sender.ID {
		return "you are " + sender.Name + " — say it in your own answer rather than to yourself"
	}

	hops := c.Live.HopsIn(sender.Chat)
	if hops >= maxHops {
		return "that exchange has gone back and forth " + strconv.Itoa(maxHops) +
			" times — say what you have and stop"
	}

	from := rosterOf(roster, sender.ID)
	// Nobody is awaiting this, so a store that fell over mid-delivery would take the daemon with it
	// rather than losing one message. Losing the message is the smaller thing.
	go func() {
		answer := c.Live.Deliver(found.Chat, chats.Delivery{
			Text: said(from, found, message), Model: found.Model, From: sender.ID, Hops: hops + 1,
		})
		if answer == nil || strings.TrimSpace(answer.Text) == "" {
			return
		}
		c.Live.Deliver(sender.Chat, chats.Delivery{
			Text: said(found, from, answer.Text), Model: from.Model, From: found.ID, Hops: hops + 2,
		})
	}()
	return "delivered to " + found.Name + " — their answer will come back to you here"
}

// matching is who they meant, by the name they wrote. The roster in their prompt gives whole names,
// so a whole name is tried first; a first name on its own is what somebody writes when they are
// writing to a colleague rather than reading off a list, and it is taken where only one person
// answers to it. Nothing looser than that: a message delivered to the wrong colleague is worse than
// one that comes back asking which.
func matching(roster []AgentInOrg, to string) []AgentInOrg {
	asked := strings.ToLower(strings.TrimSpace(to))
	whole := []AgentInOrg{}
	for _, one := range roster {
		if strings.ToLower(strings.TrimSpace(one.Name)) == asked {
			whole = append(whole, one)
		}
	}
	if len(whole) > 0 {
		return whole
	}
	first := []AgentInOrg{}
	for _, one := range roster {
		if strings.ToLower(strings.Fields(strings.TrimSpace(one.Name))[0]) == asked {
			first = append(first, one)
		}
	}
	return first
}

// said is how a delivered message reads to the model on the other end. The sender is a column in
// the store, which is what the page draws; a column is not in the context window, so it is said
// here as well — and here only, so that anything which ever rewrites message text on its way to the
// provider has one place to break rather than several.
func said(from, to AgentInOrg, text string) string {
	how := ""
	switch {
	case to.Lead != nil && *to.Lead == from.ID:
		how = " (your lead)"
	case from.Lead != nil && *from.Lead == to.ID:
		how = " (who reports to you)"
	}
	return "From " + from.Name + how + ": " + text
}

func inRoster(roster []AgentInOrg, id string) bool {
	for _, one := range roster {
		if one.ID == id {
			return true
		}
	}
	return false
}

func rosterOf(roster []AgentInOrg, id string) AgentInOrg {
	for _, one := range roster {
		if one.ID == id {
			return one
		}
	}
	return AgentInOrg{}
}
