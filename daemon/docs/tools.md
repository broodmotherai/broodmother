# Tools Reference

> What an agent can do inside a broodmother project.

---

## Overview

There are two separate tool surfaces in this daemon, and they are not the same list:

| Surface      | Defined in                | Given to                                     |
| ------------ | ------------------------- | -------------------------------------------- |
| **Chat**     | `src/chat/tools.ts`       | The model answering on the chat page          |
| **Agent**    | `src/agents/tools.ts`     | A delegate working in a checkout              |

Both are Vercel AI SDK `tool()` definitions with Zod input schemas. Neither asks permission:
a project is a folder you pointed at, the writes are to markdown, and git is the undo. This
is a deliberate difference from an agent that runs anywhere on your disk — see
[Permission Model](#permission-model).

`titleOf(name, input)` in `chat/tools.ts` is what turns a call into the line the UI shows.

---

## Chat Tools

Ten, and the whole of what the chat page can reach. Every path is scoped to the open
checkout — `project`, or `repo:<name>` — and normalised through `@broodmother/path`, so
nothing addresses its way out of the folder.

| Tool           | Does                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `list_tree`    | The folder, as a tree. Capped at 400 entries.                              |
| `read_doc`     | One document. Capped at 60,000 characters.                                 |
| `search_docs`  | Text across the project. Capped at 40 matches.                             |
| `edit_doc`     | A replacement inside a document.                                           |
| `write_doc`    | A document, whole — new or overwritten.                                    |
| `move_doc`     | A rename, which is also how a document changes folder.                     |
| `delete_doc`   | Off disk. "There is no undo but git."                                      |
| `entity_list`  | What the project has already recorded. Read before proposing anything.     |
| `entity_record`| A record written down, answering with the path it wrote.                   |
| `api`          | The daemon's own HTTP API, from the inside.                                |

The caps are the point of the tool being a tool: the model is handed an answer that fits in
a context window rather than a folder.

`api` is the interesting one — it lets the model reach the same 66 routes the browser has, so
anything the app can do it can ask for, without a tool per verb.

The two entity tools are the exception to that argument, and typed for a different reason. A
record has to be *written*: there is no tool here that takes free-form content and files it,
so what comes back from `entity_record` is what it just wrote and the path it wrote it under.
That is what makes "cite the record" something the app holds an agent to rather than
something the prompt asks for. Reading one back is `read_doc` — a record is an ordinary
markdown document, and a second tool for the same file would teach the model otherwise.

## Agent Tools

An agent is the chat page with hands. Where a chat tool reads and writes documents, an
agent gets a shell and Claude Code in an actual checkout:

| Tool               | Does                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `claude_code`      | Hands a task to Claude Code, in the checkout, with the disk and a shell |
| `shell`            | One command — `ls`, `git status`, a script                              |
| `list_attachments` | What is in its attachments folder, by name                              |
| `agent_message`    | Says something to another agent in the project, by name                |

The split between the first two is the interesting one, and the descriptions say it: `shell`
is for quick things, and *anything longer than a command is a task for `claude_code`*. An
agent delegates the real work rather than driving it a command at a time.

`AGENT_ROUNDS` is 24. A delegation is several tools deep — a look around, the errand, a
check of what came back — and each of those is a round.

### Messaging a colleague

`agent_message` takes a name, not an id: a name is what the agent's own prompt calls them, and
a model writing `agent-7` from memory is a model that will get it wrong. A whole name is
matched first and a first name after it, taken only where one person answers to it — somebody
writing to a colleague writes what they would say out loud, and two Sams get an answer asking
which rather than a message to the wrong one. Who there is to write
to is not a tool at all — it is a section of the system prompt, built per turn in
`features/agents/brief.ts` from `Agents.org()` and the project's personas, ordered the way the
chart reads downward. An agent that has to spend a call to find out its colleagues exist mostly
will not, and the roster is a handful of lines.

The message lands in the recipient's thread through `Chats.deliver` — the socket's own reply
path, with nobody having asked for it through a socket — and is answered as a turn of theirs,
with their persona and their hands. Where somebody does have that thread open, they watch it
arrive: `Chats.watching` holds whoever is looking at each thread, and the delivered message is
sent on to them, since it is the one message a page has not already drawn itself. `agent_message` does not wait for that: it answers `delivered to Priya — their
answer will come back to you here` and the turn carries on. Waiting would block one agent's
turn for as long as another agent's whole turn, which with `claude_code` on the other end is
twenty minutes.

Every delivery carries a hop count, one further than the message that prompted it, held on the
reply in flight and read back through `Chats.hopsIn`. Past `MAX_HOPS` (4) a send is refused.
**This counter is the whole of what stands between the app and two agents answering each other
politely until the key runs out** — every round of that is a full turn with a real model. It is
not an unnecessary check; do not remove it.

## Task Blocks

The third surface, and not a tool list: a task is a graph, and a block is a node in it.
`src/tasks/blocks/core.ts` dispatches on `kind`.

**Triggers** — what starts a run:

| Kind                     | Fires on                          |
| ------------------------ | --------------------------------- |
| `trigger.manual`         | A button                          |
| `trigger.interval`       | Every N                           |
| `trigger.time`           | A clock, via crontab              |
| `trigger.file`           | A document changing               |
| `trigger.github.issue`   | An issue                          |
| `trigger.github.pull`    | A pull request                    |
| `trigger.github.mention` | Being mentioned                   |
| `trigger.github.check`   | A check going red                 |

**Agents** — what a run does:

| Kind                   | Does                                              |
| ---------------------- | ------------------------------------------------- |
| `agent.claude`         | Claude Code in the checkout                       |
| `agent.muse`           | A model with the chat tools                       |
| `agent.shell`          | A command                                         |
| `agent.gate`           | A verdict that decides which way the graph goes   |
| `agent.note`           | Writes a document                                 |
| `agent.github.comment` | Says something on the issue or pull request       |
| `agent.github.pull`    | Opens one                                         |

`parseVerdict` is how a gate's prose becomes an edge: the block returns `next` and `stop`,
and the graph walks from there.

---

## The Brief

Not a tool, but what every surface above is handed first. `src/brief/core.ts` writes it, and
its own comment says the distinction best:

> A terminal has a shell, a working directory and the whole disk; the chat page has a set of
> tools and nothing else; an agent is the chat page with hands.

The brief says which room the agent is in, what the project is, and how much it syncs
(`off`, `on`, `conflicted`). `brief/soul.ts` holds the default soul — what an agent is here
before anybody has told it otherwise. It is written into no file: a profile with nothing of
its own reads back as this, so it can be edited on the profile's page like anything else.

## Permission Model

There is no approval prompt, and that is a decision rather than a gap:

- **The scope is a folder you chose.** Every path is normalised and resolved inside the open
  checkout. `RESERVED` blocks `.git`, `.broodmother` and `.repos`.
- **The content is markdown.** Not your home directory, not arbitrary code.
- **Git is the undo.** The one destructive tool says so in its own description.

The exception is `agent.shell` and `agent.claude`, which run real commands in a real checkout
— those are a task somebody wired up on purpose, and the trust is in the wiring.

## See Also

- [Subsystems](subsystems.md) — how chat, agents and tasks are put together
- [API Reference](api.md) — what the `api` tool reaches
