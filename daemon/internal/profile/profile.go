// Package profile is who you are working as. A profile is a folder in the broodmother home
// holding a `profile.json` and its projects, and the file is what tells one from a folder
// somebody dropped in by hand that is not a profile at all.
//
// What the browser is told about a connection is who it is as, never what it speaks with: the
// tokens and the keys are the server's, and a secret that reaches the browser is a secret in a
// screenshot.
package profile

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/terminal"
	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

const defaultColor = "#8fb8d8"

// defaultTheme is the id of the theme the app ships on. The daemon knows the name and nothing
// else about it: which themes exist is the frontend's, and `themeOf` there answers with its own
// default for an id it has never heard of, so a theme renamed or dropped never strands a profile.
const defaultTheme = "sand"

// Appearance is how the app looks to this person. Its own key rather than a field on the
// identity: it is not typed on the account page, it is switched, and a switch should not have to
// carry every other thing about a profile back to the server to be saved.
type Appearance struct {
	// Theme is the id of a theme in the frontend's `styles/themes/`.
	Theme string `json:"theme"`
}

// Identity is the half of a profile a person edits. The connections and the model keys are not
// in it — they are made and broken by their own routes, not by typing.
type Identity struct {
	// Color is the profile's colour, as #rrggbb.
	Color     string     `json:"color"`
	GitAuthor git.Author `json:"gitAuthor"`
	// SSHKeyPath is the git SSH key in this profile's projects; nil reverts to the default.
	SSHKeyPath *string `json:"sshKeyPath"`
	// AgentCommands is the line each terminal agent is handed here, by kind, where this profile
	// has written one of its own. A kind that is absent runs the default line. It is the whole of
	// what a profile says about an agent: everything else an agent needs is said in the line.
	AgentCommands terminal.Commands `json:"agentCommands"`
	// Soul is markdown appended to the system prompt of claude shells opened here.
	Soul *string `json:"soul"`
}

type Profile struct {
	// Name is the profile's folder name.
	Name string `json:"name"`
	// Path is the profile's file, `~/.broodmother/<name>/profile.json`.
	Path string `json:"path"`
	Identity
	Appearance Appearance `json:"appearance"`
	// Connections are the services this profile is connected to, by provider id, and who it is
	// each of them as — `github` to a login, and whatever comes after it.
	Connections map[string]string `json:"connections"`
	// Models are the model providers this profile holds a credential for, by id — `anthropic`,
	// and whatever comes after it. Never the credentials, for the same reason.
	Models []string `json:"models"`
}

// Dir is where a profile's projects live, which is the folder its own file sits in.
func Dir(p Profile) string { return filepath.Dir(p.Path) }

// Home is where broodmother keeps everything: the profiles, their projects, and this machine's
// config. The environment wins so a test, or a second checkout, can be given one of its own.
func Home() string {
	if home, set := os.LookupEnv("BROODMOTHER_HOME"); set && home != "" {
		return home
	}
	who, err := os.UserHomeDir()
	if err != nil {
		return ".broodmother"
	}
	return filepath.Join(who, ".broodmother")
}

func file(home, name string) string {
	return filepath.Join(home, name, constants.ProfileFile)
}

func AssertName(name string) error {
	if problem := utils.NameProblem(name); problem != "" {
		return apperr.Profilef("profile name %s", problem)
	}
	return nil
}

// List is every folder in the home holding a `profile.json` — drop one in and it is picked up. A
// folder without one is a project from the layout before this, and is moved.
func List(home string) ([]Profile, error) {
	if err := os.MkdirAll(home, 0o755); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(home)
	if err != nil {
		return nil, err
	}
	found := []Profile{}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		path := file(home, entry.Name())
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
			continue
		}
		found = append(found, read(path, entry.Name()))
	}
	collate.SortBy(found, func(one Profile) string { return one.Name })
	return found, nil
}

