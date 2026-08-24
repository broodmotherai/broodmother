# frontend

broodmother's web interface: the file tree, the editor, the terminals, the command palette,
chat, tasks, notebooks, diffs and settings. A Next app on `4243`, talking to the daemon on
`4242`.

It is two ports layered on each other. The **architecture** came from `example/proprium` —
its layering, its service positions, its folder shape. The **features** came from
`example/old-broodmother`, which is where every screen in it is from.

## Running it

```sh
npm install
npm run dev        # 4243; needs the daemon on 4242
npm run build
npm run typecheck
npm test           # vitest — 439 tests
```

Start the daemon first (`cd ../daemon && npm run dev`). `NEXT_PUBLIC_API_URL` overrides where
this looks for it; it defaults to `http://127.0.0.1:4242`.

## Layout

Proprium ran five workspaces and compiled `apps/lib` into each app. There is one app here, so
there is no workspace to be shared with: `lib/` was dissolved into the app and everything it
held now sits at the root, reached by the one alias `@/`.

```
app/            Next's router: /, /chat, /doc/[...path], /settings, /tasks
  components/ui/  The design system — buttons, menus, modals, fields, the icon set.
                  Every feature imports it from here; `core/` under it is proprium's own
                  kit, which broodmother's thirteen modules are drawn with
components/     Feature UI, by domain — tree, editor, terminal, palette, chat, task,
                notebook, diff, canvas, doc, shell, project, profile, repo, branch,
                github, settings
services/       DataSource (the interface naming every call), ApiDataSource (the one
                implementation, and the only place a route path is written), mock
surface/        Pointer and viewport helpers, which are not components
editor/         The browser half of the editor — Monaco, lists, preview, tables
markdown/       Rendering, wikilinks, math
hooks/          What more than one feature listens with
state.tsx       App-wide state
styles/         Proprium's token set — see styles/README.md
__tests__/      Mirrors the source
wasm/           The task kernel, AssemblyScript, built by `npm run wasm`
```

The layering rules, from proprium's `apps/AGENTS.md`:

- **A page never calls `fetch`.** It calls a `DataSource` method.
- **A component moves to `components/ui/` the moment it names nothing from
  `@broodmother/types/` and nothing from Next.** What is left in `components/` is the app's own, by domain.
- **Avoid `useCallback` and `useMemo`** unless there is a measured reason.

And broodmother's own, which `__tests__/no-node-apis.test.ts` enforces: **the frontend renders
and nothing else.** Nothing the browser is served — every source tree at the root, and the
loose modules beside them — may import `node:fs` or `node:child_process`. Every disk touch is
the daemon's. The build configs are the exception the test names, and the only one.

## The shared layer

The domain is the daemon's, and this app reads it rather than keeping a copy. `@broodmother/*`
resolves to `../daemon/src/lib/*` — one tsconfig path, one vitest alias — so the wire types,
the task and canvas codecs, the notebook codec, `path`, `media` and the rules about what makes
a name are compiled from the same file both sides run.

They were two copies before this: `contracts/` was `daemon/src/lib/types/` file for file, and
`path.ts`, `media.ts` and `notebook/codec.ts` were byte-identical to theirs. The header on the
mirrored `git.ts` named a `__tests__/contracts.test.ts` that was supposed to catch a drift; no
such test existed.

What keeps a browser out of `node:fs` is no longer where a file sits, because the app's module
graph now crosses into a package full of them. `__tests__/no-node-apis.test.ts` follows the
imports instead: from every shipped source, through `@broodmother/*` and the relative steps
taken inside that tree, and it reads whatever it reaches. `daemon/src/lib/types/` is written to
be reachable — a declaration shared with the browser lives there, and the module that talks to
git re-exports it.

Because the graph leaves this directory, `turbopack.root` and `outputFileTracingRoot` are the
repo rather than the app.

## The design system

`components/ui/` is broodmother's kit and is what every feature imports — 500-odd call
sites across 40 files, unchanged. What changed is what is behind it: each of its thirteen
modules is now drawn with proprium's tokens and utilities instead of `.menu-*`-style rules out
of the stylesheet.

- **Delegating to `core/`**: `Button` and `LinkButton` are `core/Button`; `Modal`'s close is
  `core/Button`'s `IconButton`.
- **Ported to the convention**: `Menu`, `ContextMenu`, `Select`, `Confirm`, `Choices`,
  `ColorField`, `TimeField`, `Tooltips`, `Resizer`, `Modal`, `Icon`. These have no proprium
  equivalent — proprium's menu is a flat list behind an icon button, and this one has sections,
  headings, search, submenus, badges and dots — so the structure stayed and the clothes changed:
  `popup-surface`, `bg-surface-active`, `border-edge`, `bg-field`, `text-charcoal`,
  `animate-drop`, and `focus-ring`.
- **`Menu` exports `menuSurface`, `menuItem` and `menuHeading`**, which `ContextMenu`,
  `ColorField` and `TimeField` import — the surfaces are shared so they cannot drift apart.
- **Two rules stayed in the stylesheet.** `.icon.seti` carries a *measured* baseline correction
  (Seti hangs its ink low in the em) and is overridden per context by the tree and tab rows;
  re-deriving that by eye would be worse than keeping the one place it is written down.

`app/globals.css` layers this: Tailwind's theme and utilities, then proprium's `tokens.css` and
`console.css`, then broodmother's own stylesheet last so it wins any conflict. Tailwind's
**preflight is deliberately not imported** — it would reset 5,460 lines written without one.
The two token sets share no variable name.

## Known gaps

- **`npm run lint` reports 103 findings (75 errors, 28 warnings), effectively all
  pre-existing.** The old frontend shipped no ESLint config at all — there is none anywhere in
  the repo it came from — so 22,000 lines arrived having never been linted, and the config
  reconstructed here includes the React Compiler rules that ship with `eslint-config-next` 16.
  The bulk is `react-hooks/set-state-in-effect` (31) and `react-hooks/refs` (31). Spot-checked
  against the original: the flagged code is byte-identical. Worth working through, but it is a
  backlog to triage rather than a regression to chase.

## What the port changed

- **Five workspaces became one app, and then one tree.** `@proprium/lib/*` → `@/lib/*`, and
  `lib/` itself was dissolved: there is no second package to share it with, so its folders
  came up to the root and `@broodmother/*` and `@/lib/*` both became `@/*`.
- **`src/` was dissolved into proprium's shape.** `src/components/<d>` → `components/<d>`;
  `src/components/ui` → `components/ui/`; `src/components/surface` → `surface/`;
  `src/{state,editor,colors}` → the root; `src/api/{client,http}` →
  `services/{DataSource,ApiDataSource}`.
- **`__tests__/no-node-apis.test.ts` scans every shipped tree** — `app`, `components`,
  `editor`, `hooks`, `markdown`, `notebook`, `services`, `surface`, `test` and the loose
  modules at the root. It scanned `app` and `src`.
- **`wasm/` is excluded from tsc.** It is AssemblyScript, and `asc` is what compiles it.
- **The daemon is on 4242**; this app is on 4243.
- **`app/globals.css` came across whole**, recovered from the checkout under
  `~/.broodmother/Michael/broodmother-wiki/.repos/broodmother/` after `example/` was emptied
  mid-port.
