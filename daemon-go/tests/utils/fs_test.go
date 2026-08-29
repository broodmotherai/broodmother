package utils_test

import (
	. "github.com/broodmotherai/broodmother/daemon-go/internal/utils"

	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvesInsideTheRepo(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "notes/a.md"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	realRoot, _ := filepath.EvalSymlinks(root)
	got, err := ResolveInRoot(root, "notes/a.md")
	if err != nil || got != filepath.Join(realRoot, "notes/a.md") {
		t.Errorf("got %q (%v)", got, err)
	}
}

func TestRejectsTraversalAndAbsolutePaths(t *testing.T) {
	root := t.TempDir()
	for _, input := range []string{"../outside.md", "/etc/passwd"} {
		if _, err := ResolveInRoot(root, input); err == nil {
			t.Errorf("%q was accepted", input)
		}
	}
}

func TestRejectsASymlinkedFileThatPointsOutsideTheRepo(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(root, "escape.md")); err != nil {
		t.Fatal(err)
	}
	assertEscapes(t, root, "escape.md")
}

func TestRejectsAPathTraversingASymlinkedDirectoryOutOfTheRepo(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.md"), []byte("s"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	assertEscapes(t, root, "link/secret.md")
}

func TestRejectsANotYetCreatedFileUnderASymlinkThatEscapes(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	assertEscapes(t, root, "link/new.md")
}

func assertEscapes(t *testing.T, root, input string) {
	t.Helper()
	_, err := ResolveInRoot(root, input)
	if err == nil {
		t.Fatalf("%q was accepted", input)
	}
	if !strings.Contains(err.Error(), "escapes the root") {
		t.Errorf("%q refused as %v", input, err)
	}
}

func TestAllowsASymlinkThatStaysInsideTheRepo(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "real"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "real/a.md"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "real"), filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	got, err := ResolveInRoot(root, "alias/a.md")
	if err != nil || !strings.Contains(got, "alias") {
		t.Errorf("got %q (%v)", got, err)
	}
}

func TestWritesAtomicallyAndLeavesNoScratchBehind(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "nested/a.md")
	for _, want := range []string{"hello", "again"} {
		if err := AtomicWrite(target, []byte(want), 0o644); err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(target)
		if err != nil || string(got) != want {
			t.Fatalf("read back %q (%v)", got, err)
		}
	}
	entries, err := os.ReadDir(filepath.Join(root, "nested"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".broodmothertmp") {
			t.Errorf("scratch file left behind: %s", entry.Name())
		}
	}
}

func TestWritesACredentialUnreadableToAnybodyElse(t *testing.T) {
	target := filepath.Join(t.TempDir(), "key.json")
	if err := AtomicWrite(target, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("mode %o, want 600", mode)
	}
}

func TestNamesAPathTheWayTheBrowserAsksForIt(t *testing.T) {
	if got := ToDocPath("/tmp/project", "/tmp/project/a/b.md"); got != "a/b.md" {
		t.Errorf("got %q", got)
	}
}
