// Making one, and taking one away. The repository a repo is, made the way a project's is: a plain
// directory, a repository of its own, or a clone of a remote proven reachable before anything is
// written. It is the repo's `local`, so the checkouts its branches get are its peers.

package repo

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/project"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

const defaultBranch = "main"

// New is a repo to make. Where it goes is not asked: a repo is a folder inside its project.
type New struct {
	Name string
	Git  project.Kind
	// RemoteURL is required for a remote, ignored otherwise.
	RemoteURL string
	// Branch is what to clone or to start on. Ignored where there is no git.
	Branch string
}

// Create makes a repo inside the project. Git is not required — a folder of code with no history
// is an ordinary thing to work in, and the branch menu simply has nothing to offer.
func Create(projectPath string, input New, sshKeyPath, token string, author git.Author) (Summary, error) {
	if problem := utils.NameProblem(input.Name); problem != "" {
		return Summary{}, apperr.Repof("repo name %s", problem)
	}
	if Find(projectPath, input.Name) != nil {
		return Summary{}, apperr.Repof("a repo named %q already exists", input.Name)
	}
	checkouts := CheckoutsOf(projectPath, input.Name)
	if err := makeRepo(checkouts.Primary, input, sshKeyPath, token, author); err != nil {
		return Summary{}, err
	}
	return Summary{Name: input.Name, Repo: checkouts.Primary}, nil
}

func makeRepo(target string, input New, sshKeyPath, token string, author git.Author) error {
	name := filepath.Base(filepath.Dir(target))
	head := strings.TrimSpace(input.Branch)
	if head == "" {
		head = defaultBranch
	}
	url := strings.TrimSpace(input.RemoteURL)

	if input.Git == project.Remote {
		if url == "" {
			return apperr.Repof("a repo cloned from a remote needs one")
		}
		cloned, err := clone(filepath.Dir(target), url, head, sshKeyPath, token)
		if err != nil {
			return err
		}
		if cloned {
			return nil
		}
	}

	if err := os.MkdirAll(target, 0o755); err != nil {
		return err
	}
	if input.Git == "" || input.Git == project.NoGit {
		return nil
	}

	// A branch of a repo is a worktree of it, and git will not make one of a repository with no
	// commits — so a repository broodmother makes starts with one.
	held := git.New(target, sshKeyPath, token)
	if _, err := held.Run("init", "-b", head); err != nil {
		return err
	}
	if input.Git == project.Remote {
		if _, err := held.Run("remote", "add", "origin", url); err != nil {
			return err
		}
	}
	if err := os.WriteFile(filepath.Join(target, "README.md"), []byte("# "+name+"\n"), 0o644); err != nil {
		return err
	}
	if err := held.StageAll(); err != nil {
		return err
	}
	if committed := held.Commit("broodmother: create repo "+name, author); !committed.OK {
		return apperr.Repof("%s", committed.Message)
	}
	return nil
}

func clone(holder, url, head, sshKeyPath, token string) (bool, error) {
	// Both the probe and the clone run in the folder the checkout will sit in, and git cannot
	// start in a directory that is not there.
	if err := os.MkdirAll(holder, 0o755); err != nil {
		return false, err
	}
	outer := git.New(holder, sshKeyPath, token)
	probe, err := outer.RunFor(15*time.Second, "ls-remote", "--heads", url, head)
	if err != nil {
		return false, apperr.Repof("%s", err.Error())
	}
	if probe.Code != 0 {
		reason := strings.TrimSpace(probe.Stderr)
		if reason == "" {
			reason = "remote unreachable"
		}
		return false, apperr.Repof("%s: %s", git.ClassifyRemoteError(probe.Stdout+"\n"+probe.Stderr), reason)
	}
	if strings.TrimSpace(probe.Stdout) == "" {
		return false, nil
	}

	cloned, err := outer.Run("clone", "--branch", head, url, constants.Primary)
	if err != nil {
		return false, apperr.Repof("%s", err.Error())
	}
	if cloned.Code != 0 {
		os.RemoveAll(holder)
		reason := strings.TrimSpace(cloned.Stderr)
		if reason == "" {
			reason = "git clone failed"
		}
		return false, apperr.Repof("%s", reason)
	}
	return true, nil
}

// Delete takes the repo's folder and everything in it: the repository, and the checkouts its
// branches were given. It lived in the project, so this is the last copy.
func Delete(projectPath, name string) error {
	if Find(projectPath, name) == nil {
		return apperr.Repof("no repo named %q", name)
	}
	return os.RemoveAll(Path(projectPath, name))
}
