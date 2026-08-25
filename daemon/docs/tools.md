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

The split between the first two is the interesting one, and the descriptions say it: `shell`
is for quick things, and *anything longer than a command is a task for `claude_code`*. An
agent delegates the real work rather than driving it a command at a time.

`AGENT_ROUNDS` is 24. A delegation is several tools deep — a look around, the errand, a
check of what came back — and each of those is a round.

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
