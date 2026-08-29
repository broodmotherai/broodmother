package notebook

import (
	"reflect"
	"testing"

	"github.com/broodmotherai/broodmother/daemon-go/internal/jsjson"
)

func TestReadsANotebookByItsExtensionWhateverItsCase(t *testing.T) {
	for _, path := range []string{"notes/one.ipynb", "ONE.IPYNB", "a/b/.hidden.ipynb"} {
		if !IsNotebookPath(path) {
			t.Errorf("%s did not read as a notebook", path)
		}
	}
	for _, path := range []string{"one.md", "ipynb", ".ipynb", "one.ipynb.bak"} {
		if IsNotebookPath(path) {
			t.Errorf("%s read as a notebook", path)
		}
	}
}

// The model, which the corpus only sees through the bytes a merge writes: a cell that changed
// nothing writes nothing, so a field read wrong here can light no case there.
func TestReadsACellIntoTheModel(t *testing.T) {
	parsed, err := Parse(`{"nbformat":4,"nbformat_minor":5,"cells":[
		{"cell_type":"code","id":"a1","execution_count":2,
		 "source":["print(1)\n","print(2)"],
		 "outputs":[
		   {"output_type":"stream","name":"stderr","text":["one\n","two"]},
		   {"output_type":"error","ename":"E","evalue":"v","traceback":["a","b"]},
		   {"output_type":"execute_result","execution_count":2,"data":{"text/plain":"2"}},
		   {"output_type":"display_data","data":{"image/png":"x"}}]},
		{"cell_type":"markdown","source":"# hi"}],
		"metadata":{"kernelspec":{"language":"julia"}}}`)
	if err != nil {
		t.Fatalf("refused a notebook: %v", err)
	}
	if parsed.Language != "julia" {
		t.Errorf("language is %q", parsed.Language)
	}
	if len(parsed.Cells) != 2 {
		t.Fatalf("read %d cells", len(parsed.Cells))
	}

	code := parsed.Cells[0]
	if code.ID != "a1" || code.Type != Code || code.Source != "print(1)\nprint(2)" {
		t.Errorf("read the code cell as %+v", code)
	}
	if code.ExecutionCount == nil || *code.ExecutionCount != 2 {
		t.Errorf("execution count is %v", code.ExecutionCount)
	}
	// A cell with no id of its own is matched by its position, in an alphabet nbformat's own
	// ids cannot reach.
	if parsed.Cells[1].ID != "cell@1" {
		t.Errorf("the second cell is %q", parsed.Cells[1].ID)
	}

	want := []CellOutput{
		{Kind: Stream, Name: "stderr", Text: "one\ntwo"},
		{Kind: Error, EName: "E", EValue: "v", Traceback: []string{"a", "b"}},
		{Kind: Display, ExecutionCount: code.ExecutionCount},
		{Kind: Display},
	}
	if len(code.Outputs) != len(want) {
		t.Fatalf("read %d outputs", len(code.Outputs))
	}
	for at, one := range code.Outputs {
		one.Data = nil
		if !reflect.DeepEqual(one, want[at]) {
			t.Errorf("output %d is %+v, want %+v", at, one, want[at])
		}
	}
	if got := jsjson.Compact(code.Outputs[2].Data); got != `{"text/plain":"2"}` {
		t.Errorf("the result's bundle is %s", got)
	}
}

// The one measure a save is judged by: a notebook nobody changed is the bytes that went in,
// down to whether the file ended in a newline.
func TestGivesBackTheBytesItWasGivenWhenNothingChanged(t *testing.T) {
	for _, source := range []string{
		"{\n \"cells\": [],\n \"metadata\": {},\n \"nbformat\": 4,\n \"nbformat_minor\": 5\n}\n",
		`{"nbformat":4,   "cells":[],"junk":[1,2]}`,
	} {
		parsed, err := Parse(source)
		if err != nil {
			t.Fatalf("refused a notebook: %v", err)
		}
		got, err := Serialize(parsed, source)
		if err != nil {
			t.Fatal(err)
		}
		if got != source {
			t.Errorf("rewrote an untouched notebook:\n got %q\nwant %q", got, source)
		}
	}
}

// Every kind of value a traceback can hold in a file nobody wrote by hand, put through the
// conversion JavaScript puts it through.
func TestReadsATracebackTheWayJavaScriptStringifiesOne(t *testing.T) {
	value, _ := jsjson.Parse(`["a",1,null,true,{"x":1},["y","z"],[]]`)
	items, _ := value.([]any)
	want := []string{"a", "1", "null", "true", "[object Object]", "y,z", ""}
	for at, one := range items {
		if got := asText(one); got != want[at] {
			t.Errorf("item %d is %q, want %q", at, got, want[at])
		}
	}
}
