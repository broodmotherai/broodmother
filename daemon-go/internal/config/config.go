// Package config is what broodmother knows before it has read anything else: which project is
// open, as whom, and on which checkout of it.
//
// Identity is deliberately thin: who you are lives in a profile on disk and only its name is
// here, because a project sits inside the profile it commits as and the folder is the binding.
// So is anything about git: whether a project has a repository is the project's business, and
// how it syncs is filed under the project it belongs to.
package config

import (
	"github.com/broodmotherai/broodmother/daemon-go/internal/git"
)

// Config is the file, in the order it is written. A map's keys come back out of encoding/json
// sorted rather than as they went in, which for this file costs nothing: the home writes itself
// a `.gitignore` of `*`, so no diff of it is ever read.
type Config struct {
	// ProjectPath is the absolute path to the open project, nil on first run.
	ProjectPath *string `json:"projectPath"`
	// Profile is the profile you are working as, whose folder holds the projects.
	Profile *string `json:"profile"`
	// Checkouts maps a project path to the folder of the checkout open in it.
	Checkouts map[string]string `json:"checkouts"`
	// Git maps a project path to how it syncs; no entry means the defaults.
	Git map[string]git.Settings `json:"git"`
	// Repo maps a project path to the repo it is scoped to, nil for the project itself.
	Repo map[string]*string `json:"repo"`
	// RepoBranch maps `<project>#<repo>` to the folder of its open checkout.
	RepoBranch map[string]string `json:"repoBranch"`
}

// Fields are the config's keys, in the order they are declared. Reading a malformed file names
// the ones it had to reset, and it names them in this order.
var Fields = []string{"projectPath", "profile", "checkouts", "git", "repo", "repoBranch"}

func Default(projectPath *string) Config {
	return Config{
		ProjectPath: projectPath,
		Profile:     nil,
		Checkouts:   map[string]string{},
		Git:         map[string]git.Settings{},
		Repo:        map[string]*string{},
		RepoBranch:  map[string]string{},
	}
}

// Clone is a copy nothing else holds a reference into, so a repair working over the defaults
// cannot reach back into them.
func (c Config) Clone() Config {
	out := c
	out.Checkouts = maps(c.Checkouts)
	out.RepoBranch = maps(c.RepoBranch)
	out.Git = make(map[string]git.Settings, len(c.Git))
	for key, value := range c.Git {
		out.Git[key] = value
	}
	out.Repo = make(map[string]*string, len(c.Repo))
	for key, value := range c.Repo {
		out.Repo[key] = value
	}
	return out
}

func maps(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
