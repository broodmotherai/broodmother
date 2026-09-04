// The projects on this machine and the repos inside them: what exists, which one is open, and
// which of them the tabs are about. Nothing here opens a checkout itself — it records the choice
// and asks for the project to be reopened, because what a checkout carries is a question of
// watchers and git rather than of config.

package app

import (
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/branch"
	"github.com/broodmotherai/broodmother/daemon/internal/config"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/profile"
	"github.com/broodmotherai/broodmother/daemon/internal/project"
	"github.com/broodmotherai/broodmother/daemon/internal/repo"
)

// WorkspaceDeps is what this asks of the rest of the daemon: who is working, since a project is
// made inside a profile and cloned with its key, and the two things that have to happen after the
// config moves — who is working settled again, and the project put back on what it now names.
type WorkspaceDeps struct {
	Store       *config.Store
	Profile     func() (*profile.Profile, error)
	ProfileHome func() string
	SSHKey      func() string
	LoadProfile func() error
	Reopen      func()
}

type Workspace struct {
	deps WorkspaceDeps
}

func newWorkspace(deps WorkspaceDeps) *Workspace { return &Workspace{deps: deps} }

func (w *Workspace) config() config.Config { return w.deps.Store.Config() }

// Project is the open one, read off the path the config holds: the folder is the name and the
// folder above it is the profile. Nil where nothing is open, which is a first run.
func (w *Workspace) Project() *project.Summary {
	open := w.config().ProjectPath
	if open == nil {
		return nil
	}
	summary := project.Of(*open)
	return &summary
}

// RequireProject refuses rather than answering nil: creating a project needs somewhere to put it
// and the home is always that, but opening one needs the project to exist.
func (w *Workspace) RequireProject() (*project.Summary, error) {
	if open := w.Project(); open != nil {
		return open, nil
	}
	return nil, apperr.NoProjectf("no project is open — create or choose one first")
}

// Checkout is the folder the open project is standing in. A project is a folder of checkouts and
// the config records which one you are in; unrecorded is the primary, which is the clone itself.
// Empty where nothing is open.
func (w *Workspace) Checkout() string {
	open := w.Project()
	if open == nil {
		return ""
	}
	return project.Checkout(open.Path, w.CheckoutFolder(open.Path))
}

// CheckoutFolder is the folder a project is open on, by name.
func (w *Workspace) CheckoutFolder(projectPath string) string {
	if folder, said := w.config().Checkouts[projectPath]; said && folder != "" {
		return folder
	}
	return constants.Primary
}

// ListProjects is the open profile's projects. A machine with no profile yet has none to list.
func (w *Workspace) ListProjects() ([]project.Summary, error) {
	home := w.deps.ProfileHome()
	if home == "" {
		return []project.Summary{}, nil
	}
	return project.List(home)
}

// OpenProject records the choice and settles who is working.
func (w *Workspace) OpenProject(path string) (config.Config, error) {
	next := w.config()
	next.ProjectPath = &path
	named := filepath.Base(filepath.Dir(path))
	next.Profile = &named
	saved, err := w.deps.Store.Save(next)
	if err != nil {
		return config.Config{}, err
	}
	if err := w.deps.LoadProfile(); err != nil {
		return config.Config{}, err
	}
	w.deps.Reopen()
	return saved, nil
}

// SetConfig writes the config and, where the open project moved, settles who is working again.
func (w *Workspace) SetConfig(next config.Config) (config.Config, error) {
	before := w.config().ProjectPath
	saved, err := w.deps.Store.Save(next)
	if err != nil {
		return config.Config{}, err
	}
	if !samePath(saved.ProjectPath, before) {
		if err := w.deps.LoadProfile(); err != nil {
			return config.Config{}, err
		}
		w.deps.Reopen()
	}
	return w.config(), nil
}

// AddProject makes one in the open profile's folder, opens it, and turns sync on where it was
// asked to sync — a project cloned from a remote is a project that meant to.
func (w *Workspace) AddProject(input project.New) (project.Summary, error) {
	held, err := w.deps.Profile()
	if err != nil {
		return project.Summary{}, err
	}
	made, err := project.Create(input, profile.Dir(*held), held.Name, w.deps.SSHKey(), w.hostToken(), held.GitAuthor)
	if err != nil {
		return project.Summary{}, err
	}

	next := w.config()
	next.ProjectPath = &made.Path
	next.Profile = &held.Name
	settings := git.DefaultSettings()
	settings.Enabled = input.Git == project.Remote
	next.Git[made.Path] = settings
	if _, err := w.deps.Store.Save(next); err != nil {
		return project.Summary{}, err
	}
	if err := w.deps.LoadProfile(); err != nil {
		return project.Summary{}, err
	}
	w.deps.Reopen()
	return made, nil
}

