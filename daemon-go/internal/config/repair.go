// Reading the file field by field, so a malformed one costs only the bad fields. Refusing to
// start would strand somebody with no interface to fix the file in — and the file says which
// project is open, so refusing to start is refusing to open anything.

package config

import (
	"encoding/json"
	"math"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"

	"github.com/broodmotherai/broodmother/daemon-go/internal/git"
)

type raw = map[string]json.RawMessage

// Loaded is the config a file yielded, what had to be thrown away to get it, and the one thing
// read out of the file that is not config.
type Loaded struct {
	Config Config
	// Reset names the fields a malformed file lost.
	Reset []string
	// Bindings is the layout before a project sat inside the profile it commits as, when the
	// binding was a map here. Read once, by the migration that moves the folders.
	Bindings map[string]string
}

// Repair reads what it can. A nil source is a file that would not parse at all, which is not the
// same as a file that is not there: the first resets every field and the second resets none.
func Repair(source json.RawMessage, defaults Config) Loaded {
	held, whole := object(source)
	reset := []string{}
	if !whole {
		reset = append(reset, Fields...)
	}

	config := defaults.Clone()
	for _, key := range Fields {
		data, found := held[key]
		if !found {
			continue
		}
		if !readField(&config, key, data) && !contains(reset, key) {
			reset = append(reset, key)
		}
	}

	config = adoptLegacyProjects(held, adoptLegacyProjectPath(held, config))
	return Loaded{
		Config:   adoptLegacySync(held, config),
		Reset:    reset,
		Bindings: legacyBindings(held),
	}
}

func readField(config *Config, key string, data json.RawMessage) bool {
	switch key {
	case "projectPath":
		return read(data, name, &config.ProjectPath)
	case "profile":
		return read(data, name, &config.Profile)
	case "checkouts":
		return read(data, names, &config.Checkouts)
	case "git":
		return read(data, settings, &config.Git)
	case "repo":
		return read(data, nullableNames, &config.Repo)
	case "repoBranch":
		return read(data, names, &config.RepoBranch)
	}
	return false
}

func read[T any](data json.RawMessage, of func(json.RawMessage) (T, bool), into *T) bool {
	value, ok := of(data)
	if ok {
		*into = value
	}
	return ok
}

func object(data json.RawMessage) (raw, bool) {
	var held raw
	if data == nil || json.Unmarshal(data, &held) != nil || held == nil {
		return raw{}, false
	}
	return held, true
}

// text is a string of at least one character, which is what every name in this file has to be:
// an empty project path is not a project path.
func text(data json.RawMessage) (string, bool) {
	var held string
	if json.Unmarshal(data, &held) != nil || held == "" {
		return "", false
	}
	return held, true
}

// name is a text, or the null that says there is none — which is a first run, not a fault.
func name(data json.RawMessage) (*string, bool) {
	if string(data) == "null" {
		return nil, true
	}
	held, ok := text(data)
	if !ok {
		return nil, false
	}
	return &held, true
}

func entries[T any](data json.RawMessage, of func(json.RawMessage) (T, bool)) (map[string]T, bool) {
	held, whole := object(data)
	if !whole {
		return nil, false
	}
	out := make(map[string]T, len(held))
	for key, value := range held {
		read, ok := of(value)
		if key == "" || !ok {
			return nil, false
		}
		out[key] = read
	}
	return out, true
}

func names(data json.RawMessage) (map[string]string, bool) { return entries(data, text) }

func nullableNames(data json.RawMessage) (map[string]*string, bool) {
	return entries(data, name)
}

func settings(data json.RawMessage) (map[string]git.Settings, bool) {
	return entries(data, oneSettings)
}

// oneSettings is required except for trailers, which is defaulted rather than required: a file
// written before trailers existed still parses, and one that did not would cost every project
// its sync settings on the first read.
func oneSettings(data json.RawMessage) (git.Settings, bool) {
	held, whole := object(data)
	if !whole {
		return git.Settings{}, false
	}
	var one git.Settings
	for _, field := range []struct {
		key  string
		into *bool
	}{
		{"enabled", &one.Enabled}, {"autoCommit", &one.AutoCommit},
		{"pull", &one.Pull}, {"push", &one.Push},
	} {
		if !read(held[field.key], boolean, field.into) {
			return git.Settings{}, false
		}
	}
	idle, ok := whole1000(held["idleMs"])
	if !ok {
		return git.Settings{}, false
	}
	one.IdleMs = idle
	if data, found := held["trailers"]; found && !read(data, boolean, &one.Trailers) {
		return git.Settings{}, false
	}
	return one, true
}

func boolean(data json.RawMessage) (bool, bool) {
	var held bool
	if data == nil || json.Unmarshal(data, &held) != nil {
		return false, false
	}
	return held, true
}

// whole1000 is a whole number of milliseconds no smaller than a second. Anything shorter is a
// sync loop that never stops running.
func whole1000(data json.RawMessage) (int, bool) {
	var held float64
	if data == nil || json.Unmarshal(data, &held) != nil {
		return 0, false
	}
	if held != math.Trunc(held) || math.IsInf(held, 0) || held < 1000 {
		return 0, false
	}
	return int(held), true
}

func contains(all []string, one string) bool {
	for _, each := range all {
		if each == one {
			return true
		}
	}
	return false
}

// Parse is the config as a request must send it: every field there and every field right. Unlike
// [Repair], which reads a file somebody may have edited by hand and salvages what it can, this
// reads a body a program wrote — so a field that is wrong is a caller to tell rather than a
// setting to quietly drop.
func Parse(source json.RawMessage) (Config, error) {
	held, whole := object(source)
	if !whole {
		return Config{}, apperr.BadRequestf("config must be an object")
	}
	parsed := Default(nil)
	for _, key := range Fields {
		data, found := held[key]
		if !found {
			return Config{}, apperr.BadRequestf("config has no %s", key)
		}
		if !readField(&parsed, key, data) {
			return Config{}, apperr.BadRequestf("config %s is not what it should be", key)
		}
	}
	return parsed, nil
}
