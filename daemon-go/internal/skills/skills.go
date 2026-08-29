// Package skills is what a checkout's `.tools/.skills/` folder carries: a folder per skill, its
// scripts beside a SKILL.md, and the one line that says when to reach for it.
package skills

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/broodmotherai/broodmother/daemon-go/internal/collate"
	"github.com/broodmotherai/broodmother/daemon-go/internal/constants"
	"github.com/broodmotherai/broodmother/daemon-go/internal/markdown"
)

type Skill struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// noDescription: a skill that exists is worth naming even when nobody has said what for.
const noDescription = "no description — read its SKILL.md"

func Scan(checkout string) []Skill {
	found := []Skill{}
	var walk func(dir, prefix string)
	walk = func(dir, prefix string) {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			full := filepath.Join(dir, entry.Name())
			// The folder is the name, the same rule projects and branches follow — the frontmatter
			// may carry one, but the folder is the authority `mv` updates.
			name := entry.Name()
			if prefix != "" {
				name = prefix + "/" + entry.Name()
			}
			body, err := os.ReadFile(filepath.Join(full, "SKILL.md"))
			// A skill's own folders are its scripts and its references, not more skills.
			if err == nil {
				described := markdown.Field(string(body), "description")
				if described == "" {
					described = noDescription
				}
				found = append(found, Skill{Name: name, Description: described})
				continue
			}
			walk(full, name)
		}
	}
	walk(filepath.Join(checkout, constants.SkillsDir), "")
	collate.SortBy(found, func(one Skill) string { return one.Name })
	return found
}

const helloSkill = `---
name: hello
description: prove the skills folder works — run it and read what it prints
---

# hello

The placeholder every project starts with, here to be copied and then deleted. A skill is a
folder under ` + "`.tools/.skills/`" + `: a SKILL.md whose ` + "`description:`" + ` line says when to reach
for it, and the scripts beside it that do the work.

Run it from this folder:

    python3 hello.py

Keep secrets out of skills. A script that needs a credential or an endpoint names the
environment variable it expects here, and the shell provides it.
`

const helloScript = "print('hello from the skills folder — replace me with a workflow you actually run')\n"

// Seed is the placeholder a new project is born with — its own documentation, in the format,
// saying so.
func Seed(checkout string) error {
	dir := filepath.Join(checkout, constants.SkillsDir, "hello")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(helloSkill), 0o644); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "hello.py"), []byte(helloScript), 0o644)
}
