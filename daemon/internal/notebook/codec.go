// The notebook file, read and written. Parsing refuses anything it cannot vouch for, and says
// which cell was wrong.
//
// Writing is not canonical, which is where this codec parts company with the three beside it. A
// notebook belongs to Jupyter as much as to this editor, so a save merges the model back into
// the JSON it was parsed from rather than writing the model out fresh: cells are matched by id,
// only what changed is written over, and a notebook nobody changed comes back as the very bytes
// that went in.

package notebook

import (
	"fmt"
	"slices"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/jsjson"
)

func fail(format string, args ...any) error { return apperr.Notebookf(format, args...) }

const defaultLanguage = "python"

func record(value any, what string) (*jsjson.Object, error) {
	held, ok := value.(*jsjson.Object)
	if !ok {
		return nil, fail("%s is not an object", what)
	}
	return held, nil
}

// quoted is how the TypeScript names a value it will not read: `JSON.stringify(value)`, which is
// the value quoted — and the bare word `undefined` where the field is absent, since that is what
// stringify answers with and what the template then interpolates.
func quoted(value any, found bool) string {
	if !found {
		return "undefined"
	}
	return jsjson.Compact(value)
}

func number(value any) *float64 {
	held, ok := value.(float64)
	if !ok {
		return nil
	}
	return &held
}

// numberOrNull writes a count back the way the format holds it: a number, or an explicit null.
func numberOrNull(count *float64) any {
	if count == nil {
		return nil
	}
	return *count
}

func sameNumber(one, other *float64) bool {
	if one == nil || other == nil {
		return one == nil && other == nil
	}
	return *one == *other
}

// sameCount is `raw.execution_count !== cell.executionCount`, negated. A field the file does not
// carry at all is not the same as one carrying null, which is why found is asked for separately.
func sameCount(raw any, found bool, count *float64) bool {
	if !found {
		return false
	}
	if count == nil {
		return raw == nil
	}
	held, ok := raw.(float64)
	return ok && held == *count
}

// joined: nbformat writes text as a list of lines with their newlines kept; either form is read.
func joined(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	items, ok := value.([]any)
	if !ok {
		return ""
	}
	var out strings.Builder
	for _, one := range items {
		text, ok := one.(string)
		if !ok {
			return ""
		}
		out.WriteString(text)
	}
	return out.String()
}

// lines is the inverse: `"a\nb\n"` becomes `["a\n", "b\n"]`, the shape Jupyter itself writes.
func lines(text string) []string {
	if text == "" {
		return []string{}
	}
	parts := strings.Split(text, "\n")
	last := parts[len(parts)-1]
	kept := make([]string, 0, len(parts))
	for _, one := range parts[:len(parts)-1] {
		kept = append(kept, one+"\n")
	}
	if last != "" {
		kept = append(kept, last)
	}
	return kept
}

// asText is JavaScript's `String(value)`, which is what a traceback's lines are put through. A
// traceback is a list of strings in every notebook anybody has written, and is a list of
// whatever JSON holds in the one that is malformed — so the port owes the same answer for the
// malformed one, down to `[object Object]`.
func asText(value any) string {
	switch held := value.(type) {
	case string:
		return held
	case nil:
		return "null"
	case bool:
		if held {
			return "true"
		}
		return "false"
	case *jsjson.Object:
		return "[object Object]"
	case []any:
		parts := make([]string, 0, len(held))
		for _, one := range held {
			// Array.prototype.join writes nothing for a null, rather than the word.
			if one == nil {
				parts = append(parts, "")
				continue
			}
			parts = append(parts, asText(one))
		}
		return strings.Join(parts, ",")
	}
	// A number, which JavaScript spells the same way whether it is being stringified or written
	// into JSON.
	return jsjson.Compact(value)
}

func liftOutput(value any, where string) (CellOutput, error) {
	held, err := record(value, where)
	if err != nil {
		return CellOutput{}, err
	}
	kind, found := held.Get("output_type")
	switch kind {
	case "stream":
		name := "stdout"
		if named, _ := held.Get("name"); named == "stderr" {
			name = "stderr"
		}
		text, _ := held.Get("text")
		return CellOutput{Kind: Stream, Name: name, Text: joined(text)}, nil
	case "error":
		ename, _ := held.Get("ename")
		evalue, _ := held.Get("evalue")
		output := CellOutput{Kind: Error, Traceback: []string{}}
		output.EName, _ = ename.(string)
		output.EValue, _ = evalue.(string)
		traceback, _ := held.Get("traceback")
		if items, ok := traceback.([]any); ok {
			for _, one := range items {
				output.Traceback = append(output.Traceback, asText(one))
			}
		}
		return output, nil
	case "execute_result", "display_data":
		bundle, _ := held.Get("data")
		if bundle == nil {
			bundle = jsjson.NewObject()
		}
		data, err := record(bundle, where+" data")
		if err != nil {
			return CellOutput{}, err
		}
		output := CellOutput{Kind: Display, Data: data}
		if kind == "execute_result" {
			count, _ := held.Get("execution_count")
			output.ExecutionCount = number(count)
		}
		return output, nil
	}
	return CellOutput{}, fail("%s has unknown output type %s", where, quoted(kind, found))
}

