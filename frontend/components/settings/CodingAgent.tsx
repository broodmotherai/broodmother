'use client'

import { useState } from 'react'
import { useApp } from '@/State'
import { Button } from '@/components/core/Button'
import { Input } from '@/components/core/Input'
import PanelTable, { PanelRow } from '@/components/panels/PanelTable'
import { Hint, Section } from './Layout'

/**
 * The agents that can be given a shell here, one row each, against where each keeps its
 * config. A sign-in like the model keys above rather than something about who you are, which
 * is why it left the profile page to stand with the rest of what the app reaches for.
 *
 * A row per agent rather than a field per setting: what you want to know is which of them are
 * pointed somewhere of this profile's choosing and which are running on whatever they found.
 */

/**
 * What each agent reads its own configuration out of. Claude takes a directory the profile
 * names; muse takes none — `muse exec` runs on whatever login the muse CLI itself holds, so
 * there is nothing here for this profile to point at, and a field offering to would be a
 * setting that changed nothing.
 */
const AGENTS = [
  {
    id: 'claude',
    label: 'Claude',
    env: 'CLAUDE_CONFIG_DIR',
    placeholder: '~/.claude',
  },
  {
    id: 'muse',
    label: 'Muse',
    env: null,
    note: 'Signed in through the muse CLI',
  },
] as const

export function CodingAgent() {
  const app = useApp()
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!app.profile) return null
  const profile = app.profile
  // The saved value until it is typed over, so a row nobody has touched shows what is set
  // rather than an empty box the profile would be written back from.
  const held = profile.claudeCfgDir ?? ''
  const value = draft ?? held

  const save = async () => {
    setBusy(true)
    await app.saveIdentity({
      color: profile.color,
      gitAuthor: profile.gitAuthor,
      sshKeyPath: profile.sshKeyPath,
      claudeCfgDir: value.trim() || null,
      // The rest of the profile is carried through untouched, the way the soul's page
      // carries this one: a page that wrote only its own field would clear the others.
      soul: profile.soul,
    })
    setBusy(false)
    setDraft(null)
  }

  return (
    <Section title="Coding Agent">
      <Hint>
        Where each agent reads its login from. The directory is this profile&rsquo;s, so
        switching profile switches which account the terminals here open as.
      </Hint>

      <PanelTable empty="No coding agents.">
        {AGENTS.map((agent) => (
          <PanelRow
            key={agent.id}
            label={agent.label}
            actions={
              agent.env ? (
                <>
                  <Input
                    className="w-[13rem]"
                    aria-label={`${agent.label} config directory`}
                    placeholder={agent.placeholder}
                    value={value}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void save()
                    }}
                  />
                  <Button onClick={() => void save()} disabled={busy || value === held}>
                    {busy ? 'Saving…' : 'Save'}
                  </Button>
                </>
              ) : (
                /* Not a field left empty — there is no directory to name. Saying so is the
                   row's whole content. */
                <span className="[font-family:var(--mono)] text-[0.75rem] text-muted">
                  {agent.note}
                </span>
              )
            }
          />
        ))}
      </PanelTable>
    </Section>
  )
}
