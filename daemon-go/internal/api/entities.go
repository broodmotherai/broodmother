// The records this project holds, and what each of them says it came from.
//
// A record is an ordinary markdown document — it opens in the editor, git carries it, and its
// sources are wikilinks the link index already resolves. What these routes add is the one thing a
// document cannot do for itself: refuse to be written without provenance, and answer "have I
// written this before" without forking the graph.

package api

import (
	"encoding/json"
	"net/http"

	"github.com/broodmotherai/broodmother/daemon-go/internal/app"
	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entities"
	"github.com/broodmotherai/broodmother/daemon-go/internal/entity"
)

var entitiesTable = Table{
	"GET /api/entities": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		found, err := ctx.Entities.List()
		if err != nil {
			return nil, err
		}
		return map[string]any{"entities": found}, nil
	},

	"POST /api/entities": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, newEntityBody)
		if err != nil {
			return nil, err
		}
		written, created, err := ctx.Entities.Record(input, actorOf(r))
		if err != nil {
			return nil, err
		}
		// A struct rather than a map: encoding/json sorts a map's keys, and `created` would come
		// out ahead of the record it is about.
		return recorded{Entity: written, Created: created}, nil
	},

	"GET /api/entities/catalogue": func(_ http.ResponseWriter, _ *http.Request, ctx *app.Context) (any, error) {
		return ctx.Entities.Catalogue(), nil
	},

	"POST /api/entity/link": func(_ http.ResponseWriter, r *http.Request, ctx *app.Context) (any, error) {
		input, err := parse(r, entityLinkBody)
		if err != nil {
			return nil, err
		}
		written, err := ctx.Entities.Link(input.Path, input.Relation, input.Target, actorOf(r))
		if err != nil {
			return nil, err
		}
		return map[string]any{"entity": written}, nil
	},
}

// recorded is written, or found already written. Created false is the idempotent answer: the
// same record twice is one record, and the path handed back is the one that already said it.
type recorded struct {
	Entity  entities.Summary `json:"entity"`
	Created bool             `json:"created"`
}

func newEntityBody(raw json.RawMessage) (entities.New, error) {
	var body struct {
		Kind   string            `json:"kind"`
		Name   string            `json:"name"`
		Fields map[string]string `json:"fields"`
		From   []wireSource      `json:"from"`
		Origin bool              `json:"origin"`
		Body   string            `json:"body"`
		By     string            `json:"by"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return entities.New{}, apperr.BadRequestf("body must be a record")
	}
	if !entity.IsKind(body.Kind) {
		return entities.New{}, apperr.BadRequestf("kind must be one of the kinds the catalogue lists")
	}
	if body.Name == "" {
		return entities.New{}, apperr.BadRequestf("a record needs a name")
	}
	from, err := sources(body.From)
	if err != nil {
		return entities.New{}, err
	}
	return entities.New{
		Kind:   entity.Kind(body.Kind),
		Name:   body.Name,
		Fields: body.Fields,
		From:   from,
		Origin: body.Origin,
		Body:   body.Body,
		By:     body.By,
	}, nil
}

type wireSource struct {
	Relation string `json:"relation"`
	Target   string `json:"target"`
}

func sources(said []wireSource) ([]entity.From, error) {
	from := make([]entity.From, 0, len(said))
	for _, one := range said {
		if !entity.IsRelation(one.Relation) {
			return nil, apperr.BadRequestf("%q is not a relation the catalogue lists", one.Relation)
		}
		if one.Target == "" {
			return nil, apperr.BadRequestf("a source has to say what it points at")
		}
		from = append(from, entity.From{Relation: entity.Relation(one.Relation), Target: one.Target})
	}
	return from, nil
}

type entityLink struct {
	Path     string
	Relation entity.Relation
	Target   string
}

func entityLinkBody(raw json.RawMessage) (entityLink, error) {
	var body struct {
		Path     string `json:"path"`
		Relation string `json:"relation"`
		Target   string `json:"target"`
	}
	if json.Unmarshal(raw, &body) != nil || body.Path == "" || body.Target == "" {
		return entityLink{}, apperr.BadRequestf("body must name a record, a relation and what it comes from")
	}
	if !entity.IsRelation(body.Relation) {
		return entityLink{}, apperr.BadRequestf("%q is not a relation the catalogue lists", body.Relation)
	}
	return entityLink{Path: body.Path, Relation: entity.Relation(body.Relation), Target: body.Target}, nil
}
