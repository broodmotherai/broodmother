// The services a step or a watch can reach, as this checkout can reach them.

package tasks

import (
	"github.com/broodmotherai/broodmother/daemon/internal/github"
)

// GithubReach is GitHub as a step in this checkout can reach it: the service the profile's
// connection built, and the two answers a node that names neither repository nor branch means.
type GithubReach struct {
	Service *github.Service
	// Slug is `owner/name` of this checkout's own remote, where it has a GitHub one.
	Slug string
	// Branch is the branch this checkout is on.
	Branch string
}

// Reaches is every service a step or a watch can reach, one field per provider. A second one is a
// field here and a folder of its own — not another argument on the two contracts, which is what a
// `github` beside a `slack` beside a `linear` would become. Nil where nothing is connected, which
// is the one thing a step of that provider's cannot work around.
type Reaches struct {
	Github *GithubReach
}

// Reach is the lookup a step and a watch are both handed, bound to the checkout they run in.
type Reach func(cwd string) Reaches

func (s *Store) reaching(cwd string) Reaches {
	if s.deps.Reach == nil {
		return Reaches{}
	}
	return s.deps.Reach(cwd)
}
