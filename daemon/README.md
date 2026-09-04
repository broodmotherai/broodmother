# daemon

The daemon, in Go. It began as a port, written as `daemon-go/` while the TypeScript daemon it
replaces kept running under this same name, and the two were walked through the same requests
until they answered alike: same status, same values, same words in a refusal. The TypeScript is
gone now, and this folder took its name. What it left behind is the browser's half of the
grammar in `shared/`, the answers in `../conformance/`, and the paths in the table below, which
say where each package came from in the TypeScript tree.

## What is here

| Package | Ported from |
| ------- | ----------- |
| `internal/constants` | `daemon/src/constants/` |
| `internal/apperr` | `daemon/src/types/error.ts` — fourteen classes as one kind |
| `internal/doc` | `daemon/src/types/doc.ts` |
| `internal/grid` | `daemon/src/types/grid.ts` |
| `internal/jstext` | nothing — see below |
| `internal/jsjson` | nothing — see below |
| `internal/canvas` | `daemon/src/types/canvas/` — the geometry stayed with the browser |
| `internal/task` | `daemon/src/types/task/` — schema, codec and graph |
| `internal/entity` | `daemon/src/types/entity/` — schema, codec and digest |
| `internal/entities` | `daemon/src/features/entities/` — the scan, the digest rule and the walk |
| `internal/diagrams` | `daemon/src/utils/diagrams.ts` |
| `internal/chat` | `daemon/src/features/chat/db.ts`, `types/api/{chat,agents}.ts` — the record: the conversations, what was said, and who the agents are |
| `internal/chats` | `daemon/src/features/chat/{Chats,socket}.ts` — the replies being written right now |
| `internal/llm` | `daemon/src/features/chat/model.ts` — what answers, and the one place that knows a provider exists |
| `internal/tools` | `daemon/src/features/chat/tools.ts`, `features/agents/tools.ts` — what a conversation can do |
| `internal/apicall` | the same two — the app's own routes as one tool, default deny |
| `internal/brief` | `daemon/src/features/brief/` — what an agent is told about where it is standing |
| `internal/errand` | `daemon/src/features/ledger/errand.ts` — what an errand left different |
| `internal/taskrun` | `daemon/src/features/tasks/db.ts` — the runs, and the firings a watch owes |
| `internal/tasks` | `daemon/src/features/tasks/{Tasks,scratch}.ts`, `blocks/` — the walk and all ten of its blocks, the schedule and the watches |
| `internal/notebook` | `daemon/src/utils/notebook/` — the codec and the path |
| `internal/github` | `daemon/src/{types,utils}/github.ts`, `services/GitHubService.ts` — the shapes, the device flow, the repos, and the service the tasks read |
| `internal/markdown` | `daemon/src/utils/markdown/` — the frontmatter and the links |
| `internal/media`, `internal/browser` | `daemon/src/utils/{media,browser}.ts` — what a file is, by its name |
| `internal/tree` | `daemon/src/services/Tree.ts` — the watcher is `internal/watch`'s |
| `internal/branch` | `daemon/src/{utils/branch,types/branch}.ts` |
| `internal/repo` | `daemon/src/{utils,types}/repo.ts` |
| `internal/skills`, `internal/personas` | `daemon/src/utils/{skills,personas}.ts` |
| `internal/syncloop` | `daemon/src/services/SyncLoop.ts` |
| `internal/watch` | `daemon/src/services/{Tree,Git}Service.ts` |
| `internal/relay` | `daemon/src/services/Relay.ts` |
| `internal/ledger` | `daemon/src/types/ledger.ts`, `features/ledger/` — the store, the claims, the trailers and the phrasing |
| `internal/links` | `daemon/src/services/LinkIndex.ts` |
| `internal/utils` | `daemon/src/utils/{path,fs}.ts` |
| `internal/collate` | nothing — see below |
| `internal/terminal` | `daemon/src/types/terminal.ts`, `services/Terminals.ts` — the grammar and the shells |
| `internal/git` | `daemon/src/types/git.ts`, `utils/git.ts` — the runner and every parser |
| `internal/profile` | `daemon/src/utils/profiles.ts` |
| `internal/project` | `daemon/src/utils/project.ts` |
| `internal/config` | `daemon/src/utils/config.ts` — the store, the repair and the remote helpers |
| `internal/mother` | `daemon/src/features/mother/` — what she has noticed, said and been told, and the deliberating that decides what is worth saying |
| `internal/activity` | `daemon/src/services/ActivityService.ts` — what each session says it is doing, and what the ptys say underneath |
| `internal/migrate` | `daemon/src/utils/migrate.ts` — held to the TypeScript home for home |
| `internal/app` | `daemon/src/context.ts`, `services/{Profile,Workspace,Branch}Service.ts` — the home, the config, who is working, which project is open |
| `internal/api` | `daemon/src/{app,server}.ts`, `routes/` — the server, CORS, the error ladder, seventy-eight routes and the sockets |