func Find(name, home string) (*Profile, error) {
	all, err := List(home)
	if err != nil {
		return nil, err
	}
	for _, one := range all {
		if one.Name == name {
			return &one, nil
		}
	}
	return nil, nil
}

// raw is the file as it stands, or nothing where it will not read. A profile dropped in by hand
// is a profile too, so nothing here refuses: what does not parse is what the defaults are for.
func raw(path string) map[string]json.RawMessage {
	body, err := os.ReadFile(path)
	if err != nil {
		return map[string]json.RawMessage{}
	}
	var held map[string]json.RawMessage
	if json.Unmarshal(body, &held) != nil || held == nil {
		return map[string]json.RawMessage{}
	}
	return held
}

func read(path, name string) Profile {
	source := raw(path)
	held := Profile{
		Name:        name,
		Path:        path,
		Identity:    identityOf(source, name),
		Appearance:  appearanceOf(source),
		Connections: logins(connectionsOf(source)),
		Models:      modelProviders(source),
	}
	return held
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// identityOf fills in from the file name field by field rather than refusing the whole profile,
// so a malformed one still opens as somebody.
func identityOf(source map[string]json.RawMessage, name string) Identity {
	held := Identity{
		Color:         defaultColor,
		GitAuthor:     git.Author{Name: name, Email: name + "@localhost"},
		SSHKeyPath:    nil,
		AgentCommands: terminal.Commands{},
		Soul:          nil,
	}
	if color, ok := text(source["color"]); ok && colorPattern.MatchString(color) {
		held.Color = color
	}
	if author, ok := gitAuthor(source["gitAuthor"]); ok {
		held.GitAuthor = author
	}
	if key, ok := credential(source["sshKeyPath"]); ok {
		held.SSHKeyPath = key
	}
	if commands, ok := agentCommands(source["agentCommands"]); ok {
		held.AgentCommands = commands
	}
	if soul, ok := credential(source["soul"]); ok {
		held.Soul = soul
	}
	return souled(held)
}

// souled: every profile has a soul whether or not anyone has written one, which is the rule the
// brief already follows. A file that never mentions one and a file that says null are the same
// thing said twice, so both read back as the default — and the profile's page opens on the
// prompt its agents are actually held to rather than on a blank box.
//
// Only what is handed back, never what is written: baking the default into every file would
// freeze it at the day the profile was made.
func souled(held Identity) Identity {
	if held.Soul != nil && strings.TrimSpace(*held.Soul) != "" {
		return held
	}
	soul := DefaultSoul
	held.Soul = &soul
	return held
}

// MachineAuthor is who git on this machine already thinks you are. A profile is the first thing
// broodmother asks for, and on any machine that has ever committed the answer is already on disk
// — asking for it again is a question nobody needed.
//
// Run from the home, which is no repository, so what answers is the global and system config:
// the machine's own answer rather than one project's.
func MachineAuthor(home string) *git.Author {
	author := git.Author{Name: config(home, "user.name"), Email: config(home, "user.email")}
	if author.Name == "" && author.Email == "" {
		return nil
	}
	return &author
}

func config(home, key string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "git", "config", "--get", key)
	// From the home, which is no repository, so what answers is the global and system config.
	command.Dir = home
	out, err := command.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// defaultKeys are the keys ssh tries on its own, in the order it tries them.
var defaultKeys = []string{"id_ed25519", "id_ecdsa", "id_rsa"}

// MachineSSHKey is the key ssh on this machine would use without being told: the first of its
// defaults that is there, as `~/…` so the form shows what you would have typed. Empty where none
// is.
func MachineSSHKey(sshDir string) string {
	for _, name := range defaultKeys {
		path := filepath.Join(sshDir, name)
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return utils.Tilde(path)
		}
	}
	return ""
}

// DefaultSSHDir is where ssh keeps its keys when nobody has said otherwise.
func DefaultSSHDir() string {
	who, err := os.UserHomeDir()
	if err != nil {
		return ".ssh"
	}
	return filepath.Join(who, ".ssh")
}
