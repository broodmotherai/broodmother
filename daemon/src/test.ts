import { execa } from 'execa'
import type { ChatPart, ChatStream } from '@daemon/features/chat/model'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const created: string[] = []

export async function tempDir(prefix = 'broodmother-test-'): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)))
  created.push(dir)
  return dir
}

export async function cleanup(): Promise<void> {
  await Promise.all(
    created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
}

export const AUTHOR = ['-c', 'user.name=Test', '-c', 'user.email=test@localhost']

export function git(cwd: string, ...args: string[]) {
  return execa('git', [...AUTHOR, ...args], { cwd })
}

export async function initRepo(dir: string): Promise<void> {
  await git(dir, 'init', '--initial-branch=main')
}

export async function bareRemote(): Promise<string> {
  const dir = await tempDir('broodmother-remote-')
  await execa('git', ['init', '--bare', '--initial-branch=main', dir])
  return dir
}

export async function cloneOf(remote: string): Promise<string> {
  const dir = await tempDir('broodmother-clone-')
  await execa('git', ['clone', remote, dir])
  return dir
}

/** A crontab that is only a string, so no test ever edits the machine's real one. */
export function fakeCrontab() {
  let text = ''
  return {
    read: async () => text,
    write: async (next: string) => {
      text = next
    },
  }
}

/**
 * A model that says what it was told to, so a conversation can be exercised on a machine
 * with no key. One answer per turn, the last one repeating once the script runs out.
 *
 * The words arrive one at a time rather than all at once, because a turn that streams is a
 * turn whatever is reading it has to keep up with — a page that only works when the answer
 * lands whole is a page that works nowhere but here.
 */
export function scriptedStream(...answers: string[]): ChatStream {
  const script = [...answers]
  return async function* (): AsyncIterable<ChatPart> {
    const answer = (script.length > 1 ? script.shift() : script[0]) ?? ''
    for (const word of answer.split(/(?<= )/)) yield { type: 'text', text: word }
  }
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(10)
  }
  throw new Error('condition not met before timeout')
}