// idOf is the id a cell is matched back to its JSON by. Files older than nbformat 4.5 have none,
// so one is minted from the position — `@` is outside nbformat's id alphabet, so a minted id can
// never collide with a written one, and it is never written back.
func idOf(held *jsjson.Object, index int) string {
	id, _ := held.Get("id")
	if text, ok := id.(string); ok {
		return text
	}
	return fmt.Sprintf("cell@%d", index)
}

func liftCell(value any, index int) (Cell, error) {
	held, err := record(value, fmt.Sprintf("cell %d", index))
	if err != nil {
		return Cell{}, err
	}
	kind, found := held.Get("cell_type")
	named, _ := kind.(string)
	if !CellType(named).valid() {
		return Cell{}, fail("cell %d has unknown type %s", index, quoted(kind, found))
	}
	source, _ := held.Get("source")
	count, _ := held.Get("execution_count")
	cell := Cell{
		ID:             idOf(held, index),
		Type:           CellType(named),
		Source:         joined(source),
		Outputs:        []CellOutput{},
		ExecutionCount: number(count),
	}
	if cell.Type != Code {
		return cell, nil
	}
	outputs, _ := held.Get("outputs")
	items, ok := outputs.([]any)
	if !ok {
		return cell, nil
	}
	for at, one := range items {
		output, err := liftOutput(one, fmt.Sprintf("cell %d output %d", index, at))
		if err != nil {
			return Cell{}, err
		}
		cell.Outputs = append(cell.Outputs, output)
	}
	return cell, nil
}

func cellList(held *jsjson.Object) ([]any, bool) {
	value, _ := held.Get("cells")
	items, ok := value.([]any)
	return items, ok
}

func liftNotebook(source string) (*jsjson.Object, error) {
	value, ok := jsjson.Parse(source)
	if !ok {
		return nil, fail("not JSON")
	}
	held, err := record(value, "notebook")
	if err != nil {
		return nil, err
	}
	format, found := held.Get("nbformat")
	if format != any(float64(4)) {
		return nil, fail("nbformat %s", quoted(format, found))
	}
	if _, isList := cellList(held); !isList {
		return nil, fail("cells is not a list")
	}
	return held, nil
}

func languageOf(held *jsjson.Object) string {
	metadata, _ := held.Get("metadata")
	holder, ok := metadata.(*jsjson.Object)
	if !ok {
		return defaultLanguage
	}
	kernelspec, _ := holder.Get("kernelspec")
	kernel, ok := kernelspec.(*jsjson.Object)
	if !ok {
		return defaultLanguage
	}
	language, _ := kernel.Get("language")
	if named, ok := language.(string); ok {
		return named
	}
	return defaultLanguage
}

func Parse(source string) (Notebook, error) {
	held, err := liftNotebook(source)
	if err != nil {
		return Notebook{}, err
	}
	rawCells, _ := cellList(held)
	cells := make([]Cell, 0, len(rawCells))
	for index, value := range rawCells {
		cell, err := liftCell(value, index)
		if err != nil {
			return Notebook{}, err
		}
		cells = append(cells, cell)
	}
	return Notebook{Cells: cells, Language: languageOf(held)}, nil
}

func dumpOutput(output CellOutput) *jsjson.Object {
	held := jsjson.NewObject()
	switch output.Kind {
	case Stream:
		held.Set("name", output.Name)
		held.Set("output_type", "stream")
		held.Set("text", lines(output.Text))
	case Error:
		held.Set("ename", output.EName)
		held.Set("evalue", output.EValue)
		held.Set("output_type", "error")
		held.Set("traceback", output.Traceback)
	case Display:
		held.Set("data", output.Data)
		if output.ExecutionCount != nil {
			held.Set("execution_count", *output.ExecutionCount)
		}
		held.Set("metadata", jsjson.NewObject())
		if output.ExecutionCount == nil {
			held.Set("output_type", "display_data")
		} else {
			held.Set("output_type", "execute_result")
		}
	}
	return held
}

func dumpOutputs(outputs []CellOutput) []any {
	dumped := make([]any, 0, len(outputs))
	for _, output := range outputs {
		dumped = append(dumped, dumpOutput(output))
	}
	return dumped
}

