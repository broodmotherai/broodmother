package project_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/project"

	"os"
	"path/filepath"
	"testing"
)

func profileDir(t *testing.T, names ...string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "Michael")
	for _, name := range names {
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// A project is any plain directory in a profile's folder — drop one in and it is picked up. The
// order is the browser's, which puts a lowercase name before a capital.
func TestListsEveryPlainFolderInTheBrowsersOrder(t *testing.T) {
	dir := profileDir(t, "Zeta", "notes", ".hidden", "alpha")
	if err := os.WriteFile(filepath.Join(dir, "a-file.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"alpha", "notes", "Zeta"}
	if len(all) != len(want) {
		t.Fatalf("listed %+v", all)
	}
	for index, name := range want {
		if all[index].Name != name {
			t.Fatalf("listed %+v, want %v", all, want)
		}
	}
}

// Which profile a project commits as is where it sits, so it is read off the folder rather than
// remembered anywhere.
func TestAProjectSaysWhichProfileItSitsIn(t *testing.T) {
	dir := profileDir(t, "notes")
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if all[0].Profile != "Michael" || all[0].Path != filepath.Join(dir, "notes") {
		t.Errorf("read as %+v", all[0])
	}
	// Of reads the same three things off a path alone, which is what the open project is.
	if got := Of(filepath.Join(dir, "notes")); got != all[0] {
		t.Errorf("Of gave %+v", got)
	}
}

// A folder that is not there yet is a profile with no projects, not an error: a new profile is
// where that happens.
func TestAProfileWithNoProjectsListsNone(t *testing.T) {
	all, err := List(filepath.Join(t.TempDir(), "new"))
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Errorf("listed %+v", all)
	}
}

func TestFindsOneByNameAndNothingByAnother(t *testing.T) {
	dir := profileDir(t, "notes")
	found, err := Find("notes", dir)
	if err != nil || found == nil {
		t.Fatalf("found %v, %v", found, err)
	}
	missing, err := Find("nothing", dir)
	if err != nil || missing != nil {
		t.Fatalf("found %v, %v", missing, err)
	}
}

// The name becomes a folder, so what a folder cannot be called a project cannot be called.
func TestRefusesANameAFolderCannotHave(t *testing.T) {
	for _, name := range []string{"", " padded ", ".hidden", "a/b", "a\\b"} {
		if err := AssertName(name); err == nil {
			t.Errorf("took %q", name)
		}
	}
	if err := AssertName("notes"); err != nil {
		t.Errorf("refused a plain name: %v", err)
	}
}
