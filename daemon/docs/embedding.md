# Embedding the Daemon

> How the daemon is started, by whom, and what a host has to do.

---

## Overview

The daemon is a local process. It listens on `127.0.0.1` and never on a public interface, and
it is meant to be started by something that then points a browser at the frontend.

There are three hosts that do this:

| Host        | How                                                       | Status in this repo    |
| ----------- | --------------------------------------------------------- | ---------------------- |
| A developer | `npm run dev` in `daemon/`, `npm run dev` in `frontend/`  | Works today            |
| The desktop app | Starts the daemon and serves the frontend in one window | `desktop/` is empty    |
| A test      | `server()` from `src/test.ts`, against a temporary home   | Works today            |

---

## Ports

Fixed, and the two do not collide:

| Process  | Port   | Set by                                    |
| -------- | ------ | ----------------------------------------- |
| daemon   | `4242` | `PORT` in `src/server.ts`, or `BROODMOTHER_PORT` |
| frontend | `4243` | `next dev -p 4243` in `frontend/package.json`   |

The frontend reaches the daemon at `NEXT_PUBLIC_API_URL`, which defaults to
`http://127.0.0.1:4242`. The daemon allows the frontend's origin through CORS by default —
`WEB_ORIGINS` is `http://localhost:4243` and `http://127.0.0.1:4243`, overridable as a comma
list in `BROODMOTHER_WEB_ORIGINS`.

Moving one means moving it in both places. A host that hands out ports at run time should set
`BROODMOTHER_PORT`, `BROODMOTHER_WEB_ORIGINS` and `NEXT_PUBLIC_API_URL` together.

## Starting it

```ts
import { startServer } from './src/server'

const { url, port, context } = await startServer({ port, home, root, cron })
```

`ContextOptions` is small on purpose:

| Option | Meaning                                                        |
| ------ | -------------------------------------------------------------- |
| `home` | The home. Defaults to `BROODMOTHER_HOME`, then `~/.broodmother`. |
| `root` | Where a project is opened from.                                 |
| `cron` | The system crontab, unless a test hands in a tamer one.         |

`startServer` returns the handle: the URL it actually bound, the port, and the live
`AppContext`. Binding to port `0` and reading the port back is how a test or a host that
cannot pick a free port ahead of time should do it.

## What a host owes the daemon

1. **A home it may write.** `~/.broodmother/` by default; anything else via `BROODMOTHER_HOME`.
   Profiles, projects and repos all live under it, and nothing is stored anywhere else.
2. **The origin the browser will use**, if it is not the default.
3. **Nothing about credentials.** broodmother pushes with whatever git and ssh already have on
   the machine — the agent, the keys in `~/.ssh`, and the credential helper git is configured
   with, which on a Mac is the login keychain. A host that has ever pushed from a terminal is
   already set up.
4. **A shutdown.** The handle's `close()` ends the watchers, the ptys and the sockets.

## The desktop host

`desktop/` in this repo is empty. In the version this was ported from it was an Electron main
process that started the daemon in-process, served the built frontend from a local server,
and opened one window at it — which is why `frontend/next.config.ts` still sets
`output: 'standalone'` and pins `outputFileTracingRoot`: a build that is going to be shipped
inside an app has to carry its own `node_modules`.

Nothing in the daemon is Electron-aware, and nothing needs to be. A host starts it, waits for
the URL, and points a window at the frontend.

## Testing against it

`src/test.ts` gives you the whole daemon against a temporary home:

```ts
const { call, close } = await server()
const { body } = await call('GET', '/api/profiles')
```

`tempDir` and `cleanup` handle the home; `until` polls for a condition rather than sleeping.
50 test files use this, and it is the reason the suite can cover routes, sockets, the
scheduler and git without a fixture repository checked in.

## See Also

- [Architecture](architecture.md) — what `startServer` builds
- [API Reference](api.md) — what the host's browser will call
