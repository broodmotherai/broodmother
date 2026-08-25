# Architecture

> How the broodmother daemon is structured internally.

---

## High-Level Overview

The daemon is the whole server side of broodmother. It is a Node process that owns one
folder of markdown, the git around it, the agents that work in it and the terminals that run
in it — and it hands all of that to a browser over HTTP and four websockets.

```
browser  →  Hono routes (app.ts)  →  AppContext  →  services  →  disk + git + pty + Claude
   ↑                                                                    │
   └───────────────  /ws relay: "something changed, read again"  ────────┘
```

There is one long-lived object behind every request — `AppContext` — and everything that
touches a disk hangs off it. A route is thin on purpose: it validates, asks the context for
the service that owns the answer, and encodes what comes back.

The frontend renders and nothing else. `frontend/__tests__/no-node-apis.test.ts` fails the
build if anything under `app/`, `components/` or `lib/` imports `node:fs` or
`node:child_process` — every disk touch is here.

---

## Core Pipeline

### 1. Entrypoint (`src/main.ts`)

Eight lines. Reads `BROODMOTHER_PORT`, calls `startServer`, prints where it landed and which
project is open. Everything else is a consequence of `startServer`.

### 2. Server (`src/server.ts`)

Builds the `AppContext`, mounts the Hono app on `@hono/node-server`, and attaches a
`WebSocketServer` that routes by pathname. `HOST` is `127.0.0.1` and `PORT` is `4242` — the
daemon is a local process and does not listen on a public interface.

Four websocket routes, from `lib/types/api/ws.ts`:

| Route       | Carries                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `/ws`       | The app's own socket. One-way: the server says something changed.        |
| `/terminal` | One shell, by session name. Bytes both ways.                            |
| `/chat`     | One conversation, by name. The reply streams down it.                   |
| `/kernel`   | The notebook kernel.                                                     |

### 3. Routes (`src/app.ts`)

61 HTTP routes under `/api`, all of them thin. The file also owns:

- **CORS.** `WEB_ORIGINS` defaults to `http://localhost:4243` and `http://127.0.0.1:4243`,
  which is where the frontend runs. `BROODMOTHER_WEB_ORIGINS` overrides it as a comma list.
- **Error translation.** Each subsystem throws its own error class — `PathError`,
  `RepoError`, `ProjectError`, `ProfileError`, `BranchError`, `GithubError`, `ChatError`,
  `TaskError`, `CanvasError`, `NoProjectError`, `NoRepoError`, `NoProfileError` — and this is
  the single place they become status codes.
- **Scope.** `project`, or `repo:<name>`. A path stopped being an address the moment a
  project could link more than one repository.

See [API Reference](api.md) for the full route table.

### 4. Context (`src/context.ts`)

`AppContext` is what a route has. It holds the config, the open profile, the open project and
every repo the project links — each of those being a `ProjectService` with its watchers.

The rule it encodes: **every linked repo is open, but only the one you are in is watched.** A
`TreeService` is chokidar over a whole folder, and a code repository's `node_modules` is not
something to hold four of.

`ContextOptions` takes `root`, `home` and `cron` — the last so a test can hand in a tamer
crontab than the machine's.

### 5. Services (`src/services/`)

The disk-touching half, one class per thing that has to stay true while the app is open.

| Service           | Watches                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `ProjectService`  | A project's documents, repository, link index, `.skills/`, `.personas/` |
| `TreeService`     | The files, over chokidar, debounced — and deliberately never `.git`     |
| `GitService`      | The repository's own state: commits, stages, branch moves              |
| `ActivityService` | What each checkout is doing — at work, wants somebody, or idle         |
| `GitHubService`   | Four things to watch and two to do, asked every few minutes            |

`TreeService` and `GitService` are split for a reason: a commit made in a shell changes what
the sidebar should say about every row without touching a document, and the tree watcher
never looks inside `.git`, so nothing else would notice.

`ActivityService` folds two sources into one answer per checkout: Claude Code writes a probe
file for every interactive session, and the pty side is asked what each shell has in front of
it.

---

## State Management

Three kinds, and it is worth knowing which is which:

- **On disk, authoritative.** The markdown, and git. `~/.broodmother/` holds profiles, which
  hold projects, which hold repos. Nothing is stored anywhere else.
- **SQLite, via `node:sqlite`.** Chats (`chat/db.ts`) and task runs (`tasks/db.ts`).
- **In memory, rebuilt on start.** Watchers, live replies, running shells, trigger cursors.
  `tasks/state.ts` is the exception that persists: one small JSON file of cursors, so a
  restart does not re-fire every trigger.

## Concurrency Model

Single Node process, no worker threads. The concurrency that exists is:

- **Watchers** (chokidar) firing into debounced handlers.
- **Ptys** (`@lydell/node-pty`), one per shell, outliving the socket watching them. A laptop
  that slept, a frozen tab and a closed window all look like a closed socket from here, and
  what is on the other end of them is somebody's work — so a detached shell keeps running for
  a grace period rather than dying with its viewer.
- **The scheduler** (`tasks/scheduler.ts`), one beat, two clocks behind one verb.
- **Streaming replies** (`chat/core.ts`), written down every 500ms while still arriving —
  often enough that a crash costs a sentence, rarely enough that it is not a write per token.

## Error Handling

Every subsystem exports its own `Error` subclass and throws it. `app.ts` is the only place
that knows what an HTTP status is. Nothing below the routes formats a message for a browser.

## Configuration

| Variable                       | Meaning                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `BROODMOTHER_PORT`             | Where the daemon listens. Defaults to `4242`.              |
| `BROODMOTHER_HOME`             | The home. Defaults to `~/.broodmother`.                    |
| `BROODMOTHER_PROJECT`          | Open this project instead of the one in the config.        |
| `BROODMOTHER_WEB_ORIGINS`      | Comma list of allowed origins. Defaults to the frontend.   |
| `BROODMOTHER_GITHUB_CLIENT_ID` | The GitHub app the device flow authenticates against.      |
| `ANTHROPIC_API_KEY`            | Falls back to the key stored per profile.                  |

## Testing

`vitest run` — 610 tests across 50 files, `__tests__/` mirroring `src/`. `src/test.ts` holds
the helpers: `tempDir`, `cleanup`, `until`, and a `server()` that stands the whole thing up
against a temporary home.

## See Also

- [API Reference](api.md) — every route the browser can call
- [Subsystems](subsystems.md) — chat, agents, tasks, sync, terminals
- [Tools](tools.md) — what an agent can do here
- [Embedding](embedding.md) — starting the daemon from a host
- [Exploration Guide](exploration-guide.md) — how to read this source
