// What is at work in each checkout, and everything on this machine going away.

package api

import (
	"net/http"

	"github.com/broodmotherai/broodmother/daemon/internal/activity"
	"github.com/broodmotherai/broodmother/daemon/internal/app"
)

var activityTable = Table{
	/* Changes ride the socket; this is where a client that has just arrived reads the picture as
	   it stands. */
	"GET /api/activity": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		states := map[string]activity.State{}
		if ctx.Activity != nil {
			states = ctx.Activity.States()
		}
		return map[string]any{"activity": states}, nil
	},

	/* Every folder in the home, gone. The last resort, and the one route that cannot be undone. */
	"DELETE /api/data": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		saved, err := ctx.RemoveEverything()
		if err != nil {
			return nil, err
		}
		return map[string]any{"config": saved}, nil
	},
}
