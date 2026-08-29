package grid_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/grid"

	"testing"
)

func TestSnapsToTheGrid(t *testing.T) {
	for _, one := range []struct{ in, want float64 }{
		{0, 0}, {7, 0}, {9, 16}, {16, 16}, {-8, 0}, {-9, -16},
	} {
		if got := Snap(one.in); got != one.want {
			t.Errorf("Snap(%v) = %v, want %v", one.in, got, one.want)
		}
	}
}

func TestRoundsAHalfTheWayJavaScriptDoes(t *testing.T) {
	for _, one := range []struct{ in, want float64 }{
		{0.5, 1}, {-0.5, 0}, {-1.5, -1}, {2.5, 3},
	} {
		if got := Round(one.in); got != one.want {
			t.Errorf("Round(%v) = %v, want %v", one.in, got, one.want)
		}
	}
}
