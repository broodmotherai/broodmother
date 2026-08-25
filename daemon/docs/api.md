# API Reference

> Every route the browser can call, and the four sockets it can open.

---

## Overview

The daemon serves 66 HTTP routes under `/api` and four websockets. There are no slash
commands and no CLI: the app is a browser, and this is the whole of what it can ask for.

Routes are typed end to end. `lib/types/api/routes.ts` maps a route token — the literal
`'GET /api/profiles'` — to its request and response, and the frontend's `DataSource` is the
only place a path is written on that side. Adding a route means adding it in both places, and
the types are what make the mismatch a compile error rather than a 404.

**Scope.** Most routes act on the open checkout, which is `project` or `repo:<name>`. It is
set with `POST /api/scope`. A path alone stopped being an address the moment a project could
link more than one repository.

**Errors.** Every subsystem throws its own error class; `src/app.ts` is the only place that
turns one into a status code. The body is `{ error: string }`.

---

## HTTP Routes

| Method | Path | Does |
| ------ | ---- | ---- |
| `GET` | `/api/config` | The machine's config: who you are working as, what is open |
| `PUT` | `/api/config` | Change it |
| `GET` | `/api/profiles` | Every profile, the active one, and what git on this machine says you are |
| `POST` | `/api/profiles` | Make one |
| `PUT` | `/api/profiles` | Change one |
| `GET` | `/api/profiles/key` | The key broodmother made for a profile, if it has one |
| `POST` | `/api/profiles/key` | Make one |
| `GET` | `/api/projects` | Every project belonging to the active profile |
| `POST` | `/api/projects` | Make one, with as much git as it is given |
| `PUT` | `/api/projects` | Rename or repoint |
| `DELETE` | `/api/projects` | Remove |
| `POST` | `/api/projects/open` | Switch to one |
| `GET` | `/api/repos` | The repositories this project's documents are about |
| `POST` | `/api/repos` | Link one |
| `DELETE` | `/api/repos` | Unlink |
| `GET` | `/api/branches` | Every branch git knows about, and which have checkouts |
| `POST` | `/api/branches` | Open one — a checkout is made if it has none |
| `POST` | `/api/branches/open` | Switch to one |
| `DELETE` | `/api/branches` | Close a checkout |
| `POST` | `/api/scope` | Which checkout the rest of the calls are about |
| `GET` | `/api/tree` | The folder, as the sidebar draws it |
| `GET` | `/api/doc` | One document |
| `PUT` | `/api/doc` | Write it |
| `DELETE` | `/api/doc` | Remove it |
| `POST` | `/api/doc/move` | Rename, which is also how it changes folder |
| `POST` | `/api/folder` | Make one |
| `GET` | `/api/file` | Bytes, for an image the browser fetches directly |
| `GET` | `/api/links` | What links to what, out of the project's index |
| `GET` | `/api/git` | The repository's state |
| `PUT` | `/api/git` | The git settings: author, remote, how much syncing |
| `POST` | `/api/git/check` | Whether the remote is reachable before anything is written |
| `GET` | `/api/diff` | What differs between two branches |
| `GET` | `/api/diff/file` | One file of it |
| `GET` | `/api/sync` | Where the sync loop is |
| `POST` | `/api/sync/now` | Sync, now |
| `POST` | `/api/sync/clear-conflict` | Clear the latch a conflict left |
| `POST` | `/api/github/device` | Start the device flow |
| `POST` | `/api/github/connect` | Finish it |
| `GET` | `/api/github/repos` | Repositories you can push to |
| `POST` | `/api/github/repos` | Make one |
| `DELETE` | `/api/github` | Disconnect |
| `GET` | `/api/chats` | Every conversation |
| `POST` | `/api/chats` | Start one |
| `GET` | `/api/chat` | One, with its turns |
| `DELETE` | `/api/chat` | Remove it |
| `GET` | `/api/agents` | Who can be delegated to |
| `POST` | `/api/agents` | Make one |
| `DELETE` | `/api/agent` | Remove one |
| `POST` | `/api/agent/clear` | Clear its state |
| `POST` | `/api/agent/model` | Change which model answers as it |
| `GET` | `/api/personas` | The project's `.personas/` |
| `GET` | `/api/activity` | What each checkout is doing |
| `GET` | `/api/tasks` | Every task |
| `POST` | `/api/task/run` | Run one |
| `POST` | `/api/task/stop` | Stop it |
| `GET` | `/api/task/runs` | What it has done |
| `GET` | `/api/task/log` | One run's log |
| `GET` | `/api/diagrams` | The `.canvas` files the open checkouts hold |
| `GET` | `/api/entities` | Every record the project holds, newest first |
| `POST` | `/api/entities` | Write one — refused without provenance, and the same one twice is one |
| `GET` | `/api/entities/catalogue` | The kinds there are, and the relations |
| `POST` | `/api/entity/link` | Say a record already written came from one more thing |
| `GET` | `/api/data` | Task scratch |
| `DELETE` | `/api/data` | Clear it |
| `PUT` | `/api/model-keys` | Store a provider key on the profile |
| `DELETE` | `/api/model-keys` | Remove one |
| `DELETE` | `/api/terminal` | End a shell — said by whoever is finished with it |

---

## WebSockets

| Route | Direction | Carries |
| ----- | --------- | ------- |
| `/ws` | Down only | The app's own socket. "Something changed" — never the change itself. |
| `/terminal` | Both | One shell, addressed by `?root=&session=`. |
| `/chat` | Both | One conversation, addressed by `?chat=`. The reply streams down it. |
| `/kernel` | Both | The notebook kernel. |

### Why `/ws` says so little

The relay (`src/sockets/relay.ts`) tells every open client that something changed and sends
nothing the other way. The client then reads again. The payload a view needs is most of the
view, and a client that refetches cannot drift out of sync with the server the way an
incrementally patched one can.

The frontend's socket reconnects on its own with a backoff of 200ms → 5s, and `onLive(true)`
after a drop means *read again*: what happened while it was gone arrived nowhere.

### Terminals outlive their sockets

A shell is addressed by session name, not by socket. A laptop that slept, a tab the browser
froze, a closed window and a wifi hiccup all look identical from the daemon — a socket that
closed — and what is on the other end of them is somebody's work.

So closing the socket ends nothing. `DELETE /api/terminal` is what ends a shell, and it is
said by whoever is finished with it, which is not the same as whoever stopped watching.

## See Also

- [Architecture](architecture.md) — what is behind these routes
- [Subsystems](subsystems.md) — the machinery each group of routes reaches
- [Tools](tools.md) — the `api` tool, which reaches this same surface
