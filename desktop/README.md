# desktop

broodmother in a window of its own. An Electron shell around the frontend, so the app has a
dock icon, a title bar and a `⌘Tab` slot rather than living in a browser tab beside your
email.

In a checkout it is a window and nothing else: `make desktop` starts the daemon and the site
beside it, and a second daemon fighting the first for a port is worse than no daemon at all.
In the bundle it starts both, because a stranger who drags the app into `/Applications` has no
checkout to run anything from, and a window pointed at a port nobody is listening on is not an
application. `app.isPackaged` is the whole of the difference.

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
make dmg            # the same, in out/broodmother-<version>-<arch>.dmg
make install        # the .app, copied into /Applications
make uninstall
```

`make bundle` is what the first two do first: it builds the site as a Next standalone server —
its own `server.js`, its own `node_modules` — and copies the daemon in as the TypeScript it
is, since `tsx` runs it here the same as in a checkout. Both land in `Contents/Resources`
beside the app rather than inside its asar, because a `.node` binary has to be a file on disk
before anything can load it.

Neither tree brings a Node. Electron carries one, and `ELECTRON_RUN_AS_NODE=1` with
`process.execPath` is how `serve.ts` reaches it — so the bundle has one runtime in it rather
than three, and the daemon's prebuilt `pty.node` loads there because it is N-API and does not
care which of the two it was built for.

The two servers run on `4242` and `4243` rather than on ports asked of the OS, alone among
everything in this repo. The site reaches the daemon from the browser, so its address is
compiled into the build by `NEXT_PUBLIC_API_URL` — a port chosen at launch would arrive too
late to be compiled in. If something already holds either one, that child is not started and
the window shows whatever is answering: a checkout on the default ports is a broodmother
already running, and fighting it for the port would leave you with neither.

A GUI application inherits launchd's `PATH`, which is four system directories and nothing
anybody installed. So the children are handed what the login shell says `PATH` is, asked once
with `$SHELL -ilc`. Without it `git` is there and `claude` is not, and the app run from a
terminal works while the same app run from the Finder does not.

`make install` replaces `/Applications/broodmother.app` outright rather than copying over it,
because a stale file left inside a bundle is a bug you cannot see.

The bundle is unsigned and un-notarized. Gatekeeper refuses it on first launch on any Mac but
the one that built it, and the download page walks people through the right-click-Open that
gets past that. Signing is a flag and an identity away when there is a reason to.

## Layout

```
src/
  main.ts       the window, the guest a browser tab runs in, and waiting for the port
  serve.ts      the daemon and the site, started by the bundle and by nothing else
  holding.ts    the page it sits on until then
  loopback.ts   which addresses a guest is refused, kept where the renderer cannot edit it
```
