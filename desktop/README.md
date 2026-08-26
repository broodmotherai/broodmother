# desktop

broodmother in a window of its own. An Electron shell around the frontend, so the app has a
dock icon, a title bar and a `⌘Tab` slot rather than living in a browser tab beside your
email.

It is a window and nothing else. It starts no servers and holds no state: the daemon and the
frontend are the app, and this is the frame around them. That is the whole design — the two
trees that do the work already know how to run themselves, and a third process supervising
them is a third thing to debug when one of them will not start.

## Running it

From the repo root, the whole stack with the window in front of it:

```sh
make desktop
```

That is the daemon, the site and this window on ports asked of the OS, wired to each other —
`BROODMOTHER_URL` is what tells the window where the site landed. Any one of the three
falling over takes the other two with it.

This tree on its own:

```sh
npm install
make dev            # compiles, then opens the window
make vet            # typecheck
```

Alone it loads `http://127.0.0.1:4243` — the frontend on its default port, which needs the
daemon on `4242` — so the two of them have to be up beside it:

```sh
(cd ../daemon && npm run dev)
(cd ../frontend && npm run dev)
```

Until something answers, the window holds on a page that says so and says what to run. It
retries twice a second and swaps itself for the real thing the moment the port opens, so the
order you start the three in does not matter.

| Variable           | Meaning                                            |
| ------------------ | -------------------------------------------------- |
| `BROODMOTHER_URL`  | What to load. Defaults to `http://127.0.0.1:4243`. |

## The Mac application

```sh
make package        # out/broodmother-darwin-<arch>/broodmother.app
make install        # the same, copied into /Applications
make uninstall
```

`make install` replaces `/Applications/broodmother.app` outright rather than copying over it,
because a stale file left inside a bundle is a bug you cannot see.

The bundle is unsigned and un-notarized, which is fine for the machine that built it and is
not a thing you can hand to anybody else: Gatekeeper will refuse it on any other Mac. Signing
is a flag and an identity away when there is a reason to.

An installed bundle is still only a window, and one pointed at `4243` — double-clicking it
with nothing running gets you the holding page, not a running broodmother. What it wants
beside it is the two default-port lines above, since `make desktop` hands out ports the
bundle knows nothing about. Bundling the daemon and the frontend into the app so it boots on
its own is the obvious next step and a considerably larger one: it means shipping Node, both
trees' `node_modules`, and a supervisor that knows when a child has died.

## Layout

```
src/
  main.ts       the window, the guest a browser tab runs in, and waiting for the port
  holding.ts    the page it sits on until then
  loopback.ts   which addresses a guest is refused, kept where the renderer cannot edit it
```
