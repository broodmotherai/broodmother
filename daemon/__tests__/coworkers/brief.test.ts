import { expect, it } from 'vitest'
import { coworkerBrief } from '../../src/coworkers/brief'

const VOICE = {
  name: 'Priya',
  persona: 'research/aggregator',
  personaBody: '# Identity\n\nYou pull things together.',
  profile: 'Michael',
  attachmentsAbs: '/Users/you/.broodmother/you/handbook/local/attachments/priya',
  attachments: 'attachments/priya',
}

/* The room, then the person: who they are is the persona's own words, how they talk is what
   no persona says, and where their work goes is spelled out as a path they can hand on. */
it('puts the persona, the voice and the folder after the room', () => {
  const text = coworkerBrief('## The room', VOICE)
  expect(text.indexOf('## The room')).toBeLessThan(text.indexOf('## Who you are'))
  expect(text).toContain('You are Priya')
  expect(text).toContain('You pull things together.')
  expect(text).toContain('messaging Michael on a work chat')
  expect(text).toContain('write like a person typing into a chat window')
  expect(text).toContain(VOICE.attachmentsAbs)
  expect(text).toContain('(attachments/priya in the project)')
  expect(text).toContain('`claude_code` and `shell`')
})

/* A persona taken out from under a coworker is said, not swallowed: better a colleague who
   knows their brief has gone than one with no voice at all. */
it('says so when the persona has gone missing', () => {
  const text = coworkerBrief('room', { ...VOICE, personaBody: null, profile: null })
  expect(text).toContain('`research/aggregator` is not in the project')
  expect(text).toContain('messaging the person you work with')
})
