import { expect, it } from 'vitest'
import { agentBrief } from '@daemon/features/agents/brief'

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
  const text = agentBrief('## The room', VOICE)
  expect(text.indexOf('## The room')).toBeLessThan(text.indexOf('## Who you are'))
  expect(text).toContain('You are Priya')
  expect(text).toContain('You pull things together.')
  expect(text).toContain('messaging Michael on a work chat')
  expect(text).toContain('write like a person typing into a chat window')
  expect(text).toContain(VOICE.attachmentsAbs)
  expect(text).toContain('(attachments/priya in the project)')
  expect(text).toContain('`claude_code` and `shell`')
})

/* A persona taken out from under an agent is said, not swallowed: better a colleague who
   knows their brief has gone than one with no voice at all. */
it('says so when the persona has gone missing', () => {
  const text = agentBrief('room', { ...VOICE, personaBody: null, profile: null })
  expect(text).toContain('`research/aggregator` is not in the project')
  expect(text).toContain('messaging the person you work with')
})

/* Where you stand, and what it means: the chart is only worth stating because of the two
   sentences it earns — hand down, escalate up. */
it('names the lead and the reports, and what each of them is for', () => {
  const text = agentBrief('room', {
    ...VOICE,
    team: { lead: 'Sam', reports: ['Rafa', 'Ada'] },
  })
  expect(text.indexOf('## Who you are')).toBeLessThan(text.indexOf('## Who else is here'))
  expect(text.indexOf('## Who else is here')).toBeLessThan(text.indexOf('## How you talk'))
  expect(text).toContain('You report to Sam.')
  expect(text).toContain('Rafa and Ada report to you')
  expect(text).toContain('rather than to your own hands')
  expect(text).toContain('tell Sam rather')
  expect(text).toContain('widening your own remit')
})

/* A project where nobody has drawn a line is the ordinary state of a small one, so it reads
   as an invitation to the chart rather than as a gap. */
it('says everyone is a peer where nobody reports to anybody', () => {
  const text = agentBrief('room', { ...VOICE, team: { lead: null, reports: [] } })
  expect(text).toContain('Nobody in this project reports to anybody yet')
  expect(text).not.toContain('report to you')
  expect(text).not.toContain('widening your own remit')
})

/* Each half of the chart stands on its own: the sentence with no subject is not written. */
it('drops the sentence it has no subject for', () => {
  const under = agentBrief('room', { ...VOICE, team: { lead: 'Sam', reports: [] } })
  expect(under).toContain('You report to Sam.')
  expect(under).toContain('tell Sam rather')
  expect(under).toContain('widening your own remit')
  expect(under).not.toContain('to you, and work that')

  const over = agentBrief('room', { ...VOICE, team: { lead: null, reports: ['Rafa'] } })
  expect(over).toContain('Rafa reports to you')
  expect(over).not.toContain('You report to')
  expect(over).not.toContain('widening your own remit')
})

/* An agent by itself is told about no room: the section is left out whole, the way the app
   brief already leaves out trees and skills when there are none. */
it('leaves the section out entirely when there is nobody else', () => {
  const text = agentBrief('room', VOICE)
  expect(text).not.toContain('## Who else is here')
  expect(text).toContain('## Who you are')
  expect(text).toContain('## How you talk')
})

/* The rule the whole section was written for, and the one thing `who_did`'s own description
   cannot say: what to do once you know whose it is. */
it('says what to do about work that is not yours, without restating who_did', () => {
  const text = agentBrief('room', { ...VOICE, team: { lead: null, reports: [] } })
  expect(text).toContain('Never redo it, and never')
  expect(text).toContain('say what you are blocked on rather than working around it')
  expect(text).not.toContain('who_did')
})
