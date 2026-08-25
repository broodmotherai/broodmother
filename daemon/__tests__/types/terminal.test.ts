import { describe, expect, it } from 'vitest'
import { AGENT_KINDS, agentCommand } from '@daemon/types/terminal'

describe('agentCommand', () => {
  it('hands a plain shell nothing', () => {
    expect(agentCommand('shell')).toBeNull()
  })

  /* The brief reaches the shell in its environment, so the line has to name the variable
     rather than carry the text — and quote it, because it arrives with blank lines in it. */
  it('passes the brief by name, as one argument', () => {
    for (const kind of AGENT_KINDS)
      expect(agentCommand(kind)).toContain('"$BROODMOTHER_BRIEF"')
  })

  it('skips the approval prompt in each CLI’s own words', () => {
    expect(agentCommand('claude')).toContain('--dangerously-skip-permissions')
    expect(agentCommand('muse')).toContain('--yolo')
  })

  /* The line is the whole of what a profile sets, so what it says is what is typed —
     followed by the return that sends it, which is not part of what anybody wrote. */
  it('types the profile’s own line where it has one', () => {
    expect(agentCommand('claude', { claude: 'claude --resume' })).toBe('claude --resume\r')
    // Another agent's line is not this one's.
    expect(agentCommand('muse', { claude: 'claude --resume' })).toContain('muse --yolo')
  })

  /* A box somebody emptied is nobody having written a line, not an agent asked to run
     nothing: an empty command would open a shell that sits there having done nothing. */
  it('falls back to the default for a blank line', () => {
    expect(agentCommand('claude', { claude: '   ' })).toContain(
      '--dangerously-skip-permissions',
    )
    expect(agentCommand('shell', { claude: 'claude --resume' })).toBeNull()
  })
})

