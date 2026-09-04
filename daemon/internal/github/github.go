// Package github is what this app knows about GitHub before it has talked to it: the shape of
// the handshake, the shape of a repository, and what an address for one looks like.
package github

import (
	"regexp"
	"strings"
)

// Device is the half of the device flow a browser has to answer: a short code, and where to
// type it.
type Device struct {
	// Code is held by the app and sent back while waiting. Never shown — it is not what you type.
	Code string `json:"deviceCode"`
	// UserCode is the eight characters you read off the screen and type into GitHub.
	UserCode        string `json:"userCode"`
	VerificationURI string `json:"verificationUri"`
	// Interval is how long GitHub asks to be left alone between asks, in milliseconds.
	Interval int `json:"intervalMs"`
}

// Repo is a repository you can push to, as the picker needs it.
type Repo struct {
	FullName      string `json:"fullName"`
	CloneURL      string `json:"cloneUrl"`
	Private       bool   `json:"private"`
	DefaultBranch string `json:"defaultBranch"`
}

// IsSlug reports whether something is the `owner/name` this API is addressed by. The editor
// takes one typed by hand, so the codec and the service ask the same question of it.
//
// Written out rather than compiled, because the pattern is `^[\w.-]+/[\w.-]+$` and `\w` in a
// JavaScript regular expression without the unicode flag is ASCII alone — Go's `\w` is the same
// today, but the one thing this has to keep agreeing with is a regex in a browser.
func IsSlug(value string) bool {
	owner, name, found := cut(value)
	return found && isSlugPart(owner) && isSlugPart(name)
}

func cut(value string) (owner, name string, found bool) {
	for index := range len(value) {
		if value[index] == '/' {
			return value[:index], value[index+1:], true
		}
	}
	return "", "", false
}

func isSlugPart(part string) bool {
	if part == "" {
		return false
	}
	for index := range len(part) {
		c := part[index]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '_', c == '.', c == '-':
		default:
			return false
		}
	}
	return true
}

// remotes are the two shapes of GitHub remote a checkout may carry, in the order they are tried:
// the SSH one, then everything with a host in it. Compiled from the same source as the
// TypeScript's, since what a checkout's own repository is called is answered by whichever daemon
// is running and a task that named no repository would otherwise mean two different things.
var remotes = []*regexp.Regexp{
	regexp.MustCompile(`^git@github\.com:([^/]+)/(.+)$`),
	regexp.MustCompile(`^(?:https?://|ssh://git@)(?:[^@]+@)?github\.com/([^/]+)/([^/]+)$`),
}

// RemoteSlug is the `owner/name` a remote url points at, or empty where it points somewhere that
// is not GitHub — which is not a fault: a checkout with a GitLab remote is a checkout a GitHub
// step has to be told the repository of.
func RemoteSlug(url string) string {
	cleaned := strings.TrimSuffix(strings.TrimSpace(url), ".git")
	for _, pattern := range remotes {
		match := pattern.FindStringSubmatch(cleaned)
		if match == nil || match[1] == "" || match[2] == "" {
			continue
		}
		return match[1] + "/" + match[2]
	}
	return ""
}
