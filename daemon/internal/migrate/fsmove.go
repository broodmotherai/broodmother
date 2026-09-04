// Moving a folder that may be a git repository, and putting one back together afterwards.

package migrate

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/broodmotherai/broodmother/daemon/internal/branch"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
)

func exists(target string) bool {
	_, err := os.Lstat(target)
	return err == nil
}

// rmIfEmpty takes away the home's old repo folder once every repository in it has been moved
// into a project. Anything left is something broodmother did not put there.
func rmIfEmpty(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) > 0 {
		return
	}
	_ = os.RemoveAll(dir)
}

// move is a rename, except where a rename is not one: a repository on another volume is an
// ordinary place to have kept one, and a rename across devices does not work there.
func move(from, to string) error {
	err := os.Rename(from, to)
	if err == nil || !errors.Is(err, syscall.EXDEV) {
		return err
	}
	if err := copyTree(from, to); err != nil {
		return err
	}
	return os.RemoveAll(from)
}

// copyTree is the crossing-devices half of [move]. Symlinks are copied as the links they are
// rather than as what they point at — a repository holds them and following one would turn a
// link into a second copy — and times are kept, because a checkout's mtimes are what git reads
// before it decides a file is unchanged.
func copyTree(from, to string) error {
	return filepath.WalkDir(from, func(found string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rest, err := filepath.Rel(from, found)
		if err != nil {
			return err
		}
		target := filepath.Join(to, rest)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		switch {
		case entry.IsDir():
			if err := os.MkdirAll(target, info.Mode().Perm()); err != nil {
				return err
			}
		case entry.Type()&fs.ModeSymlink != 0:
			named, err := os.Readlink(found)
			if err != nil {
				return err
			}
			return os.Symlink(named, target)
		case entry.Type().IsRegular():
			if err := copyFile(found, target, info.Mode().Perm()); err != nil {
				return err
			}
		default:
			// A socket or a device file, which is not something a project holds.
			return nil
		}
		return os.Chtimes(target, info.ModTime(), info.ModTime())
	})
}

func copyFile(from, to string, mode os.FileMode) error {
	source, err := os.Open(from)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(to, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		target.Close()
		return err
	}
	return target.Close()
}

// repair puts a moved repository back together: a worktree records where its repository is, and
// its repository records where it is — both in absolute paths that the move just invalidated.
//
// Nothing is returned. A folder that is not a repository has nothing to repair, and a git that
// refuses says so on a checkout the daemon is about to open anyway.
func repair(checkouts branch.Checkouts) {
	if !exists(filepath.Join(checkouts.Primary, ".git")) {
		return
	}
	entries, err := os.ReadDir(checkouts.Worktrees)
	if err != nil {
		return
	}
	trees := []string{"worktree", "repair"}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == constants.Primary || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		trees = append(trees, filepath.Join(checkouts.Worktrees, entry.Name()))
	}
	_, _ = git.New(checkouts.Primary, "", "").Run(trees...)
}
