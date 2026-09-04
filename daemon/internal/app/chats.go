// The conversations this project has held, and the replies being written into them right now.

package app

import (
	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/chat"
)

// ListChats is every conversation in the open project. Nowhere to work is no conversations rather
// than an error: an empty app is a state you are allowed to stand in.
func (c *Context) ListChats() []chat.Summary {
	open := c.Workspace.Project()
	if open == nil || c.Chats == nil {
		return []chat.Summary{}
	}
	return c.Chats.List(open.Path)
}

func (c *Context) AddChat(model string) (chat.Chat, error) {
	open, err := c.Workspace.RequireProject()
	if err != nil {
		return chat.Chat{}, err
	}
	if c.Chats == nil {
		return chat.Chat{}, apperr.Chatf("there is nowhere to keep a conversation")
	}
	return c.Chats.Create(open.Path, model)
}

// OneChat is one conversation, whole — with the reply still arriving folded in, so a page that has
// just loaded reads the same thing the socket is about to continue.
func (c *Context) OneChat(id string) (chat.Chat, error) {
	if c.Chats == nil || c.Live == nil {
		return chat.Chat{}, apperr.NotFoundf("no such chat")
	}
	return c.Live.Chat(id)
}

func (c *Context) RemoveChat(id string) error {
	if c.Live == nil {
		return nil
	}
	return c.Live.Remove(id)
}
