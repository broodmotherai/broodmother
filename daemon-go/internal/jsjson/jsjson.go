// Package jsjson is JSON held the way JavaScript holds it, which is not how encoding/json holds
// it.
//
// The difference that matters is order. `JSON.parse` hands back an object whose keys are in the
// order the file wrote them and `JSON.stringify` writes them back in that order; a Go map has no
// order at all, and encoding/json writes one sorted. Any format this daemon reads, edits in part
// and writes back therefore comes out alphabetised on its first save — every line of the file
// moved, by a save that changed one field. A notebook is merged back into the JSON it was parsed
// from and a profile is written as the file it was read from plus what changed, so both need
// this rather than a map.
//
// A value here is a string, a float64, a bool, nil, a []any or an [*Object], and the writer is
// this package's. The scalars are still encoding/json's, which is what keeps a number spelled
// the way JSON.stringify spells it.

package jsjson

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"slices"
	"strings"
)

// Object is a JSON object in the order its keys arrived in.
type Object struct {
	keys   []string
	values map[string]any
}

func NewObject() *Object { return &Object{values: map[string]any{}} }

// Keys is the order the object is written in. A key written twice keeps the place it first had
// and the value it last got, which is what JSON.parse does with a repeated key.
func (o *Object) Keys() []string {
	if o == nil {
		return nil
	}
	return slices.Clone(o.keys)
}

func (o *Object) Get(key string) (any, bool) {
	if o == nil {
		return nil, false
	}
	value, found := o.values[key]
	return value, found
}

func (o *Object) Set(key string, value any) {
	if _, found := o.values[key]; !found {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
}

// Clone is shallow, which is all a write over one field needs: what is replaced is replaced
// wholesale, and nothing deeper is written to.
func (o *Object) Clone() *Object {
	return &Object{keys: slices.Clone(o.keys), values: maps.Clone(o.values)}
}

// errMalformed stands for the two shapes a JSON decoder cannot hand back and Go still needs a
// branch for. Nothing reads it: readJSON answers whether the source was JSON at all.
var errMalformed = errors.New("malformed")

// Parse is JSON.parse: one value, and nothing after it. The second answer is whether the source
// was JSON at all — why it was not is a question no caller here asks.
func Parse(source string) (any, bool) {
	decoder := json.NewDecoder(strings.NewReader(source))
	value, err := readValue(decoder)
	if err != nil {
		return nil, false
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return nil, false
	}
	return value, true
}

func readValue(decoder *json.Decoder) (any, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	delim, opening := token.(json.Delim)
	if !opening {
		return token, nil
	}
	switch delim {
	case '{':
		held := NewObject()
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			value, err := readValue(decoder)
			if err != nil {
				return nil, err
			}
			named, ok := key.(string)
			if !ok {
				return nil, errMalformed
			}
			held.Set(named, value)
		}
		_, err := decoder.Token()
		return held, err
	case '[':
		// An empty list rather than a nil one: nil would be written as `null`.
		items := []any{}
		for decoder.More() {
			item, err := readValue(decoder)
			if err != nil {
				return nil, err
			}
			items = append(items, item)
		}
		_, err := decoder.Token()
		return items, err
	}
	return nil, errMalformed
}

func writeValue(out *bytes.Buffer, value any) {
	switch held := value.(type) {
	case *Object:
		out.WriteByte('{')
		for at, key := range held.Keys() {
			if at > 0 {
				out.WriteByte(',')
			}
			writeScalar(out, key)
			out.WriteByte(':')
			writeValue(out, held.values[key])
		}
		out.WriteByte('}')
	case []any:
		out.WriteByte('[')
		for at, item := range held {
			if at > 0 {
				out.WriteByte(',')
			}
			writeValue(out, item)
		}
		out.WriteByte(']')
	case []string:
		out.WriteByte('[')
		for at, item := range held {
			if at > 0 {
				out.WriteByte(',')
			}
			writeScalar(out, item)
		}
		out.WriteByte(']')
	default:
		writeScalar(out, value)
	}
}

// writeScalar is encoding/json's, for the number spelling — a float is printed the way
// JSON.stringify prints it, `1e+21` threshold and all. The encoder rather than Marshal is for
// the reason the canvas codec gives: Go escapes `<`, `>` and `&` unless told not to, and
// JSON.stringify does not.
func writeScalar(out *bytes.Buffer, value any) {
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		// Everything that reaches here came out of JSON: a string, a finite number, a bool or
		// nil. There is nothing encoding/json can refuse.
		panic(err)
	}
	out.Truncate(out.Len() - 1) // Encode's own trailing newline, which the caller places.
}

// Compact is `JSON.stringify(value)` — the spelling two values are compared as, since a file
// that came back the same is written back as the bytes that went in.
func Compact(value any) string {
	var out bytes.Buffer
	writeValue(&out, value)
	return out.String()
}

// Indent is `JSON.stringify(value, null, n)`, where the indent is given as the string it is
// written with — nbformat writes a notebook with one space and everything else here uses two.
func Indent(value any, indent string) string {
	var out bytes.Buffer
	if err := json.Indent(&out, []byte(Compact(value)), "", indent); err != nil {
		panic(err) // Compact wrote it; Indent cannot refuse it.
	}
	return out.String()
}
