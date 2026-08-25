# Reorganization plan

> Restructuring the daemon along the patterns claude-code uses. Written as a plan, kept as the record of what was done.

---

## What this is measured against

The path named in the ask — `~/dev/broodmother/broodmother/example/claude-code` — is an empty directory. The only claude-code source on this machine is `~/dev/claude/claude-code-leaked`: 1884 TypeScript files, and the reference everything below is drawn from.

One thing that reference does *not* support: it is not comment-light. Sampled across `utils/`, `services/` and `tools/`, 22867 of 119262 lines are comments — 19%. The daemon is at 2333 of 12935, 18%. The two codebases are commented at the same density. So "structured like claude-code" and "no comments" are two separate directives, and the second one is ours alone. Both are worth doing; they just do not come from the same place.

---

## The five patterns worth taking

**One module per thing, in a folder named for it, with a thin index.** `commands/status/index.ts` is eleven lines — name, description, `load: () => import('./status.js')` — and `status.tsx` next to it is the work. `tools/GrepTool/` is `GrepTool.ts`, `prompt.ts`, `UI.tsx`. Never `core.ts`.

**A contract file with a builder that fills defaults.** `Tool.ts` declares the `Tool` type; `buildTool()` spreads `TOOL_DEFAULTS` under a partial definition so no call site ever writes `?.() ?? false`. Sixty tools, one place the defaults live.

**A flat registry that the type system checks.** `tools.ts` and `commands.ts` are import lists and an array. Adding a tool is one import and one array entry — nothing else in the tree changes.

**Three separate homes for three kinds of code.** `utils/` is pure and leaf. `services/` is stateful and long-lived. `types/` is contract only, at the top level, and the file says why: *"Import permission types from centralized location to break import cycles."*

**`constants/` per domain.** `apiLimits.ts`, `toolLimits.ts`, `system.ts`, `keys.ts`. No magic number is declared where it is used.

---

## Where the daemon diverges

### 1. `context.ts` is a god object — 1273 lines, 92 methods

`AppContext` is simultaneously the state store, the composition root, and the business layer. It holds the config, the active profile, the open project and every open repo, the host token and the model keys; it constructs and wires nine subsystems in a 110-line constructor; and it owns the verbs for profiles, GitHub auth, projects, repos, scope, branches, diffs, sync and checkouts. claude-code splits exactly this three ways: `state/AppState` for the state, `bootstrap/` for the wiring, `services/*` for the verbs.

It is contained, which makes this cheap: only `app.ts`, `server.ts` and the tests import it. `frontend/state.tsx` has an `AppContext` of its own but it is a React context, unrelated.

### 2. `app.ts` is one file for 62 routes and 19 schemas

Every zod body, every route, and a twelve-arm `instanceof` ladder for error mapping, in 477 lines. Adding a subsystem means editing this file in three places.

### 3. Fourteen error classes and no shared base

`ProfileError`, `PathError`, `ProjectError`, `RepoError`, `BranchError`, `GithubError`, `ChatError`, `TaskError`, `CanvasError`, `NotebookParseError`, `BadRequest`, `NoProjectError`, `NoRepoError`, `NoProfileError` — each declared where it is thrown, all of them imported into `app.ts` so `onError` can sort them into 400, 409 and 500.

### 4. `lib/` is three kinds of code under one alias

`@broodmother/*` resolves to `src/lib/*`, and holds pure functions (`path`, `fs`, `media`, `grid`), stateful subsystems (`git`, `sync`, `links`, `tree`, `branch`, `config`), and the entire shared type layer at `lib/types/*` — reached as `@broodmother/types/api/chat`, which reads like a published package and is a folder two levels inside `lib`.

### 5. Five files called `core.ts`

`tasks/core.ts` is the `Tasks` class. `chat/core.ts` is `Chats`. `coworkers/core.ts` is `Coworkers`. `brief/core.ts` is the brief. `tasks/blocks/core.ts` is the step dispatcher and the shared step helpers. None of them are named for what they hold.

### 6. `tasks/blocks/` is the tools pattern, three quarters finished

Seven block kinds, one file each — and then `performStep` is a seven-arm switch in `core.ts`. A new kind touches two files, and nothing checks that the switch covers the schema.

