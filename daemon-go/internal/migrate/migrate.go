// Package migrate moves a home written in an older layout into the one this daemon reads.
//
// The layout before the home was a shelf of profiles: profiles were files in `profiles/`,
// projects were folders beside it, and a repo was a repository anywhere on the disk that a
// registry in the project pointed at.
//
// Everything moves rather than being copied — a git repository is portable, and moving a whole
// directory keeps it one — and every checkout is repaired afterwards, because a worktree
// remembers where its repository was in absolute paths. Nothing is deleted except the registry
// the repos have replaced, and a home already in the new shape is left exactly as it is.
//
// It runs before anything else reads the home, and it runs on every start: a home already
// migrated costs it a handful of directory reads and no writes at all.
package migrate

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/config"
	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/jsjson"
	"github.com/broodmotherai/broodmother/daemon-go/internal/profile"
	"github.com/broodmotherai/broodmother/daemon-go/internal/project"
)

const (
	// staging is where a project waits while a profile takes the name it had.
	staging = ".migrating"
	// legacyTask: tasks were called dreams, and the name was in the extension every one wore.
	legacyTask = ".dream"
	// legacyProfiles: a profile was a file in this folder rather than a folder of its own.
	legacyProfiles = "profiles"
	// legacyRegistry: a repo was a repository anywhere on the disk that this file pointed at.
	legacyRegistry = "projects.json"
	// legacyReposDir: repos were called projects, and the folder a project keeps them in said so.
	legacyReposDir = ".projects"
	// legacyAttachments: attachments were the one folder in a project that was not dotted, and
	// skills sat beside the tools they run rather than inside them.
	legacyAttachments = "attachments"
	legacySkills      = ".skills"
	// fallback is the profile that takes in projects from a home that never had one.
	fallback = "default"
)

// Run migrates the home and answers with the config as it now reads. The config moves with the
// folders: everything this machine filed under a project path is filed under the path it has.
func Run(home string, loaded config.Loaded) (config.Config, error) {
	staged, err := stageProjects(home)
	if err != nil {
		return config.Config{}, err
	}
	if err := adoptProfiles(home); err != nil {
		return config.Config{}, err
	}
	if len(staged) > 0 {
		held, err := profile.List(home)
		if err != nil {
			return config.Config{}, err
		}
		if len(held) == 0 {
			if err := writeProfile(home, fallback); err != nil {
				return config.Config{}, err
			}
		}
	}

	held, err := profile.List(home)
	if err != nil {
		return config.Config{}, err
	}
	names := make([]string, 0, len(held))
	for _, one := range held {
		names = append(names, one.Name)
	}

	paths := map[string]string{}
	for _, name := range staged {
		to, err := land(filepath.Join(home, staging, name), filepath.Join(home, owner(loaded, home, name, names)))
		if err != nil {
			return config.Config{}, err
		}
		paths[filepath.Join(home, name)] = to
	}
	if err := os.RemoveAll(filepath.Join(home, staging)); err != nil {
		return config.Config{}, err
	}

	for _, name := range names {
		projects, err := project.List(filepath.Join(home, name))
		if err != nil {
			return config.Config{}, err
		}
		for _, one := range projects {
			if err := liftProject(one.Path); err != nil {
				return config.Config{}, err
			}
		}
	}
	rmIfEmpty(filepath.Join(home, legacyReposDir))

	return rewrite(loaded.Config, paths, names), nil
}

// owner is the profile a staged project lands in. A project nobody bound goes to the first
// profile there is — one of them made it, and the machine has forgotten which.
func owner(loaded config.Loaded, home, name string, names []string) string {
	if held := pick(loaded.Bindings[filepath.Join(home, name)], names); held != "" {
		return held
	}
	if len(names) > 0 {
		return names[0]
	}
	return fallback
}

func pick(name string, names []string) string {
	if name == "" {
		return ""
	}
	for _, one := range names {
		if one == name {
			return name
		}
	}
	return ""
}

