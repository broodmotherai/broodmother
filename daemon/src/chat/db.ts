import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type {
  Chat,
  ChatMessage,
  ChatStep,
  ChatSummary,
} from '@broodmother/types/api/chat'
import type { Coworker, NewCoworker } from '@broodmother/types/api/coworkers'

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
  // A chat may be a coworker's one running conversation, which the chats list leaves out.
  (db) => addColumn(db, 'chats', 'coworker', 'INTEGER'),
]

function addColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (columns.some((one) => (one as { name: string }).name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
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
        steps TEXT
      );
      CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat, id);
      CREATE TABLE IF NOT EXISTS coworkers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        name TEXT NOT NULL,
        persona TEXT NOT NULL,
        model TEXT NOT NULL,
        color TEXT NOT NULL,
        chat INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS coworkers_by_project ON coworkers (project, id);
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
   *  question nobody asked. A coworker's thread is not among them — it is reached through the
   *  coworker, and listing it here would be the same conversation twice in the rail. */
  list(project: string): ChatSummary[] {
    return this.db
      .prepare(
        `SELECT * FROM chats WHERE project = ? AND coworker IS NULL
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
   */
  addMessage(
    chat: string,
    role: ChatMessage['role'],
    text: string,
    at = Date.now(),
  ): ChatMessage {
    const inserted = this.db
      .prepare(`INSERT INTO messages (chat, role, text, created_at) VALUES (?, ?, ?, ?)`)
      .run(rowIdOf(chat), role, text, at)
    this.db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`).run(at, rowIdOf(chat))
    if (role === 'user') this.nameFrom(chat, text)
    return { id: messageId(inserted.lastInsertRowid as number), role, text, at }
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

  /** Everything in it goes with it. */
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
   * A coworker, and the one conversation held with them, made together: the thread is a chat
   * row marked with the coworker, titled with their name once and for all — the first thing
   * you say to a person is not what the conversation is called.
   */
  createCoworker(project: string, input: NewCoworker, at = Date.now()): Coworker {
    const chat = this.db
      .prepare(
        `INSERT INTO chats (project, title, model, created_at, updated_at, coworker)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .run(project, input.name, input.model, at, at)
    const chatRow = chat.lastInsertRowid as number
    const inserted = this.db
      .prepare(
        `INSERT INTO coworkers (project, name, persona, model, color, chat, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(project, input.name, input.persona, input.model, input.color, chatRow, at)
    const id = inserted.lastInsertRowid as number
    this.db.prepare(`UPDATE chats SET coworker = ? WHERE id = ?`).run(id, chatRow)
    return this.coworker(coworkerId(id)) as Coworker
  }

  /** One project's coworkers, by name. */
  coworkers(project: string): Coworker[] {
    return this.db
      .prepare(`SELECT * FROM coworkers WHERE project = ? ORDER BY name COLLATE NOCASE, id`)
      .all(project)
      .map(toCoworker)
  }

  coworker(id: string): Coworker | null {
    const row = this.db.prepare(`SELECT * FROM coworkers WHERE id = ?`).get(rowIdOf(id)) as
      | Record<string, unknown>
      | undefined
    return row ? toCoworker(row) : null
  }

  /** Whose thread a chat is, or null for a conversation that is nobody's. */
  coworkerOfChat(chat: string): Coworker | null {
    const row = this.db
      .prepare(`SELECT * FROM coworkers WHERE chat = ?`)
      .get(rowIdOf(chat)) as Record<string, unknown> | undefined
    return row ? toCoworker(row) : null
  }

  /** When the last thing was said to or by them, or null when nothing has been. */
  lastSaidAt(chat: string): number | null {
    const row = this.db
      .prepare(`SELECT MAX(created_at) AS at FROM messages WHERE chat = ?`)
      .get(rowIdOf(chat)) as { at: number | null } | undefined
    return row?.at ?? null
  }

  /** The coworker and their conversation, gone together. */
  removeCoworker(id: string): void {
    const held = this.coworker(id)
    if (!held) return
    this.remove(held.chat)
    this.db.prepare(`DELETE FROM coworkers WHERE id = ?`).run(rowIdOf(id))
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
const coworkerId = (row: number) => `coworker-${String(row)}`

/** Ids are `chat-3` and `msg-7` rather than `3` and `7`: a rowid is a number in a file, and
 *  handing one out invites it to be treated as one. */
function rowIdOf(id: string): number {
  return Number(id.replace(/^(chat|msg|coworker)-/, ''))
}

/** Where a coworker's deliverables go, from their name: lower case, one dash between words,
 *  nothing a path would trip on. */
export function attachmentsOf(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'coworker'
  return `attachments/${slug}`
}

function toCoworker(row: Record<string, unknown>): Coworker {
  const name = row.name as string
  return {
    id: coworkerId(row.id as number),
    name,
    persona: row.persona as string,
    model: row.model as string,
    color: row.color as string,
    chat: chatId(row.chat as number),
    attachments: attachmentsOf(name),
    createdAt: row.created_at as number,
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
  return message
}
