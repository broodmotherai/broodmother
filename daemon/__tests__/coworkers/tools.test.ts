import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { ToolSet } from 'ai'
import { Tree } from '@broodmother/tree'
import { cleanup, tempDir } from '../../src/test'
import { coworkerTools } from '../../src/coworkers/tools'
import { titleOf } from '../../src/chat/tools'

afterAll(cleanup)

/**
 * A stand-in for the `claude` binary: a script that prints a stream-json session — a look
 * around, a tool reached for, an answer — writes the file it was told to, and says so. What
 * it received rides out to a file beside it, so the test can read what the errand was told.
 */
const FAKE_CLAUDE = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_LOG"
echo '{"type":"system","subtype":"init","cwd":"'"$PWD"'"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at the notes first."}]}}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"'"$FAKE_OUT"'","content":"# One pager"}}]}}'
mkdir -p "$(dirname "$FAKE_OUT")"
echo '# One pager' > "$FAKE_OUT"
echo 'this is not json'
echo '{"type":"result","subtype":"success","is_error":false,"result":"Wrote the one-pager to '"$FAKE_OUT"'."}'
`

async function hands(env: Record<string, string> = {}, opts: { claude?: string } = {}) {
  const dir = await tempDir()
  const checkout = path.join(dir, 'local')
  await mkdir(checkout, { recursive: true })
  const attachments = path.join(checkout, 'attachments', 'priya')
  const claude = path.join(dir, 'claude')
  await writeFile(claude, FAKE_CLAUDE)
  await chmod(claude, 0o755)
  const notes: [string, string][] = []
  const tools = coworkerTools({
    tree: () => new Tree(checkout),
    call: () => Promise.reject(new Error('not here')),
    checkout: () => checkout,
    env: () => ({
      FAKE_LOG: path.join(dir, 'log'),
      FAKE_OUT: path.join(attachments, 'one-pager.md'),
      PATH: process.env.PATH ?? '',
      ...env,
    }),
    brief: () => 'you are inside broodmother',
    persona: 'You are a careful researcher.',
    name: 'Priya',
    attachments,
    progress: (id, note) => notes.push([id, note]),
    claude: opts.claude ?? claude,
  })
  const run = (name: string, input: unknown, toolCallId = 'call-1') =>
    (tools[name as keyof ToolSet]?.execute as (i: unknown, o: unknown) => Promise<string>)(
      input,
      { toolCallId, messages: [], abortSignal: undefined },
    )
  return { tools, run, dir, checkout, attachments, notes }
}

/* The hands are the chat's tools and three more. */
it('has the chat tools and hands besides', async () => {
  const { tools } = await hands()
  expect(Object.keys(tools)).toEqual(
    expect.arrayContaining(['read_doc', 'write_doc', 'api', 'claude_code', 'shell', 'list_attachments']),
  )
})

/* Claude Code is run in the checkout, headless, wearing whose errand it is and the persona;
   what it says as it goes is passed on as notes on the call, and what it says at the end is
   the answer. A line on stdout that is not an event is left alone rather than choked on. */
it('hands an errand to claude, watches it go, and answers with what it said', async () => {
  const { run, dir, attachments, notes } = await hands()
  const answer = await run('claude_code', { task: 'write the one-pager' }, 'call-7')
  expect(answer).toBe(`Wrote the one-pager to ${path.join(attachments, 'one-pager.md')}.`)
  expect(await readFile(path.join(attachments, 'one-pager.md'), 'utf8')).toBe('# One pager\n')

  const args = (await readFile(path.join(dir, 'log'), 'utf8')).split('\n')
  expect(args.slice(0, 2)).toEqual(['-p', 'write the one-pager'])
  const system = args[args.indexOf('--append-system-prompt') + 1]
  expect(system).toContain('you are inside broodmother')
  expect(args).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose']))
  // The system prompt runs over several lines and the log is one arg per line, so the pieces
  // are looked for across the whole of it.
  const whole = args.join('\n')
  expect(whole).toContain('You are the hands of Priya')
  expect(whole).toContain(attachments)
  expect(whole).toContain('You are a careful researcher.')

  expect(notes).toEqual([
    ['call-7', 'Looking at the notes first.'],
    ['call-7', 'Write one-pager.md'],
  ])
})

/* A claude that is not there is an answer in words, not a turn that ends in an exception. */
it('says so when claude cannot be run', async () => {
  const { run } = await hands({}, { claude: '/nowhere/claude' })
  const answer = await run('claude_code', { task: 'anything' })
  expect(answer).toMatch(/^claude failed: /)
})

it('runs a shell command in the checkout and reports failure in words', async () => {
  const { run, checkout } = await hands()
  await writeFile(path.join(checkout, 'a.md'), '')
  expect(await run('shell', { command: 'ls' })).toBe('a.md\n')
  expect(await run('shell', { command: 'pwd' })).toBe(`${checkout}\n`)
  expect(await run('shell', { command: 'echo nope >&2; exit 3' })).toBe(
    'command failed (exit 3): nope',
  )
})

it('lists what is in the attachments folder', async () => {
  const { run, attachments } = await hands()
  expect(await run('list_attachments', {})).toBe(`nothing yet in ${attachments}`)
  await mkdir(attachments, { recursive: true })
  await writeFile(path.join(attachments, 'b.md'), '')
  await writeFile(path.join(attachments, 'a.md'), '')
  expect(await run('list_attachments', {})).toBe('a.md\nb.md')
})

it('titles a hand by what it was handed', () => {
  expect(titleOf('claude_code', { task: 'write the one-pager\nand more' })).toBe(
    'claude: write the one-pager',
  )
  expect(titleOf('shell', { command: 'git status' })).toBe('$ git status')
  expect(titleOf('list_attachments', {})).toBe('list attachments')
})
