// The canvas file, read and written. Parsing refuses anything it cannot vouch for, and says
// which node was wrong; writing is canonical, so a load–save round trip changes no bytes.

package canvas

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
)

func fail(format string, args ...any) error { return apperr.Canvasf(format, args...) }

type raw = map[string]json.RawMessage

func record(data json.RawMessage, what string) (raw, error) {
	var held raw
	if err := json.Unmarshal(data, &held); err != nil || held == nil {
		return nil, fail("%s is not an object", what)
	}
	return held, nil
}

func text(data json.RawMessage, what string) (string, error) {
	var held string
	if data == nil || json.Unmarshal(data, &held) != nil {
		return "", fail("%s is not a string", what)
	}
	return held, nil
}

func finite(data json.RawMessage, what string) (float64, error) {
	var held float64
	// json.Unmarshal into float64 refuses a string or a bool, which is the check the TypeScript
	// makes with typeof; the infinity check is for a literal too large to hold, which JSON has
	// no other way to write.
	if data == nil || json.Unmarshal(data, &held) != nil || math.IsInf(held, 0) || math.IsNaN(held) {
		return 0, fail("%s is not a number", what)
	}
	return held, nil
}

func size(data json.RawMessage, what string) (float64, error) {
	measure, err := finite(data, what)
	if err != nil {
		return 0, err
	}
	if measure <= 0 {
		return 0, fail("%s must be more than nothing", what)
	}
	return measure, nil
}