// stageProjects: every folder in the home that is not a profile is a project from the old
// layout. Staged out of the way first, so a profile can take the name a project had.
func stageProjects(home string) ([]string, error) {
	entries, err := os.ReadDir(home)
	if err != nil {
		return nil, nil
	}
	var legacy []string
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if entry.Name() == legacyProfiles {
			continue
		}
		if exists(filepath.Join(home, entry.Name(), constants.ProfileFile)) {
			continue
		}
		legacy = append(legacy, entry.Name())
	}
	if len(legacy) == 0 {
		return nil, nil
	}

	staged := filepath.Join(home, staging)
	if err := os.MkdirAll(staged, 0o755); err != nil {
		return nil, err
	}
	for _, name := range legacy {
		if err := os.Rename(filepath.Join(home, name), filepath.Join(staged, name)); err != nil {
			return nil, err
		}
	}
	return legacy, nil
}

// adoptProfiles: `profiles/ada.json` and the key beside it become the folder `ada/` holds.
func adoptProfiles(home string) error {
	dir := filepath.Join(home, legacyProfiles)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".json")
		target := filepath.Join(home, name)
		if err := os.MkdirAll(target, 0o755); err != nil {
			return err
		}
		file := filepath.Join(target, constants.ProfileFile)
		if err := os.Rename(filepath.Join(dir, entry.Name()), file); err != nil {
			return err
		}
		for _, suffix := range []string{".key", ".key.pub"} {
			// A profile with no key is the ordinary case, so a rename that finds nothing is not
			// a failure.
			_ = os.Rename(filepath.Join(dir, name+suffix), filepath.Join(target, "profile"+suffix))
		}
		if err := repointKey(file, filepath.Join(dir, name+".key")); err != nil {
			return err
		}
	}
	return os.RemoveAll(dir)
}

// repointKey: the key moved with the profile, and the profile names it by absolute path.
func repointKey(file, was string) error {
	body, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	value, ok := jsjson.Parse(string(body))
	if !ok {
		return nil
	}
	held, isObject := value.(*jsjson.Object)
	if !isObject {
		return nil
	}
	if named, _ := held.Get("sshKeyPath"); named != any(was) {
		return nil
	}
	next := held.Clone()
	next.Set("sshKeyPath", strings.TrimSuffix(file, ".json")+".key")
	return os.WriteFile(file, []byte(jsjson.Indent(next, "  ")+"\n"), 0o600)
}

func writeProfile(home, name string) error {
	if err := os.MkdirAll(filepath.Join(home, name), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(home, name, constants.ProfileFile), []byte("{}\n"), 0o600)
}

// land moves the staged project into the profile that owns it. A name already taken there is
// only ever a migration that stopped halfway, and neither folder is worth losing to the other.
func land(from, profileDir string) (string, error) {
	if err := os.MkdirAll(profileDir, 0o755); err != nil {
		return "", err
	}
	name := filepath.Base(from)
	target := filepath.Join(profileDir, name)
	for n := 2; exists(target); n++ {
		target = filepath.Join(profileDir, name+"-"+strconv.Itoa(n))
	}
	if err := os.Rename(from, target); err != nil {
		return "", err
	}
	return target, nil
}

// rewrite is everything this machine filed under a project path, moved onto the path it now has.
func rewrite(held config.Config, paths map[string]string, names []string) config.Config {
	at := func(project string) string {
		if moved, found := paths[project]; found {
			return moved
		}
		return project
	}

	next := held.Clone()
	if held.ProjectPath != nil {
		moved := at(*held.ProjectPath)
		next.ProjectPath = &moved
	}
	next.Profile = profileFor(next.ProjectPath, held.Profile, names)
	next.Checkouts = rekey(held.Checkouts, at)
	next.Git = rekey(held.Git, at)
	next.Repo = rekey(held.Repo, at)
	next.RepoBranch = map[string]string{}
	for key, value := range held.RepoBranch {
		cut := strings.LastIndex(key, "#")
		if cut < 0 {
			next.RepoBranch[key] = value
			continue
		}
		next.RepoBranch[at(key[:cut])+key[cut:]] = value
	}
	return next
}

// profileFor: the open project sits inside the profile it commits as, so the path settles who
// that is. What the config said comes next, whether or not it names a profile that is there —
// and a home with neither falls back to whichever profile comes first.
func profileFor(projectPath, said *string, names []string) *string {
	if projectPath != nil {
		if held := pick(filepath.Base(filepath.Dir(*projectPath)), names); held != "" {
			return &held
		}
	}
	if said != nil {
		return said
	}
	if len(names) > 0 {
		return &names[0]
	}
	return nil
}

func rekey[T any](held map[string]T, at func(string) string) map[string]T {
	next := make(map[string]T, len(held))
	for key, value := range held {
		next[at(key)] = value
	}
	return next
}
