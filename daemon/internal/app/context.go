// Package app is what one running daemon holds: the home it was started in, the config it is
// running on, who it is working as, and — as the port reaches them — the services every route
// asks its questions of.
package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/broodmotherai/broodmother/daemon/internal/activity"
	"github.com/broodmotherai/broodmother/daemon/internal/brief"
	"github.com/broodmotherai/broodmother/daemon/internal/chat"
	"github.com/broodmotherai/broodmother/daemon/internal/chats"
	"github.com/broodmotherai/broodmother/daemon/internal/config"
	"github.com/broodmotherai/broodmother/daemon/internal/doc"
	"github.com/broodmotherai/broodmother/daemon/internal/entities"
	"github.com/broodmotherai/broodmother/daemon/internal/git"
	"github.com/broodmotherai/broodmother/daemon/internal/github"
	"github.com/broodmotherai/broodmother/daemon/internal/ledger"
	"github.com/broodmotherai/broodmother/daemon/internal/links"
	"github.com/broodmotherai/broodmother/daemon/internal/llm"
	"github.com/broodmotherai/broodmother/daemon/internal/migrate"
	"github.com/broodmotherai/broodmother/daemon/internal/mother"
	"github.com/broodmotherai/broodmother/daemon/internal/personas"
	"github.com/broodmotherai/broodmother/daemon/internal/profile"
	"github.com/broodmotherai/broodmother/daemon/internal/project"
	"github.com/broodmotherai/broodmother/daemon/internal/relay"
	"github.com/broodmotherai/broodmother/daemon/internal/syncloop"
	"github.com/broodmotherai/broodmother/daemon/internal/taskrun"
	"github.com/broodmotherai/broodmother/daemon/internal/tasks"
	"github.com/broodmotherai/broodmother/daemon/internal/terminal"
	"github.com/broodmotherai/broodmother/daemon/internal/tree"
)

// Home is where broodmother keeps everything. It lives with the profiles, which is what is kept
// in it.
func Home() string { return profile.Home() }

type Options struct {
	// Home overrides where everything is kept. Empty is [Home].
	Home string
	// Root opens a project by path whatever the config says, which is how a second checkout is
	// started on a project of its own.
	Root string
	// ClaudeDir is whose sessions to read for what is at work. Empty is Claude's own, which is
	// every case but a test's.
	ClaudeDir string
	// Cron is the system crontab unless a test hands in a tamer one. A schedule is mirrored into
	// it, so a test left to the real one would rewrite the machine's.
	Cron tasks.CrontabIO
}

// Context is the one thing every route is handed besides the request: the stores that outlive a
// project, the services that answer for one, and the checkout that is open right now. It is a
// fraction of what the TypeScript's is — most of the services are still being ported — and it
// grows from here.
type Context struct {
	Home  string
	Store *config.Store
	// Relay is every open socket. It outlives a project: a browser watching one project and then
	// another is the same browser.
	Relay *relay.Relay
	// Ledger holds every project's acts, so it lives in the home rather than in a project — the
	// question it answers is asked about work done yesterday, in a project you have since left.
	Ledger *ledger.Store
	// Entities is what the project has written down. It holds nothing of its own: a record is a
	// markdown document, so the tree is its store and the link index is its edges.
	Entities *entities.Store
	// Tasks is what the checkouts hold, what it has done, the walk that runs one, and the beat
	// that fires the triggers.
	Tasks *tasks.Store
	// Chats is every conversation this machine has held. Nil where the file will not open, which
	// is a page with no conversations rather than no page.
	Chats *chat.Store
	// Live is the replies being written into them right now.
	Live *chats.Chats
	// Mother is what she has noticed, said and been told, and Watching is her noticing it.
	Mother   *mother.Store
	Watching *mother.Watch
	// Activity is what is going on in each checkout, as the sessions themselves report it and as
	// the ptys show it.
	Activity *activity.Watch
	// Shells is every terminal this daemon has open. One per session, outliving the socket that
	// is watching it.
	Shells *terminal.Shells

	// Profiles is who the daemon is working as, and the credentials that identity carries.
	Profiles *Profiles
	// Workspace is what is on this machine to work in: the projects, the repos inside them, and
	// which of them is open.
	Workspace *Workspace
	// Branches is the checkouts a root can stand in, and the diff between two of them.
	Branches *Branches

	runs *taskrun.Store
	// url is where this daemon answers, known only once it is listening. The cron lines curl it,
	// so a schedule cannot be written down before it is.
	url string
	// github is the polling service every watch shares, and the token it was built for.
	github      *github.Service
	githubToken string

	mutex sync.RWMutex
	open  *Open
	sync  *syncloop.Loop
}

