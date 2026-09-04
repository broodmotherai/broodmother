package profile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func home(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
		if body == "" {
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, name, "profile.json"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// The file is what tells a profile from a folder somebody dropped in by hand that is not one.
func TestOnlyAFolderHoldingTheFileIsAProfile(t *testing.T) {
	dir := home(t, map[string]string{"Michael": "{}", "stray": "", ".hidden": "{}"})
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Name != "Michael" {
		t.Fatalf("found %+v", all)
	}
}

// A file dropped in by hand is a profile too, so a malformed one fills in from the file name
// field by field rather than refusing the whole profile.
func TestFillsInAroundWhateverTheFileGotWrong(t *testing.T) {
	dir := home(t, map[string]string{
		"alice": `{"color":"not a colour","gitAuthor":{"name":"","email":"a@b"},"sshKeyPath":7}`,
	})
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	one := all[0]
	if one.Color != defaultColor {
		t.Errorf("colour is %q", one.Color)
	}
	// One bad half costs the whole author, which is the field the schema proves as a pair.
	if one.GitAuthor.Name != "alice" || one.GitAuthor.Email != "alice@localhost" {
		t.Errorf("author is %+v", one.GitAuthor)
	}
	if one.SSHKeyPath != nil {
		t.Errorf("key is %q", *one.SSHKeyPath)
	}
}

func TestAProfileThatIsNotJSONIsStillAProfile(t *testing.T) {
	dir := home(t, map[string]string{"Zoe": "not json at all"})
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Name != "Zoe" || all[0].Color != defaultColor {
		t.Fatalf("read %+v", all)
	}
}

// Every profile has a soul whether or not anyone has written one, and one that is only spaces is
// nobody having written one.
func TestEveryProfileHasASoul(t *testing.T) {
	dir := home(t, map[string]string{
		"none":    `{}`,
		"null":    `{"soul":null}`,
		"blank":   `{"soul":"   "}`,
		"written": `{"soul":"be brief"}`,
	})
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, one := range all {
		if one.Soul == nil {
			t.Fatalf("%s has no soul", one.Name)
		}
		want := DefaultSoul
		if one.Name == "written" {
			want = "be brief"
		}
		if *one.Soul != want {
			t.Errorf("%s reads back as %q", one.Name, *one.Soul)
		}
	}
	if strings.HasPrefix(DefaultSoul, "\n") || strings.HasSuffix(DefaultSoul, "\n") {
		t.Error("the default soul is not trimmed the way the TypeScript trims it")
	}
}

// What the browser is told is who each connection is as, and never what it speaks with.
func TestNeverHandsOutWhatItSpeaksWith(t *testing.T) {
	dir := home(t, map[string]string{
		"Michael": `{"connections":{"github":{"login":"mvaden","token":"ghp_secret"}},
		             "models":{"anthropic":{"type":"key","key":"sk-secret"}}}`,
	})
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	one := all[0]
	if one.Connections["github"] != "mvaden" {
		t.Errorf("connections are %v", one.Connections)
	}
	if len(one.Models) != 1 || one.Models[0] != "anthropic" {
		t.Errorf("models are %v", one.Models)
	}
	for _, held := range []any{one.Connections, one.Models} {
		if strings.Contains(sprint(held), "secret") {
			t.Fatalf("a credential reached the answer: %v", held)
		}
	}
}

func sprint(value any) string {
	switch held := value.(type) {
	case map[string]string:
		out := ""
		for key, one := range held {
			out += key + one
		}
		return out
	case []string:
		return strings.Join(held, "")
	}
	return ""
}

// GitHub was once a key of its own at the root; a file written before this still reads.
func TestReadsTheOlderPlaceAConnectionWasKept(t *testing.T) {
	dir := home(t, map[string]string{"Michael": `{"github":{"login":"legacy","token":"t"}}`})
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if all[0].Connections["github"] != "legacy" {
		t.Errorf("connections are %v", all[0].Connections)
	}
}

// A kind left out runs the default line; a blank one is the same as leaving it out, so it is
// refused rather than saved as an agent that runs nothing.
func TestOnlyAnAgentKindTakesALine(t *testing.T) {
	dir := home(t, map[string]string{
		"good":  `{"agentCommands":{"claude":"claude --resume"}}`,
		"blank": `{"agentCommands":{"claude":""}}`,
		"shell": `{"agentCommands":{"shell":"bash"}}`,
	})
	all, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, one := range all {
		switch one.Name {
		case "good":
			if one.AgentCommands["claude"] != "claude --resume" {
				t.Errorf("good has %v", one.AgentCommands)
			}
		default:
			if len(one.AgentCommands) != 0 {
				t.Errorf("%s kept %v", one.Name, one.AgentCommands)
			}
		}
	}
}

func TestFindsOneByNameAndNothingByAnother(t *testing.T) {
	dir := home(t, map[string]string{"Michael": "{}"})
	found, err := Find("Michael", dir)
	if err != nil || found == nil {
		t.Fatalf("found %v, %v", found, err)
	}
	if Dir(*found) != filepath.Join(dir, "Michael") {
		t.Errorf("projects live in %q", Dir(*found))
	}
	missing, err := Find("nobody", dir)
	if err != nil || missing != nil {
		t.Fatalf("found %v, %v", missing, err)
	}
}
