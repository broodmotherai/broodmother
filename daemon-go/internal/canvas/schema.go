// Package canvas is what a diagram is: shapes on a plane and the lines between them, and the
// file it lives in.
//
// The file is [JSON Canvas](https://jsoncanvas.org), the format Obsidian's canvas writes, so a
// diagram made here opens there and one made there opens here. One field is ours alone: shape,
// which says whether a node is drawn as a box, an ellipse or a diamond. A reader that has never
// heard of it ignores it and draws a box, which is what it is.
package canvas

import (
	"math"
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/grid"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

const Extension = ".canvas"

func IsCanvasPath(path string) bool { return utils.Extension(path) == "canvas" }

// Side is one of the four a line can leave from or land on — the format's own word for them.
type Side string

const (
	Top    Side = "top"
	Right  Side = "right"
	Bottom Side = "bottom"
	Left   Side = "left"
)

var Sides = []Side{Top, Right, Bottom, Left}

func (s Side) valid() bool {
	for _, one := range Sides {
		if one == s {
			return true
		}
	}
	return false
}

// Shape is how a node is drawn. Absent means rectangle: the shape every other canvas draws, and
// the one this canvas draws with its corners taken off.
type Shape string

const (
	Rectangle  Shape = "rectangle"
	Terminator Shape = "terminator"
	Trigger    Shape = "trigger"
	Ellipse    Shape = "ellipse"
	Diamond    Shape = "diamond"
	Document   Shape = "document"
	Documents  Shape = "documents"
	Cloud      Shape = "cloud"
	Class      Shape = "class"
	Text       Shape = "text"
)

// Shapes is the order the toolbar and the right-click menu offer them in: where a flow starts,
// what it does, what sets it off, and the two shapes a decision is drawn with.
var Shapes = []Shape{
	Rectangle, Terminator, Trigger, Ellipse, Diamond,
	Document, Documents, Cloud, Class, Text,
}

func (s Shape) valid() bool {
	for _, one := range Shapes {
		if one == s {
			return true
		}
	}
	return false
}

// Label is the word in the menu, and the word a shape arrives saying where it has nothing else
// to say.
func (s Shape) Label() string {
	switch s {
	case Documents:
		return "Multiple Documents"
	case Text:
		return "Text box"
	default:
		return strings.ToUpper(string(s)[:1]) + string(s)[1:]
	}
}

type Size struct{ Width, Height float64 }

// Seed is how big a shape arrives. Anything writing a diagram by hand uses these too — a canvas
// of shapes each measured differently reads as a canvas nobody drew.
var seeds = map[Shape]Size{
	Rectangle:  {160, 80},
	Terminator: {160, 64},
	Trigger:    {176, 80},
	Ellipse:    {176, 96},
	Diamond:    {176, 112},
	Document:   {160, 96},
	Documents:  {176, 128},
	Cloud:      {176, 112},
	Class:      {208, 80},
	Text:       {160, 48},
}

func (s Shape) Seed() Size { return seeds[s] }

// ClassText is the shape of a UML class, written the way it reads: a name, a rule, what it holds.
const ClassText = "ClassName\n---\n- field: Type"

// Nothing useful is smaller than this, and a handle dragged past it stops rather than turning
// the shape inside out.
const (
	MinW = 48.0
	MinH = 32.0
)

// ArrowEnd is what an end of a line wears. Absent is none at the tail and arrow at the head.
type ArrowEnd string

const (
	NoEnd ArrowEnd = "none"
	Arrow ArrowEnd = "arrow"
)

func (e ArrowEnd) valid() bool { return e == NoEnd || e == Arrow }

// Node is one shape. The format has four kinds — text, file, link and group — and this editor
// draws the first; the others are refused by name rather than silently dropped, so a canvas that
// holds one says so instead of opening short.
type Node struct {
	ID     string
	Text   string
	X      float64
	Y      float64
	Width  float64
	Height float64
	// Color is the line round the shape: a preset "1"–"6", or #rrggbb. Absent is black.
	Color *string
	// Fill is ours, not the format's: what the shape is filled with. Absent is white.
	Fill *string
	// Shape is ours, not the format's: how the node is drawn. Absent is a rectangle.
	Shape *Shape
}

type Edge struct {
	ID       string
	FromNode string
	FromSide *Side
	FromEnd  *ArrowEnd
	ToNode   string
	ToSide   *Side
	ToEnd    *ArrowEnd
	Color    *string
	// Label is a word on the line, drawn at its middle.
	Label *string
}

type Canvas struct {
	Nodes []Node
	Edges []Edge
}

// Empty is a fine place to stand: unlike a task, which is born with the trigger that makes it
// runnable, a canvas has nothing it needs before you draw on it.
func Empty() Canvas { return Canvas{Nodes: []Node{}, Edges: []Edge{}} }

// ShapeOf is how a node is drawn, with the default spelled out.
func ShapeOf(node Node) Shape {
	if node.Shape == nil {
		return Rectangle
	}
	return *node.Shape
}

// EndsOf is what an edge's ends wear, with the format's defaults spelled out.
func EndsOf(edge Edge) (from, to ArrowEnd) {
	from, to = NoEnd, Arrow
	if edge.FromEnd != nil {
		from = *edge.FromEnd
	}
	if edge.ToEnd != nil {
		to = *edge.ToEnd
	}
	return from, to
}

// isCompartment is a rule across a class box, written as a rule is written everywhere else in
// this app: three or more dashes alone on a line.
func isCompartment(line string) bool {
	trimmed := strings.Trim(line, " \t")
	return len(trimmed) >= 3 && strings.Trim(trimmed, "-") == ""
}

// ClassParts is a UML class as its compartments: the name, then whatever else has been written
// under a line of dashes. Nothing is tidied on the way through: a blank line somebody put in a
// compartment is a line, and comes back as one.
func ClassParts(text string) []string {
	parts := [][]string{{}}
	for _, line := range strings.Split(text, "\n") {
		if isCompartment(line) {
			parts = append(parts, []string{})
			continue
		}
		parts[len(parts)-1] = append(parts[len(parts)-1], line)
	}
	joined := make([]string, len(parts))
	for i, part := range parts {
		joined[i] = strings.Join(part, "\n")
	}
	return joined
}

// What a class box is set in, to the pixel, so that the height worked out here and the height
// the stylesheet draws are the same height.
const (
	ClassPad      = 12.0
	ClassLine     = 18.0
	ClassNameLine = 22.0
	classRule     = 1.0
	classStroke   = 2.0
)

// ClassHeight is how tall a class box has to be to hold what is written in it, so a field added
// to a class makes the class taller rather than being swallowed by a box drawn before it was
// written.
func ClassHeight(text string) float64 {
	total := classStroke
	for index, part := range ClassParts(text) {
		lines := float64(max(1, len(strings.Split(part, "\n"))))
		line, rule := ClassLine, classRule
		if index == 0 {
			line, rule = ClassNameLine, 0
		}
		total += ClassPad + lines*line + rule
	}
	return total
}

// WithClassPart rewrites one compartment and leaves the rest as they were.
func WithClassPart(text string, index int, part string) string {
	parts := ClassParts(text)
	if index < 0 || index >= len(parts) {
		return text
	}
	parts[index] = part
	return strings.Join(parts, "\n---\n")
}

// ClassBox is how tall a class box has to be for what is written in it, taken up to the next
// whole cell: everything else on this canvas is measured in cells, and a box that was not would
// be the one thing on the grid standing off it.
func ClassBox(text string) float64 {
	return math.Ceil(ClassHeight(text)/grid.Grid) * grid.Grid
}

// The six colours the format names by number, in its order, and what this canvas draws each of
// them in — the format says which colour, not which hex, so somebody has to.
var presetHex = map[string]string{
	"1": "#f472b6", "2": "#b39051", "3": "#eab308",
	"4": "#34d399", "5": "#22d3ee", "6": "#c084fc",
}

const (
	LineDefault   = "#b4b4b4"
	FillDefault   = "#ffffff"
	BorderDefault = "#9f9f9f"
	// InkDefault: a text box has no card to sit on, so its words are on the board itself.
	InkDefault = "#ffffff"
)

// PaintOf is what the file says, as a colour anything can draw with: a preset resolved, a hex
// kept, and nothing at all answered with the default asked for.
func PaintOf(color *string, fallback string) string {
	if color == nil || *color == "" {
		return fallback
	}
	if strings.HasPrefix(*color, "#") {
		return *color
	}
	if hex, found := presetHex[*color]; found {
		return hex
	}
	return fallback
}

func BorderOf(node Node) string {
	fallback := BorderDefault
	if ShapeOf(node) == Text {
		fallback = InkDefault
	}
	return PaintOf(node.Color, fallback)
}

// FreshID is the next id nothing has taken, stem-1 onward. Ids only have to be unique inside the
// one file, so they are readable rather than random.
func FreshID(taken map[string]bool, stem string) string {
	for n := 1; ; n++ {
		id := stem + "-" + strconv.Itoa(n)
		if !taken[id] {
			return id
		}
	}
}

// MakeShape makes a shape the way the editor makes one: the right size for its kind, its middle
// where it was asked for, on the grid, and named for what it is.
func MakeShape(c Canvas, shape Shape, centreX, centreY float64) Node {
	seed := shape.Seed()
	text := shape.Label()
	height := seed.Height
	if shape == Class {
		text = ClassText
		// A class box arrives as tall as the class written in it.
		height = ClassBox(text)
	}
	taken := map[string]bool{}
	for _, node := range c.Nodes {
		taken[node.ID] = true
	}
	node := Node{
		ID:     FreshID(taken, "node"),
		Text:   text,
		X:      grid.Snap(centreX - seed.Width/2),
		Y:      grid.Snap(centreY - seed.Height/2),
		Width:  seed.Width,
		Height: height,
	}
	// A rectangle is what a node is when nothing says otherwise, so it says nothing.
	if shape != Rectangle {
		node.Shape = &shape
	}
	return node
}
