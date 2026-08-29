package jsjson_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/jsjson"

	"testing"
)

// The property every caller here stands on: a Go map is unordered and encoding/json writes one
// sorted, so a file read through either would come back alphabetised on its first save.
func TestAnObjectKeepsTheOrderItsKeysArrivedIn(t *testing.T) {
	value, ok := Parse(`{"z":1,"a":2,"m":{"y":3,"b":4}}`)
	if !ok {
		t.Fatal("refused JSON")
	}
	if got := Compact(value); got != `{"z":1,"a":2,"m":{"y":3,"b":4}}` {
		t.Errorf("wrote %s", got)
	}
}

// A key written twice keeps the place it first had and the value it last got, which is what
// JSON.parse does with it.
func TestAKeyWrittenTwiceKeepsItsPlaceAndItsLastValue(t *testing.T) {
	value, ok := Parse(`{"a":1,"b":2,"a":3}`)
	if !ok {
		t.Fatal("refused JSON")
	}
	if got := Compact(value); got != `{"a":3,"b":2}` {
		t.Errorf("wrote %s", got)
	}
}

func TestRefusesAnythingAfterTheValue(t *testing.T) {
	if _, ok := Parse(`{"a":1} {"b":2}`); ok {
		t.Error("read two values as one")
	}
	if _, ok := Parse(`{"a":1} `); !ok {
		t.Error("refused trailing space")
	}
}
