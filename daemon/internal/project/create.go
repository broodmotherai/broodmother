// Making one, and taking one away. A project is a folder of checkouts and `local` is the one it
// starts with, so that is what gets made — whether it is a clone, a fresh repository or a plain
// directory. Git is optional: a project with none is still a project, and the only thing it lacks
// is history.

package project

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/personas"
	"github.com/broodmotherai/broodmother/daemon/internal/skills"
)

// Kind is how much git a new project gets. None is a folder of markdown and nothing else — no
// repository, no history, no sync. Local is a repository with no remote: history and checkouts,
// kept on this machine. Remote is one that syncs.
type Kind string

const (
	NoGit  Kind = "none"
	Local  Kind = "local"
	Remote Kind = "remote"
)

const defaultBranch = "main"

type New struct {
	Name string
	Git  Kind
	// RemoteURL is required for [Remote], ignored otherwise.
	RemoteURL string
	// Branch is what to clone or to start on. Ignored for [NoGit].
	Branch string
}

const tasksReadme = "# .tasks\n\nA `.task` is a flow the app runs: triggers, and the agents they set off. One anywhere in\nthe checkout runs — this is where to keep them, so they are together.\n\nMake one from the sidebar. What fires it is in the file.\n"

// seedTasks makes the folder a project's flows are kept in, at birth, so there is an obvious
// place to put the first one.
func seedTasks(checkout string) error {
	dir := filepath.Join(checkout, constants.TasksDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "README.md"), []byte(tasksReadme), 0o644)
}

func readme(name string, kind Kind) string {
	history := ", git for history"
	if kind == NoGit {
		history = ""
	}
	return "# " + name + "\n\nA broodmother project. Markdown on disk" + history + ".\n"
}

// seed writes the three placeholder folders a new checkout is born with, each its own
// documentation in its own format.
func seed(checkout, name string, kind Kind) error {
	if err := os.WriteFile(filepath.Join(checkout, "README.md"), []byte(readme(name, kind)), 0o644); err != nil {
		return err
	}
	if err := skills.Seed(checkout); err != nil {
		return err
	}
	if err := personas.Seed(checkout); err != nil {
		return err
	}
	return seedTasks(checkout)
}

// Create makes a project inside a profile's folder. A remote is proven reachable before anything
// is written, because a project that was asked to sync and cannot is worse than one that was
// never asked.
func Create(input New, profileDir, profileName, sshKeyPath, token string, author git.Author) (Summary, error) {
	if err := AssertName(input.Name); err != nil {
		return Summary{}, err
	}
	if input.Git == Remote && strings.TrimSpace(input.RemoteURL) == "" {
		return Summary{}, apperr.Projectf("a project that syncs needs a remote")
	}
	// A profile's projects sit beside its own file, which is what makes them commit as it.
	if err := os.MkdirAll(profileDir, 0o755); err != nil {
		return Summary{}, err
	}

	target := filepath.Join(profileDir, input.Name)
	if _, err := os.Stat(target); err == nil {
		return Summary{}, apperr.Projectf("a project named %q already exists", input.Name)
	}

	local := Primary(target)
	head := strings.TrimSpace(input.Branch)
	if head == "" {
		head = defaultBranch
	}
	made := Summary{Name: input.Name, Path: target, Profile: profileName}

	if input.Git == NoGit {
		if err := os.MkdirAll(local, 0o755); err != nil {
			return Summary{}, err
		}
		return made, seed(local, input.Name, input.Git)
	}

	url := strings.TrimSpace(input.RemoteURL)
	if input.Git == Remote {
		cloned, err := clone(profileDir, input.Name, url, head, sshKeyPath, token)
		if err != nil {
			return Summary{}, err
		}
		if cloned {
			return made, nil
		}
	}

	// Either a repository of its own, or a reachable remote whose branch has no commits yet —
	// both start here, and the second gets pushed by the first sync.
	if err := os.MkdirAll(local, 0o755); err != nil {
		return Summary{}, err
	}
	held := git.New(local, sshKeyPath, token)
	if _, err := held.Run("init", "-b", head); err != nil {
		return Summary{}, err
	}
	if input.Git == Remote {
		if _, err := held.Run("remote", "add", "origin", url); err != nil {
			return Summary{}, err
		}
	}
	// Before staging, so the first commit carries the placeholders.
	if err := seed(local, input.Name, input.Git); err != nil {
		return Summary{}, err
	}
	if err := held.StageAll(); err != nil {
		return Summary{}, err
	}
	if committed := held.Commit("broodmother: create project "+input.Name, author); !committed.OK {
		return Summary{}, apperr.Projectf("%s", committed.Message)
	}
	return made, nil
}

// clone probes the remote and clones it where the branch has commits. False with no error is a
// reachable remote whose branch is empty, which the caller starts a repository for instead.
func clone(profileDir, name, url, head, sshKeyPath, token string) (bool, error) {
	outer := git.New(profileDir, sshKeyPath, token)
	probe, err := outer.RunFor(15*time.Second, "ls-remote", "--heads", url, head)
	if err != nil {
		return false, apperr.Projectf("%s", err.Error())
	}
	if probe.Code != 0 {
		reason := strings.TrimSpace(probe.Stderr)
		if reason == "" {
			reason = "remote unreachable"
		}
		return false, apperr.Projectf("%s: %s", git.ClassifyRemoteError(probe.Stdout+"\n"+probe.Stderr), reason)
	}
	if strings.TrimSpace(probe.Stdout) == "" {
		return false, nil
	}

	// Cloned into the project's `local`, so the checkouts added later are its peers.
	cloned, err := outer.Run("clone", "--branch", head, url, filepath.Join(name, constants.Primary))
	if err != nil {
		return false, apperr.Projectf("%s", err.Error())
	}
	if cloned.Code != 0 {
		os.RemoveAll(filepath.Join(profileDir, name))
		reason := strings.TrimSpace(cloned.Stderr)
		if reason == "" {
			reason = "git clone failed"
		}
		return false, apperr.Projectf("%s", reason)
	}
	return true, nil
}

// Delete takes the folder and everything in it. The path comes from the listing rather than from
// the name, so what is removed is always a folder in the profile and never whatever a `../` in
// the name would have reached. The repos live inside it, so they go with it.
func Delete(name, dir string) error {
	found, err := Find(name, dir)
	if err != nil {
		return err
	}
	if found == nil {
		return apperr.Projectf("no project named %q", name)
	}
	return os.RemoveAll(found.Path)
}