### 7. No `constants/`

`HOST`, `PORT` and `HEARTBEAT_MS` in `server.ts`; `TICK_MS` in `tasks/core.ts`; `MAX_ROUNDS` and `COWORKER_ROUNDS` in the chat and coworker modules; `SKILLS` and `PERSONAS` in `ProjectService`; `PRIMARY`, `REPOS_DIR`, `RESERVED`, `TEMP_SUFFIX` scattered through `lib/`.

---

## Target tree

```
src/
  main.ts                    unchanged — reads the port, starts the server
  server.ts                  HTTP + websocket lifecycle, nothing else
  bootstrap.ts               the composition root: builds state, services, app

  state/
    AppState.ts              config, profile, open project + repos, cached credentials
    selectors.ts             requireProject, rootOf, scope, here, sites, gitSettings

  routes/
    index.ts                 the registry, typed against ApiRoutes
    branches.ts  chat.ts  coworkers.ts  diff.ts  docs.ts  git.ts
    github.ts    profiles.ts  projects.ts  repos.ts  tasks.ts  tree.ts
    errors.ts                AppError → status, the whole of onError

  services/
    ProjectService.ts  TreeService.ts  GitService.ts  GitHubService.ts  ActivityService.ts
    BranchService.ts   DiffService.ts  ProfileService.ts  WorkspaceService.ts
    SyncLoop.ts        LinkIndex.ts    ConfigStore.ts     Terminals.ts   Relay.ts

  features/
    tasks/     Tasks.ts  scheduler.ts  triggers.ts  crontab.ts  db.ts  scratch.ts
    tasks/blocks/  Block.ts  registry.ts  claude.ts  muse.ts  shell.ts  gate.ts
                   note.ts  github.ts
    chat/      Chats.ts  api.ts  model.ts  tools.ts  db.ts
    coworkers/ Coworkers.ts  brief.ts  tools.ts
    brief/     brief.ts  soul.ts  making.ts

  utils/
    path.ts  fs.ts  media.ts  grid.ts  git.ts  markdown/  notebook/

  types/
    api/  task/  canvas/  config.ts  doc.ts  git.ts  profile.ts  …

  constants/
    server.ts  tasks.ts  chat.ts  files.ts
```

Aliases become `@daemon/types/*`, `@daemon/utils/*`, `@daemon/services/*`, `@daemon/features/*`. `@broodmother/*` goes away — it named a package that was never a package.

---

## Phases

Executed in the order below — the tree move went first so nothing landed twice.

### 1 — split the tree ✅

`src/lib/types/` → `src/types/`. The pure modules of `lib/` → `src/utils/`. The stateful ones → `src/services/`, one class per PascalCase file. `tasks/`, `chat/`, `coworkers/`, `brief/` → `src/features/`, each `core.ts` renamed to the thing it holds. `sockets/relay.ts` and `sockets/terminal.ts` → `services/Relay.ts` and `services/Terminals.ts`. `src/lib/` and `src/sockets/` are gone; `@broodmother/*` is gone with them, replaced by `@daemon/*`.

### 2 — errors ✅

`AppError` in `types/error.ts` carries a status, `Conflict` sets 409, and the fourteen classes extend one or the other. `onError` is four lines. `app.ts` lost seven imports, and a subsystem's error no longer requires editing the router. `NoProjectError`, `NoRepoError` and `NoProfileError` moved to `types/error.ts` too — the services throw them, and a marker class in a leaf module is what lets them without an import cycle.

### 3 — constants ✅

`constants/server.ts`, `constants/files.ts`, `constants/agents.ts`. Only the values that cross a module boundary or duplicate: `MAX_ANSWER` was declared twice at the same number in `chat/api.ts` and `coworkers/tools.ts`. A `const DEBOUNCE_MS = 100` beside its only use stayed where it was — hauling those into `constants/` would make the code worse.

### 4 — the router ✅

`app.ts` went from 477 lines to 22: CORS, `mount`, `onError`. Twelve domain tables under `routes/`, the zod bodies in `routes/schemas.ts`, the request helpers in `routes/request.ts`, and `routes/index.ts` mounting them.

