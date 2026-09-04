package jstext_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/jstext"

	"testing"
)

// The whole reason this package exists: a JavaScript string is counted in UTF-16 code units, and
// the count reaches the user in the message a record over the limit is refused with.
func TestCountsTheWayTheBrowserCounts(t *testing.T) {
	for _, one := range []struct {
		in   string
		want int
	}{
		{"", 0},
		{"abc", 3},
		{"héllo", 5},
		{"日本語", 3},
		{"a\U0001F600b", 4},
	} {
		if got := Length(one.in); got != one.want {
			t.Errorf("Length(%q) = %d, want %d", one.in, got, one.want)
		}
	}
}

func TestCutsWhereTheBrowserCutsAndNeverThroughACharacter(t *testing.T) {
	for _, one := range []struct {
		in    string
		units int
		want  string
	}{
		{"abcdef", 3, "abc"},
		{"abc", 9, "abc"},
		{"abc", 0, ""},
		{"a\U0001F600b", 3, "a\U0001F600"},
		// JavaScript would hand back half a surrogate pair here, which Go has no string for.
		{"a\U0001F600b", 2, "a"},
	} {
		if got := Head(one.in, one.units); got != one.want {
			t.Errorf("Head(%q, %d) = %q, want %q", one.in, one.units, got, one.want)
		}
	}
}

// JavaScript's whitespace is not Go's and not Unicode's: the byte order mark is in, and the next
// line character — which unicode.IsSpace takes — is out.
func TestSpaceIsWhatJavaScriptCallsSpace(t *testing.T) {
	for _, one := range []struct {
		r    rune
		want bool
	}{
		{' ', true}, {'\t', true}, {'\n', true}, {'\v', true}, {'\f', true}, {'\r', true},
		{0x00A0, true}, {0x3000, true}, {0x2028, true}, {0x2029, true}, {0xFEFF, true},
		{0x0085, false}, {'a', false}, {0x200B, false},
	} {
		if got := IsSpace(one.r); got != one.want {
			t.Errorf("IsSpace(%U) = %v, want %v", one.r, got, one.want)
		}
	}
}

func TestFlattensRunsOfSpaceAndLosesTheOnesAtTheEnds(t *testing.T) {
	for _, one := range []struct{ in, want string }{
		{"a b", "a b"},
		{"  a   b  ", "a b"},
		{" a ", "a"},
		{"\ta\n", "a"},
		{"\ufeffa", "a"},
		{"a\u3000b", "a b"},
		{"ab", "ab"},
		{"", ""},
		{"   ", ""},
	} {
		if got := Flatten(one.in); got != one.want {
			t.Errorf("Flatten(%q) = %q, want %q", one.in, got, one.want)
		}
	}
}
