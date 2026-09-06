// Who the daemon is working as: the profile on disk, the key its git offers, the token it pushes
// with and the model keys it speaks with. A profile is a folder of projects, so settling on one
// settles which projects there are — and a credential that changed has to reach the checkout
// before the next command runs out of it.

package app

import (
	"path/filepath"
	"sync"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/config"
	"github.com/broodmotherai/broodmother/daemon/internal/github"
	"github.com/broodmotherai/broodmother/daemon/internal/profile"
	"github.com/broodmotherai/broodmother/daemon/internal/project"
)

// ProfileDeps is what this asks of the rest of the daemon. Reopen is the whole reason it is a
// dependency rather than a call: what git offers is fixed when a checkout opens, so an identity,
// a key or a token that moved has to put the open project back.
type ProfileDeps struct {
	Home    string
	Store   *config.Store
	Project func() *project.Summary
	Reopen  func()
}

type Profiles struct {
	deps ProfileDeps

	mutex  sync.RWMutex
	active *profile.Profile
}

func newProfiles(deps ProfileDeps) *Profiles { return &Profiles{deps: deps} }

// Active is who is working, or nil before anybody is — which is a first run.
func (p *Profiles) Active() *profile.Profile {
	p.mutex.RLock()
	defer p.mutex.RUnlock()
	return p.active
}

func (p *Profiles) hold(found *profile.Profile) {
	p.mutex.Lock()
	p.active = found
	p.mutex.Unlock()
}

// Require refuses rather than answering nil: nothing that commits works without an identity.
func (p *Profiles) Require() (*profile.Profile, error) {
	if held := p.Active(); held != nil {
		return held, nil
	}
	return nil, apperr.NoProfilef("no profile yet — pick one for this project first")
}

// ProjectHome is the folder the open profile's projects live in, or empty before there is one.
func (p *Profiles) ProjectHome() string {
	held := p.Active()
	if held == nil {
		return ""
	}
	return profile.Dir(*held)
}

// Load settles who is working: the profile the open project sits inside, or the one the config
// names, or — with nothing open at all — whichever profile comes first.
func (p *Profiles) Load() error {
	held := p.deps.Store.Config()
	named := ""
	if held.ProjectPath != nil {
		named = filepath.Base(filepath.Dir(*held.ProjectPath))
	} else if held.Profile != nil {
		named = *held.Profile
	}

	var found *profile.Profile
	if named != "" {
		one, err := profile.Find(named, p.deps.Home)
		if err != nil {
			return err
		}
		found = one
	}
	if found == nil && held.ProjectPath == nil {
		all, err := profile.List(p.deps.Home)
		if err != nil {
			return err
		}
		if len(all) > 0 {
			found = &all[0]
		}
	}

	p.hold(found)
	return nil
}

// List is every profile on this machine.
func (p *Profiles) List() ([]profile.Profile, error) { return profile.List(p.deps.Home) }

// Select is working as somebody else, which is standing in their folder — so what opens is one of
// their projects. Nil when they have none yet, which is where a new profile starts.
func (p *Profiles) Select(name string) (*project.Summary, error) {
	found, err := profile.Find(name, p.deps.Home)
	if err != nil {
		return nil, err
	}
	if found == nil {
		return nil, apperr.Profilef("no profile named %q", name)
	}
	if err := p.workAs(found); err != nil {
		return nil, err
	}
	return p.deps.Project(), nil
}

// workAs settles who is working and opens one of their projects, which is what standing in
// somebody's folder means. Their first, or nothing at all where they have none yet.
func (p *Profiles) workAs(found *profile.Profile) error {
	projects, err := project.List(profile.Dir(*found))
	if err != nil {
		return err
	}

	next := p.deps.Store.Config()
	next.Profile = &found.Name
	next.ProjectPath = nil
	if len(projects) > 0 {
		next.ProjectPath = &projects[0].Path
	}
	if _, err := p.deps.Store.Save(next); err != nil {
		return err
	}

	p.hold(found)
	p.deps.Reopen()
	return nil
}

// Add makes one and works as it: a profile made from the project menu is one you meant to be. It
// holds no projects yet, which is the first-run state with a name on it.
func (p *Profiles) Add(input profile.New) (profile.Profile, error) {
	made, err := profile.Create(input, p.deps.Home)
	if err != nil {
		return profile.Profile{}, err
	}
	if err := p.workAs(&made); err != nil {
		return profile.Profile{}, err
	}
	return made, nil
}

// SetIdentity writes who you commit as. The key a checkout's git offers is fixed when it opens,
// so the project behind it is reopened.
func (p *Profiles) SetIdentity(identity profile.Identity) (profile.Profile, error) {
	held, err := p.Require()
	if err != nil {
		return profile.Profile{}, err
	}
	saved, err := profile.WriteIdentity(*held, identity)
	if err != nil {
		return profile.Profile{}, err
	}
	p.hold(&saved)
	p.deps.Reopen()
	return saved, nil
}

// SetAppearance writes how the app looks to whoever is open. Nothing is reopened: a theme changes
// what is drawn and not what git offers, so the project behind it goes on as it was.
func (p *Profiles) SetAppearance(appearance profile.Appearance) (profile.Profile, error) {
	held, err := p.Require()
	if err != nil {
		return profile.Profile{}, err
	}
	saved, err := profile.WriteAppearance(*held, appearance)
	if err != nil {
		return profile.Profile{}, err
	}
	p.hold(&saved)
	return saved, nil
}

