// Writing a profile: who you commit as, the key you push with, and what you speak to a service
// or a model with. Each lands in the same file at 0600, because a token and a private key are
// the same kind of thing as the name beside them — whoever the profile is.
//
// The file is written as the file it was read from plus what changed, never as the model
// rendered out: a profile can be dropped in by hand, and a key nothing here has heard of has to
// survive a save that touched the colour. That is what [jsjson] is for — a Go map would come
// back alphabetised, and the first save would move every line.

package profile

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon-go/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon-go/internal/jsjson"
	"github.com/broodmotherai/broodmother/daemon-go/internal/utils"
)

// ModelKey is what a profile speaks to one model provider with. A union rather than a bare key,
// so that a provider you sign in to rather than paste into — an OAuth login like the one
// `claude` already holds — fits the slot that is already there instead of needing the file
// rewritten around it.
type ModelKey struct {
	Type string `json:"type"`
	Key  string `json:"key"`
}

// New is a profile nobody has made yet: a name, and who it is.
type New struct {
	Name string `json:"name"`
	Identity
}

// object is the file as it stands and in the order it stands in, or an empty one where it will
// not read — the same forgiveness [raw] shows, since a profile dropped in by hand is a profile.
func object(path string) *jsjson.Object {
	body, err := os.ReadFile(path)
	if err != nil {
		return jsjson.NewObject()
	}
	value, ok := jsjson.Parse(string(body))
	if !ok {
		return jsjson.NewObject()
	}
	held, isObject := value.(*jsjson.Object)
	if !isObject {
		return jsjson.NewObject()
	}
	return held
}

// fields is the same file as the readers take it, which is by key rather than in order.
func fields(held *jsjson.Object) map[string]json.RawMessage {
	source := map[string]json.RawMessage{}
	for _, key := range held.Keys() {
		value, _ := held.Get(key)
		source[key] = json.RawMessage(jsjson.Compact(value))
	}
	return source
}

// valueOf is a Go value as the file holds it. Through JSON rather than by hand, so a struct's
// tags decide the spelling here the way they decide it everywhere else.
func valueOf(value any) any {
	body, err := json.Marshal(value)
	if err != nil {
		// Everything passed here is a string, a map of them, or a struct of both.
		panic(err)
	}
	held, ok := jsjson.Parse(string(body))
	if !ok {
		panic("encoding/json wrote what jsjson will not read")
	}
	return held
}

func orNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// without is the file minus one key, in the order it had the rest.
func without(held *jsjson.Object, drop string) *jsjson.Object {
	kept := jsjson.NewObject()
	for _, key := range held.Keys() {
		if key == drop {
			continue
		}
		value, _ := held.Get(key)
		kept.Set(key, value)
	}
	return kept
}

// save writes at 0600, which is the protection a token and a key actually have.
func save(path string, held *jsjson.Object) error {
	return utils.AtomicWrite(path, []byte(jsjson.Indent(held, "  ")+"\n"), 0o600)
}

// WriteIdentity is merged rather than written over: the file holds the connections and the model
// keys too, and saving who you commit as is not signing out of anywhere.
func WriteIdentity(p Profile, identity Identity) (Profile, error) {
	// The page opens on the default, so saving one that was never touched comes back here as the
	// default's own text. Storing it would freeze a copy of it on the day it was saved; what it
	// means is that nobody has written a soul, which is what goes in the file.
	written := identity
	if written.Soul != nil && strings.TrimSpace(*written.Soul) == DefaultSoul {
		written.Soul = nil
	}

	held := object(p.Path)
	held.Set("color", written.Color)
	held.Set("gitAuthor", valueOf(written.GitAuthor))
	held.Set("sshKeyPath", orNil(written.SSHKeyPath))
	held.Set("agentCommands", valueOf(written.AgentCommands))
	held.Set("soul", orNil(written.Soul))
	if err := save(p.Path, held); err != nil {
		return Profile{}, err
	}
	p.Identity = souled(written)
	return p, nil
}

// Create makes the folder and writes the file. A profile made from the project menu is one you
// meant to work as; it holds no projects yet, which is the first-run state with a name on it.
func Create(input New, home string) (Profile, error) {
	if err := AssertName(input.Name); err != nil {
		return Profile{}, err
	}
	found, err := Find(input.Name, home)
	if err != nil {
		return Profile{}, err
	}
	if found != nil {
		return Profile{}, apperr.Profilef("a profile named %q already exists", input.Name)
	}
	if err := os.MkdirAll(filepath.Join(home, input.Name), 0o755); err != nil {
		return Profile{}, err
	}
	return WriteIdentity(Profile{
		Name:        input.Name,
		Path:        file(home, input.Name),
		Identity:    input.Identity,
		Connections: map[string]string{},
		Models:      []string{},
	}, input.Identity)
}

// keptModels is the credentials the file holds, in the order it holds them — and nothing at all
// where any one of them is malformed, which is how [modelProviders] reads them too. A file half
// of whose keys are unreadable is a file this cannot safely write one key back into.
func keptModels(held *jsjson.Object) *jsjson.Object {
	kept := jsjson.NewObject()
	value, _ := held.Get("models")
	source, isObject := value.(*jsjson.Object)
	if !isObject {
		return kept
	}
	for _, provider := range source.Keys() {
		one, _ := source.Get(provider)
		entry, isEntry := one.(*jsjson.Object)
		if provider == "" || !isEntry {
			return jsjson.NewObject()
		}
		kind, _ := entry.Get("type")
		secret, _ := entry.Get("key")
		held, isKey := secret.(string)
		if kind != any("key") || !isKey || held == "" {
			return jsjson.NewObject()
		}
		kept.Set(provider, one)
	}
	return kept
}

