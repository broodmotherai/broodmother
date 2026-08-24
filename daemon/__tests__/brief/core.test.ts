import { describe, expect, it } from 'vitest'
import { brief, type BriefState } from '../../src/brief/core'
import { DEFAULT_SOUL } from '../../src/brief/soul'
import { SHAPES, SHAPE_SEED } from '@broodmother/types/canvas/schema'
import { NODE_H, NODE_W } from '@broodmother/types/task/schema'
import { GRID } from '@broodmother/types/grid'

const PROJECT = '/Users/tester/.broodmother/tester/handbook'

const STATE: BriefState = {
  api: 'http://127.0.0.1:3001',
  profile: 'tester',
  soul: null,
  project: { name: 'handbook', path: PROJECT, checkout: `${PROJECT}/local` },
  repos: [
    { name: 'api', path: `${PROJECT}/api/local` },
    { name: 'pipeline', path: `${PROJECT}/pipeline/local` },
  ],
  skills: [],
  personas: [],
  scope: 'repo:api',
  cwd: `${PROJECT}/api/local`,
  sync: 'off',
}

describe('brief', () => {
  it('names the project, every repo and where the shell is standing', () => {
    const text = brief(STATE)

    expect(text).toContain('project  handbook — ~/.broodmother/tester/handbook')
    expect(text).toContain('repo api')
    expect(text).toContain('repo pipeline')
    expect(text).toContain('scope    repo:api')
    expect(text).toContain('cwd      ~/.broodmother/tester/handbook/api/local')
  })

  it('marks the tree the shell is in, and only that one', () => {
    const inRepo = brief(STATE)
      .split('\n')
      .filter((line) => line.includes('you are here'))
    expect(inRepo).toHaveLength(1)
    expect(inRepo[0]).toContain('repo api')

    const inProject = brief({ ...STATE, scope: 'project', cwd: `${PROJECT}/local` })
    const marked = inProject.split('\n').filter((line) => line.includes('you are here'))
    expect(marked).toHaveLength(1)
    expect(marked[0]).toContain('project')
  })

  /* The editor soft-wraps, so a paragraph hard-wrapped to a terminal's width reads back
     full of stray newlines — the one writing habit worth spelling out to every agent. */
  it('tells an agent to write whole paragraphs and leave the wrapping to the editor', () => {
    const text = brief(STATE)

    expect(text).toContain('Write each paragraph as one long line')
    expect(text).toContain('Never hard-wrap prose at a column width')
  })

  it('says so when no project is open, and lists no trees', () => {
    const text = brief({ ...STATE, project: null, repos: [], profile: null })

    expect(text).toContain('none is open yet')
    expect(text).not.toContain('The trees')
    expect(text).toContain('You are running in a terminal inside broodmother')
  })

  it('puts a written soul under the one heading, in place of the default', () => {
    const text = brief({ ...STATE, soul: "# Rules\n\nDon't be cheerful.\n" })

    expect(text).toContain("## Who you are\n\n# Rules\n\nDon't be cheerful.")
    expect(text).not.toContain(DEFAULT_SOUL)
  })

  /* A profile that has never been written a soul is every profile on a fresh machine, so
     the default is what an agent is held to until somebody says otherwise — under the same
     heading a written one gets, being the same thing. */
  it('falls back to the default soul, under the same heading', () => {
    for (const soul of [null, '', '  \n ']) {
      const text = brief({ ...STATE, soul })
      expect(text).toContain(`## Who you are\n\n${DEFAULT_SOUL}`)
    }
  })

  /* The routes an agent is handed are a decision, not everything the router answers: a
     prompt that names the device flow or the delete-everything route is a prompt that
     invites them. */
  it('offers the routes the filesystem cannot replace and no others', () => {
    const text = brief(STATE)

    expect(text).toContain('POST   /api/doc/move')
    expect(text).toContain('GET    /api/links')
    expect(text).toContain('GET /api/config')
    expect(text).toContain("curl -s 'http://127.0.0.1:3001/api/links?path=notes/sync.md'")

    expect(text).not.toContain('/api/data')
    expect(text).not.toContain('/api/profiles')
    expect(text).not.toContain('/api/github')
  })

  /* Branching is the app's rather than git's — a worktree an agent adds itself is a folder
     nothing was ever moved into — so the whole of it is offered, not just the reading. */
  it('hands over the branch routes, not only the ones that read', () => {
    const text = brief(STATE)

    expect(text).toContain('POST   /api/branches ')
    expect(text).toContain('POST   /api/branches/open')
    expect(text).toContain('DELETE /api/branches ')
    expect(text).toContain('GET /api/branches')
  })

  /* An agent has git in the same terminal, so which of the two does a piece of git work is
     the thing to say outright: the routes where there is one, git where there is not. */
  it('sends git work at the routes that do it, and the rest to git', () => {
    const text = brief(STATE)

    expect(text).toContain('run it rather than git')
    expect(text).toContain('/api/sync/now')
    expect(text).toContain('POST /api/sync/clear-conflict')
    expect(text).toContain('POST   /api/git/check')
    expect(text).toContain('GET /api/git ')
    // Nothing syncs a repo, so committing in one is git's, and saying so keeps the rule
    // above from reading as "never touch git".
    expect(text).toContain("A repo's repository is yours")
  })

  it('says in one word whether the project syncs', () => {
    expect(brief(STATE)).toContain('sync     off —')
    expect(brief({ ...STATE, sync: 'on' })).toContain('sync     on —')
    expect(brief({ ...STATE, sync: 'conflicted' })).toContain('sync     conflicted —')
  })

  it('names each skill against its description, under the skills path', () => {
    const text = brief({
      ...STATE,
      skills: [
        { name: 'hello', description: 'prove the skills folder works' },
        { name: 'train-model', description: 'submit a training run' },
      ],
    })

    expect(text).toContain('## Skills')
    expect(text).toContain('~/.broodmother/tester/handbook/local/.skills')
    expect(text).toContain('hello')
    expect(text).toMatch(/train-model\s+submit a training run/)
    expect(text).toContain("read a skill's SKILL.md in full")
  })

  it('renders no skills section at all for a project that carries none', () => {
    expect(brief(STATE)).not.toContain('## Skills')
  })

  /* The two documents that are not prose. An agent told nothing about them writes a task
     out of its own head, and the file it writes is one nothing here can open. */
  it('carries the shape of a task and of a diagram', () => {
    const text = brief(STATE)

    expect(text).toContain('## Tasks and diagrams')
    for (const kind of [
      'trigger.manual',
      'trigger.interval',
      'trigger.time',
      'trigger.file',
      'agent.claude',
      'agent.muse',
      'agent.shell',
    ])
      expect(text).toContain(kind)
    expect(text).toContain('"version": 1')
    for (const kind of [
      'trigger.github.issue',
      'trigger.github.pull',
      'trigger.github.mention',
      'trigger.github.check',
      'agent.github.comment',
      'agent.github.pull',
    ])
      expect(text).toContain(kind)
    // The one file a GitHub action reads that no step wrote.
    expect(text).toContain('github.json')
    expect(text).toContain('[JSON Canvas](https://jsoncanvas.org)')
    expect(text).toContain('{"nodes": [], "edges": []}')
    expect(text).toContain('cannot come back on itself')
  })

  /* A board written off the grid, or at a size nothing else is, reads as a board nobody
     drew — so the numbers the editor uses are the numbers an agent is given. */
  it('gives the measure both boards are laid out on', () => {
    const text = brief(STATE)

    expect(text).toContain(`Both boards stand on a ${GRID}px grid`)
    expect(text).toMatch(new RegExp(`cards\\s+are ${NODE_W}×${NODE_H}`))
    for (const shape of SHAPES) {
      const { width, height } = SHAPE_SEED[shape]
      expect(text).toContain(`${shape.padEnd(12)}${width}×${height}`)
    }
  })

  it('names the voices a task can wear, and says nothing where there are none', () => {
    expect(brief(STATE)).not.toContain('The voices this project carries')

    const text = brief({
      ...STATE,
      personas: [{ name: 'editor', description: 'reads a draft the way a reader would' }],
    })
    expect(text).toMatch(/editor\s+reads a draft the way a reader would/)
  })

  it('offers the routes that run a task and read what it did', () => {
    const text = brief(STATE)

    expect(text).toContain('POST   /api/task/run')
    expect(text).toContain('POST   /api/task/stop')
    expect(text).toContain('GET    /api/task/runs')
    expect(text).toContain('GET    /api/tasks')
    expect(text).toContain('GET    /api/task/log')
    expect(text).toContain('GET    /api/diagrams')
    expect(text).toContain('GET    /api/personas')
  })

  /* With nothing open there is no tree to write a board into, so the section stays away
     the way the trees and the skills do. */
  it('says nothing of either with no project open', () => {
    const text = brief({ ...STATE, project: null, repos: [] })

    expect(text).not.toContain('## Tasks and diagrams')
  })
})