`canvas/geometry.ts` stayed with the browser on purpose — it lives in `shared/` now. It is where
a diagram's lines go — which side of a node one leaves from, the curve between two ports, the SVG
path a cloud is drawn as — and the only thing that imports it is the browser. A daemon that draws
no pictures has no use for it, and a port of it here would be four hundred lines nothing calls.
The colours beside it are the same question: `PaintOf` and `BorderOf` are all that is left of
them here, and only a test reaches those — when somebody next looks, they belong with the
geometry.

## What it serves

All seventy-eight routes. The config and the workspace: `GET`/`PUT /api/config`,
`GET /api/projects`, `POST /api/projects/open`, `PUT /api/projects`. Git:
`GET`/`PUT /api/git`, `POST /api/git/check`. And the documents: `GET /api/tree`,
`GET`/`PUT`/`DELETE /api/doc`, `POST /api/doc/move`, `POST /api/folder`, `GET /api/links`,
`GET /api/file` and `GET /api/file/{root}/{path...}`. The repos and their branches:
`GET /api/repos`, `POST /api/scope`, `GET`/`POST`/`DELETE /api/branches`, and
`POST /api/branches/open`. Making and removing both: `POST`/`DELETE /api/projects` and
`POST`/`DELETE /api/repos`. And syncing: `GET /api/sync`, `POST /api/sync/now`,
`POST /api/sync/clear-conflict`. And who did what: `GET /api/ledger`. The profiles, whole but for
the connecting: `GET`/`POST`/`PUT /api/profiles`, `GET`/`POST /api/profiles/key`,
`PUT`/`DELETE /api/model-keys` and `GET /api/integrations`. Two branches compared whole:
`GET /api/diff` and `GET /api/diff/file`. And what the open checkout carries for the agents it
opens: `GET /api/skills` and `GET /api/personas`. And the records: `GET`/`POST /api/entities`,
`GET /api/entities/catalogue` and `POST /api/entity/link`. And GitHub: `POST /api/github/device`,
`POST /api/github/connect`, `DELETE /api/github`, `GET`/`POST /api/github/repos`. And what the
checkouts hold that something runs or draws: `GET /api/tasks`, `GET /api/task/runs`,
`GET /api/task/log` and `GET /api/diagrams` — and what makes one happen:
`POST /api/task/run`, `POST /api/task/stop` and `POST /api/task/approve`. And the conversations:
`GET`/`POST /api/chats`, `GET`/`DELETE /api/chat` — and the agents under them:
`GET`/`POST /api/agents`, `GET /api/agents/org`, `DELETE /api/agent`, and
`POST /api/agent/{clear,model,lead,place}`. And Mother: `GET /api/mother`,
`POST /api/mother/{sweep,verdict}` and `PUT /api/mother/settings`. And the last three:
`GET /api/activity`; `DELETE /api/terminal`, which is a tab saying it is finished with its shell
— said over a route of its own because no socket closing means it any more; and
`DELETE /api/data`, which takes every folder in the home away. Everything else under `/api/`
answers 404 with a reason rather than hanging up, so a browser pointed here is told what is
missing.

The sockets are four. `/ws` is the daemon reporting — the tree, the repository and the sync loop,
to every open client at once, and nothing sent the other way. `/terminal` is a shell: a pty this
daemon opened, named by the tab watching it, which outlives the socket the way a shell should
outlive a shut lid. `/chat` is a reply arriving a word at a time. `/kernel` is the notebook
plan's phase 2 on this side as it was on the other: it answers by hanging up, and no client
dials it.

They were held to the TypeScript by running both against a home of their own and walking them
through the same requests: same status, same values, same words in a refusal. Two things differ
and both are said again in the list at the foot of this file — the wording of a request refused
for its shape, and the order of the keys in a profile handed back from a write.

