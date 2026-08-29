// How a conversation is answered: who is speaking, and how far they may reach.
//
// The room it wakes up in is asked each turn — the project, the scope and what is syncing all move
// under a conversation that stays open. An agent's thread is answered by the agent; any other, by
// the page.

package app

import (
	"github.com/broodmotherai/broodmother/daemon-go/internal/apicall"
	"github.com/broodmotherai/broodmother/daemon-go/internal/brief"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chat"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chats"
	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
	"github.com/broodmotherai/broodmother/daemon-go/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tools"
	"github.com/broodmotherai/broodmother/daemon-go/internal/tree"
)

// turn is what answers one turn of one conversation.
func (c *Context) turn(held chat.Chat, note func(call, text string)) (chats.Turn, error) {
	if agent, mine := c.Chats.AgentOfChat(held.ID); mine {
		return c.agentTurn(agent, note)
	}
	return chats.Turn{
		System: c.Brief(brief.Chat),
		// What a record written this turn says wrote it. The route has no caller to ask, so this is
		// the one place that knows — and everywhere else it goes unsaid.
		Tools: tools.Chat(c.toolDeps(ledger.Actor{
			Kind: ledger.ChatActor, ID: held.ID, Model: held.Model,
		}, "chat/"+held.ID)),
		Title:  tools.Title,
		Rounds: constants.MaxRounds,
	}, nil
}

// toolDeps is the app's own front door, opened for whoever is taking the turn. Whoever it is opened
// for travels with it, so the ledger can say whose write it was.
func (c *Context) toolDeps(by ledger.Actor, wrote string) tools.Deps {
	return tools.Deps{
		Tree: func(root doc.Root) *tree.Tree {
			open, err := c.Root(root)
			if err != nil {
				return nil
			}
			return open.Tree
		},
		Call: apicall.New(c.serverURL, &by),
		By:   wrote,
	}
}
