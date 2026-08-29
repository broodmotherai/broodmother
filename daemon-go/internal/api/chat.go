// The conversations this project has held: made, listed, read and removed. The talking is the
// socket's, beside this.

package api

import (
	"encoding/json"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/chat"
)

var chatTable = Table{
	/* Every conversation in the open project, newest first. Nowhere to work is no conversations
	   rather than an error: an empty app is a state you are allowed to stand in. */
	"GET /api/chats": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return map[string]any{"chats": ctx.ListChats()}, nil
	},

	"POST /api/chats": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		model, err := parse(r, newChatBody)
		if err != nil {
			return nil, err
		}
		made, err := ctx.AddChat(model)
		if err != nil {
			return nil, err
		}
		return map[string]any{"chat": made}, nil
	},

	"GET /api/chat": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		id, err := query(r, "chat")
		if err != nil {
			return nil, err
		}
		held, err := ctx.OneChat(id)
		if err != nil {
			return nil, err
		}
		return map[string]any{"chat": held}, nil
	},

	"DELETE /api/chat": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		id, err := query(r, "chat")
		if err != nil {
			return nil, err
		}
		if err := ctx.RemoveChat(id); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	},
}

// newChatBody: which model the conversation opens on. Named at the start rather than assumed,
// because the picker in the composer is the answer and it has one before anything is said.
func newChatBody(raw json.RawMessage) (string, error) {
	var body struct {
		Model string `json:"model"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Model == "" {
		return "", apperr.BadRequestf("body must name the model")
	}
	if chat.ProviderOf(body.Model) == "" {
		return "", apperr.BadRequestf("%q is not a model this daemon serves", body.Model)
	}
	return body.Model, nil
}
