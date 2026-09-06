package profile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/terminal"
)

func written(t *testing.T, body string) Profile {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "profile.json")
	if body != "" {
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return Profile{Name: "ada", Path: path, Identity: identityOf(raw(path), "ada")}
}

func onDisk(t *testing.T, p Profile) string {
	t.Helper()
	body, err := os.ReadFile(p.Path)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func anIdentity() Identity {
	return Identity{
		Color:         "#8fb8d8",
		GitAuthor:     git.Author{Name: "Ada", Email: "ada@localhost"},
		AgentCommands: terminal.Commands{},
	}
}

// The whole reason the file is held in order rather than in a map: a key nothing here has heard
// of keeps the place it had, and a save that touched the colour moves no other line.
func TestWritesOverWhatItKnowsAndLeavesEveryOtherLineWhereItWas(t *testing.T) {
	p := written(t, `{"zzz":1,"color":"#000000","mine":{"b":2,"a":1}}`+"\n")
	if _, err := WriteIdentity(p, anIdentity()); err != nil {
		t.Fatal(err)
	}
	want := `{
  "zzz": 1,
  "color": "#8fb8d8",
  "mine": {
    "b": 2,
    "a": 1
  },
  "gitAuthor": {
    "name": "Ada",
    "email": "ada@localhost"
  },
  "sshKeyPath": null,
  "agentCommands": {},
  "soul": null
}
`
	if got := onDisk(t, p); got != want {
		t.Errorf("wrote:\n%s\nwant:\n%s", got, want)
	}
}

// The page opens on the default, so saving one that was never touched means nobody has written a
// soul — which is what goes in the file. Storing it would freeze a copy of it.
func TestDoesNotStoreTheSoulThePageOpenedOn(t *testing.T) {
	p := written(t, "{}\n")
	identity := anIdentity()
	held := "\n" + DefaultSoul + "  "
	identity.Soul = &held
	saved, err := WriteIdentity(p, identity)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(onDisk(t, p), `"soul": null`) {
		t.Errorf("stored it:\n%s", onDisk(t, p))
	}
	// Handed back filled in, though: the profile's page opens on the prompt its agents are held
	// to rather than on a blank box.
	if saved.Soul == nil || *saved.Soul != DefaultSoul {
		t.Errorf("answered with %v", saved.Soul)
	}
}

func TestKeepsASoulSomebodyActuallyWrote(t *testing.T) {
	p := written(t, "{}\n")
	identity := anIdentity()
	held := "be brief"
	identity.Soul = &held
	if _, err := WriteIdentity(p, identity); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(onDisk(t, p), `"soul": "be brief"`) {
		t.Errorf("wrote:\n%s", onDisk(t, p))
	}
}

// The others stay where they were and the one written goes last, which is where re-adding a key
// puts it. Dropping one is not signing out of the rest of your life.
func TestWritesOneModelKeyAndLeavesTheOthersInThePlaceTheyHad(t *testing.T) {
	p := written(t, `{"models":{"zeta":{"type":"key","key":"z"},"alpha":{"type":"key","key":"a"}}}`+"\n")
	saved, err := WriteModelKey(p, "beta", &ModelKey{Type: "key", Key: "b"})
	if err != nil {
		t.Fatal(err)
	}
	body := onDisk(t, p)
	if at, then, last := strings.Index(body, `"zeta"`), strings.Index(body, `"alpha"`), strings.Index(body, `"beta"`); !(at < then && then < last) {
		t.Errorf("wrote:\n%s", body)
	}
	// What comes back is sorted, since that is `Object.keys(...).sort()` rather than the order
	// the file holds.
	if strings.Join(saved.Models, ",") != "alpha,beta,zeta" {
		t.Errorf("holds %v", saved.Models)
	}

	gone, err := WriteModelKey(saved, "zeta", nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(onDisk(t, p), `"z"`) {
		t.Errorf("the key is still there:\n%s", onDisk(t, p))
	}
	if strings.Join(gone.Models, ",") != "alpha,beta" {
		t.Errorf("holds %v", gone.Models)
	}
}

// A file half of whose credentials are unreadable is a file this cannot safely write one key back
// into — so it writes the one it was given and nothing else, which is what the reader already
// reports the file as holding.
func TestDropsEveryModelKeyWhereOneOfThemIsMalformed(t *testing.T) {
	p := written(t, `{"models":{"alpha":{"type":"key","key":"a"},"beta":"not an object"}}`+"\n")
	saved, err := WriteModelKey(p, "anthropic", &ModelKey{Type: "key", Key: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(saved.Models, ",") != "anthropic" {
		t.Errorf("holds %v", saved.Models)
	}
}

// A key made elsewhere is still this profile's, so the path it named is the one read back.
func TestReadsThePublicHalfOfWhicheverKeyTheProfileNames(t *testing.T) {
	dir := t.TempDir()
	elsewhere := filepath.Join(dir, "somewhere.key")
	if err := os.WriteFile(elsewhere+".pub", []byte("ssh-ed25519 AAAA ada\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	p := written(t, "{}\n")
	if got := ReadPublicKey(p); got != "" {
		t.Errorf("a profile with no key answered %q", got)
	}
	p.SSHKeyPath = &elsewhere
	if got := ReadPublicKey(p); got != "ssh-ed25519 AAAA ada" {
		t.Errorf("read %q", got)
	}
}

func TestReadsTheTokenOutOfEitherPlaceAConnectionIsKept(t *testing.T) {
	held := written(t, `{"github":{"login":"ada","token":"legacy"}}`+"\n")
	if account := ReadConnection(held, "github"); account == nil || account.Token != "legacy" {
		t.Errorf("read %+v", account)
	}
	now := written(t, `{"connections":{"github":{"login":"ada","token":"current"}}}`+"\n")
	if account := ReadConnection(now, "github"); account == nil || account.Token != "current" {
		t.Errorf("read %+v", account)
	}
	if account := ReadConnection(now, "gitlab"); account != nil {
		t.Errorf("read a connection nobody made: %+v", account)
	}
}

// A theme is switched by its own write, so it goes into the file beside everything else rather
// than over any of it — and the keys the file already had keep the order they had.
func TestWritesTheAppearanceAndLeavesEveryOtherLineWhereItWas(t *testing.T) {
	p := written(t, `{"zzz":1,"color":"#000000"}`+"\n")
	saved, err := WriteAppearance(p, Appearance{Theme: "ink"})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Appearance.Theme != "ink" {
		t.Errorf("came back as %+v", saved.Appearance)
	}
	want := `{
  "zzz": 1,
  "color": "#000000",
  "appearance": {
    "theme": "ink"
  }
}
`
	if got := onDisk(t, p); got != want {
		t.Errorf("wrote:\n%s\nwant:\n%s", got, want)
	}
}

// The one way these two writes could ruin each other: the account page holds a copy of the
// identity from before a theme was switched, and saving it must not carry that copy over the
// switch. `WriteIdentity` writes the keys it names and no others, and this is what says so.
func TestSavingTheIdentityLeavesTheAppearanceWhereItWas(t *testing.T) {
	p := written(t, `{"appearance":{"theme":"ink"}}`+"\n")
	if _, err := WriteIdentity(p, anIdentity()); err != nil {
		t.Fatal(err)
	}
	if got := onDisk(t, p); !strings.Contains(got, `"theme": "ink"`) {
		t.Errorf("lost the theme:\n%s", got)
	}
	if again := read(p.Path, "ada"); again.Appearance.Theme != "ink" {
		t.Errorf("reads back as %+v", again.Appearance)
	}
}

// A file written before the app had themes is every file on disk today, and it opens on the one
// the app ships rather than on nothing.
func TestAProfileThatSaysNothingAboutThemesOpensOnTheDefault(t *testing.T) {
	p := written(t, `{"color":"#000000"}`+"\n")
	if held := read(p.Path, "ada"); held.Appearance.Theme != defaultTheme {
		t.Errorf("opened on %q", held.Appearance.Theme)
	}
	broken := written(t, `{"appearance":{"theme":42}}`+"\n")
	if held := read(broken.Path, "ada"); held.Appearance.Theme != defaultTheme {
		t.Errorf("a theme that is not a name opened on %q", held.Appearance.Theme)
	}
}

// Which themes exist is the frontend's, so a name the daemon has never heard of is carried rather
// than corrected — the app falls back to its own default for one it cannot draw, and a theme
// renamed and renamed back finds the profile still pointing at it.
func TestCarriesAThemeItHasNeverHeardOf(t *testing.T) {
	p := written(t, `{"appearance":{"theme":"midnight"}}`+"\n")
	if held := read(p.Path, "ada"); held.Appearance.Theme != "midnight" {
		t.Errorf("read back as %q", held.Appearance.Theme)
	}
}
