// Package personas is what a checkout's `.personas/` folder carries: a folder per persona, whose
// PERSONA.md joins the system prompt of a task step wearing it.
package personas

import (
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/collate"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/markdown"
)

type Persona struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// noDescription: a persona that exists is worth naming even when nobody has said what for.
const noDescription = "no description — read its PERSONA.md"

func Scan(checkout string) []Persona {
	found := []Persona{}
	var walk func(dir, prefix string)
	walk = func(dir, prefix string) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".") || !entry.IsDir() {
				continue
			}
			full := filepath.Join(dir, entry.Name())
			name := entry.Name()
			if prefix != "" {
				name = prefix + "/" + entry.Name()
			}
			if body, err := os.ReadFile(filepath.Join(full, "PERSONA.md")); err == nil {
				described := markdown.Field(string(body), "description")
				if described == "" {
					described = noDescription
				}
				found = append(found, Persona{Name: name, Description: described})
			}
			// Unlike a skill, a persona may hold more personas inside it whether or not it is one.
			walk(full, name)
		}
	}
	walk(filepath.Join(checkout, constants.PersonasDir), "")
	collate.SortBy(found, func(one Persona) string { return one.Name })
	return found
}

// Read is the body a task's Claude step wears as its added system prompt: the PERSONA.md with any
// frontmatter stripped, and false where the project has no persona by that name.
//
// The name comes from a hand-editable `.task` file, so anything that is not a plain folder name
// answers false rather than reaching outside `.personas/`.
func Read(checkout, name string) (string, bool) {
	if !plainName(name) {
		return "", false
	}
	file := filepath.Join(append([]string{checkout, constants.PersonasDir},
		append(strings.Split(name, "/"), "PERSONA.md")...)...)

	base, err := filepath.Abs(filepath.Join(checkout, constants.PersonasDir))
	if err != nil {
		return "", false
	}
	resolved, err := filepath.Abs(file)
	if err != nil || !strings.HasPrefix(resolved, base+string(filepath.Separator)) {
		return "", false
	}
	body, err := os.ReadFile(file)
	if err != nil {
		return "", false
	}
	return markdown.Strip(string(body)), true
}

func plainName(name string) bool {
	if name == "" || strings.HasPrefix(name, ".") || strings.ContainsAny(name, `\`) {
		return false
	}
	if strings.Contains(name, "..") || path.Clean(name) != name || strings.HasPrefix(name, "/") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || strings.HasPrefix(part, ".") {
			return false
		}
	}
	return true
}

const helloPersona = `---
name: hello
description: prove the personas folder works — pick it on a task's Claude node
---

You are the placeholder persona every project starts with, here to be copied and then
replaced. A persona is a folder under ` + "`.personas/`" + `: a PERSONA.md whose body becomes the
agent's added system prompt when a task's Claude node wears it. Say so, briefly, in
everything you write, so a run wearing this persona is unmistakable.
`

// Seed is the placeholder a new project is born with — its own documentation, in the format,
// saying so.
func Seed(checkout string) error {
	dir := filepath.Join(checkout, constants.PersonasDir, "hello")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "PERSONA.md"), []byte(helloPersona), 0o644)
}
