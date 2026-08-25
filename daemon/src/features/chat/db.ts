import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type {
  Chat,
  ChatMessage,
  ChatStep,
  ChatSummary,
} from '@daemon/types/api/chat'
import type { Agent, AgentPlaced, NewAgent } from '@daemon/types/api/agents'

/** How long a title taken from what you said is allowed to be. */
const TITLE_MAX = 60

/**
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that is already there, so a column added
 * after the first file was written is added by hand here. Each one checks before it alters, so
 * the list runs whole on every open and a file at any age ends up at the head of it.
 */
const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  // Answers grew steps: what a reply did on its way to being written.
  (db) => addColumn(db, 'messages', 'steps', 'TEXT'),
  // A chat may be an agent's one running conversation, which the chats list leaves out.
  (db) => addColumn(db, 'chats', 'agent', 'INTEGER'),
  // Where an agent stands on the org chart. Null is nobody has placed it, which is every
  // agent until somebody drags one.
  (db) => addColumn(db, 'agents', 'x', 'INTEGER'),
  (db) => addColumn(db, 'agents', 'y', 'INTEGER'),
  // Who said it, where that is another agent rather than the person: an agent id. Null on
  // everything the person typed, which is most of what is in here.
  (db) => addColumn(db, 'messages', 'from_agent', 'TEXT'),
]

/**
 * Renaming cannot be a migration: `CREATE TABLE IF NOT EXISTS` runs first and would make an
 * empty table beside the rows, leaving the rename to find its name taken. So these run before
 * the schema, and check before they act the way the migrations do.
 */
const RENAMES: ((db: DatabaseSync) => void)[] = [
  (db) => renameTable(db, 'coworkers', 'agents'),
  (db) => renameColumn(db, 'chats', 'coworker', 'agent'),
]

function hasTable(db: DatabaseSync, table: string): boolean {
  const found = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table)
  return found !== undefined
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((one) => (one as { name: string }).name)
}

function addColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  if (columnsOf(db, table).includes(column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

/** A rename carries the old table's indexes with it under their old names, so the one this
 *  file declares is dropped and made again beside the schema it belongs to. */
function renameTable(db: DatabaseSync, from: string, to: string): void {
  if (!hasTable(db, from) || hasTable(db, to)) return
  db.exec(`ALTER TABLE ${from} RENAME TO ${to}`)
  db.exec(`DROP INDEX IF EXISTS ${from}_by_project`)
}

function renameColumn(db: DatabaseSync, table: string, from: string, to: string): void {
  const columns = columnsOf(db, table)
  if (!columns.includes(from) || columns.includes(to)) return
  db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`)
}

/**
 * Every conversation and everything said in one, in a SQLite file in the broodmother home —
 * beside the runs, and on disk for the same reason: a chat you cannot come back to tomorrow is
 * a chat you have to hold in your head today.
 *
 * A conversation belongs to the project it was held in. The project is the absolute path of the
 * folder, which is what the config calls one, so a project that moves takes its chats with it
 * only if it is opened by the path it moved to — the same bargain every other per-project thing
 * in the app makes.
 */
export class ChatStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    for (const rename of RENAMES) rename(this.db)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        title TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chats_by_project ON chats (project, id);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        steps TEXT,
        from_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat, id);
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        name TEXT NOT NULL,
        persona TEXT NOT NULL,
        model TEXT NOT NULL,
        color TEXT NOT NULL,
        chat INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agents_by_project ON agents (project, id);
      CREATE TABLE IF NOT EXISTS reports (
        agent INTEGER NOT NULL,
        lead INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS reports_by_agent ON reports (agent);
    `)
    for (const migrate of MIGRATIONS) migrate(this.db)
  }

  /** An empty conversation in a project, named `New chat` until something is said in it. */
  create(project: string, model: string, at = Date.now()): Chat {
    const inserted = this.db
      .prepare(
        `INSERT INTO chats (project, title, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(project, 'New chat', model, at, at)
    return {
      id: chatId(inserted.lastInsertRowid as number),
      title: 'New chat',
      model,
      updatedAt: at,
      messages: [],
    }
  }

  /** One project's conversations, newest first. Without their messages: the rail beside a chat
   *  draws names, and reading every word of every conversation to write a list of titles is a
   *  question nobody asked. An agent's thread is not among them — it is reached through the
   *  agent, and listing it here would be the same conversation twice in the rail. */
  list(project: string): ChatSummary[] {
    return this.db
      .prepare(
        `SELECT * FROM chats WHERE project = ? AND agent IS NULL
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(project)
      .map(toSummary)
  }

  /** One conversation, whole. Null is a chat that is not there — deleted in another window,
   *  or an id that outlived the project it was made in. */
  chat(id: string): Chat | null {
    const row = this.db
      .prepare(`SELECT * FROM chats WHERE id = ?`)
      .get(rowIdOf(id)) as Record<string, unknown> | undefined
    if (!row) return null
    const messages = this.db
      .prepare(`SELECT * FROM messages WHERE chat = ? ORDER BY id`)
      .all(rowIdOf(id))
      .map(toMessage)
    return { ...toSummary(row), messages }
  }

  /**
   * Something said. The conversation is touched so the rail keeps its order, and the first
   * thing you say names it — which is what every chat app does, and it means there is no name
   * to be asked for before there is a conversation to give it to.
   *
   * `from` is another agent's id, where one agent said this to another.
   */
  addMessage(
    chat: string,
    role: ChatMessage['role'],
    text: string,
    at = Date.now(),
    from?: string,
  ): ChatMessage {
    const inserted = this.db
      .prepare(
        `INSERT INTO messages (chat, role, text, created_at, from_agent) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(rowIdOf(chat), role, text, at, from ?? null)
    this.db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(at, rowIdOf(chat))
    if (role === 'user') this.nameFrom(chat, text)
    const message: ChatMessage = {
      id: messageId(inserted.lastInsertRowid as number),
      role,
      text,
      at,
    }
    if (from) message.from = from
    return message
  }

  /** The reply as it stands, rewritten as it grows — what was said and what was done to say
   *  it. A message saved every delta would be a write per token; the caller decides how
   *  often, and the last word is the one that counts. */
  setMessageText(id: string, text: string, steps: ChatStep[] = []): void {
    this.db
      .prepare(`UPDATE messages SET text = ?, steps = ? WHERE id = ?`)
      .run(text, steps.length ? JSON.stringify(steps) : null, rowIdOf(id))
  }

  /** One message as it stands on disk, or null for one that is not there. */
  message(id: string): ChatMessage | null {
    const row = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(rowIdOf(id)) as
      | Record<string, unknown>
      | undefined
    return row ? toMessage(row) : null
  }

  /** One message gone: a reply that was asked for and never came. An empty bubble in a
   *  conversation reads as an answer of nothing, which is not what happened. */
  removeMessage(id: string): void {
    this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(rowIdOf(id))
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM messages WHERE chat = ?`).run(rowIdOf(id))
    this.db.prepare(`DELETE FROM chats WHERE id = ?`).run(rowIdOf(id))
  }

  /** What was said, gone; the conversation stays to be said into again. */
  clear(id: string, at = Date.now()): void {
    this.db.prepare(`DELETE FROM messages WHERE chat = ?`).run(rowIdOf(id))
    this.db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(at, rowIdOf(id))
  }

  /**
   * An agent, and the one conversation held with them, made together: the thread is a chat
   * row marked with the agent, titled with their name once and for all — the first thing
   * you say to a person is not what the conversation is called.
   */
  createAgent(project: string, input: NewAgent, at = Date.now()): Agent {
    const chat = this.db
      .prepare(
        `INSERT INTO chats (project, title, model, created_at, updated_at, agent)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .run(project, input.name, input.model, at, at)
    const chatRow = chat.lastInsertRowid as number
    const inserted = this.db
      .prepare(
        `INSERT INTO agents (project, name, persona, model, color, chat, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(project, input.name, input.persona, input.model, input.color, chatRow, at)
    const id = inserted.lastInsertRowid as number
    this.db.prepare(`UPDATE chats SET agent = ? WHERE id = ?`).run(id, chatRow)
    return this.agent(agentId(id)) as Agent
  }

  agents(project: string): Agent[] {
    return this.db
      .prepare(`SELECT * FROM agents WHERE project = ? ORDER BY name COLLATE NOCASE, id`)
      .all(project)
      .map(toAgent)
  }

  agent(id: string): Agent | null {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(rowIdOf(id)) as
      | Record<string, unknown>
      | undefined
    return row ? toAgent(row) : null
  }

  /** Another model behind the same voice. The chat row carries it too, since that is what a
   *  conversation reopened without a client's word falls back to. */
  setAgentModel(id: string, model: string): void {
    const held = this.agent(id)
    if (!held) return
    this.db.prepare(`UPDATE agents SET model = ? WHERE id = ?`).run(model, rowIdOf(id))
    this.db.prepare(`UPDATE chats SET model = ? WHERE id = ?`).run(model, rowIdOf(held.chat))
  }

  /** Whose thread a chat is, or null for a conversation that is nobody's. */
  agentOfChat(chat: string): Agent | null {
    const row = this.db
      .prepare(`SELECT * FROM agents WHERE chat = ?`)
      .get(rowIdOf(chat)) as Record<string, unknown> | undefined
    return row ? toAgent(row) : null
  }

  /** When the last thing was said to or by them, or null when nothing has been. */
  lastSaidAt(chat: string): number | null {
    const row = this.db
      .prepare(`SELECT MAX(created_at) AS at FROM messages WHERE chat = ?`)
      .get(rowIdOf(chat)) as { at: number | null } | undefined
    return row?.at ?? null
  }

  /** Every agent in the project, with who they report to and where they stand. One query
   *  rather than one per agent, because a board draws all of it or none. */
  org(project: string): AgentPlaced[] {
    return this.db
      .prepare(
        `SELECT agents.*, reports.lead AS lead FROM agents
         LEFT JOIN reports ON reports.agent = agents.id
         WHERE agents.project = ?
         ORDER BY agents.name COLLATE NOCASE, agents.id`,
      )
      .all(project)
      .map(toPlaced)
  }

  /** Who an agent reports to, or nobody. The unique index is what makes it one lead: a
   *  second is the same row rewritten rather than a second line into the same agent. */
  setLead(agent: string, lead: string | null): void {
    if (lead === null) {
      this.db.prepare(`DELETE FROM reports WHERE agent = ?`).run(rowIdOf(agent))
      return
    }
    this.db
      .prepare(
        `INSERT INTO reports (agent, lead) VALUES (?, ?)
         ON CONFLICT (agent) DO UPDATE SET lead = excluded.lead`,
      )
      .run(rowIdOf(agent), rowIdOf(lead))
  }

  /** Where it stands. Written by a drag and by nothing else — until one, the board lays the
   *  agent out itself and this stays null. */
  place(agent: string, x: number, y: number): void {
    this.db.prepare(`UPDATE agents SET x = ?, y = ? WHERE id = ?`).run(x, y, rowIdOf(agent))
  }

  /** Their reports come up under their own lead, which is what an org does when somebody
   *  leaves — and where they had none, the reports have none either. */
  removeAgent(id: string): void {
    const held = this.agent(id)
    if (!held) return
    const row = rowIdOf(id)
    const above = this.db
      .prepare(`SELECT lead FROM reports WHERE agent = ?`)
      .get(row) as { lead: number } | undefined
    if (above) this.db.prepare(`UPDATE reports SET lead = ? WHERE lead = ?`).run(above.lead, row)
    else this.db.prepare(`DELETE FROM reports WHERE lead = ?`).run(row)
    this.db.prepare(`DELETE FROM reports WHERE agent = ?`).run(row)
    this.remove(held.chat)
    this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(row)
  }

  close(): void {
    this.db.close()
  }

  /** Names a conversation after the first thing said in it, and never again — a title that
   *  followed the latest message would be a list whose rows all change when you speak. */
  private nameFrom(chat: string, text: string): void {
    this.db
      .prepare(`UPDATE chats SET title = ? WHERE id = ? AND title = 'New chat'`)
      .run(titleOf(text), rowIdOf(chat))
  }
}

/** The first line of what was said, cut to a name's length. An empty message keeps the
 *  placeholder rather than making a row with nothing in it. */
export function titleOf(text: string): string {
  const line = text.trim().split('\n')[0].trim()
  if (!line) return 'New chat'
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line
}

const chatId = (row: number) => `chat-${String(row)}`
const messageId = (row: number) => `msg-${String(row)}`
const agentId = (row: number) => `agent-${String(row)}`

/** Ids are `chat-3` and `msg-7` rather than `3` and `7`: a rowid is a number in a file, and
 *  handing one out invites it to be treated as one. */
function rowIdOf(id: string): number {
  return Number(id.replace(/^(chat|msg|agent)-/, ''))
}

/** Where an agent's deliverables go, from their name: lower case, one dash between words,
 *  nothing a path would trip on. */
export function attachmentsOf(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  return `attachments/${slug}`
}

function toAgent(row: Record<string, unknown>): Agent {
  const name = row.name as string
  return {
    id: agentId(row.id as number),
    name,
    persona: row.persona as string,
    model: row.model as string,
    color: row.color as string,
    chat: chatId(row.chat as number),
    attachments: attachmentsOf(name),
    createdAt: row.created_at as number,
  }
}

function toPlaced(row: Record<string, unknown>): AgentPlaced {
  const lead = row.lead as number | null
  const [x, y] = [row.x as number | null, row.y as number | null]
  return {
    ...toAgent(row),
    lead: lead === null ? null : agentId(lead),
    place: x === null || y === null ? null : { x, y },
  }
}

function toSummary(row: Record<string, unknown>): ChatSummary {
  return {
    id: chatId(row.id as number),
    title: row.title as string,
    model: row.model as string,
    updatedAt: row.updated_at as number,
  }
}

function toMessage(row: Record<string, unknown>): ChatMessage {
  const message: ChatMessage = {
    id: messageId(row.id as number),
    role: row.role as ChatMessage['role'],
    text: row.text as string,
    at: row.created_at as number,
  }
  // Absent rather than empty: a message that did nothing has no working to show, and a page
  // drawing an empty list of steps would leave a gap where the answer should start.
  const steps = row.steps as string | null
  if (steps) message.steps = JSON.parse(steps) as ChatStep[]
  const from = row.from_agent as string | null
  if (from) message.from = from
  return message
}
