package canvas_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/canvas"

	"math"
	"reflect"
	"testing"

	"github.com/broodmotherai/broodmother/daemon-go/internal/grid"
)

func TestAShapeArrivesTheSizeItsKindArrivesAtCentredWhereItWasAsked(t *testing.T) {
	node := MakeShape(Empty(), Ellipse, 400, 300)

	if node.ID != "node-1" || node.Text != Ellipse.Label() {
		t.Errorf("arrived as %q / %q", node.ID, node.Text)
	}
	if node.Shape == nil || *node.Shape != Ellipse {
		t.Error("arrived without saying it is an ellipse")
	}
	seed := Ellipse.Seed()
	if node.Width != seed.Width || node.Height != seed.Height {
		t.Errorf("arrived %vx%v", node.Width, node.Height)
	}
	// Centred on the point it was asked for, then put on the grid — within half a cell.
	if math.Abs(node.X+node.Width/2-400) > grid.Grid/2 {
		t.Errorf("x is %v", node.X)
	}
	if math.Abs(node.Y+node.Height/2-300) > grid.Grid/2 {
		t.Errorf("y is %v", node.Y)
	}
}

// The one shape the format already draws is the one that says nothing about itself.
func TestLeavesARectangleUnlabelledSoEveryOtherReaderDrawsItToo(t *testing.T) {
	if shape := MakeShape(Empty(), Rectangle, 0, 0).Shape; shape != nil {
		t.Errorf("a rectangle said it was a %q", *shape)
	}
	shape := MakeShape(Empty(), Diamond, 0, 0).Shape
	if shape == nil || *shape != Diamond {
		t.Error("a diamond did not say so")
	}
}

func TestStandsEveryShapeOnTheGrid(t *testing.T) {
	for _, shape := range Shapes {
		node := MakeShape(Empty(), shape, 137, 91)
		if math.Mod(node.X, grid.Grid) != 0 || math.Mod(node.Y, grid.Grid) != 0 {
			t.Errorf("%s stands at %v,%v", shape, node.X, node.Y)
		}
	}
}

func TestGivesAClassBoxTheCompartmentsItDrawsAndTheHeightToHoldThem(t *testing.T) {
	node := MakeShape(Empty(), Class, 0, 0)

	if node.Text != ClassText {
		t.Errorf("arrived saying %q", node.Text)
	}
	if node.Height != ClassBox(ClassText) {
		t.Errorf("height %v, want %v", node.Height, ClassBox(ClassText))
	}
	if node.Height < ClassHeight(ClassText) {
		t.Errorf("height %v cannot hold %v", node.Height, ClassHeight(ClassText))
	}
	if math.Mod(node.Height, grid.Grid) != 0 {
		t.Errorf("height %v stands off the grid", node.Height)
	}
}

func TestTakesTheNextIDNothingHasSoAShapeNeverLandsOnAnother(t *testing.T) {
	one := MakeShape(Empty(), Rectangle, 0, 0)
	two := MakeShape(Canvas{Nodes: []Node{one}}, Rectangle, 0, 0)
	if one.ID != "node-1" || two.ID != "node-2" {
		t.Errorf("ids were %q and %q", one.ID, two.ID)
	}
	if got := FreshID(map[string]bool{"edge-1": true, "edge-2": true}, "edge"); got != "edge-3" {
		t.Errorf("next edge id is %q", got)
	}
}

func TestHasANameAndASizeForEveryShapeItDraws(t *testing.T) {
	for _, shape := range Shapes {
		if shape.Label() == "" {
			t.Errorf("%s has no name", shape)
		}
		if seed := shape.Seed(); seed.Width <= 0 || seed.Height <= 0 {
			t.Errorf("%s arrives %vx%v", shape, seed.Width, seed.Height)
		}
	}
}

func TestReadsAClassAsItsCompartments(t *testing.T) {
	for _, one := range []struct {
		text string
		want []string
	}{
		{"Order\n---\n- id: string\n---\n+ save(): void", []string{"Order", "- id: string", "+ save(): void"}},
		{"Order", []string{"Order"}},
		{"Order\n----\n\n- id\n", []string{"Order", "\n- id\n"}},
		{"Order\n---\n- id\n", []string{"Order", "- id\n"}},
		// A dash inside a line is not a rule across the box.
		{"Order\n- a - b", []string{"Order\n- a - b"}},
	} {
		if got := ClassParts(one.text); !reflect.DeepEqual(got, one.want) {
			t.Errorf("ClassParts(%q) = %q, want %q", one.text, got, one.want)
		}
	}
}

func TestAClassGrowsTallerWhenAFieldIsWrittenInIt(t *testing.T) {
	one := ClassHeight("Order\n---\n- id\n---\n+ save()")
	more := ClassHeight("Order\n---\n- id\n- name\n---\n+ save()")
	if more <= one {
		t.Errorf("a field added did not make it taller: %v then %v", one, more)
	}
	// A blank compartment is still a line, so it stands as tall as one with something in it.
	if ClassHeight("Order\n---\n\n---\n") != ClassHeight("Order\n---\n-\n---\n-") {
		t.Error("a blank compartment measured differently from a written one")
	}
}

func TestRewritesOneCompartmentAndLeavesTheRest(t *testing.T) {
	was := "Order\n---\n- id\n---\n+ save()"
	if got := WithClassPart(was, 1, "- id\n- name"); got != "Order\n---\n- id\n- name\n---\n+ save()" {
		t.Errorf("got %q", got)
	}
	if got := WithClassPart(was, 0, "Shipment"); got != "Shipment\n---\n- id\n---\n+ save()" {
		t.Errorf("got %q", got)
	}
	for _, index := range []int{7, -1} {
		if got := WithClassPart(was, index, "x"); got != was {
			t.Errorf("compartment %d rewrote something: %q", index, got)
		}
	}
}

func TestResolvesAColourOrFallsBack(t *testing.T) {
	hex, preset, unknown, blank := "#123456", "3", "puce", ""
	for _, one := range []struct {
		color *string
		want  string
	}{
		{nil, FillDefault},
		{&blank, FillDefault},
		{&hex, "#123456"},
		{&preset, "#eab308"},
		{&unknown, FillDefault},
	} {
		if got := PaintOf(one.color, FillDefault); got != one.want {
			t.Errorf("PaintOf(%v) = %q, want %q", one.color, got, one.want)
		}
	}
}

func TestSpellsOutTheDefaultsTheFormatLeavesUnsaid(t *testing.T) {
	if got := ShapeOf(Node{}); got != Rectangle {
		t.Errorf("a node with no shape is a %q", got)
	}
	from, to := EndsOf(Edge{})
	if from != NoEnd || to != Arrow {
		t.Errorf("an edge with no ends wears %q and %q", from, to)
	}
	text := Text
	if got := BorderOf(Node{Shape: &text}); got != InkDefault {
		t.Errorf("a text box is inked %q", got)
	}
	if got := BorderOf(Node{}); got != BorderDefault {
		t.Errorf("a shape is bordered %q", got)
	}
}