func New(options Options) (*Context, error) {
	home := options.Home
	if home == "" {
		home = Home()
	}
	if err := os.MkdirAll(home, 0o755); err != nil {
		return nil, err
	}

	// App state lives above the profiles rather than inside one, so the choice of project
	// survives switching between them — and a project is a git working tree, which is no place
	// for state the sync loop would offer to commit.
	store := config.NewStore(filepath.Join(home, "config.json"), config.Default(nil))
	loaded := store.Load()
	// Before anything else reads the home: a home written in the layout before profiles existed
	// is moved into this one, and the config is moved with the folders.
	migrated, err := migrate.Run(home, loaded)
	if err != nil {
		return nil, err
	}
	cron := options.Cron
	if cron == nil {
		cron = tasks.SystemCrontab()
	}
	ctx := &Context{Home: home, Store: store, Relay: relay.New()}
	ctx.wire()
	ctx.Entities = entities.NewStore(entities.Deps{
		Tree:  func() *tree.Tree { return ctx.projectTree() },
		Links: func() *links.Index { return ctx.projectLinks() },
		WriteDoc: func(path, markdown string, by ledger.Actor) (doc.Path, error) {
			return ctx.WriteDoc(doc.Project, path, markdown, by)
		},
	})
	// A ledger that will not open is a daemon with no provenance, which is what a document had
	// before any of this existed — worth saying, not worth refusing to start over. The runs are
	// the same bargain: a page with no log rather than no page.
	if held, err := ledger.Open(filepath.Join(home, "ledger.db")); err == nil {
		ctx.Ledger = held
	} else {
		fmt.Fprintln(os.Stderr, "broodmother: the ledger will not open —", err)
	}
	if held, err := taskrun.Open(filepath.Join(home, "tasks.db")); err == nil {
		ctx.runs = held
	} else {
		fmt.Fprintln(os.Stderr, "broodmother: the task runs will not open —", err)
	}
	if held, err := chat.Open(filepath.Join(home, "chats.db")); err == nil {
		ctx.Chats = held
	} else {
		fmt.Fprintln(os.Stderr, "broodmother: the chats will not open —", err)
	}
	if held, err := mother.Open(filepath.Join(home, "mother.db")); err == nil {
		ctx.Mother = held
	} else {
		fmt.Fprintln(os.Stderr, "broodmother: Mother will not open —", err)
	}
	// The root the shell was opened from, then the project, then the home — which is only where
	// you stand on first run, when there is nothing to stand in yet.
	ctx.Shells = terminal.NewShells(ctx.session)
	ctx.Activity = activity.Open(func(states map[string]activity.State) {
		ctx.Broadcast(relay.Activity(states))
	}, activity.Options{ConfigDir: options.ClaudeDir, Foreground: ctx.foreground})
	// A conversation belongs to the project it was held in, and speaks with the key the profile
	// holds for whichever provider serves the model it was asked for.
	if ctx.Chats != nil {
		ctx.Live = chats.New(chats.Deps{
			Store:   ctx.Chats,
			Project: func() string { return ctx.Workspace.Checkout() },
			Stream:  llm.New(ctx.Profiles.ModelKey, nil),
			Turn:    ctx.turn,
			OnLive: func(id string, working bool) {
				if agent, mine := ctx.Chats.AgentOfChat(id); mine {
					ctx.Broadcast(relay.AgentWorking(agent.ID, working))
				}
			},
		})
	}
	ctx.Tasks = tasks.NewStore(tasks.Deps{
		Sites: ctx.Sites,
		Runs:  ctx.runs,
		// The laptop's clock rather than this process's: the server may well be asleep when a
		// schedule comes due, and cron will not be. The line it writes curls the run route back
		// in, which is why the scheduler wants the URL rather than the store.
		Scheduler: tasks.CrontabScheduler(tasks.NewCrontab(cron), ctx.serverURL),
		Triggers:  tasks.NewTriggerStore(filepath.Join(home, "triggers.json")),
		Scratch:   func() string { return taskrun.ScratchBase(home) },
		Project:   ctx.projectTree,
		Env:       ctx.agentEnv,
		Persona:   ctx.persona,
		Brief:     func() string { return ctx.Brief(brief.Terminal) },
		Notify:    func(title, body string) { ctx.Broadcast(relay.Notify(title, body)) },
		Moved:     func() { ctx.Broadcast(relay.TaskMoved()) },
	})
	// A run the last server died in the middle of is ended here, before anything asks about it.
	ctx.Tasks.Recover()

	settled, err := resolve(options.Root, migrated, home)
	if err != nil {
		return nil, err
	}
	// A project sits inside the profile it commits as, so the open one settles who you are.
	next := migrated.Clone()
	next.ProjectPath = settled
	if settled != nil {
		named := filepath.Base(filepath.Dir(*settled))
		next.Profile = &named
	}
	// Persist the resolution and whatever the migration moved, or the open project and the
	// reported config disagree.
	if changed(next, loaded.Config) {
		if _, err := store.Save(next); err != nil {
			return nil, err
		}
	}
	if err := ctx.Profiles.Load(); err != nil {
		return nil, err
	}
	// The loop stands up before the project opens, so opening it refreshes a loop that is there
	// to be refreshed — a daemon whose first answer about syncing was silence would say nothing
	// about a project that does not sync until something else moved.
	ctx.startSync()
	ctx.UseProject()
	return ctx, nil
}

