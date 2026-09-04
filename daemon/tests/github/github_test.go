package github_test

import (
	. "github.com/broodmotherai/broodmother/daemon/internal/github"

	"testing"
)

func TestOnlyAnOwnerNameIsASlug(t *testing.T) {
	for _, one := range []struct {
		in   string
		want bool
	}{
		{"broodmotherai/broodmother", true},
		{"some-org/a.repo_name", true},
		{"a/b", true},
		{"broodmother", false},
		{"a/b/c", false},
		{"/b", false},
		{"a/", false},
		{"", false},
		{"a b/c", false},
		{"a/c d", false},
		// The pattern is ASCII in the browser, which is the implementation this has to agree with.
		{"ünïcode/repo", false},
	} {
		if got := IsSlug(one.in); got != one.want {
			t.Errorf("IsSlug(%q) = %v, want %v", one.in, got, one.want)
		}
	}
}
