// What a handler reads out of a request. A body that is not JSON and a body that is JSON but
// not the shape asked for are two different complaints, and both are the caller's fault rather
// than a bug.

package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/ledger"
)

// bodies larger than this are not a request anybody meant to send. The routes that take real
// content take it by path rather than in a body.
const maxBody = 8 << 20

func body(r *http.Request) (json.RawMessage, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		return nil, apperr.BadRequestf("body must be JSON")
	}
	var held json.RawMessage
	if json.Unmarshal(raw, &held) != nil {
		return nil, apperr.BadRequestf("body must be JSON")
	}
	return held, nil
}

// parse reads a body of the shape a route takes. `of` proves the shape and names what is wrong
// with it, the way each route's schema does in the TypeScript — in different words, since those
// are zod's and are read by a person rather than by a caller.
func parse[T any](r *http.Request, of func(json.RawMessage) (T, error)) (T, error) {
	var nothing T
	raw, err := body(r)
	if err != nil {
		return nothing, err
	}
	return of(raw)
}

// named is a `{ "<key>": "<a name>" }` body, which is most of what this API is asked with.
func named(key string) func(json.RawMessage) (string, error) {
	return func(raw json.RawMessage) (string, error) {
		var held map[string]json.RawMessage
		if json.Unmarshal(raw, &held) != nil || held == nil {
			return "", apperr.BadRequestf("body must be an object")
		}
		var value string
		if json.Unmarshal(orNull(held[key]), &value) != nil || value == "" {
			return "", apperr.BadRequestf("%s must be a name", key)
		}
		return value, nil
	}
}

func orNull(data json.RawMessage) json.RawMessage {
	if data == nil {
		return json.RawMessage("null")
	}
	return data
}

// query is a parameter a GET names in its URL.
func query(r *http.Request, name string) (string, error) {
	value := r.URL.Query().Get(name)
	if value == "" {
		return "", apperr.BadRequestf("missing %s", name)
	}
	return value, nil
}

// actorOf is who says they are doing this, for the ledger. The header is a claim and is read as
// one: an absent one is a person, which is what the editor's save is, and one that will not parse
// is nobody rather than a guess.
func actorOf(r *http.Request) ledger.Actor {
	return ledger.ParseActor(r.Header.Get(ledger.Header))
}
