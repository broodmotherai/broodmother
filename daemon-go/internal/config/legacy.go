// The layouts this file has had before, read only where the current one says nothing. Each is
// the same shape of answer: an older key means what a newer one means, so it is taken forward
// once and written back under the name that survived.

package config

import (
	"encoding/json"
	"math"

	"github.com/broodmotherai/broodmother/daemon-go/internal/git"
)

// adoptLegacyProjectPath: projects were called vaults for a while, and the field that names the
// open one said so. Same meaning, older name, and only read when the current one is absent.
func adoptLegacyProjectPath(source raw, config Config) Config {
	if _, said := source["projectPath"]; config.ProjectPath != nil || said {
		return config
	}
	if legacy, ok := text(source["vaultPath"]); ok {
		config.ProjectPath = &legacy
	}
	return config
}

// adoptLegacyProjects: repos were called projects, and the two fields that file things under one
// said so. Same meaning, older names, and only read when the current ones are absent.
func adoptLegacyProjects(source raw, config Config) Config {
	if _, said := source["repo"]; !said {
		if legacy, ok := nullableNames(source["project"]); ok {
			config.Repo = legacy
		}
	}
	if _, said := source["repoBranch"]; !said {
		if legacy, ok := names(source["projectBranch"]); ok {
			config.RepoBranch = legacy
		}
	}
	return config
}

// adoptLegacySync: the layout before sync settings belonged to a project — one remote, one
// branch and one on-switch for the whole machine, which was only ever right while you had one
// project. They become the open project's own settings, and the remote and branch are dropped
// rather than carried: the repository already knows both, and it is the one that is right.
func adoptLegacySync(source raw, config Config) Config {
	project := config.ProjectPath
	if project == nil {
		return config
	}
	if _, already := config.Git[*project]; already {
		return config
	}

	enabled, said := boolean(source["syncEnabled"])
	idle, timed := legacyIdle(source)
	if !said && !timed {
		return config
	}

	one := git.DefaultSettings()
	if said {
		one.Enabled = enabled
	}
	// No whole-number rule here, unlike the settings a file writes today: this is a number
	// somebody's old config already holds, and the truncation is the reading of it.
	if timed && idle >= 1000 {
		one.IdleMs = int(math.Trunc(idle))
	}
	config.Git[*project] = one
	return config
}

// legacyIdle is `source.idleMs ?? source.syncIdleMs`: the newer name where the file has one that
// is not null, and the older one otherwise.
func legacyIdle(source raw) (float64, bool) {
	for _, key := range []string{"idleMs", "syncIdleMs"} {
		data, found := source[key]
		if !found || string(data) == "null" {
			continue
		}
		var held float64
		if json.Unmarshal(data, &held) != nil {
			return 0, false
		}
		return held, true
	}
	return 0, false
}

// legacyBindings is the map that bound a project to a profile before a project sat inside the
// profile's own folder.
func legacyBindings(source raw) map[string]string {
	bound, ok := names(source["profiles"])
	if !ok {
		return map[string]string{}
	}
	return bound
}