// RemoveProject takes a project off disk. Deleting the one you are in falls back the way startup
// does: whatever is left, or nothing, which is the first-run state again.
func (w *Workspace) RemoveProject(name string) (*project.Summary, error) {
	home := w.deps.ProfileHome()
	if home == "" {
		return nil, apperr.Projectf("no project named %q", name)
	}
	gone, err := project.Find(name, home)
	if err != nil {
		return nil, err
	}
	if gone == nil {
		return nil, apperr.Projectf("no project named %q", name)
	}
	if err := project.Delete(name, home); err != nil {
		return nil, err
	}

	// Nothing filed under the path outlives it: a folder of that name made later is a different
	// project, and it does not inherit this one's sync settings or the repos that were inside it.
	next := w.forget(gone.Path)
	if held := w.config().ProjectPath; held == nil || *held != gone.Path {
		if _, err := w.deps.Store.Save(next); err != nil {
			return nil, err
		}
		return w.Project(), nil
	}

	left, err := project.List(home)
	if err != nil {
		return nil, err
	}
	next.ProjectPath = nil
	if len(left) > 0 {
		next.ProjectPath = &left[0].Path
	}
	if _, err := w.deps.Store.Save(next); err != nil {
		return nil, err
	}
	if err := w.deps.LoadProfile(); err != nil {
		return nil, err
	}
	w.deps.Reopen()
	return w.Project(), nil
}

// forget drops everything this machine filed under a project path.
func (w *Workspace) forget(projectPath string) config.Config {
	next := w.config()
	delete(next.Git, projectPath)
	delete(next.Checkouts, projectPath)
	delete(next.Repo, projectPath)
	for key := range next.RepoBranch {
		if strings.HasPrefix(key, projectPath+"#") {
			delete(next.RepoBranch, key)
		}
	}
	return next
}

// Repos is every repo in the open project. A machine with no project open has none.
func (w *Workspace) Repos() []repo.Summary {
	open := w.Project()
	if open == nil {
		return []repo.Summary{}
	}
	return repo.List(open.Path)
}

// RepoCheckout is the folder a repo is open on: the branch the config records for it, or the
// repository's own checkout where it records none — which is what a repo starts on.
func (w *Workspace) RepoCheckout(projectPath, name string) string {
	checkouts := repo.CheckoutsOf(projectPath, name)
	folder, said := w.config().RepoBranch[branch.Key(projectPath, name)]
	if !said || folder == "" || folder == constants.Primary {
		return checkouts.Primary
	}
	return filepath.Join(checkouts.Worktrees, folder)
}

// AddRepo makes one inside the open project and scopes to it: a repo you just made is one you
// meant to work in.
func (w *Workspace) AddRepo(input repo.New) (repo.Summary, error) {
	open, err := w.RequireProject()
	if err != nil {
		return repo.Summary{}, err
	}
	held, err := w.deps.Profile()
	if err != nil {
		return repo.Summary{}, err
	}
	made, err := repo.Create(open.Path, input, w.deps.SSHKey(), w.hostToken(), held.GitAuthor)
	if err != nil {
		return repo.Summary{}, err
	}
	if _, err := w.SetScope(doc.RepoRoot(made.Name)); err != nil {
		return repo.Summary{}, err
	}
	return made, nil
}

// RemoveRepo takes one off disk. Deleting the one you are in leaves the project's documents on
// their own, which is where every project starts.
func (w *Workspace) RemoveRepo(name string) error {
	open, err := w.RequireProject()
	if err != nil {
		return err
	}
	if err := repo.Delete(open.Path, name); err != nil {
		return err
	}
	next := w.config()
	delete(next.RepoBranch, branch.Key(open.Path, name))
	if scoped, said := next.Repo[open.Path]; said && scoped != nil && *scoped == name {
		next.Repo[open.Path] = nil
	}
	_, err = w.deps.Store.Save(next)
	return err
}

// SetScope records which tree the tabs are about: the project itself, or one of its repos.
func (w *Workspace) SetScope(to doc.Root) (config.Config, error) {
	open, err := w.RequireProject()
	if err != nil {
		return config.Config{}, err
	}
	next := w.config()
	name, isRepo := to.Repo()
	if !isRepo {
		next.Repo[open.Path] = nil
	} else {
		// A plain refusal rather than the conflict a missing repo raises elsewhere: the request is
		// well formed and names something that is not there, which is the caller's mistake.
		if repo.Find(open.Path, name) == nil {
			return config.Config{}, apperr.Repof("no repo named %q", name)
		}
		held := name
		next.Repo[open.Path] = &held
	}
	return w.deps.Store.Save(next)
}

// hostToken is the credential a clone is made with. The daemon's own git is given the open
// profile's token, but making a project or a repo is not: the TypeScript reads it out of the
// profile service here and that call has no port yet, so a private remote is cloned over ssh or
// not at all.
func (w *Workspace) hostToken() string { return "" }

func samePath(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
