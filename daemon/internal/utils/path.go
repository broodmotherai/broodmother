// Package utils turns what a browser sent into an address this tree will answer to, and is
// where a tree's boundary lives and a write is made whole or not made.
package utils

import (
	"strings"

	"github.com/broodmotherai/broodmother/daemon/internal/apperr"
	"github.com/broodmotherai/broodmother/daemon/internal/constants"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
)

func Base(path string) string {
	if slash := strings.LastIndex(path, "/"); slash >= 0 {
		return path[slash+1:]
	}
	return path
}

// Extension is lowercase and without the dot, so `a/b.PNG` is `png`. Empty for a dotfile or a
// name with no extension at all.
func Extension(path string) string {
	name := strings.ToLower(Base(path))
	if dot := strings.LastIndex(name, "."); dot > 0 {
		return name[dot+1:]
	}
	return ""
}

// Tilde is a path as it is shown rather than as it is used. Everyone writes their home as `~`,
// every tool prints it that way, and the twenty characters in front of it say only that the
// machine has more than one user.
func Tilde(path string) string {
	for _, prefix := range []string{"/Users/", "/home/"} {
		rest, found := strings.CutPrefix(path, prefix)
		if !found {
			continue
		}
		if slash := strings.Index(rest, "/"); slash >= 0 {
			return "~/" + rest[slash+1:]
		}
	}
	return path
}

func hasDriveLetter(input string) bool {
	if len(input) < 2 || input[1] != ':' {
		return false
	}
	c := input[0]
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func Normalize(input string) (doc.Path, error) {
	if input == "" {
		return "", apperr.Pathf("empty path")
	}
	if strings.ContainsRune(input, 0) {
		return "", apperr.Pathf("path contains a null byte")
	}
	if strings.Contains(input, `\`) {
		return "", apperr.Pathf("path contains a backslash")
	}
	if strings.HasPrefix(input, "/") || hasDriveLetter(input) {
		return "", apperr.Pathf("path must be relative to the tree root")
	}
	for segment := range strings.SplitSeq(input, "/") {
		if segment == "" || segment == "." || segment == ".." || constants.IsReserved(segment) {
			return "", apperr.Pathf("path segment not allowed: %q", segment)
		}
	}
	return input, nil
}

// NameProblem is the complaint to put after the noun, or empty if the name is fine. A project is
// a folder, a repo is a name for one, a profile is a file — every name typed into broodmother
// becomes one of those.
func NameProblem(name string) string {
	if name != strings.TrimSpace(name) || name == "" {
		return "must not be blank or padded with spaces"
	}
	if strings.HasPrefix(name, ".") {
		return "must not start with a dot — it would be hidden"
	}
	if strings.ContainsAny(name, `/\`) || strings.ContainsRune(name, 0) {
		return "must be a plain folder name, not a path"
	}
	return ""
}