// WriteModelKey writes one provider's credential. Nil forgets that one provider: the others
// stay, and so does everything else in the file — dropping a key is not signing out of the rest
// of your life.
func WriteModelKey(p Profile, provider string, credential *ModelKey) (Profile, error) {
	held := object(p.Path)
	models := without(keptModels(held), provider)
	if credential != nil {
		models.Set(provider, valueOf(credential))
	}
	held.Set("models", models)
	if err := save(p.Path, held); err != nil {
		return Profile{}, err
	}
	p.Models = named(models)
	return p, nil
}

// keptConnections is where a profile's connections live in its file, and where they used to.
// GitHub was once a key of its own at the root; a file written before this still reads, and the
// first write of any connection carries it over.
func keptConnections(held *jsjson.Object) *jsjson.Object {
	kept := jsjson.NewObject()
	value, _ := held.Get("connections")
	if source, isObject := value.(*jsjson.Object); isObject {
		whole := true
		for _, provider := range source.Keys() {
			one, _ := source.Get(provider)
			if provider == "" || !isAccount(one) {
				whole = false
				break
			}
			kept.Set(provider, one)
		}
		if !whole {
			kept = jsjson.NewObject()
		}
	}
	if _, connected := kept.Get("github"); connected {
		return kept
	}
	if legacy, _ := held.Get("github"); isAccount(legacy) {
		kept.Set("github", legacy)
	}
	return kept
}

func isAccount(value any) bool {
	held, isObject := value.(*jsjson.Object)
	if !isObject {
		return false
	}
	login, _ := held.Get("login")
	token, _ := held.Get("token")
	as, named := login.(string)
	with, speaks := token.(string)
	return named && speaks && as != "" && with != ""
}

// WriteConnection connects or disconnects one service. Nil disconnects: the profile keeps
// everything else it had, since signing out of a host is not forgetting who you commit as, or
// who else you have signed in with.
func WriteConnection(p Profile, provider string, account *Account) (Profile, error) {
	held := object(p.Path)
	connections := without(keptConnections(held), provider)
	if account != nil {
		connections.Set(provider, valueOf(account))
	}
	// The root `github` key goes on any write, whichever provider was written: leaving it would
	// let a disconnect be undone by the fallback that reads it.
	next := without(held, "github")
	next.Set("connections", connections)
	if err := save(p.Path, next); err != nil {
		return Profile{}, err
	}
	p.Connections = map[string]string{}
	for _, one := range connections.Keys() {
		value, _ := connections.Get(one)
		if entry, isObject := value.(*jsjson.Object); isObject {
			login, _ := entry.Get("login")
			p.Connections[one], _ = login.(string)
		}
	}
	return p, nil
}

// ReadConnection is what this profile speaks to one service as, and with. The token, which is
// why nothing that answers a request calls it.
func ReadConnection(p Profile, provider string) *Account {
	if one, found := connectionsOf(fields(object(p.Path)))[provider]; found {
		return &one
	}
	return nil
}

// named is `Object.keys(...).sort()`, which is JavaScript's default — code unit order — rather
// than the localeCompare the listings a person reads are sorted with.
func named(held *jsjson.Object) []string {
	keys := held.Keys()
	if keys == nil {
		keys = []string{}
	}
	sort.Strings(keys)
	return keys
}

// KeyFile is the key a profile keeps beside its own file, when it has one broodmother made.
func KeyFile(p Profile) string { return strings.TrimSuffix(p.Path, ".json") + ".key" }

// ReadPublicKey is the public half of the key this profile offers git, or empty where there is
// none. The one it named if it named one, since a key made elsewhere is still this profile's.
func ReadPublicKey(p Profile) string {
	named := KeyFile(p)
	if p.SSHKeyPath != nil {
		named = utils.ExpandHome(*p.SSHKeyPath)
	}
	body, err := os.ReadFile(named + ".pub")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}

const keygenTimeout = 30 * time.Second

// GenerateKey makes a key here rather than in a terminal. ed25519 because it is the default
// everywhere that matters and the public half is one short line, which is the line you are about
// to paste into a host.
//
// No passphrase: git runs from this app with no terminal to answer a prompt on, so a passphrase
// would be a key that cannot be used rather than a key that is safer. The file sits in the
// broodmother home at 0600, which is the protection it actually has.
//
// Refused where one is already there — replacing a key silently is taking away access to
// everything the old one opened.
func GenerateKey(p Profile) (string, error) {
	if ReadPublicKey(p) != "" {
		return "", apperr.Profilef("%s already has a key", p.Name)
	}
	target := KeyFile(p)

	ctx, cancel := context.WithTimeout(context.Background(), keygenTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, "ssh-keygen",
		"-t", "ed25519", "-f", target, "-N", "", "-C", p.Name+"@broodmother", "-q")
	var errs bytes.Buffer
	command.Stderr = &errs
	if err := command.Run(); err != nil {
		if said := strings.TrimSpace(errs.String()); said != "" {
			return "", apperr.Profilef("%s", said)
		}
		return "", apperr.Profilef("ssh-keygen failed")
	}

	body, err := os.ReadFile(target + ".pub")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(body)), nil
}

// ReadModelKey is what this profile speaks to one provider with, or empty where it holds nothing
// for that one. Read off the file each time rather than carried on the [Profile]: a credential in
// a struct that is handed to a route is a credential one careless `json:` tag from the browser.
func ReadModelKey(p Profile, provider string) string {
	one, said := keptModels(object(p.Path)).Get(provider)
	entry, isEntry := one.(*jsjson.Object)
	if !said || !isEntry {
		return ""
	}
	secret, _ := entry.Get("key")
	held, isKey := secret.(string)
	if !isKey {
		return ""
	}
	return held
}