// PublicKey is the open profile's, or empty where it has none yet.
func (p *Profiles) PublicKey() string {
	held := p.Active()
	if held == nil {
		return ""
	}
	return profile.ReadPublicKey(*held)
}

// SSHKey is the key the profile's git offers, or empty where it has none.
func (p *Profiles) SSHKey() string {
	held := p.Active()
	if held == nil || held.SSHKeyPath == nil {
		return ""
	}
	return *held.SSHKeyPath
}

// AddKey makes a key and points the profile at it, so the next git command offers it.
func (p *Profiles) AddKey() (profile.Profile, string, error) {
	held, err := p.Require()
	if err != nil {
		return profile.Profile{}, "", err
	}
	publicKey, err := profile.GenerateKey(*held)
	if err != nil {
		return profile.Profile{}, "", err
	}
	next := held.Identity
	made := profile.KeyFile(*held)
	next.SSHKeyPath = &made
	saved, err := p.SetIdentity(next)
	if err != nil {
		return profile.Profile{}, "", err
	}
	return saved, publicKey, nil
}

// SetModelKey writes the key a profile speaks to one model provider with, into the profile's own
// file the way the host token is. What comes back is the profile as the browser may see it:
// which providers are held, and not a character of what they are held as.
func (p *Profiles) SetModelKey(provider string, credential *profile.ModelKey) (profile.Profile, error) {
	held, err := p.Require()
	if err != nil {
		return profile.Profile{}, err
	}
	saved, err := profile.WriteModelKey(*held, provider, credential)
	if err != nil {
		return profile.Profile{}, err
	}
	p.hold(&saved)
	return saved, nil
}

// StartGithub opens a device code. Signing in is two requests: this one, and [Profiles.
// ConnectGithub] asked again while the browser is being answered — holding a request open for as
// long as somebody takes to find their password is a request nobody can tell from a hang.
func (p *Profiles) StartGithub() (github.Device, error) { return github.StartDevice() }

// ConnectGithub is the answer to a device code, once the browser has given one. Connecting is the
// profile's: the token is what it pushes with, the way its key is.
func (p *Profiles) ConnectGithub(deviceCode string) (bool, profile.Profile, error) {
	held, err := p.Require()
	if err != nil {
		return false, profile.Profile{}, err
	}
	answer, err := github.Poll(deviceCode)
	if err != nil {
		return false, profile.Profile{}, err
	}
	if answer.Token == "" {
		return true, *held, nil
	}
	login, err := github.Login(answer.Token)
	if err != nil {
		return false, profile.Profile{}, err
	}
	saved, err := p.setConnection(*held, &profile.Account{Login: login, Token: answer.Token})
	return false, saved, err
}

// DisconnectGithub takes the token and nothing else. What was pushed with it stays pushed, and
// the projects it reached are still there — this is a credential, not a relationship.
func (p *Profiles) DisconnectGithub() (profile.Profile, error) {
	held, err := p.Require()
	if err != nil {
		return profile.Profile{}, err
	}
	return p.setConnection(*held, nil)
}

func (p *Profiles) setConnection(held profile.Profile, account *profile.Account) (profile.Profile, error) {
	saved, err := profile.WriteConnection(held, "github", account)
	if err != nil {
		return profile.Profile{}, err
	}
	p.hold(&saved)
	// What git offers is fixed when a checkout opens, so a token that came or went reopens the
	// project behind it.
	p.deps.Reopen()
	return saved, nil
}

func (p *Profiles) GithubRepos() ([]github.Repo, error) {
	token, err := p.requireToken()
	if err != nil {
		return nil, err
	}
	return github.Repos(token)
}

func (p *Profiles) CreateGithubRepo(input github.NewRepo) (github.Repo, error) {
	token, err := p.requireToken()
	if err != nil {
		return github.Repo{}, err
	}
	return github.CreateRepo(token, input)
}

// requireToken refuses rather than answering empty: a picker with nothing in it and no reason why
// is worse than being told the connection is gone.
func (p *Profiles) requireToken() (string, error) {
	held, err := p.Require()
	if err != nil {
		return "", err
	}
	if account := profile.ReadConnection(*held, "github"); account != nil {
		return account.Token, nil
	}
	return "", apperr.Githubf("%s is not connected to GitHub", held.Name)
}

// HostToken is what the open profile pushes with, or empty where it is connected to nothing.
//
// Read on demand rather than held: the TypeScript holds it because reading it there costs a
// promise per git command, and here it is one read of one small file — which is also how a token
// written by the other daemon is picked up without a restart.
func (p *Profiles) HostToken() string {
	held := p.Active()
	if held == nil {
		return ""
	}
	if account := profile.ReadConnection(*held, "github"); account != nil {
		return account.Token
	}
	return ""
}

// ModelKey is what the open profile speaks to one model provider with, or empty where it holds
// nothing for that one — which is the model picker's answer for why a conversation will not start.
func (p *Profiles) ModelKey(provider string) string {
	held := p.Active()
	if held == nil {
		return ""
	}
	return profile.ReadModelKey(*held, provider)
}
