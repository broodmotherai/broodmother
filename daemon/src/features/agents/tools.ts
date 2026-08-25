import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { ambient } from '@daemon/services/Terminals'
import { changedBetween, marksOf } from '@daemon/features/ledger/errand'
import { chatTools, type ToolDeps } from '../chat/tools'

/** How long an errand handed to Claude Code may take before it is a stuck one. Longer than a
 *  task step's five minutes: an agent is given afternoons, not commands. */
const CLAUDE_MINUTES = 20

/** A shell command is a quick thing; past this it is a job for `claude_code`. */
const SHELL_MINUTES = 5

/** How much of what a hand reports is worth carrying back to the brain. */
const MAX_ANSWER = 20_000

/** How much of a progress note fits on a step's line. */
const NOTE_MAX = 80

export interface AgentToolDeps extends ToolDeps {
  /** Where the hands work: the checkout, asked each call. */
  checkout: () => string
  /** What the hands run with, beyond the ambient environment: `CLAUDE_CONFIG_DIR`, a key. */
  env: () => Record<string, string>
  /** What Claude Code is told about the app — the terminal brief, since it has a shell. */
  brief: () => string
  /** The persona's body, which Claude Code wears too, so what it writes sounds like them. */
  persona: string | null
  /** The agent's name, so the errand knows whose it is. */
  name: string
  /** Where deliverables go, absolute. */
  attachments: string
  /** A word on how an errand is going, filed by the tool call it belongs to, for the step
   *  on screen to wear while the hands are busy. */
  progress?: (toolCallId: string, note: string) => void
  /** What an errand left different, for the ledger: the paths the checkout says changed
   *  either side of it, and the errand in its own first line. Coarse on purpose — it says
   *  which errand a file was part of, never which line was whose. */
  noteErrand?: (paths: string[], note: string) => void
  /** How Claude Code is invoked. A test hands in a script; the app has `claude` on PATH. */
  claude?: string
}

/**
 * What an agent can do: everything the chat can, and two more that the chat has not got —
 * a shell in the checkout, and Claude Code in it. The chat is a conversation about a folder
 * of markdown; an agent is somebody you hand work to, and hands are what work takes.
 *
 * Expected failures come back as text rather than thrown, the way the chat's do: the brain
 * reads "command failed: …" and tells you, where an exception ends the turn mid-sentence.
 */
export function agentTools(deps: AgentToolDeps): ToolSet {
  return {
    ...chatTools(deps),

    claude_code: tool({
      description:
        'Hand a task to Claude Code, running in the checkout with the whole disk and a ' +
        'shell. Use it for anything that reads or changes files, writes code or prose, ' +
        'researches across the project, or takes more than one command. Write the task ' +
        'the way you would brief a capable colleague: the goal, what matters, where the ' +
        'result should go. It answers with what it did.',
      inputSchema: z.object({
        task: z.string().describe('the errand, in full'),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(120)
          .optional()
          .describe(`how long it may take; unsaid is ${String(CLAUDE_MINUTES)}`),
      }),
      execute: ({ task, minutes }, { toolCallId, abortSignal }) =>
        watching(deps, trimNote(task), () =>
          runClaude(deps, { task, minutes, toolCallId, signal: abortSignal }),
        ),
    }),

    shell: tool({
      description:
        'Run one shell command in the checkout — ls, git status, grep, a script. Quick ' +
        'things; anything longer than a command is a task for claude_code. Answers with ' +
        'stdout and stderr.',
      inputSchema: z.object({
        command: z.string().describe('the command, as you would type it'),
        minutes: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe(`how long it may take; unsaid is ${String(SHELL_MINUTES)}`),
      }),
      execute: ({ command, minutes }, { abortSignal }) =>
        watching(deps, trimNote(command), async () => {
          const result = await execa('/bin/sh', ['-c', command], {
            cwd: deps.checkout(),
            env: { ...ambient(), ...deps.env() },
            extendEnv: false,
            input: '',
            timeout: (minutes ?? SHELL_MINUTES) * 60_000,
            cancelSignal: abortSignal,
            reject: false,
            stripFinalNewline: false,
          })
          const out = [result.stdout, result.stderr].filter(Boolean).join('\n')
          if (result.failed || result.exitCode !== 0)
            return cut(
              `command failed (exit ${String(result.exitCode ?? '?')}): ${
                out.trim() || result.shortMessage || 'no output'
              }`,
            )
          return cut(out || '(no output)')
        }),
    }),

    list_attachments: tool({
      description:
        'What is in your attachments folder — everything you have made so far, by name.',
      inputSchema: z.object({}),
      execute: async () => {
        const names = await readdir(deps.attachments).catch(() => [] as string[])
        return names.length
          ? names.sort().join('\n')
          : `nothing yet in ${deps.attachments}`
      },
    }),
  }
}

/**
 * An errand run with the checkout watched either side of it. What it changed is filed as one
 * act per path, all naming the same errand: the hands work on the real disk, so this is the
 * only place the app can find out what they did, and the boundary is all it knows.
 *
 * Nothing is filed where nothing differs, and a failed errand is watched like any other — a
 * command that fell over halfway still changed what it changed.
 */