Writing the config or opening a project records the choice, settles who is working, opens the
checkout, moves the watchers onto it and tells the sync loop to look again.

It writes a profile. Making one, saving who you commit as, making the ssh key you push with,
holding the key you speak to a model provider with — each lands in the profile's own file at
0600, and the ones that change what git offers reopen the project behind them, since the key a
checkout's git carries is fixed when it opens. The file is written as the file it was read from
plus what changed, so a key nothing here has heard of survives a save that touched the colour.

It connects to GitHub. The device flow, because a program on somebody's laptop cannot keep a
secret: one request opens a short code, and a second is asked again while the browser is being
answered — holding one open for as long as somebody takes to find their password is a request
nobody can tell from a hang. The token lands in the profile file at 0600 beside the ssh key, and
is read off it per command rather than held, which is also how a connection made outside this
process is picked up without a restart. What the browser is ever told is the login.

Neither daemon's talking to GitHub was compared during the port — that is somebody's account, not
a fixture. What was compared is everything around it: a build with no client id refusing to draw
a button that cannot work, a profile that is not connected being told so by name, and a
disconnect. The last is the one worth the trouble, and the two wrote the same bytes: the token
gone, the key it used to be kept under gone with it so the fallback that reads it cannot undo the
disconnect, and every other line of the file where it was.

The service the tasks read is `github/service.go`: the issues, pulls, mentions and checks a
trigger watches, asked the same question every few minutes for as long as the app is open, which
is a different job from the device flow's one question and lives in a file of its own.

It writes records. A record is an ordinary markdown document — the editor opens it, git carries
it, the link index is its edges — so there is no store behind these routes and no second copy of
anything. What they add is the one thing a document cannot do for itself: refuse to be written
without provenance, and answer "have I written this before" without forking the graph. The second
is the digest, recomputed from what is on disk rather than read off the `sha:` line, because
somebody may have edited the prose since and answering with a path to a document that no longer
says that would be the stalest possible answer, given confidently.

Two implementations reaching the same digest is what makes that idempotence portable, and it is
checked rather than assumed: the two daemons walked through the same twenty-five requests wrote
documents whose `sha:` lines are the same string.

It runs tasks. A run is handed back the moment it starts and its steps fill in as the graph walks;
a layer of the graph runs four at a time, since its members cannot feed each other. The file is the
only channel between steps — what one writes is what the next is handed — and the run's folder
keeps every one of those files afterwards as its record. A step may end its own branch, pick which
paths onward to follow, halt the flow deliberately, or stop and wait for a person; a run that stops
at a question keeps its place, and answering it sends the walk back in from there.

The store is the same SQLite file in the same home that the TypeScript wrote, so a run it walked
is a run this daemon lists — and a run the last server died in the middle of is ended by the next
one to start. That cannot be picked up where it was left: the step that was running may have
half-done something the world can see, and doing it again would comment twice. A paused run is a
different thing, written deliberately at a step boundary, and it is left exactly where it stands.

All ten kinds of step run here: the shell, the two agents, the approval, the notification, the
call, the gate, the note, and the two that reach GitHub. A step's agent is handed the standing
brief, so it is told about the project as well as its persona. And a run is no longer only one
somebody asked for: the schedule fires — mirrored into the system crontab, because this server
might not be running when the clock strikes and cron will be — and the watches fire, on what the
GitHub service noticed.

It also lists the tasks, and what has been drawn. A `.canvas` has no runner behind it the way a
task does, so `GET /api/diagrams` is the whole of its server side: what is on each one, and what a
broken one is broken by.

It keeps the conversations, and it answers them. A reply arrives over `/chat` a word at a time,
streamed from whichever provider `internal/llm` names for the model, and a socket closing does
not stop a reply being written — a lid, a sleep and a reload all look like that, and none of them
is somebody saying they were done. The record lands in the same SQLite file in the same home that
the TypeScript wrote. The whole of that file's schema is here, agents and reports included, and
so are its renames and its column migrations: a file written before a column existed has to reach
the head of the list whichever version opens it. Held to that by opening the same older file:
`coworkers` becomes `agents` and `coworker` becomes `agent`, and the list is the same list.

