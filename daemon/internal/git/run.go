// Running git. Every command goes through one place, so the guard against a destructive one is
// the promise rather than the convention, and so a credential is never an argument.

package git

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/broodmotherai/broodmother/daemon/internal/utils"
)

// The default a command is given before it is called slow rather than stuck.
const Timeout = 60 * time.Second

// destructive is anything that can throw away work.
var destructive = map[string]bool{
	"reset": true, "clean": true, "checkout": true, "restore": true, "rm": true,
	"stash": true, "gc": true, "prune": true, "filter-branch": true,
}

// AssertNonDestructive refuses a command that could throw away work, and a forced one whatever
// it is. The subcommand is the first argument that is not a flag and is not the value of a `-c`,
// which is where `git -c user.name=… commit` puts it.
func AssertNonDestructive(args []string) error {
	command := ""
	for index, one := range args {
		if !strings.HasPrefix(one, "-") && (index == 0 || args[index-1] != "-c") {
			command = one
			break
		}
	}
	if destructive[command] {
		return errors.New("refusing to run destructive git " + command)
	}
	for _, one := range args {
		if one == "--force" || one == "-f" || one == "--force-with-lease" {
			return errors.New("refusing to run a forced git command")
		}
	}
	return nil
}

// SSHCommand adds the profile's key to whatever ssh would have offered, rather than substituting
// for it. This used to pass IdentitiesOnly, which turns off the agent and every other key — so a
// profile that named a key stopped being able to reach anything that key did not open, and
// naming one made authentication worse than leaving it blank. Most people already have a working
// agent, and the right thing to do with it is nothing.
//
// BatchMode stays either way: there is no terminal here to answer a passphrase prompt, so a key
// that needs one has to fail rather than hang.
func SSHCommand(keyPath string) string {
	batch := "ssh -oBatchMode=yes"
	if keyPath == "" {
		return batch
	}
	return batch + ` -i "` + utils.ExpandHome(keyPath) + `"`
}

// tokenHelper is how an https remote is answered where the profile has connected to a host that
// hands out tokens. It is read out of the environment by the shell git runs it in, so the token
// is never an argument: `ps` is readable by anyone on the machine, and a command line is the one
// place a secret cannot be taken back from.
const tokenHelper = `!f() { test "$1" = get && printf "username=x-access-token\npassword=%s\n" "$BROODMOTHER_GIT_TOKEN"; }; f`

type Git struct {
	Root string
	// SSHKeyPath is the profile's key, where it has one.
	SSHKeyPath string
	// Token is a host token to push with, for the person who has no key and wants none.
	Token string
}

func New(root, sshKeyPath, token string) *Git {
	return &Git{Root: root, SSHKeyPath: sshKeyPath, Token: token}
}

// Output is what one command said and how it ended.
type Output struct {
	Code   int
	Stdout string
	Stderr string
}

func (o Output) failed() bool { return o.Code != 0 }

// both is stdout and stderr together, which is where a reason may be on either.
func (o Output) both() string { return o.Stdout + "\n" + o.Stderr }

// reason is what to say when a command failed: what git said, or what it printed instead.
func (o Output) reason() string {
	if strings.TrimSpace(o.Stderr) != "" {
		return o.Stderr
	}
	return o.Stdout
}

func (g *Git) Run(args ...string) (Output, error) { return g.RunFor(Timeout, args...) }

func (g *Git) RunFor(timeout time.Duration, args ...string) (Output, error) {
	if err := AssertNonDestructive(args); err != nil {
		return Output{}, err
	}
	// Ahead of the arguments, because that is where `git -c` has to be, and ahead of any helper
	// the machine already has, because ours is the one that knows this profile.
	full := args
	if g.Token != "" {
		full = append([]string{"-c", "credential.helper=" + tokenHelper}, args...)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	command := exec.CommandContext(ctx, "git", full...)
	command.Dir = g.Root
	command.Env = append(command.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_ASKPASS=true",
		"GIT_SSH_COMMAND="+SSHCommand(g.SSHKeyPath))
	if g.Token != "" {
		command.Env = append(command.Env, "BROODMOTHER_GIT_TOKEN="+g.Token)
	}

	// Never trimmed: a file read out of a branch is its bytes, and a diff whose two sides differ
	// only in the last newline is a difference that eating it would report as unchanged.
	var out, errs bytes.Buffer
	command.Stdout = &out
	command.Stderr = &errs
	err := command.Run()

	held := Output{Stdout: out.String(), Stderr: errs.String()}
	var exited *exec.ExitError
	switch {
	case err == nil:
		held.Code = 0
	case errors.As(err, &exited):
		held.Code = exited.ExitCode()
	default:
		// git that never started — a missing working directory, no `git` on PATH — and git that
		// was killed for taking too long. Every caller here reads stderr for the reason and falls
		// back to a guess when it is empty, so an empty one is how a failure before the network
		// became "the remote is unreachable". This is where what went wrong gets put so the
		// caller can find it.
		held.Code = -1
	}
	if held.failed() && strings.TrimSpace(held.Stderr) == "" {
		held.Stderr = said(err, ctx)
	}
	return held, nil
}

func said(err error, ctx context.Context) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "git timed out"
	}
	if err != nil {
		return err.Error()
	}
	return "git failed"
}

// IsSSH reports `git@host:path` or `ssh://…`, which is a key question rather than a password one.
var sshRemote = regexp.MustCompile(`^[\w.-]+@[\w.-]+:`)

func IsSSH(url string) bool {
	return strings.HasPrefix(url, "ssh://") || sshRemote.MatchString(url)
}

// IsLocalPath reports a folder or a `file://`, which nothing authenticates.
func IsLocalPath(url string) bool {
	return strings.HasPrefix(url, "/") || strings.HasPrefix(url, "file://")
}

// AuthAdvice is the one failure with something to do about it, so it says what — and the three
// kinds of remote are fixed three different ways, so one sentence would be wrong for two of them.
func AuthAdvice(remoteURL string) string {
	if IsLocalPath(remoteURL) {
		return remoteURL + " is a path on this machine, so there are no credentials involved. Check the folder is still there and is a repository."
	}
	if IsSSH(remoteURL) {
		return "The remote refused your key. broodmother uses whatever ssh already has: your agent, the keys in ~/.ssh, and the profile’s key if it has one. Generate a key below and add it to your host."
	}
	return "The remote refused. broodmother uses whatever git credential helper this machine has, so pushing once from a terminal is what fills it."
}
