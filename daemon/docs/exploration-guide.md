# Exploration Guide

> How to navigate and study the broodmother daemon source.

---

## Quick Start

The daemon is ~7,500 lines of source and ~7,000 of tests. It is small enough to read, and the
fastest way in is three files in this order:

1. **`src/app.ts`** — 61 routes. Reading the route names tells you what the system *is*
   before you know how anything works.
2. **`src/context.ts`** — `AppContext`. Everything that touches a disk hangs off this.
3. **`src/services/ProjectService.ts`** — the disk-touching half of a project, and the
   watchers under it.

After that, pick a subsystem from [Subsystems](subsystems.md) and read it beside its tests.

## The Layout

```
src/
  main.ts          8 lines: read the port, start, print where it landed
  server.ts        HTTP + the four websockets
  app.ts           every route, and the only place an error becomes a status
  context.ts       AppContext — the open profile, project and repos
  profiles.ts      who you commit as
  migrate.ts       moving an older home forward
  diagrams.ts      the .canvas files, which have no runner behind them
  test.ts          server(), tempDir, cleanup, until
  services/        the five watchers
  chat/            one conversation, streamed
  coworkers/       the chat page with hands
  brief/           what an agent is handed first
  tasks/           the graph, its blocks, its two clocks
  sockets/         the relay and the ptys
  lib/             the domain: git, sync, tree, project, repo, branch, path…
    types/         the wire — what the frontend also compiles against
__tests__/         mirrors src/, plus lib/ for the domain modules
```

`src/lib/` is the domain layer. It was a separate workspace in the repo this came from,
shared with the frontend; here the daemon owns it, and the frontend keeps its own contracts.
See [the frontend README](../../frontend/README.md) for that seam.

## Finding Things

| Looking for            | Start at                                                |
| ---------------------- | ------------------------------------------------------- |
| A route                | `src/app.ts` — grep the path                            |
| What a route returns   | `src/lib/types/api/` — one file per domain              |
| A websocket            | `src/server.ts`, then `src/sockets/`                    |
| Anything about a file  | `src/lib/tree.ts` + `src/services/TreeService.ts`       |
| Anything about git     | `src/lib/git.ts` + `src/services/GitService.ts`         |
| What an agent can do   | `src/chat/tools.ts`, `src/coworkers/tools.ts`           |
| Why a task ran         | `src/tasks/triggers.ts`                                 |
| Error → status code    | `src/app.ts`, the error translation block               |

## Code Patterns to Recognise

**Errors are classes, thrown low, translated once.** Every subsystem exports its own
`Error` subclass — `PathError`, `RepoError`, `ProjectError`, `ProfileError`, `BranchError`,
`GithubError`, `ChatError`, `TaskError`, `CanvasError`. Nothing below `app.ts` knows what an
HTTP status is.

**A service is a thing that has to stay true while the app is open.** If it watches, polls or
holds a handle, it is a service. If it is a function of its arguments, it belongs in
`src/lib/`.

**Types come from `lib/types/`, not from the code that sends them.** The route table in
`lib/types/api/routes.ts` maps a literal route token to its request and response. The
frontend compiles against its own mirror of these.

**The comments carry the reasoning.** This source explains *why* far more than *what*, and
the why is usually the interesting part — read the block comment above a constant before
changing it. `TreeService`'s debounce window and `terminal.ts`'s grace period both have a
paragraph explaining what went wrong at the other value.

**A cap is part of a tool's contract.** `MAX_DOC`, `MAX_MATCHES`, `MAX_ENTRIES` in
`chat/tools.ts` are what make a tool return an answer rather than a folder.

## Grep Patterns

```sh
# Every route, as a list
grep -oE "\.(get|post|put|patch|delete)\('[^']*'" src/app.ts

# Every tool an agent is given
grep -oE "^    [a-z_]+: tool\(" src/chat/tools.ts src/coworkers/tools.ts

# Every kind a task graph can hold
grep -n "kind: '" src/lib/types/task/schema.ts

# Everything that touches the disk
grep -rn "node:fs" src/ | grep -v types

# Every error class
grep -rn "extends Error" src/

# What is configurable
grep -rhoE "process\.env\.[A-Z_]+" src | sort -u
```

## Study Paths

**"How does a keystroke reach a file?"**
`frontend` editor → `PUT /api/doc` → `app.ts` → `ProjectService` → `lib/tree.ts` →
`lib/fs.ts` (`atomicWrite`) → chokidar echoes → `TreeService` suppresses its own echo →
`/ws` says something changed → the browser reads again.

**"How does a task fire?"**
`tasks/scheduler.ts` beats → `tasks/triggers.ts` checks each source against its cursor →
a firing writes what it was about into the run folder → `tasks/core.ts` walks the graph →
`tasks/blocks/core.ts` dispatches on `kind` → a gate's `parseVerdict` picks the next edge.

**"What stops an agent leaving the folder?"**
`lib/path.ts` — `normalize`, `RESERVED`, and `resolveInRoot` in `lib/fs.ts`. Read
`__tests__/lib/path.test.ts` beside it; the tests are the specification.

## Reading the Tests

`__tests__/` mirrors `src/`, and `__tests__/lib/` covers the domain modules. `src/test.ts` is
the whole of the harness:

- `server()` — the entire daemon against a temporary home, with a `call(method, path)`
- `tempDir()` / `cleanup()` — homes that clean themselves up
- `until(condition, ms)` — poll rather than sleep

610 tests, ~14s. Run one file with `npx vitest run __tests__/tasks/scheduler.test.ts`.

## See Also

- [Architecture](architecture.md)
- [Subsystems](subsystems.md)
- [API Reference](api.md)
- [Tools](tools.md)
- [Embedding](embedding.md)