func isHex(value string) bool {
	digits, found := strings.CutPrefix(value, "#")
	if !found || (len(digits) != 3 && len(digits) != 6) {
		return false
	}
	for _, c := range digits {
		if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

func isPreset(value string) bool {
	return len(value) == 1 && value[0] >= '1' && value[0] <= '6'
}

// color is a preset the format names by number, or a hex anybody can read.
func color(data json.RawMessage, what string) (string, error) {
	hex, err := text(data, what)
	if err != nil {
		return "", err
	}
	if !isPreset(hex) && !isHex(hex) {
		return "", fail("%s is not a preset 1–6 or a #rrggbb colour", what)
	}
	return hex, nil
}

func side(data json.RawMessage, what string) (Side, error) {
	named, err := text(data, what)
	if err != nil {
		return "", err
	}
	if !Side(named).valid() {
		return "", fail("%s is not a side of a node", what)
	}
	return Side(named), nil
}

func end(data json.RawMessage, what string) (ArrowEnd, error) {
	named, err := text(data, what)
	if err != nil {
		return "", err
	}
	if !ArrowEnd(named).valid() {
		return "", fail("%s is not none or arrow", what)
	}
	return ArrowEnd(named), nil
}

// legacyRounded: the rectangle was drawn twice for a while — square-cornered and rounded — and
// is now drawn once, rounded. A shape that still says `rounded` is the shape it always was, and
// the next save writes it under the name that survived.
const legacyRounded = "rounded"

func shape(data json.RawMessage, what string) (Shape, error) {
	named, err := text(data, what)
	if err != nil {
		return "", err
	}
	if named == legacyRounded {
		return Rectangle, nil
	}
	if !Shape(named).valid() {
		return "", fail("%s is not a shape this canvas draws", what)
	}
	return Shape(named), nil
}

// optional runs read over a field only where the file carries one, the way the TypeScript
// guards each with `!== undefined`.
func optional[T any](held raw, key, what string, read func(json.RawMessage, string) (T, error)) (*T, error) {
	data, found := held[key]
	if !found {
		return nil, nil
	}
	value, err := read(data, what)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func readNode(data json.RawMessage, index int) (Node, error) {
	held, err := record(data, fmt.Sprintf("node %d", index))
	if err != nil {
		return Node{}, err
	}
	id, err := text(held["id"], fmt.Sprintf("node %d id", index))
	if err != nil {
		return Node{}, err
	}
	// The format has four kinds of node and this editor draws one of them. A canvas holding a
	// file, a link or a group is refused by name rather than opened with a hole in it.
	kind, found := held["type"]
	if named, err := text(kind, ""); !found || err != nil || named != "text" {
		return Node{}, fail("%s is a %s node, which this canvas cannot draw yet", id, undefinedOr(kind, found))
	}

	node := Node{ID: id}
	if node.Text, err = text(held["text"], id+" text"); err != nil {
		return Node{}, err
	}
	if node.X, err = finite(held["x"], id+" x"); err != nil {
		return Node{}, err
	}
	if node.Y, err = finite(held["y"], id+" y"); err != nil {
		return Node{}, err
	}
	if node.Width, err = size(held["width"], id+" width"); err != nil {
		return Node{}, err
	}
	if node.Height, err = size(held["height"], id+" height"); err != nil {
		return Node{}, err
	}
	if node.Color, err = optional(held, "color", id+" color", color); err != nil {
		return Node{}, err
	}
	if node.Fill, err = optional(held, "fill", id+" fill", color); err != nil {
		return Node{}, err
	}
	if node.Shape, err = optional(held, "shape", id+" shape", shape); err != nil {
		return Node{}, err
	}
	return node, nil
}

// undefinedOr is how the TypeScript names a kind it will not draw: `JSON.stringify(raw.type)`,
// which is the value quoted — and the bare word `undefined` where the field is absent, since
// that is what stringify answers with and what the template then interpolates.
func undefinedOr(data json.RawMessage, found bool) string {
	if !found {
		return "undefined"
	}
	return string(data)
}

func readEdge(data json.RawMessage, index int, ids map[string]bool) (Edge, error) {
	held, err := record(data, fmt.Sprintf("edge %d", index))
	if err != nil {
		return Edge{}, err
	}
	id, err := text(held["id"], fmt.Sprintf("edge %d id", index))
	if err != nil {
		return Edge{}, err
	}
	edge := Edge{ID: id}
	if edge.FromNode, err = text(held["fromNode"], id+" fromNode"); err != nil {
		return Edge{}, err
	}
	if edge.ToNode, err = text(held["toNode"], id+" toNode"); err != nil {
		return Edge{}, err
	}
	if !ids[edge.FromNode] || !ids[edge.ToNode] {
		return Edge{}, fail("%s points at a missing node", id)
	}
	if edge.FromNode == edge.ToNode {
		return Edge{}, fail("%s points at itself", id)
	}
	if edge.FromSide, err = optional(held, "fromSide", id+" fromSide", side); err != nil {
		return Edge{}, err
	}
	if edge.FromEnd, err = optional(held, "fromEnd", id+" fromEnd", end); err != nil {
		return Edge{}, err
	}
	if edge.ToSide, err = optional(held, "toSide", id+" toSide", side); err != nil {
		return Edge{}, err
	}
	if edge.ToEnd, err = optional(held, "toEnd", id+" toEnd", end); err != nil {
		return Edge{}, err
	}
	if edge.Color, err = optional(held, "color", id+" color", color); err != nil {
		return Edge{}, err
	}
	if edge.Label, err = optional(held, "label", id+" label", text); err != nil {
		return Edge{}, err
	}
	return edge, nil
}

func Parse(source string) (Canvas, error) {
	// An empty file is an empty canvas: a document made and never drawn on is not broken.
	if strings.TrimSpace(source) == "" {
		return Empty(), nil
	}
	var body json.RawMessage
	if err := json.Unmarshal([]byte(source), &body); err != nil {
		return Canvas{}, fail("not JSON")
	}
	held, err := record(body, "canvas")
	if err != nil {
		return Canvas{}, err
	}

	// Both lists are optional in the format — a canvas with only nodes omits `edges`.
	rawNodes, err := list(held, "nodes")
	if err != nil {
		return Canvas{}, err
	}
	rawEdges, err := list(held, "edges")
	if err != nil {
		return Canvas{}, err
	}

	nodes := make([]Node, 0, len(rawNodes))
	ids := map[string]bool{}
	for index, data := range rawNodes {
		node, err := readNode(data, index)
		if err != nil {
			return Canvas{}, err
		}
		nodes = append(nodes, node)
		ids[node.ID] = true
	}
	if len(ids) != len(nodes) {
		return Canvas{}, fail("node ids repeat")
	}

	edges := make([]Edge, 0, len(rawEdges))
	lines := map[string]bool{}
	for index, data := range rawEdges {
		edge, err := readEdge(data, index, ids)
		if err != nil {
			return Canvas{}, err
		}
		edges = append(edges, edge)
		lines[edge.ID] = true
	}
	if len(lines) != len(edges) {
		return Canvas{}, fail("edge ids repeat")
	}

	return Canvas{Nodes: nodes, Edges: edges}, nil
}

func list(held raw, key string) ([]json.RawMessage, error) {
	data, found := held[key]
	if !found || string(data) == "null" {
		return nil, nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, fail("%s is not a list", key)
	}
	return items, nil
}

type wireNode struct {
	ID     string  `json:"id"`
	Type   string  `json:"type"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Color  *string `json:"color,omitempty"`
	Fill   *string `json:"fill,omitempty"`
	Shape  *Shape  `json:"shape,omitempty"`
	Text   string  `json:"text"`
}

type wireEdge struct {
	ID       string    `json:"id"`
	FromNode string    `json:"fromNode"`
	FromSide *Side     `json:"fromSide,omitempty"`
	FromEnd  *ArrowEnd `json:"fromEnd,omitempty"`
	ToNode   string    `json:"toNode"`
	ToSide   *Side     `json:"toSide,omitempty"`
	ToEnd    *ArrowEnd `json:"toEnd,omitempty"`
	Color    *string   `json:"color,omitempty"`
	Label    *string   `json:"label,omitempty"`
}

type wireCanvas struct {
	Nodes []wireNode `json:"nodes"`
	Edges []wireEdge `json:"edges"`
}

// Serialize is canonical two-space JSON in schema field order, so a load–save round trip is
// byte-identical and diagrams diff cleanly in git.
//
// An encoder rather than MarshalIndent: Go escapes `<`, `>` and `&` into `<` and friends by
// default and JSON.stringify does not, so a diagram with an arrow in a label would be rewritten
// on first save. Encode's own trailing newline is the one the TypeScript appends.
func Serialize(c Canvas) string {
	wire := wireCanvas{Nodes: make([]wireNode, 0, len(c.Nodes)), Edges: make([]wireEdge, 0, len(c.Edges))}
	for _, node := range c.Nodes {
		wire.Nodes = append(wire.Nodes, wireNode{
			ID: node.ID, Type: "text", X: node.X, Y: node.Y,
			Width: node.Width, Height: node.Height,
			Color: node.Color, Fill: node.Fill, Shape: node.Shape, Text: node.Text,
		})
	}
	for _, edge := range c.Edges {
		wire.Edges = append(wire.Edges, wireEdge{
			ID: edge.ID, FromNode: edge.FromNode, FromSide: edge.FromSide, FromEnd: edge.FromEnd,
			ToNode: edge.ToNode, ToSide: edge.ToSide, ToEnd: edge.ToEnd,
			Color: edge.Color, Label: edge.Label,
		})
	}

	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(wire); err != nil {
		// Every field is a string, a number or a pointer to one; there is nothing here that
		// encoding/json can refuse.
		panic(err)
	}
	return out.String()
}
