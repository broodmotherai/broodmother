import { expect, it } from 'vitest'
import { agentBrief } from '@daemon/features/agents/brief'

const VOICE = {
  name: 'Priya',
  persona: 'research/aggregator',
  personaBody: '# Identity\n\nYou pull things together.',
  profile: 'Ada',
  attachmentsAbs: '/Users/you/.broodmother/you/handbook/local/attachments/priya',
  attachments: 'attachments/priya',
}

const PEER = { name: 'Rafa', purpose: 'keeps the numbers', lead: null }

/* The room, then the person: who they are is the persona's own words, how they talk is what
   no persona says, and where their work goes is spelled out as a path they can hand on. */
it('puts the persona, the voice and the folder after the room', () => {
  const text = agentBrief('## The room', VOICE)
  expect(text.indexOf('## The room')).toBeLessThan(text.indexOf('## Who you are'))
  expect(text).toContain('You are Priya')
  expect(text).toContain('You pull things together.')
  expect(text).toContain('messaging Ada on a work chat')
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

/* Who else is here is in the prompt rather than behind a tool, because an agent that has to
   spend a call to find out its colleagues exist mostly will not. The order is the chart read
   downward, so the shape of the team is read off the list. */
it('names the others, what they are for, and who they report to', () => {
  const text = agentBrief('room', {
    ...VOICE,
    team: {
      lead: 'Sam',
      reports: [],
      everyone: [
        { name: 'Sam', purpose: 'runs the product', lead: null },
        { name: 'Ada', purpose: 'writes the code', lead: 'Sam' },
      ],
    },
  })
  expect(text).toContain('## Who else is here')
  expect(text).toContain('- **Sam** — runs the product')
  expect(text).toContain('- **Ada** — writes the code (reports to Sam)')
  expect(text.indexOf('**Sam**')).toBeLessThan(text.indexOf('**Ada**'))
  expect(text).toContain('`agent_message`')
})

/* Where you stand, and what it means: the chart is only worth stating because of the two
   sentences it earns — hand down, escalate up. */
it('names the lead and the reports, and what each of them is for', () => {
  const text = agentBrief('room', {
    ...VOICE,
    team: { lead: 'Sam', reports: ['Rafa', 'Ada'], everyone: [PEER] },
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
  const text = agentBrief('room', {
    ...VOICE,
    team: { lead: null, reports: [], everyone: [PEER] },
  })
  expect(text).toContain('Nobody in this project reports to anybody yet')
  expect(text).not.toContain('report to you')
  expect(text).not.toContain('widening your own remit')
})

/* Each half of the chart stands on its own: the sentence with no subject is not written. */
it('drops the sentence it has no subject for', () => {
  const under = agentBrief('room', {
    ...VOICE,
    team: { lead: 'Sam', reports: [], everyone: [PEER] },
  })
  expect(under).toContain('You report to Sam.')
  expect(under).toContain('tell Sam rather')
  expect(under).toContain('widening your own remit')
  expect(under).not.toContain('to you, and work that')

  const over = agentBrief('room', {
    ...VOICE,
    team: { lead: null, reports: ['Rafa'], everyone: [PEER] },
  })
  expect(over).toContain('Rafa reports to you')
  expect(over).not.toContain('You report to')
  expect(over).not.toContain('widening your own remit')
})

/* An agent by itself is told about no room: the section is left out whole, the way the app
   brief already leaves out trees and skills when there are none — and with it goes the one
   tool they would have nobody to point at. */
it('leaves the section out entirely when there is nobody else', () => {
  const text = agentBrief('room', VOICE)
  expect(text).not.toContain('## Who else is here')
  expect(text).not.toContain('agent_message')
  expect(text).toContain('## Who you are')
  expect(text).toContain('## How you talk')
})

/* The rule the whole section was written for, and the one thing `who_did`'s own description
   cannot say: what to do once you know whose it is. */
it('says what to do about work that is not yours, without restating who_did', () => {
  const text = agentBrief('room', {
    ...VOICE,
    team: { lead: null, reports: [], everyone: [PEER] },
  })
  expect(text).toContain('Never redo it, and never')
  expect(text).toContain('say what you are blocked on rather than working around it')
  expect(text).not.toContain('who_did')
})
