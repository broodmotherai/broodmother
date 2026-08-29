package utils

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/doc"
)

func wrap(err error) error {
	if err == nil {
		return nil
	}
	return apperr.Pathf("%s", err.Error())
}

// AtomicWrite is temp file, fsync, rename. The editor saves on a 500ms debounce, so a crash
// lands mid-save often and a half-written note is lost work.
//
// The mode is on the temp file rather than set afterwards: a file that holds a credential must
// never exist readable, not even for the moment between writing it and tightening it.
func AtomicWrite(target string, data []byte, mode os.FileMode) error {
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return wrap(err)
	}

	scratch := make([]byte, 6)
	if _, err := rand.Read(scratch); err != nil {
		return wrap(err)
	}
	temp := filepath.Join(dir,
		"."+filepath.Base(target)+"."+hex.EncodeToString(scratch)+constants.TempSuffix)

	if err := write(temp, data, mode); err != nil {
		os.Remove(temp)
		return wrap(err)
	}
	if err := os.Rename(temp, target); err != nil {
		os.Remove(temp)
		return wrap(err)
	}
	return nil
}

func write(temp string, data []byte, mode os.FileMode) error {
	handle, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	if _, err := handle.Write(data); err != nil {
		handle.Close()
		return err
	}
	if err := handle.Sync(); err != nil {
		handle.Close()
		return err
	}
	return handle.Close()
}

func contains(root, target string) bool {
	return target == root || strings.HasPrefix(target, root+string(filepath.Separator))
}

// resolveThroughSymlinks is the real path of the deepest existing ancestor, with the missing
// tail appended.
func resolveThroughSymlinks(target string) string {
	missing := []string{}
	current := target
	for {
		if real, err := filepath.EvalSymlinks(current); err == nil {
			return filepath.Join(append([]string{real}, missing...)...)
		}
		parent := filepath.Dir(current)
		if parent == current {
			return target
		}
		missing = append([]string{filepath.Base(current)}, missing...)
		current = parent
	}
}

// ResolveInRoot is the only place a tree's boundary exists: paths arrive from a browser, so
// escapes are rejected after symlink resolution rather than by inspecting the string alone.
func ResolveInRoot(root, input string) (string, error) {
	rel, err := Normalize(input)
	if err != nil {
		return "", err
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", wrap(err)
	}
	target := filepath.Join(realRoot, rel)
	if !contains(realRoot, target) {
		return "", apperr.Pathf("path escapes the root")
	}
	if !contains(realRoot, resolveThroughSymlinks(target)) {
		return "", apperr.Pathf("path escapes the root")
	}
	return target, nil
}

func ToDocPath(root, absolute string) doc.Path {
	rel, err := filepath.Rel(root, absolute)
	if err != nil {
		rel = absolute
	}
	return filepath.ToSlash(rel)
}

// ExpandHome takes the `~` a human types, credential paths being typed by humans.
func ExpandHome(target string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return target
	}
	if target == "~" {
		return home
	}
	if rest, found := strings.CutPrefix(target, "~/"); found {
		return filepath.Join(home, rest)
	}
	return target
}