// wire stands the services up over each other. What one asks of another is a closure rather than
// a field because they are mutually dependent and every one of them is younger than something it
// needs: a profile is settled from the open project, and which project is open is a question for
// whoever is working.
func (c *Context) wire() {
	c.Profiles = newProfiles(ProfileDeps{
		Home:    c.Home,
		Store:   c.Store,
		Project: func() *project.Summary { return c.Workspace.Project() },
		Reopen:  c.UseProject,
	})
	c.Workspace = newWorkspace(WorkspaceDeps{
		Store:       c.Store,
		Profile:     c.Profiles.Require,
		ProfileHome: c.Profiles.ProjectHome,
		SSHKey:      c.Profiles.SSHKey,
		LoadProfile: c.Profiles.Load,
		Reopen:      c.UseProject,
	})
	c.Branches = newBranches(BranchDeps{
		Store:          c.Store,
		Project:        c.Workspace.Project,
		RequireProject: c.Workspace.RequireProject,
		RepoCheckout:   c.Workspace.RepoCheckout,
		Checkout:       c.Workspace.Checkout,
		SSHKey:         c.Profiles.SSHKey,
		Reopen:         c.UseProject,
	})
}

// resolve is which project is actually open. A path asked for on the command line wins, then the
// one the config names if its folder is still there, then the first project of whichever profile
// the config names — and a machine with none of those is a first run.
func resolve(root string, held config.Config, home string) (*string, error) {
	if root == "" {
		root = os.Getenv("BROODMOTHER_PROJECT")
	}
	if root != "" {
		full, err := filepath.Abs(root)
		if err != nil {
			return nil, err
		}
		return &full, nil
	}
	if held.ProjectPath != nil {
		if _, err := os.Stat(*held.ProjectPath); err == nil {
			return held.ProjectPath, nil
		}
	}
	named := ""
	if held.Profile != nil {
		named = *held.Profile
	} else {
		all, err := profile.List(home)
		if err != nil {
			return nil, err
		}
		if len(all) == 0 {
			return nil, nil
		}
		named = all[0].Name
	}
	projects, err := project.List(filepath.Join(home, named))
	if err != nil {
		return nil, err
	}
	if len(projects) == 0 {
		return nil, nil
	}
	return &projects[0].Path, nil
}