It keeps the agents too — the people-shaped ones under the chats. An agent and the one
conversation held with them are made together, titled with their name once and for all, and their
attachments folder is made at the same moment so it is in the tree from the first message. The
chart they stand on is a forest with one lead each, since the question a chart is asked is who to
escalate to: a line that would close on itself is refused by walking upward from the proposed lead
and meeting the agent on the way. How an agent answers is a turn on the chat socket, and whether a
reply of theirs is being written is `internal/chats`' to say — an agent mid-reply is listed as
working.

It keeps what Mother has noticed, said and been told: the feed, the verdicts you gave it, the
per-rule tally those verdicts add up to, and the two settings that decide whether any of it
happens. A verdict is a thing you said once — one already answered keeps the answer it had, and
the tally underneath it is counted once too. The noticing is here as well: a sweep looks over the
project, and a deliberation — a model call, the same half of this app that answers a chat —
decides whether any of it is worth saying, so `POST /api/mother/sweep` sweeps rather than only
marking the time.

It reports what is at work. Claude Code says so itself: every interactive session writes a probe
under its config folder — `sessions/<pid>.json`, with a `cwd` and a `status` it keeps current —
and that folder is watched. It needs nothing installed in the session, and it tells the one thing
no process list can: Claude waiting to be told what next and Claude thinking are the same process,
and the probe is where the difference is written down. A session killed outright leaves its probe
behind saying whatever it was doing, so a pid nothing is running under is left out rather than
believed.

The other half of the answer is read off the ptys — a shell whose foreground is the shell is at a
prompt, one running anything else is busy — which is what a client draws as "there is a shell
here, at rest".

It compares two branches. Nothing about it is about a commit: what is reported is the difference
between the branch you are on and the branch you named — as the two stand, or against where they
parted, which is the basis and is the whole of what a pull request's view changes. Every part of
it was already ported and unused: `ResolveRef`, `MergeBase`, `DiffFiles` and `ReadBlob` had been
sitting in `internal/git` with no caller, and this is the caller.

An open project also holds what its `.tools/.skills/` and `.personas/` folders carry, read when
it opens and read again whenever a change lands in either folder. Rescanning whole costs less
than being clever about which half of a move mattered.

It syncs. The loop wakes every second, commits once the project has been quiet for its idle
period, pulls, pushes, and latches a conflict until it is cleared — held to the TypeScript by
running both against their own remotes and diffing the histories they wrote.

A repo's tree is held and watched the way the project's is, one per repo on whichever checkout the config has it open on, because the sidebar draws all of them at once and a commit made in one from a shell has to reach its rows. The folder the repos live in is watched too, so a repository cloned into it by hand is listed without anybody telling the daemon. A `repo:` root is answered for the same as the project's; what it does not get is the link index and the sync loop, which are the project's idea.

It watches, and it reports. A document changed behind the daemon's back updates the link index and reaches every open `/ws` socket, and so does the sync loop's status. The tree's watcher is fsnotify where the TypeScript's was chokidar; the repository's polls `index`, `HEAD`, the branch HEAD names and `packed-refs`, for the reason the TypeScript gave about the first of them — git replaces the index by renaming a lockfile over it, and an event watch follows the orphaned inode into silence. The branch is polled as well because a reset or an amend moves it and nothing else, and the letters in the sidebar move with it.

Every write files an act, and a commit carries the trailers the ledger asks for where the project
has turned them on. `ledger/say.go` is the ledger in words — the line under a document — so what
a person is shown is a sentence rather than a row.

It migrates. A home written in the layout before profiles existed — profiles as files in
`profiles/`, projects as folders beside them, and a repo a repository anywhere on the disk that a
registry pointed at — is moved into this one before anything else reads it, and the config is
moved with the folders. Everything moves rather than being copied, since a git repository is
portable and moving a whole directory keeps it one, and every checkout is repaired afterwards,
because a worktree remembers where its repository was in absolute paths. It was the first thing
running the two daemons side by side turned up, and it is held the same way it was found: one
fixture home built twice, both migrations run, and the two homes diffed down to the bytes of
every file git wrote. They agree, index caches aside, and so do the two configs.

One thing the TypeScript had that this does not, worth knowing before adding a route: the
exhaustiveness proof. Its `routes/index.ts` failed to compile if a route was typed and not served,
or served and not typed. Go has no equivalent, so `internal/api/route.go`'s table is the only list
there is.

