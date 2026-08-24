# Subsystems Guide

> The major subsystems of the broodmother daemon, and how each is put together.

---

## Table of Contents

- [Projects, Repos and Branches](#projects-repos-and-branches)
- [Tree and Documents](#tree-and-documents)
- [Git and Sync](#git-and-sync)
- [GitHub](#github)
- [Chat](#chat)
- [Coworkers](#coworkers)
- [Brief](#brief)
- [Tasks](#tasks)
- [Terminals](#terminals)
- [Agents](#agents)
- [Service Layer](#service-layer)

---

## Projects, Repos and Branches

`src/lib/{project,repo,branch}.ts`, `src/profiles.ts`

The home is `~/.broodmother/`, and everything broodmother has is inside it: profiles hold
projects, and projects hold repos. No folder is ever typed in — a name is all any of them
takes, and the folder name *is* the name, so renaming a project is renaming a folder.

**A project is where you work.** Every folder in a profile's folder is one; drop one in by
hand and it shows up, with no registration step. Which profile a project commits as is which
folder it is in.

Whether a project has a repository is never read out of the config — it is asked of the
folder. A project you `git init` in a terminal is git-backed the next time it is opened.

**A repo is what the documents are about.** Notes about a codebase are not the codebase, so a
repository the documents concern lives under the project in `.repos/`. A docs project usually
covers several.

**A branch is a checkout.** `Branch` carries `name`, the `path` its checkout is at *or would
go*, `checkedOut`, and `primary` for the repository itself. Every branch git knows about is
offered whether or not this machine has given it a folder yet.

## Tree and Documents

`src/lib/tree.ts`, `src/services/TreeService.ts`

`TreeService` is chokidar over the project folder, debounced at 100ms, and it deliberately
never looks inside `.git`.

The subtle part is echo suppression: one write of the app's own can arrive as more than one
event, so a write marks a window during which its own echo is ignored. That window is short
on purpose — it was two seconds once, which was long enough to swallow an agent editing the
same file straight after a save. It only has to outlast the echo of a local write, which is
immediate.

Paths are `DocPath`s, normalised through `src/lib/path.ts`. `RESERVED` — `.git`,
`.broodmother`, `.repos` — is what nothing may address.

## Git and Sync

`src/lib/{git,sync}.ts`, `src/services/GitService.ts`

`GitService` watches the repository's own state rather than the files in it. A commit, a
stage or a branch move made in a shell changes what the sidebar should say about every row
without touching a single document — and since the tree watcher never looks in `.git`,
nothing else would notice.

**Sync is off until it is turned on, per project.** One project can push on every quiet
moment while the next keeps its history to itself. Under the switch are the steps it is made
of: whether to commit for you, whether to pull, whether to push, and how long the project has
to be quiet first.

`SyncStatus` is one of `off`, `idle`, `syncing`, `conflict`, `error`, `offline`. `conflict`
carries the conflicted paths and **latches** — it stays until explicitly cleared, because a
conflict that quietly resolved itself is not a thing anybody should have to trust.

`commitMessage` derives a message from the paths: one file names it, several in one folder
name the folder, and otherwise it counts them.

## GitHub

`src/lib/github.ts`, `src/services/GitHubService.ts`

The module does the one-shot asks: the device flow — a short code and where to type it — and
the repo picker. The **service** exists because a task needs the same question asked every
few minutes for as long as the app is open, which is a different job: four things to watch
(issues, pulls, mentions, checks) and two to do (comment, open a pull request).

Watching keeps a cursor per source — whatever the source hands out that says "seen up to
here".

## Chat

`src/chat/{core,db,model,tools,api,error}.ts`

A conversation, streamed over `/chat`. SQLite behind it via `node:sqlite`.

The reply as it stands is written down every 500ms while it is still arriving — often enough
that a crash costs a sentence, rarely enough that it is not a write per token.

Like a terminal, the reply outlives the socket carrying it. The browser reconnects, asks for
the same chat back, and is told what it missed. Closing the socket is the page looking away,
which stops nothing.

The eight tools it is given are in [Tools](tools.md).

## Coworkers

`src/coworkers/{core,tools,brief}.ts`

A coworker is the chat page with hands: a shell and Claude Code in an actual checkout,
reached through its tools. `COWORKER_ROUNDS` is 24 — a delegation is several tools deep, a
look around, the errand, a check of what came back, and each is a round.

## Brief

`src/brief/{core,making,soul}.ts`

What every agent is handed first. It names which room the agent is in — and the three rooms
are genuinely different:

> A terminal has a shell, a working directory and the whole disk; the chat page has a set of
> tools and nothing else; a coworker is the chat page with hands.

It also carries the project and how much it syncs, in one word.

`soul.ts` is the default soul: what an agent is here before anybody has told it otherwise. It
is written into no file — a profile with nothing of its own reads back as this, which is what
lets it be edited on the profile's page like any other field.

## Tasks

`src/tasks/{core,db,scheduler,triggers,crontab,state,scratch}.ts`, `src/tasks/blocks/`

A task is a graph. Trigger nodes start a run; agent nodes do the work; a gate decides which
edge the run takes next. The kinds are listed in [Tools](tools.md#task-blocks).

- **`scheduler.ts`** is the beat. Two clocks — intervals and the system crontab — behind one
  verb, so the two are two wirings rather than two schedulers.
- **`crontab.ts`** writes real crontab lines, which is what makes a timed task survive the app
  being closed.
- **`triggers.ts`** holds the cursors: an mtime, an etag, a last-seen id. It also writes what
  a firing was *about* into the run's folder — the issue to answer, the commit that went red —
  so a step three along still knows which issue the run is about.
- **`state.ts`** persists those cursors in one small JSON file, so a restart does not re-fire
  everything.
- **`db.ts`** is SQLite: runs and their logs.

## Terminals

`src/sockets/terminal.ts`

One pty per shell, via `@lydell/node-pty`, addressed by session name rather than by socket.

A detached shell keeps running for a grace period. The reasoning is in the source and worth
repeating: a laptop that slept, a tab the browser froze, a window closed and reopened and a
wifi hiccup all look the same from here — a socket that closed — and what is on the other end
of them is somebody's work.

`DELETE /api/terminal` ends one. That is said by whoever is finished with it, which is not
the same as whoever stopped watching.

## Agents

`src/services/AgentService.ts`

What is going on in each checkout — at work, wants somebody, or sitting at a prompt — folded
into one answer per checkout from two sources:

1. **Claude Code says so itself.** Every interactive session writes a probe file.
2. **The pty side is asked**: every shell, its pid, where it is, what it says is in front.

## Service Layer

Five classes, each owning something that has to stay true while the app is open. They are
described in [Architecture](architecture.md#5-services-srcservices).

The division that matters: `ProjectService` is the disk-touching half of a project and is
valid only while one is open. One is opened per project and closed to swap, so nothing above
it has to remember which parts of the previous project are still live.

## See Also

- [Architecture](architecture.md) — how these fit together
- [API Reference](api.md) — the routes that reach them
- [Tools](tools.md) — the agent surfaces