// changed is the whole config against the whole config, the way the TypeScript compares them:
// two JSON spellings of the same value. Cheaper comparisons exist and this one is written once
// per start.
func changed(next, held config.Config) bool {
	a, _ := json.Marshal(next)
	b, _ := json.Marshal(held)
	return string(a) != string(b)
}

func (c *Context) Config() config.Config { return c.Store.Config() }

// UseProject opens the checkout the config now names, and drops whatever was open before.
func (c *Context) UseProject() {
	checkout := c.Workspace.Checkout()
	var open *Open
	if checkout != "" {
		open = openProject(checkout)
	}
	c.mutex.Lock()
	before := c.open
	c.open = open
	c.mutex.Unlock()
	before.close()
	if open != nil {
		open.watch(c, doc.Project)
	}
	// The project underneath changed, so what the status line says about syncing has to. A clone
	// and a plain folder do not report the same thing.
	if c.sync != nil {
		c.sync.Refresh()
	}
}

// Broadcast tells every open socket. Nothing above this has to know whether anybody is listening.
func (c *Context) Broadcast(message relay.Message) { c.Relay.Broadcast(message) }

// Start is what a listening server tells its context: where it answers, and that the clocks may
// run. Kept out of [New] because a schedule is written as a line that curls this daemon, and
// until it is listening there is no address to write.
func (c *Context) Start(url string) {
	c.mutex.Lock()
	c.url = url
	c.mutex.Unlock()
	c.Tasks.Start()
	c.startMother()
}

// reach is every service a step or a watch can ask for, as the checkout it runs in can reach it.
// GitHub is the one that answers today; a second is another field on [tasks.Reaches] and a folder
// of its own.
//
// The service is kept between looks rather than built per beat: the hour's budget belongs to the
// token, so every watch has to share one of these or each discovers a spent budget alone. A token
// that changed is a different connection and gets a service of its own.
func (c *Context) reach(cwd string) tasks.Reaches {
	token := c.Profiles.HostToken()
	if token == "" {
		return tasks.Reaches{}
	}
	c.mutex.Lock()
	if c.github == nil || c.githubToken != token {
		c.github, c.githubToken = github.NewService(token, github.ServiceOptions{}), token
	}
	service := c.github
	c.mutex.Unlock()

	held := &tasks.GithubReach{Service: service}
	if cwd != "" {
		repo := git.New(cwd, "", "")
		held.Slug = github.RemoteSlug(repo.RemoteURL())
		held.Branch = repo.Branch()
	}
	return tasks.Reaches{Github: held}
}

func (c *Context) serverURL() string {
	c.mutex.RLock()
	defer c.mutex.RUnlock()
	return c.url
}

// agentEnv is what a step's process is given beyond the ambient environment: the key an agent
// signs in with, where this machine has one.
func (c *Context) agentEnv() map[string]string {
	env := map[string]string{}
	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		env["ANTHROPIC_API_KEY"] = key
	}
	return env
}

// persona is what a named persona says, out of the open project's checkout.
func (c *Context) persona(name string) string {
	open, err := c.Root(doc.Project)
	if err != nil {
		return ""
	}
	body, _ := personas.Read(open.Path, name)
	return body
}

// Close stops what runs on its own. A daemon shutting down that left the loop running would
// commit into a project nobody has open.
func (c *Context) Close() {
	if c.sync != nil {
		c.sync.Stop()
	}
	c.mutex.Lock()
	open := c.open
	c.open = nil
	c.mutex.Unlock()
	open.close()
	c.Relay.Close()
	if c.Ledger != nil {
		c.Ledger.Close()
	}
	// The beats stop before the stores they write into close, and the runs still walking stop with
	// them: a step writing into a closed database would lose the ending rather than record it.
	if c.Tasks != nil {
		c.Tasks.Stop()
	}
	if c.Watching != nil {
		c.Watching.Stop()
	}
	if c.runs != nil {
		c.runs.Close()
	}
	if c.Shells != nil {
		c.Shells.Close()
	}
	if c.Live != nil {
		c.Live.Close()
	}
	if c.Chats != nil {
		c.Chats.Close()
	}
	if c.Mother != nil {
		c.Mother.Close()
	}
	if c.Activity != nil {
		c.Activity.Close()
	}
}