func freshCell(cell Cell, metadata any, withID bool) *jsjson.Object {
	head := jsjson.NewObject()
	head.Set("cell_type", string(cell.Type))
	if cell.Type == Code {
		head.Set("execution_count", numberOrNull(cell.ExecutionCount))
	}
	if withID {
		head.Set("id", cell.ID)
	}
	if metadata == nil {
		metadata = jsjson.NewObject()
	}
	head.Set("metadata", metadata)
	if cell.Type == Code {
		head.Set("outputs", dumpOutputs(cell.Outputs))
	}
	head.Set("source", lines(cell.Source))
	return head
}

func sameOutput(one, other CellOutput) bool {
	if one.Kind != other.Kind {
		return false
	}
	switch one.Kind {
	case Stream:
		return one.Name == other.Name && one.Text == other.Text
	case Error:
		return one.EName == other.EName && one.EValue == other.EValue &&
			slices.Equal(one.Traceback, other.Traceback)
	}
	return sameNumber(one.ExecutionCount, other.ExecutionCount) &&
		jsjson.Compact(one.Data) == jsjson.Compact(other.Data)
}

func sameOutputs(one, other []CellOutput) bool {
	return slices.EqualFunc(one, other, sameOutput)
}

// keptOutputs is the cell's own outputs read back out of its JSON, which is what the model's are
// compared against. Lifted rather than raw, so a form the codec normalises — a `display_data`
// written with an execution count, a stream named something that is neither — reads as unchanged
// and the file keeps the bytes it had.
func keptOutputs(raw *jsjson.Object) ([]CellOutput, error) {
	value, _ := raw.Get("outputs")
	items, ok := value.([]any)
	if !ok {
		return nil, nil
	}
	kept := make([]CellOutput, 0, len(items))
	for at, one := range items {
		output, err := liftOutput(one, fmt.Sprintf("output %d", at))
		if err != nil {
			return nil, err
		}
		kept = append(kept, output)
	}
	return kept, nil
}

// mergeCell is the cell's original JSON with only what changed written over it, so metadata and
// keys this codec has no opinion about ride through untouched. A cell whose type switched keeps
// only its metadata: the rest of its shape belongs to the type it no longer is.
func mergeCell(cell Cell, raw *jsjson.Object, withID bool) (*jsjson.Object, error) {
	if raw == nil {
		return freshCell(cell, nil, withID), nil
	}
	kind, _ := raw.Get("cell_type")
	if named, ok := kind.(string); !ok || named != string(cell.Type) {
		metadata, _ := raw.Get("metadata")
		return freshCell(cell, metadata, withID), nil
	}
	merged := raw.Clone()
	source, _ := raw.Get("source")
	if joined(source) != cell.Source {
		merged.Set("source", lines(cell.Source))
	}
	if cell.Type != Code {
		return merged, nil
	}
	count, found := raw.Get("execution_count")
	if !sameCount(count, found, cell.ExecutionCount) {
		merged.Set("execution_count", numberOrNull(cell.ExecutionCount))
	}
	kept, err := keptOutputs(raw)
	if err != nil {
		return nil, err
	}
	if !sameOutputs(kept, cell.Outputs) {
		merged.Set("outputs", dumpOutputs(cell.Outputs))
	}
	return merged, nil
}

// Serialize merges the model back into the JSON it was parsed from: cells are matched by id, new
// cells are written fresh, and everything unmatched by an edit — notebook metadata, cell
// metadata, unknown keys — is carried verbatim. A notebook nobody changed comes back as the very
// bytes that went in.
func Serialize(n Notebook, originalJSON string) (string, error) {
	original, err := liftNotebook(originalJSON)
	if err != nil {
		return "", err
	}
	rawCells, _ := cellList(original)
	byID := map[string]*jsjson.Object{}
	for index, value := range rawCells {
		raw, err := record(value, fmt.Sprintf("cell %d", index))
		if err != nil {
			return "", err
		}
		byID[idOf(raw, index)] = raw
	}
	// Ids are only written where the file already speaks them: nbformat 4.5 is where cell ids
	// became part of the format, and writing one into an older file makes it invalid.
	minor, _ := original.Get("nbformat_minor")
	withID := false
	if held := number(minor); held != nil {
		withID = *held >= 5
	}

	cells := make([]any, 0, len(n.Cells))
	for _, cell := range n.Cells {
		merged, err := mergeCell(cell, byID[cell.ID], withID)
		if err != nil {
			return "", err
		}
		cells = append(cells, merged)
	}
	merged := original.Clone()
	merged.Set("cells", cells)
	if jsjson.Compact(merged) == jsjson.Compact(original) {
		return originalJSON, nil
	}
	tail := ""
	if strings.HasSuffix(originalJSON, "\n") {
		tail = "\n"
	}
	return jsjson.Indent(merged, " ") + tail, nil
}
