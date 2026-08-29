// Package api is the daemon's HTTP surface: the route table, what a handler is, and the one
// place an error becomes a status.
package api

import (
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
)

// Handler answers with the value to write as JSON, or with the error to write instead. Returning
// the body rather than writing it is what keeps the error path in one place: a handler that
// fails has written nothing yet, so there is still a status to choose.
//
// A route whose answer is not JSON — a file's bytes, which carry a type of their own — writes to
// the writer itself and returns [Written].
type Handler func(http.ResponseWriter, *http.Request, *app.Context) (any, error)

// Written is what a handler returns when it has answered in its own bytes.
type Written struct{}

// Table is a domain's routes, keyed by method and path the way the API is keyed. The TypeScript
// proved at compile time that every route in its registry was served and every served route was in
// it; Go has no equivalent, so this table is the list, and `tests/api` holds it to the frontend's.
type Table map[string]Handler

// tables is every domain, in the order the API is mounted.
var tables = []Table{terminalTable, gitTable, projectsTable, profilesTable, docsTable, reposTable, branchesTable, syncTable, ledgerTable, diffTable, entitiesTable, githubTable, tasksTable, chatTable, agentsTable, motherTable, activityTable}

func routes() Table {
	all := Table{}
	for _, table := range tables {
		for pattern, handler := range table {
			all[pattern] = handler
		}
	}
	return all
}