## The thing to understand before adding to it

The frontend runs the daemon's grammar as *runtime code*, not only as types: the codecs in
`shared/` are imported by value across `path`, `browser`, `media`, `notebook`, and the canvas,
task and entity codecs. The browser parses a `.canvas` to draw it and the daemon parses the same
bytes before it writes them, so the two implementations are halves of one grammar. A document one
accepts and the other refuses is a document that opens and cannot be saved.

That is what `../conformance/` is for. Cases are written by hand, the answers were taken from the
TypeScript while it was in production, and both implementations were held to them — now this one
still is. An entity is held to three: the document it writes, the canonical form it hashes, and
the digest itself — a port that got the second wrong would write the same file under a different
name. `go test ./tests/conformance/` is the port's only real proof, and it is worth more than the
unit tests beside it.

A notebook is held differently again, because its writing is not canonical. The other three
codecs write the model out fresh and a load–save round trip is byte-identical by construction. A
notebook belongs to Jupyter as much as to this editor, so a save merges the model back into the
JSON it was parsed from: cells are matched by id, only what changed is written over, and the
file's own key order, its cell metadata and every key no version of this codec has heard of ride
through untouched. What the bytes owe therefore depends on what was *edited* as much as on what
was read, so a notebook case is an edit and the file it is made to — and the cases carrying no
edit at all are the ones that prove a notebook nobody changed comes back as the very bytes that
went in.

The config is in there too, on a different footing. Its bytes are not the contract — it is
machine-written app state in a folder that ignores itself, and nothing ever reads a diff of it —
so what the two implementations owe each other is the values. The corpus holds them with every
object key sorted, which is how two languages that order a map differently can still be compared
byte for byte.

Regenerate the answers with `make corpus` from the checkout root. It regenerates the grammars that
still have two implementations — the codecs the browser runs, now in `shared/` — and leaves the
rest of the corpus frozen: those answers are what the TypeScript daemon said before it was
deleted, and the tests here are still held to them. Regenerating changes what the app accepts, so
read the diff.

## What Go settled that another language would not have, and what it did not

Two of the ways a port silently rewrites every file in the repository on first save are not
questions here:

- **Numbers.** `encoding/json` prints a float the way `JSON.stringify` does, `1e21` threshold
  and all. A port to a language whose encoder writes `160.0` needs a number type of its own.
- **Field order.** Struct declaration order is wire order, and `omitempty` on a pointer is the
  format's "absent" — so the canonical writer is a struct rather than a hand-rolled one.

The third is a real trap and is handled in `canvas/codec.go`: `encoding/json` escapes `<`, `>`
and `&` unless told not to, and `JSON.stringify` does not.

The fifth is `internal/collate`, which is also a package. Half a dozen listings are sorted with
`localeCompare`, and one of them — the profiles — decides which project opens on a machine whose
config says nothing. That order is ICU's, not byte order: `_` before `-` before the digits before
the letters, and a lowercase letter before its own capital rather than after every capital there
is. Sorting the obvious way puts `Zoe` before `alice` and opens the wrong project. The table was
read off node rather than guessed at, and the corpus holds it.

The fourth is `internal/jstext`, which is a package rather than a paragraph. A JavaScript string
is a sequence of UTF-16 code units, so `text.length` counts an emoji as two, `slice` cuts by the
same measure, and `\s` is a whitespace class that is neither Go's nor Unicode's — it takes the
byte order mark and leaves U+0085 alone. An entity's name is cut at 200 of those and its prose is
refused past 8000, and the count is in the sentence the refusal is written in, so a Go port
reaching for `len()` disagrees with the browser in a message a person reads.

The sixth is `internal/jsjson`, which is the same trap from a third direction and is also a
package. A Go map has no order and `encoding/json` writes one sorted, so any file this daemon
reads, edits in part and writes back comes out alphabetised on its first save: every line moved,
by a save that changed one field. A notebook is merged back into the JSON it was parsed from and
a profile is written as the file it was read from plus what changed, so both are held in an
object that keeps the order its keys arrived in and written by that package rather than by
`encoding/json` — whose scalars it still borrows, since the number spelling is the thing worth
borrowing.

Three things are still not settled, and each is named where it lives:

