# conformance

What `daemon` is held to.

`cases/*.json` is written by hand. `corpus/*.json` is the answer to every case, and
`daemon/tests/conformance` runs each case through the Go and compares.

## Two implementations, and one

The corpus exists because a grammar can have two readers. The browser parses a `.task` and a
`.canvas` to draw them; the daemon parses the same bytes before it writes them. A document one
accepts and the other refuses is a document that opens and cannot be saved.

Four grammars still have two readers, and `make corpus` regenerates those from the browser's half
in `shared/`:

    canvas    the diagram the editor draws
    task      the flow the editor draws and the server runs
    entity    the record, which the browser reads and the daemon writes
    notebook  the .ipynb the editor edits

The rest are **frozen**. They were generated from the TypeScript daemon, which has since been
ported to Go and deleted — so their answers are a record of what the implementation being replaced
did, not something regenerable:

    brief         what an agent is told about where it is standing
    agent-brief   who an agent is told they are, and who else is here
    collate       the order half a dozen listings are in
    commit        what a sync pass commits under
    config        what the app salvages from a config it cannot read
    crontab       the lines a schedule becomes in the user's crontab
    git           what git says, read
    github        what a checkout's own remote is called
    ledger        who a request says it is, and the ledger in words
    links         what a wikilink points at, and what a move does to it

Frozen does not mean stale: the Go tests still run every one of those cases on every build. It
means the answers cannot be recomputed from a second implementation, because there is no longer a
second implementation. Changing one is changing the app's behaviour, and the diff is the review.

A case added to a frozen corpus has to have its answer written by hand, which is the honest cost
of having only one implementation left.