/* The chat page is not a terminal, and a brief that said it was would have the model promise
   things it has no way to do. Everything about the project is the same; what differs is what
   the room has in it. */
describe('the chat surface', () => {
  const CHAT: BriefState = { ...STATE, surface: 'chat', skills: [{ name: 'deploy', description: 'ship it' }] }

  it('says which room it is in, and does not claim a terminal', () => {
    const text = brief(CHAT)
    expect(text).toContain('You are the chat page inside broodmother')
    expect(text).not.toContain('running in a terminal')
    expect(text).toContain('no shell')
  })

  it('leaves out what only a process standing somewhere has', () => {
    const text = brief(CHAT)
    // No working directory to be in, and no shell to run the example in.
    expect(text).not.toContain('cwd')
    expect(text).not.toContain('curl')
    expect(text).not.toContain('log, diff, status, blame')
  })

  it('offers a skill as something to read rather than something to run', () => {
    const text = brief(CHAT)
    expect(text).toContain('deploy')
    expect(text).toContain('You cannot run one from here')
  })

  it('still carries everything about the project a terminal is told', () => {
    const text = brief(CHAT)
    expect(text).toContain('project  handbook — ~/.broodmother/tester/handbook')
    expect(text).toContain('repo api')
    expect(text).toContain('POST   /api/doc/move')
    expect(text).toContain('GET /api/tree')
    // The task and canvas schemas, so it can author a board rather than guess at one.
    expect(text).toContain('trigger.manual')
    // And the soul, which is the profile's own text and the same in either room.
    expect(text).toContain(DEFAULT_SOUL)
  })

  it('tells it the tools are how anything is done', () => {
    const text = brief(CHAT)
    expect(text).toContain('Your tools are how anything gets done here')
    expect(text).toContain('read_doc')
  })
})

/* A coworker is the chat page with hands: the same tools, and a shell and Claude Code in the
   checkout besides — so the brief says where it is standing, and offers a skill and git as
   things it can run. */
describe('the coworker surface', () => {
  const COWORKER: BriefState = {
    ...STATE,
    surface: 'coworker',
    skills: [{ name: 'deploy', description: 'ship it' }],
  }

  it('says which room it is in, and that its tools reach the disk', () => {
    const text = brief(COWORKER)
    expect(text).toContain('You are a coworker inside broodmother')
    expect(text).toContain('`shell` and `claude_code`')
    expect(text).not.toContain('there is no shell')
    expect(text).toContain('cwd')
  })

  it('offers a skill and git as things it can run', () => {
    const text = brief(COWORKER)
    expect(text).toContain('through `shell` or by handing it to `claude_code`')
    expect(text).toContain('log, diff, status, blame')
    // Still reached through tools rather than curl.
    expect(text).toContain('api  GET  /api/links')
    expect(text).not.toContain('curl')
  })
})