async function watching(
  deps: AgentToolDeps,
  note: string,
  errand: () => Promise<string>,
): Promise<string> {
  if (!deps.noteErrand) return errand()
  const checkout = deps.checkout()
  const before = await marksOf(checkout)
  try {
    return await errand()
  } finally {
    const changed = changedBetween(before, await marksOf(checkout))
    if (changed.length) deps.noteErrand(changed, note)
  }
}

/**
 * One Claude Code errand, headless, in the checkout — the shape of a task's Claude step, with
 * two differences. It wears the agent's persona rather than a node's, so what it writes
 * sounds like the person you asked; and it is watched as it goes: `stream-json` says what the
 * session is doing line by line, and the last thing said becomes the note the step on screen
 * wears, so a twenty-minute errand is not twenty minutes of a spinner.
 */
async function runClaude(
  deps: AgentToolDeps,
  {
    task,
    minutes,
    toolCallId,
    signal,
  }: { task: string; minutes?: number; toolCallId: string; signal?: AbortSignal },
): Promise<string> {
  const system = [
    deps.brief(),
    `## Whose errand this is

You are the hands of ${deps.name}, an agent in this project who was asked to do this in
a chat and handed it to you. Do it fully. Anything you make — a report, a draft, an
export, a script — goes in ${deps.attachments} unless the task says otherwise; make the
folder if it is not there. Edits to documents that already exist stay where they are. When
you are done, say in a few lines what you did and where it is: that is what ${deps.name}
reads back to the person who asked.`,
    deps.persona ? `## Who ${deps.name} is\n\n${deps.persona}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const args = [
    '-p',
    task,
    '--append-system-prompt',
    system,
    '--permission-mode',
    'acceptEdits',
    '--output-format',
    'stream-json',
    '--verbose',
  ]
  const subprocess = execa(deps.claude ?? 'claude', args, {
    cwd: deps.checkout(),
    env: { ...ambient(), ...deps.env() },
    extendEnv: false,
    input: '',
    timeout: (minutes ?? CLAUDE_MINUTES) * 60_000,
    cancelSignal: signal,
    reject: false,
    stripFinalNewline: false,
    // Errors ride out on stderr; the lines are stdout's, and reading only those keeps a
    // warning printed mid-run from being parsed as one.
    all: false,
  })

  let result: string | null = null
  let failed: string | null = null
  const stray: string[] = []
  for await (const line of subprocess) {
    const event = eventOf(line)
    if (!event) {
      if (line.trim()) stray.push(line)
      continue
    }
    if (event.type === 'assistant') {
      const note = noteOf(event)
      if (note) deps.progress?.(toolCallId, note)
    } else if (event.type === 'result') {
      if (event.is_error) failed = event.result ?? 'claude failed'
      else result = event.result ?? ''
    }
  }
  const ended = await subprocess

  if (failed !== null) return cut(`claude failed: ${failed}`)
  if (result !== null) return cut(result || '(claude said nothing)')

  // No result line at all: the session did not get as far as answering.
  const details =
    ended.stderr?.trim() || stray.join('\n').trim() || ended.shortMessage || 'claude failed'
  const hint = /not logged in|no.*api.*key|auth/i.test(details)
    ? ' — Claude not logged in: set ANTHROPIC_API_KEY or run `claude auth login`'
    : ''
  return cut(`claude failed: ${details}${hint}`)
}

interface StreamEvent {
  type: string
  is_error?: boolean
  result?: string
  message?: { content?: { type: string; text?: string; name?: string; input?: unknown }[] }
}

function eventOf(line: string): StreamEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' && 'type' in parsed
      ? (parsed as StreamEvent)
      : null
  } catch {
    return null
  }
}

/** What the session is doing, in a few words: the last thing it said, or the tool it reached
 *  for and what with. */
function noteOf(event: StreamEvent): string | null {
  const content = event.message?.content ?? []
  for (const part of [...content].reverse()) {
    if (part.type === 'tool_use' && part.name) {
      const said = (part.input ?? {}) as Record<string, unknown>
      const what =
        typeof said.command === 'string'
          ? said.command
          : typeof said.file_path === 'string'
            ? path.basename(said.file_path)
            : typeof said.pattern === 'string'
              ? said.pattern
              : typeof said.description === 'string'
                ? said.description
                : ''
      return trimNote(`${part.name}${what ? ` ${what}` : ''}`)
    }
    if (part.type === 'text' && part.text?.trim()) return trimNote(part.text)
  }
  return null
}

function trimNote(text: string): string {
  const line = text.trim().split('\n')[0].trim()
  return line.length > NOTE_MAX ? `${line.slice(0, NOTE_MAX - 1).trimEnd()}…` : line
}

function cut(text: string): string {
  return text.length > MAX_ANSWER
    ? `${text.slice(0, MAX_ANSWER)}\n\n[…cut: the answer was ${String(text.length)} characters]`
    : text
}
