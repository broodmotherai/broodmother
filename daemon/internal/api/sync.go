package api

import (
	"net/http"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
)

// Sync now is the project's alone: a repo's repository is yours to commit from a terminal, so
// nothing here touches it.
var syncTable = Table{
	"GET /api/sync": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return ctx.Sync().State(), nil
	},

	"POST /api/sync/now": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return ctx.Sync().SyncNow(), nil
	},

	"POST /api/sync/clear-conflict": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return ctx.Sync().ClearConflict(), nil
	},
}
