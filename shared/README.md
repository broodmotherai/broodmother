# shared

The grammar both halves of the app read.

A `.task` and a `.canvas` are parsed twice: once by the browser, to draw them, and once by the
daemon, to refuse a write that would leave one broken. This is the browser's half — the codecs, the
schemas, the API types the frontend is written against, and the three utilities they need.

It lived in the TypeScript daemon until the daemon was ported to Go. It was never the daemon's:
`conformance/` exists precisely because these are the other half of a grammar the Go daemon has to
agree with exactly, and `conformance/corpus/` is what this code answered, frozen, with the Go tests
held to it.

Nothing here touches the disk, the network or a process. Anything that did stayed behind and was
deleted with the daemon.
