// A project, moved into the shape it has now: its checkouts, its repos, and the two folders
// inside a checkout that were renamed.

package migrate

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/jsjson"
	"github.com/broodmotherai/broodmother/daemon-go/internal/project"
	"github.com/broodmotherai/broodmother/daemon-go/internal/repo"
	"github.com/broodmotherai/broodmother/daemon-go/internal/task"
)

// liftProject is the order the moves have to happen in: the repos come out from under the old
// name before the checkout is lifted around them, the registry is read while the folder it names
// is still where it was, and the checkouts are repaired before anything walks them.
func liftProject(path string) error {
	if err := liftRepos(path); err != nil {
		return err
	}
	if err := liftCheckout(path); err != nil {
		return err
	}
	if err := adoptRepos(path); err != nil {
		return err
	}
	repair(project.Checkouts(path))
	if err := adoptTasks(path); err != nil {
		return err
	}
	return adoptFolders(path)
}

// liftCheckout: the layout before a project held checkouts had the project folder be the
// checkout itself. It becomes `local/`, so the branches added later are its peers rather than
// folders buried inside it. A project already holding one is left exactly as it is.
func liftCheckout(path string) error {
	local := project.Primary(path)
	if exists(local) {
		return nil
	}
	entries, err := os.ReadDir(path)
	if err != nil || len(entries) == 0 {
		return nil
	}

	// Staged inside the project so every move stays on one device, then renamed into place.
	staged := filepath.Join(path, staging)
	if err := os.RemoveAll(staged); err != nil {
		return err
	}
	if err := os.MkdirAll(staged, 0o755); err != nil {
		return err
	}
	for _, entry := range entries {
		// The repos sit beside the checkouts rather than in one, which is what keeps the sync
		// loop from ever seeing them.
		if entry.Name() == staging || entry.Name() == constants.ReposDir || entry.Name() == legacyReposDir {
			continue
		}
		if err := os.Rename(filepath.Join(path, entry.Name()), filepath.Join(staged, entry.Name())); err != nil {
			return err
		}
	}
	return os.Rename(staged, local)
}

// liftRepos: `.projects/` becomes `.repos/`, contents and all. A project that already has the
// new folder takes in whatever the old one holds that it does not; anything it does hold stays
// where it is, because neither copy is worth losing to the other. Every checkout that moved is
// repaired, since its worktrees remember the folder by its old name.
func liftRepos(path string) error {
	was := filepath.Join(path, legacyReposDir)
	now := filepath.Join(path, constants.ReposDir)
	if !exists(was) {
		return nil
	}
	if !exists(now) {
		if err := os.Rename(was, now); err != nil {
			return err
		}
	} else {
		entries, err := os.ReadDir(was)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if exists(filepath.Join(now, entry.Name())) {
				continue
			}
			if err := os.Rename(filepath.Join(was, entry.Name()), filepath.Join(now, entry.Name())); err != nil {
				return err
			}
		}
		rmIfEmpty(was)
	}
	for _, one := range repo.List(path) {
		repair(repo.CheckoutsOf(path, one.Name))
	}
	return nil
}

// adoptRepos: every repository the registry pointed at, moved into the project as the repo's own
// `local`. A repository that is no longer there is an entry with nothing behind it.
func adoptRepos(path string) error {
	file := filepath.Join(path, constants.ReposDir, legacyRegistry)
	body, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	// The registry's own order, kept: two entries naming one folder are a file nobody wrote, but
	// which of them wins should not depend on how Go happened to walk a map.
	value, ok := jsjson.Parse(string(body))
	if !ok {
		return nil
	}
	held, isObject := value.(*jsjson.Object)
	if !isObject {
		return nil
	}

	for _, name := range held.Keys() {
		value, _ := held.Get(name)
		from, isPath := value.(string)
		if !isPath || from == "" {
			continue
		}
		checkouts := repo.CheckoutsOf(path, name)
		if from == checkouts.Primary || !exists(from) {
			continue
		}
		if err := os.MkdirAll(checkouts.Worktrees, 0o755); err != nil {
			return err
		}
		if err := move(from, checkouts.Primary); err != nil {
			return err
		}
		repair(checkouts)
	}
	return os.Remove(file)
}

// adoptTasks: tasks were called dreams, and the name was in the extension every one of them
// wears. Renamed in place, in every checkout — git sees the rename and the next sync carries it.
// A checkout at a time rather than the project whole: the repos are checkouts of somebody else's
// source, a task was never written into one, and walking them is walking every dependency folder
// of every branch of every repository the project has — on every start, for a rename that
// happened once.
func adoptTasks(path string) error {
	for _, checkout := range checkoutsOf(path) {
		err := filepath.WalkDir(checkout, func(found string, entry fs.DirEntry, err error) error {
			if err != nil || entry.IsDir() || !strings.HasSuffix(entry.Name(), legacyTask) {
				return nil
			}
			to := strings.TrimSuffix(found, legacyTask) + task.Extension
			if exists(to) {
				return nil
			}
			return os.Rename(found, to)
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// adoptFolders: two folders of a checkout renamed. `attachments/` is dotted like every other
// folder the app owns, and `.skills/` moves under `.tools/` beside what a skill runs. Every
// checkout of the project, since a branch has a copy of both. A checkout already holding the new
// name is left alone rather than merged — neither copy is worth losing to the other.
func adoptFolders(path string) error {
	renames := [][2]string{
		{legacyAttachments, constants.AttachmentsDir},
		{legacySkills, constants.SkillsDir},
	}
	for _, checkout := range checkoutsOf(path) {
		for _, pair := range renames {
			from := filepath.Join(checkout, pair[0])
			to := filepath.Join(checkout, pair[1])
			if !exists(from) || exists(to) {
				continue
			}
			if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
				return err
			}
			if err := move(from, to); err != nil {
				return err
			}
		}
	}
	return nil
}

// checkoutsOf is every checkout the project holds, which is every folder in it but the one its
// repos live in. What is under there is a repository, not a document.
func checkoutsOf(path string) []string {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil
	}
	var found []string
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == constants.ReposDir || entry.Name() == legacyReposDir {
			continue
		}
		found = append(found, filepath.Join(path, entry.Name()))
	}
	return found
}
