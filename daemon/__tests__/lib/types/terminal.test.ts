import { describe, expect, it } from 'vitest'
import { agentCommand, TERMINAL_KINDS } from '@broodmother/types/terminal'

describe('agentCommand', () => {
  it('hands a plain shell nothing', () => {
    expect(agentCommand('shell')).toBeNull()
  })

  /* The brief reaches the shell in its environment, so the line has to name the variable
     rather than carry the text — and quote it, because it arrives with blank lines in it. */
  it('passes the brief by name, as one argument', () => {
    for (const kind of TERMINAL_KINDS.filter((one) => one !== 'shell'))
      expect(agentCommand(kind)).toContain('"$BROODMOTHER_BRIEF"')
  })

  it('skips the approval prompt in each CLI’s own words', () => {
    expect(agentCommand('claude')).toContain('--dangerously-skip-permissions')
    expect(agentCommand('muse')).toContain('--yolo')
  })
})
