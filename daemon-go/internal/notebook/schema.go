// Package notebook is what a Jupyter notebook is: cells, what each of them said when it ran, and
// the file it lives in. The shape only — reading and writing one is the codec's.
//
// The model is deliberately smaller than the file. nbformat has four output types and this has
// three, because `execute_result` and `display_data` are the same MIME bundle and which one a
// bundle was is carried by the count of the run that produced it. Everything else the file holds
// — kernel metadata, per-cell metadata, widget state, keys no version of this codec has heard of
// — has no field here at all, and rides through the codec untouched. A notebook is somebody
// else's format before it is ours.
package notebook

import (
	"github.com/broodmotherai/broodmother/daemon-go/internal/jsjson"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

const Extension = ".ipynb"

func IsNotebookPath(path string) bool { return utils.Extension(path) == "ipynb" }

type CellType string

const (
	Code     CellType = "code"
	Markdown CellType = "markdown"
	Raw      CellType = "raw"
)

func (t CellType) valid() bool { return t == Code || t == Markdown || t == Raw }

// OutputKind is nbformat's four output types lifted to three.
type OutputKind string

const (
	Stream  OutputKind = "stream"
	Error   OutputKind = "error"
	Display OutputKind = "display"
)

// CellOutput is one thing a cell said when it ran. One struct wearing every field any kind can
// carry, for the reason the task's node gives: Go has no discriminated union, and the codec is
// what keeps it from being a loose bag — it reads only the fields the kind allows and writes
// only the fields the kind carries.
type CellOutput struct {
	Kind OutputKind

	// Stream: which of the two streams, and what came down it.
	Name string
	Text string

	// Error: what was raised, what it said, and where it came from.
	EName     string
	EValue    string
	Traceback []string

	// Display: the MIME bundle, and the count of the run that produced it where the bundle was
	// a result rather than a drawing.
	Data           *jsjson.Object
	ExecutionCount *float64
}

type Cell struct {
	// ID is what a cell is matched back to its JSON by. Files older than nbformat 4.5 have none,
	// so one is minted from the position and never written back.
	ID             string
	Type           CellType
	Source         string
	Outputs        []CellOutput
	ExecutionCount *float64
}

type Notebook struct {
	Cells    []Cell
	Language string
}
