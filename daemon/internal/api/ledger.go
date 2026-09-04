package api

import (
	"net/http"
	"strconv"

	"github.com/broodmotherai/broodmother/daemon/internal/app"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
)

// few is how many acts a page or a tool is handed unasked. Enough to say "Priya made it, Rafa
// changed it" and not enough to be a history.
const few = 5

type GetLedger struct {
	Acts []ledger.Entry `json:"acts"`
	// Git is asked only where the ledger is silent, and its answer travels beside the acts rather
	// than among them: a pull, a rebase or a checkout changes a file without telling the app
	// anything, and the honest answer there is that the ledger does not know and this is what git
	// has.
	Git *git.CommitTouch `json:"git"`
}

var ledgerTable = Table{
	"GET /api/ledger": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		open, path, err := where(r, ctx)
		if err != nil {
			return nil, err
		}
		root, _ := rootOf(r)
		limit := few
		if asked, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && asked > 0 {
			limit = asked
		}
		answer := GetLedger{Acts: ctx.ActsFor(root, path, limit)}
		if len(answer.Acts) == 0 {
			answer.Git = git.New(open.Path, "", "").LastCommit(path)
		}
		return answer, nil
	},
}