The exhaustiveness check works, in both directions:

```ts
type Assert<T extends never> = T
type _NoneUnserved = Assert<Exclude<ApiRoute, Registered>>
type _NoneUntyped = Assert<Exclude<Registered, ApiRoute>>
```

It caught real drift on its first run: `GET /api/file` had been served since the images work and was never added to `ApiRoutes`. A `GetFile` type now exists and the route is in the table. Typo a route key and you get two errors — one at the table for the unknown key, one at the registry naming the route that is now unserved.

### 5 — the blocks registry ✅

`Block.ts` is the contract and `defineBlock`; `registry.ts` is the array and a map lookup. The seven-arm switch is gone. The type bridge lives inside `defineBlock` — a block is authored against the one node kind it serves and stored against all of them, and that one cast is the whole of it, the way `buildTool` absorbs its own.

### 6 — AppContext ✅ (partly)

1273 lines → 788. Three services, each following the `deps` interface the codebase already uses for `Tasks`, `Chats`, `Coworkers` and `SyncLoop`:

- `BranchService` — branches and the two branches a diff is between (145 lines out).
- `ProfileService` — the profile, the GitHub token and the model keys, which it now owns rather than AppContext (146 lines out).
- `WorkspaceService` — projects, repos and scope (164 lines out).

`branchKey` moved to `utils/branch.ts`, where its three callers can share it.

**Not done: `bootstrap.ts`.** The plan called for lifting the constructor's wiring into a composition root. On reading it, that would be worse: every dep is a closure over `this`, so a separate file would reach back into the object it is supposed to be building. `AppContext.create` already is the bootstrap. Left alone deliberately.

What remains in `AppContext` is one coherent thing — the object that owns the open roots: `useProject`, `useRepos`, `reopenRepo`, `closeRepo`, `watchScope`, `checkoutOf`, `ignoredIn`, the two event handlers, `rootOf`, `trees`, `writeDoc`, `broadcast`, and the wiring for the nine subsystems.

---

## What the refactor caught

Two real defects, both found by the work rather than looked for:

- **`GET /api/file` was untyped.** Served, and absent from `ApiRoutes`. The registry's exhaustiveness check failed on it the first time it ran.
- **A regression I introduced and then fixed.** `ProfileService.require` first threw `ProfileError` (400) where `AppContext.requireProfile` had thrown `NoProfileError` (409), quietly changing the status of seven routes. Moving the marker classes into `types/error.ts` fixed it; a probe confirms `POST /api/projects` with no profile still answers 409.

Also fixed in passing: a doc comment orphaned onto the wrong method when the profile cluster was cut out from between `here()` and `session()`.

---

## Comments — what the rule actually removed

The plan set a target of under 5% comment lines outside `types/`. **That target was wrong, and I did not hit it: 17% → 16%.**

The rule was applied as written — delete restatements, keep constraints — and the reason it removed so little is that this codebase's comments are not narration. Reading all 221 single-line doc comments and all 262 inline `//` comments outside `types/`:

- **Every one of the 262 inline comments is a genuine constraint.** `git leaves the directory behind when it was already empty of tracked files`. `A 304 carries no body at all, and asking for one reads as a broken answer`. `A pty rejects a zero dimension, and xterm reports one while the panel is hidden`. `Cron turns a bare % into a newline`. Not one restates the line under it.
- **Of the 221 doc comments, about 40 were restatements.** Those are gone: `/** Whether a reply is being written into this conversation right now. */` over `working(id): boolean`, `/** Opens a pull request, and answers with where it is. */` over `openPull()`, and the like.

The remaining 1700 lines are design rationale that exists nowhere else — not in `docs/`, not in the type names, not in git history. Getting to 5% means deleting it. That is a real option and a one-command change, but it is deleting knowledge rather than noise, so it is not something to do without saying so first.

---

## State

Typecheck clean. 616/616 tests passing. The daemon boots, serves `/api/config` and `/api/profiles`, answers 409 for a tree with no project, 404 for an unknown route.

Nothing is committed. `frontend/` was not touched — its `@broodmother/*` aliases pointed into `daemon/src/lib/` and are being repointed by the session working there.