- **A regular expression.** `agent.gate` asks JavaScript whether its pattern compiles; Go's
  regexp is RE2, which takes a little less. A gate wanting a lookahead is a task the browser
  keeps and this refuses. The kind is legacy and its patterns in the wild are words.
- **A collation.** The header keys an entity does not require are sorted with `localeCompare`.
  `entity/codec.go` carries the ICU order exactly over the alphabet a header key is allowed —
  `[A-Za-z][A-Za-z0-9_-]*` — and nothing else can reach it.
- **A document's modified time.** `stats.mtimeMs` is fractional — a file system keeps
  nanoseconds and JavaScript reports them as a fraction of a millisecond rather than rounding
  them off — so the tree reports a float here too.
- **The order of a listing.** Go visits a map in a different order every run. Anything a person
  reads is ordered off a slice instead: the backlinks off the document list, so two identical
  requests answer the same way.
- **The origin of a WebSocket.** `/ws` checks it; the implementation this is ported from checked
  nothing. A socket is not covered by CORS — a browser opens one across origins and hands the page
  everything that comes back — so on a loopback server with no auth any page the user visits could
  otherwise watch their tree. A request with no Origin at all is still allowed, which is every
  client that is not a browser.
- **A destructive git command.** The guard is ported and held to the same cases, because a port
  that got it wrong would run the `git reset` the TypeScript refused. It is the promise rather
  than the convention: it runs before the process does.
- **A name outside ASCII.** `internal/collate` is exact over printable ASCII and falls back to
  byte order past it. A profile or project named in Japanese sorts differently here.
- **The order of a profile's keys.** A profile handed back from a write is `name`, `path`,
  `connections`, `models`, then the identity there, and `name`, `path`, the identity, then
  `connections` and `models` here. The TypeScript's own two constructions of that object already
  disagreed with each other — its listing was in this order — so what is matched is the listing,
  and the write path was the accident. Every value is the same.
- **A profile's agent commands.** The lines a profile has typed over are a map in the model, so
  they are written in the order Go sorts a map rather than in the order the browser sent them.
  Every other key in the file keeps the place it had.
- **An error's wording.** A request refused for its shape was refused in zod's words there and is
  refused in Go's here. Nothing is held to those: they are read by a person, not by a caller. One
  goes further on purpose: deleting a document that is not there answers `notes/x.md is not there`
  rather than repeating Node's `ENOENT` with the absolute path in it.
- **A line separator.** `encoding/json` escapes U+2028 and U+2029 whatever it is told about
  HTML, and `JSON.stringify` leaves both alone. A document holding one comes back with `\u2028`
  where it had the character — the same string spelled differently, and a line in the diff
  nobody asked for. It is every codec here rather than the notebook's alone.
- **A lone surrogate.** Cutting a name at 200 code units can land inside a surrogate pair.
  JavaScript hands back half of one; Go has no string that holds half of one, so `jstext.Head`
  takes the whole character. A name that long ending in an emoji is where the two differ.

## What it depends on

`fsnotify` for the tree watcher, `coder/websocket` for the sockets, `modernc.org/sqlite` for the
stores, and `creack/pty` for the shells, with `golang.org/x/sys` beside it for the one ioctl the
foreground question needs. All of them are pure Go: `go build` needs no C toolchain, which is the
property worth keeping.

The repository's watcher takes none of them. It polls `index` and `HEAD`, which is what the
TypeScript already did and for the reason it gave — git replaces the index by renaming a
lockfile over it, and an event watch follows the orphaned inode into silence.

## Where the tests are

`tests/` mirrors `internal/`, the way `daemon/__tests__/` mirrored `daemon/src/` — a package's tests
under a folder of its own name, as an external test package with a dot import, so every name is
spelled the way it was when the file sat beside the code.

Nineteen files stay in `internal/` beside what they test, because Go will not let them move: a test
can only reach a package's unexported names from inside that package's own folder, and these reach
for something. `internal/github/client_test.go` stands its own server in front of the package's
URLs; `internal/syncloop` reaches the loop's mutex to hold it still; `internal/api`'s eleven use
the shape a refusal is written in. Where a package has tests of both kinds they are split — the
slug is in `tests/github/`, the client is not — which reads oddly for a moment and is the only
honest place for each.

## Running it

```sh
make test    # unit tests and the conformance suite
make vet     # gofmt and go vet
make dev     # the server, on $BROODMOTHER_PORT or the usual 4242
```
