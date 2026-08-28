# e2e

The suite that drives the whole app: a real daemon on a real home, a real browser, and the
Electron shell for the things only it does. The other two suites cover the daemon in a node
process and the components in jsdom; what neither of them can see is the two of them wired
together — a route the page calls with the wrong body, a socket that never reconnects, a
watcher event that reaches nothing on screen.

## Running it

From the checkout root, because the suite needs a built site and a compiled shell and those
are the other trees' to make:

```sh
make e2e            # headless, both tiers
make e2e-ui         # the same specs in Playwright's UI mode
make e2e-web        # the browser tier, in a browser you can watch
```

Each builds the site and compiles the shell first. That costs about fifteen seconds and buys
the certainty that what ran is what is on disk now; `next start` holds the build it started
with, so a clever target that skipped it would be testing the last checkout.

In this tree, once the site is built, `npm test`, `npm run ui` and `npm run web` are the same
three without the build. `npx playwright show-trace <path>` replays a failure step by step,
and `npm run report` opens the HTML report of the last run.

## The two tiers

**`tests/web/`** is every flow, in Chromium, against the site and a daemon. A browser context
is milliseconds, so this is where the suite grows. One file per flow, ordered by what breaks
most: the tree drawing what is on disk and following a write made behind its back, a document
opened and edited and read back off disk, the palette, a task pressed from play to a step with
its output on screen, a conversation the scripted model answers, an edit synced to a bare
remote, and a record written by the app appearing on the entities page.

**`tests/shell/`** is the handful of things that are the shell and nothing else — the holding
page until something answers, the window it opens, the guest a browser tab runs in, a link
leaving for the OS browser. An Electron launch is seconds and the windows are real windows,
so this tier stays small and runs one at a time. It is Playwright's own advice about Electron
and it is also where the wall clock goes.

## How a test gets a world

`fixtures/stack.ts` is a worker fixture. Per worker: a temp home, a profile holding a key that
is never spent, a project whose `local` checkout is a real git repository with two documents
committed and a bare remote to push to, and a daemon `startServer`ed in-process on a port the
OS chose. The handle it hands over carries the `context` the daemon built, so a test can ask
the app what it thinks rather than only what it drew, and `close()` is awaited at the end of
the worker rather than signalled.

**A worker's world is shared by every test that runs in it.** The two seeded documents are
there to be read; a test that wants one to edit asks `stack.note()` for its own, and a test
that reads a list — runs, records — finds the rest of the worker's in it and filters. Nothing
else keeps two tests that land in the same worker out of each other's way.

Nothing outbound is real: `fakeCrontab()` for the schedule, `scriptedStream()` for the model,
and `fixtures/claude.sh` for Claude Code. All three arrive as arguments to `startServer` —
`ContextOptions` — which is why no product code has to know a test is running. There is no
`BROODMOTHER_E2E` and nothing reads `NODE_ENV`.

One site build serves every worker, so the page is told which daemon is its own: the `page`
fixture sets `window.BROODMOTHER_API_URL` before any of the app's script runs, and
`ApiDataSource` reads it ahead of the address baked in at build time. Deliberately not a query
parameter — a URL that repoints the app at another server is a link somebody can be sent.

The site's port is fixed (`site.ts`) and no daemon's is. That is the way round it has to be:
the daemon reads its allowed origins once, at import, so the site's address has to be known
before a worker loads it — `playwright.config.ts` puts it in the environment — while a fixed
daemon port would serialise the whole suite.

## Selectors

Roles and accessible names, which is how the app is already written — 127 `aria-label`s in the
repo. Where there is no accessible name to hold on to the answer is a `data-testid` on the
product element, not a CSS path in the test that goes stale the next time somebody restyles a
row. There is one: `editor`, on the editor's host, because Monaco names only the offscreen
textarea it reads keystrokes from and that sits behind the text where nothing can click it.
The canvas and the xterm viewport will want theirs when something tests them.

`fixtures/editor.ts` is how a test writes in a document, and both of its waits are load-
bearing: the focus is waited for rather than assumed, and the text goes in as one insertion
rather than a keystroke at a time. See the comment there — a burst of keystrokes slower than
the half-second save debounce races the watcher reading the file back.

## What belongs here

The wiring, and the flows that cross it. A codec, a reducer, a route's error shape and a
component's states stay in the suites they are in: a test that could have been a vitest test
and was written here instead is a slow test in the wrong place.

## Known rough edges

- **`next start` warns about `output: standalone`** on every run and serves the site anyway.
  The shipping app will run the standalone server, and this will want to as well once
  something depends on the difference.
- **UI mode against the shell tier is unverified.** Electron opens a window of its own rather
  than the context Playwright's live preview expects. The trace and the report are that
  tier's record either way.
- **A wikilink goes nowhere.** The live preview styles one and `render()` has no rule for the
  token at all, so reading mode drops it. There was going to be a test for it; there is
  nothing yet to test.
- **The tasks page can sit half a minute stale.** It asks again when the socket says a run
  moved, and a page that mounts while one is still walking can miss that word — its own poll
  is thirty seconds. `task.spec.ts` waits on the daemon rather than racing it, and says so.
- **`agent.muse` still reaches for a real `muse`.** `agent.claude` takes the binary from
  `ContextOptions`, the way the chat's errand does; its neighbour does not, so a task with a
  muse step in it is not something this suite can run.
