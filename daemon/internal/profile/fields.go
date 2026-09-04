// The parts of a profile file that are not the identity: what it is connected to, what it holds
// a key for, and the readers each field is proved by. Nothing here refuses — a field it cannot
// read is a field the default stands in for.

package profile

import (
	"encoding/json"
	"sort"

	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/terminal"
)

// Account is what a profile speaks to a service as, and with. One shape for every service a task
// can reach, so a second one is an entry beside `github` rather than another key next to it.
//
// The token is a password and is kept like the private key beside it: a file in the broodmother
// home at 0600. It never leaves the server — what the app is told is the login.
type Account struct {
	Login string `json:"login"`
	Token string `json:"token"`
}

func text(data json.RawMessage) (string, bool) {
	var held string
	if data == nil || json.Unmarshal(data, &held) != nil || held == "" {
		return "", false
	}
	return held, true
}

// credential is a text, or the null that says there is none. Absent is neither: the field keeps
// whatever it already had.
func credential(data json.RawMessage) (*string, bool) {
	if data == nil {
		return nil, false
	}
	if string(data) == "null" {
		return nil, true
	}
	held, ok := text(data)
	if !ok {
		return nil, false
	}
	return &held, true
}

func gitAuthor(data json.RawMessage) (git.Author, bool) {
	var held struct {
		Name  json.RawMessage `json:"name"`
		Email json.RawMessage `json:"email"`
	}
	if data == nil || json.Unmarshal(data, &held) != nil {
		return git.Author{}, false
	}
	name, hasName := text(held.Name)
	email, hasEmail := text(held.Email)
	if !hasName || !hasEmail {
		return git.Author{}, false
	}
	return git.Author{Name: name, Email: email}, true
}

// agentCommands is a line each, and nothing else. A kind left out runs the default one; a blank
// line is the same as leaving it out, so it is refused here rather than saved as an agent that
// runs nothing.
func agentCommands(data json.RawMessage) (terminal.Commands, bool) {
	var held map[string]json.RawMessage
	if data == nil || json.Unmarshal(data, &held) != nil || held == nil {
		return nil, false
	}
	commands := terminal.Commands{}
	for key, value := range held {
		kind := terminal.Kind(key)
		if !terminal.IsAgent(kind) {
			return nil, false
		}
		line, ok := text(value)
		if !ok {
			return nil, false
		}
		commands[kind] = line
	}
	return commands, true
}

func account(data json.RawMessage) (Account, bool) {
	var held struct {
		Login json.RawMessage `json:"login"`
		Token json.RawMessage `json:"token"`
	}
	if data == nil || json.Unmarshal(data, &held) != nil {
		return Account{}, false
	}
	login, hasLogin := text(held.Login)
	token, hasToken := text(held.Token)
	if !hasLogin || !hasToken {
		return Account{}, false
	}
	return Account{Login: login, Token: token}, true
}

// connectionsOf is where a profile's connections live in its file, and where they used to.
// GitHub was once a key of its own at the root; a file written before this still reads, and the
// first write of any connection carries it over.
func connectionsOf(source map[string]json.RawMessage) map[string]Account {
	held := map[string]Account{}
	var raw map[string]json.RawMessage
	if json.Unmarshal(orNull(source["connections"]), &raw) == nil && raw != nil {
		whole := true
		for key, value := range raw {
			one, ok := account(value)
			if key == "" || !ok {
				whole = false
				break
			}
			held[key] = one
		}
		if !whole {
			held = map[string]Account{}
		}
	}
	if _, connected := held["github"]; connected {
		return held
	}
	if legacy, ok := account(source["github"]); ok {
		held["github"] = legacy
	}
	return held
}

// logins is what the browser is told: who each connection is as, and never what it speaks with.
func logins(connections map[string]Account) map[string]string {
	named := make(map[string]string, len(connections))
	for provider, one := range connections {
		named[provider] = one.Login
	}
	return named
}

// modelProviders is which providers a key is held for, and nothing about the keys. A key is a
// password belonging to whoever the profile is, the same as the token beside it.
//
// A union rather than a bare string, so that a provider you sign in to rather than paste into
// fits the slot that is already there instead of needing the file rewritten around it.
func modelProviders(source map[string]json.RawMessage) []string {
	var raw map[string]json.RawMessage
	if json.Unmarshal(orNull(source["models"]), &raw) != nil || raw == nil {
		return []string{}
	}
	providers := make([]string, 0, len(raw))
	for key, value := range raw {
		var held struct {
			Type json.RawMessage `json:"type"`
			Key  json.RawMessage `json:"key"`
		}
		if json.Unmarshal(value, &held) != nil {
			return []string{}
		}
		kind, _ := text(held.Type)
		if _, hasKey := text(held.Key); key == "" || kind != "key" || !hasKey {
			return []string{}
		}
		providers = append(providers, key)
	}
	// A plain sort, not the browser's collation: this list is `Object.keys(...).sort()`, which is
	// JavaScript's default — code unit order — rather than the localeCompare the listings use.
	sort.Strings(providers)
	return providers
}

func orNull(data json.RawMessage) json.RawMessage {
	if data == nil {
		return json.RawMessage("null")
	}
	return data
}
