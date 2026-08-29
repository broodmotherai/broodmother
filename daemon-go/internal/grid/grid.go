// Package grid is the grid both boards walk — the diagram's and the task's. A drag snaps to it,
// the dots are drawn on it, and anything laying a board out by hand moves in it, so a file
// written from a terminal stands where a file written in the editor stands.
package grid

import "math"

const Grid = 16.0

func Snap(value float64) float64 { return Round(value/Grid) * Grid }

// Round is Math.round, which is not math.Round: JavaScript rounds a half up toward positive
// infinity, so -0.5 is -0 there and -1 here. A board laid out either side of the origin would
// otherwise snap differently in the browser and in the daemon.
func Round(value float64) float64 { return math.Floor(value + 0.5) }
