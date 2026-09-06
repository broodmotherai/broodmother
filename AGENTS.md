# Agent rules

The one file. `AGENTS.md` at the root is the source of truth for every agent that works in this repository, and the only file with rules in it — Codex, Cursor, Grok and Muse each read it natively, and `CLAUDE.md` is a one-line import of it because Claude Code reads `CLAUDE.md` and nothing else. Nothing is duplicated: add a rule here and all five have it. A rule that belongs to one tool goes in that tool's own file, and so far none does.

Each directory has its own README — `daemon/`, `frontend/`, `shared/`, `desktop/`. Read the relevant one before working in a directory; they carry the reasoning this file does not.

## Commits

The subject line is:

```
{fix|feat|update}({branch}): {what it is}
```

`{branch}` is the branch you are committing on, so a commit on `main` reads `fix(main): ...`. `feat` is a capability that was not there before, `fix` is something that was wrong and now is not, `update` is everything else — a revision, a dependency, a document, a refactor that changes no behaviour. The body under it is free prose and is where the reasoning goes; keep the subject to the one line.

Commits before this rule was written do not follow it and are not to be rewritten.

Never commit or push unless you were asked to.

## Architecture and design decisions

Before making a structural or architectural decision — choosing a pattern, designing a data model, picking a library, organising modules — research it first. Look up how others solve the problem, what the community recommends, and what the trade-offs are, and ground the decision in that rather than in assumption. This is for non-trivial decisions, not routine changes.

## Coding standards

Good code is simple code. It should be elegant and use modern paradigms wherever possible, never at the cost of quality.

Comments should be close to non-existent. The rule of thumb: if a genius like Richard Feynman or Alan Turing could not understand a chunk of code, it needs a comment. Never restate what a line does, and never leave a comment explaining a change you just made — that belongs in the commit message.

Read before you write. Find the closest existing example in the repo and follow it — its layout, naming, error handling, import order, test style. If there is no precedent, say so before inventing one.

### TypeScript

- Free of semicolons
- Use interfaces

## The commands

```sh
make dev            # the daemon and the site, on ports asked of the OS
make desktop        # the same, with the Electron window in front
make test           # cd daemon && go test ./... ; cd frontend && npm run typecheck && npm test
```

Each tree also runs on its own: `daemon/` has `make dev`, `make vet` and `make test`; `frontend/` has `npm run dev`, `typecheck`, `lint`, `test` and `fmt`; `desktop/` has `npm run dev`, `compile` and `package`.

`make test` does not pass today. `conformance/` was deleted in `25d24e4` and nothing has regenerated it, so every case in `daemon/tests/conformance/` fails on a missing file and `make corpus` writes into a directory that is not there. Do not read those failures as something you broke, and do not "fix" them by deleting the tests.

## The thing to understand before changing a format

The frontend runs the daemon's grammar as runtime code, not only as types. The codecs in `shared/` are imported by value by the browser — `path`, `browser`, `media`, `notebook`, and the canvas, task and entity codecs — and `daemon/internal/` re-implements the same grammar in Go. The browser parses a `.canvas` to draw it and the daemon parses the same bytes before it writes them.

So the two are halves of one grammar, and a document one accepts and the other refuses is a document that opens and cannot be saved. Change a codec on one side and you must change it on the other. `daemon/README.md` has the long version, including the six places Go and JavaScript disagree about bytes — number spelling, field order, HTML escaping, UTF-16 string length, ICU collation, and map ordering — each of which silently rewrites every file in the repository on first save if you get it wrong.

## Where things are

| | |
| --- | --- |
| `daemon/` | the server, in Go. `internal/` is the packages, `tests/` mirrors it |
| `frontend/` | the site, Next.js and Monaco |
| `shared/` | the grammar the browser runs, imported by value |
| `desktop/` | the Electron window |
| `.github/assets/` | the README's screenshots |

Daemon tests live in `daemon/tests/<package>/` as external test packages with a dot import, mirroring `internal/`. Nineteen files stay beside the code they test because they reach for unexported names and Go will not let them move.

## Prose

Write documentation the way a person would explain it out loud. Lead with the point. Use short sentences and common words, active voice, and one name for one thing. Prefer a period to an em dash, and cut the words that carry no weight: `delve`, `leverage`, `robust`, `seamless`, `landscape`, `it's worth noting`, `in today's world`. No preambles, no cheerful sign-offs, no bold on every other phrase. Vary sentence length so the page has a pulse. Keep commands, paths, field names and quotations exactly as they are; plain language is about the prose around them, never about the facts inside them.

Markdown in this repo is wrapped near 95 columns — `daemon/README.md`, the `Makefile` comments — except the newer sections of `README.md`, which are one line per paragraph. Match the file you are in rather than reflowing it; a rewrapped paragraph is a diff where every line moved.

## Boundaries

### Do freely

- Read any file in the repo
- Run linters, type checks and tests
- Make code changes

### Ask first

- Add a dependency
- Change a public interface, a route, or a format the two implementations share
- Delete or rewrite code you did not just write
- Anything that deploys, publishes or sends outward

### Never

- Commit secrets, `.env` files, or credentials
- Force push or rewrite shared git history
- Edit `broodmother`'s own `config.json` by hand — it is the app's, and the API is how it changes
- Commit `node_modules/`, `.next/`, or anything else the build writes
