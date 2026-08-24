# daemon

The whole server side of broodmother: one Node process that owns a folder of markdown, the
git around it, the agents that work in it and the terminals that run in it — and hands all of
that to a browser over HTTP and four websockets.

Ported from `example/old-broodmother`, where it was `daemon/` plus a `lib/` workspace shared
with the frontend. Here the daemon owns that domain layer as `src/lib/`, and the frontend
keeps its own contracts.

## Running it

```sh
npm install
npm run dev        # tsx watch, on 4242
npm start          # tsx, no watch
npm run typecheck
npm test           # vitest — 610 tests, ~14s
```

It listens on `127.0.0.1:4242`. The frontend runs on `4243` and is allowed through CORS by
default.

| Variable                       | Meaning                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `BROODMOTHER_PORT`             | Where it listens. Defaults to `4242`.                      |
| `BROODMOTHER_HOME`             | The home. Defaults to `~/.broodmother`.                    |
| `BROODMOTHER_PROJECT`          | Open this project instead of the one in the config.        |
| `BROODMOTHER_WEB_ORIGINS`      | Comma list of allowed origins. Defaults to the frontend.   |
| `BROODMOTHER_GITHUB_CLIENT_ID` | The GitHub app the device flow authenticates against.      |
| `ANTHROPIC_API_KEY`            | Falls back to the key stored per profile.                  |

## Layout

```
src/
  main.ts       read the port, start, say where it landed
  server.ts     HTTP + the four websockets
  app.ts        61 routes, and the only place an error becomes a status code
  context.ts    AppContext — the open profile, project and repos
  services/     the five watchers
  chat/         one conversation, streamed
  coworkers/    the chat page with hands
  brief/        what an agent is handed first
  tasks/        the graph, its blocks, its two clocks
  sockets/      the relay and the ptys
  lib/          the domain — git, sync, tree, project, repo, branch, path
    types/      the wire
__tests__/      mirrors src/, plus lib/ for the domain modules
```

## Docs

[`docs/`](docs/) documents this daemon:

- [Architecture](docs/architecture.md) — the pipeline, the context, the services
- [API Reference](docs/api.md) — every route and socket
- [Subsystems](docs/subsystems.md) — chat, coworkers, tasks, sync, terminals, git
- [Tools](docs/tools.md) — what an agent can do here
- [Embedding](docs/embedding.md) — starting the daemon from a host
- [Exploration Guide](docs/exploration-guide.md) — how to read this source

## What the port changed

- **`lib/` became `src/lib/`.** It was a sibling workspace shared with the frontend. The
  `@broodmother/*` imports are unchanged; a tsconfig path and a vitest alias point them here.
- **`@daemon/*`** is a second alias, for the moved `__tests__/lib/` reaching `src/test.ts`.
- **The port is 4242**, and CORS defaults to the frontend on 4243. Both were 3001/6767.
- **Two test fixtures gained `models: []`.** `Profile` requires it, and the lib tests were
  never typechecked before — that workspace had no tsconfig.
- **`__tests__/lib/fs.test.ts`** spells out the module path it hands a child process.
