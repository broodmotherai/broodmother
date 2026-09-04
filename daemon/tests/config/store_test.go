package config_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/config"

	"os"
	"path/filepath"
	"testing"
)

func store(t *testing.T) *Store {
	t.Helper()
	return NewStore(filepath.Join(t.TempDir(), "config.json"), Default(nil))
}

// A home with no config is a first run, not a fault: nothing was lost, so nothing is named.
func TestAConfigThatIsNotThereLosesNothing(t *testing.T) {
	held := store(t)
	loaded := held.Load()
	if loaded.Config.ProjectPath != nil || len(loaded.Reset) != 0 || len(loaded.Bindings) != 0 {
		t.Errorf("read %+v", loaded)
	}
}

func TestWritesAConfigItCanReadBack(t *testing.T) {
	held := store(t)
	path := "/tmp/a"
	want := Default(&path)
	want.Checkouts["/tmp/a"] = "local"

	saved, err := held.Save(want)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ProjectPath == nil || *saved.ProjectPath != path {
		t.Errorf("saved %+v", saved)
	}

	again := NewStore(held.File, Default(nil))
	loaded := again.Load()
	if loaded.Config.ProjectPath == nil || *loaded.Config.ProjectPath != path {
		t.Errorf("read back %+v", loaded.Config)
	}
	if loaded.Config.Checkouts["/tmp/a"] != "local" || len(loaded.Reset) != 0 {
		t.Errorf("read back %+v, reset %v", loaded.Config, loaded.Reset)
	}
}

// App state, not project content: the folder ignores itself so the sync loop never commits it
// and never has to be told not to in a .gitignore somebody else owns.
func TestTheHomeIgnoresItself(t *testing.T) {
	held := store(t)
	if _, err := held.Save(Default(nil)); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(filepath.Dir(held.File), ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "*\n" {
		t.Errorf("ignored %q", body)
	}
}

// The store is read by every request and written by a few, which is one more thread than the
// implementation this is ported from ever had.
func TestSurvivesBeingReadWhileItIsWritten(t *testing.T) {
	held := store(t)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for n := range 200 {
			path := string(rune('a' + n%26))
			held.Save(Default(&path))
		}
	}()
	for range 200 {
		held.Config()
		held.Reset()
	}
	<-done
}

// A caller that changes what it was handed must not change what the store holds.
func TestHandsOutACopyRatherThanWhatItHolds(t *testing.T) {
	held := store(t)
	if _, err := held.Save(Default(nil)); err != nil {
		t.Fatal(err)
	}
	held.Config().Checkouts["/tmp/a"] = "local"
	if len(held.Config().Checkouts) != 0 {
		t.Error("a caller reached into the config the store holds")
	}
}
