package markdown_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/markdown"

	"testing"
)

const fenced = "---\nentity: finding\nname: A finding\n---\n\nThe prose.\n"

func TestReadsOneLineOutOfTheHeader(t *testing.T) {
	for _, one := range []struct{ key, want string }{
		{"entity", "finding"},
		{"name", "A finding"},
		{"sha", ""},
	} {
		if got := Field(fenced, one.key); got != one.want {
			t.Errorf("Field(%q) = %q, want %q", one.key, got, one.want)
		}
	}
	if got := Field("No fence here.\n", "entity"); got != "" {
		t.Errorf("found %q in a document with no header", got)
	}
}

func TestTakesTheFenceOffAndTheBlankLinesItLeftBehind(t *testing.T) {
	header, body, found := Split(fenced)
	if !found {
		t.Fatal("no fence found")
	}
	if header != "entity: finding\nname: A finding" {
		t.Errorf("header is %q", header)
	}
	if body != "The prose.\n" {
		t.Errorf("body is %q", body)
	}
	if got := Strip(fenced); got != body {
		t.Errorf("Strip disagreed with Split: %q", got)
	}
}

// A document typed on Windows has both, and the fence is allowed its trailing spaces.
func TestOpensAFenceWrittenAnyOfTheWaysItIsWritten(t *testing.T) {
	for _, one := range []struct{ name, in, want string }{
		{"CRLF", "---\r\na: b\r\nc: d\r\n---\r\nprose", "a: b\r\nc: d"},
		{"trailing spaces", "--- \na: b\n--- \nprose", "a: b"},
		{"a trailing tab", "---\t\na: b\n---\t\nprose", "a: b"},
		{"no newline after the closing fence", "---\na: b\n---", "a: b"},
	} {
		t.Run(one.name, func(t *testing.T) {
			header, _, found := Split(one.in)
			if !found || header != one.want {
				t.Errorf("read %q, %v", header, found)
			}
		})
	}
}

// The fence has to be the first thing in the document, and the first closing rule wins — a body
// that opens with a rule of its own is a body, not a second header.
func TestOnlyTheFenceAtTheTopIsAHeader(t *testing.T) {
	if _, _, found := Split("Some prose.\n---\na: b\n---\n"); found {
		t.Error("read a header out of the middle of a document")
	}
	header, body, _ := Split("---\na: b\n---\n\n---\n\nprose")
	if header != "a: b" || body != "---\n\nprose" {
		t.Errorf("read %q and %q", header, body)
	}
}

func TestADocumentWithNoFenceIsAllBody(t *testing.T) {
	if got := Strip("\n\nJust prose.\n"); got != "Just prose.\n" {
		t.Errorf("Strip returned %q", got)
	}
}
