package utils_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/utils"

	"testing"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
)

func TestAcceptsARelativePosixPath(t *testing.T) {
	got, err := Normalize("Handbook/Overview/Overview.md")
	if err != nil || got != "Handbook/Overview/Overview.md" {
		t.Errorf("got %q (%v)", got, err)
	}
}

func TestRejectsWhatIsNotAnAddress(t *testing.T) {
	for _, input := range []string{
		"", "..", "../secrets", "a/../../b", "a/./b", "/etc/passwd", "C:/Windows",
		"a//b", "a/b/", `notes\..\..\x`, "a\x00b", ".git/config",
		".broodmother/config.json", "nested/.git/hooks/pre-commit",
	} {
		_, err := Normalize(input)
		if err == nil {
			t.Errorf("%q was accepted", input)
			continue
		}
		if !apperr.KindOf(err, apperr.Path) {
			t.Errorf("%q refused as the wrong kind: %v", input, err)
		}
	}
}

func TestKeepsADotfileThatIsNotOurs(t *testing.T) {
	for _, input := range []string{".env", "notes/.keep"} {
		if _, err := Normalize(input); err != nil {
			t.Errorf("%q was refused: %v", input, err)
		}
	}
}

func TestReadsAnExtensionLowercasedAndUndotted(t *testing.T) {
	for _, one := range []struct{ in, want string }{
		{"a/b.PNG", "png"}, {"a/b.tar.gz", "gz"}, {"a/README", ""}, {"a/.env", ""},
	} {
		if got := Extension(one.in); got != one.want {
			t.Errorf("Extension(%q) = %q, want %q", one.in, got, one.want)
		}
	}
}

func TestShortensAHomeToATilde(t *testing.T) {
	for _, one := range []struct{ in, want string }{
		{"/Users/michael/notes/a.md", "~/notes/a.md"},
		{"/home/michael/notes/a.md", "~/notes/a.md"},
		{"/opt/broodmother", "/opt/broodmother"},
	} {
		if got := Tilde(one.in); got != one.want {
			t.Errorf("Tilde(%q) = %q, want %q", one.in, got, one.want)
		}
	}
}

func TestComplainsAboutANameThatIsNotOne(t *testing.T) {
	if NameProblem("broodmother") != "" {
		t.Error("a good name was complained about")
	}
	for _, name := range []string{"", " padded ", ".hidden", "a/b"} {
		if NameProblem(name) == "" {
			t.Errorf("%q was accepted", name)
		}
	}
}
