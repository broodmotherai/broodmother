'use client'

import { useState } from 'react'
import { CHAT_PROVIDERS } from '@broodmother/types/api/chat'
import { useApp } from '@/State'
import { Button, LinkButton } from '@/components/core/Button'
import { Input } from '@/components/core/Input'
import { Hint, Section } from './Layout'

/**
 * The keys the chat page speaks with, one row per provider. A key is a password and is kept
 * the way the GitHub token beside it is — in the profile's own file, on the server, at 0600 —
 * so the row can say a provider is connected and never show what it is connected with.
 *
 * A row per provider rather than a field per model: you authenticate with whoever serves the
 * model, once, however many of their models you go on to use.
 */

/* A table of three columns and no chrome: the hairline under each row is the whole grid.
   The last cell holds the buttons and drops both its rule and its right padding, so a row
   of them ends where the column does. */
const head =
  'border-b border-[var(--line)] py-[0.35rem] pr-[0.55rem] text-left text-[0.72rem] font-semibold tracking-[0.04em] text-[var(--faint)] uppercase'

const name =
  'border-b border-[var(--line)] py-[0.45rem] pr-[0.55rem] text-left align-middle text-[0.85rem] font-medium whitespace-nowrap text-foreground'

const cell = 'border-b border-[var(--line)] py-[0.45rem] pr-[0.55rem] align-middle'

const acts = 'flex justify-end gap-[0.35rem] border-b-0 py-[0.45rem] align-middle'

export function ModelKeys() {
  const app = useApp()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  if (!app.profile) return null
  const held = app.profile.models

  const save = async (provider: string) => {
    const key = drafts[provider]?.trim()
    if (!key) return
    setBusy(provider)
    await app.saveModelKey(provider, key)
    setDrafts((all) => ({ ...all, [provider]: '' }))
    setBusy(null)
  }

  return (
    <Section title="Models">
      <Hint>
        What this profile talks to models with. The key is kept in the profile on this machine
        and never leaves the server — switching profile switches whose key, and whose bill, the
        chat page is on.
      </Hint>
      <table className="w-full border-collapse text-[0.85rem]">
        <thead>
          <tr>
            <th scope="col" className={head}>
              Provider
            </th>
            <th scope="col" className={head}>
              Key
            </th>
            {/* The buttons head nothing: a column of them wants a name only if the name
                says something the buttons do not. */}
            <th scope="col" className={head} />
          </tr>
        </thead>
        <tbody>
          {CHAT_PROVIDERS.map((provider) => {
            const connected = held.includes(provider.id)
            return (
              <tr key={provider.id} data-connected={connected ? 'true' : undefined}>
                <th scope="row" className={name}>
                  {provider.label}
                </th>
                <td className={cell}>
                  {connected ? (
                    /* A key that is set is a fact, not a field: there is nothing to read
                       back and nothing to type over. */
                    <span className="[font-family:var(--mono)] text-[0.75rem] text-muted">
                      Connected
                    </span>
                  ) : (
                    /* The field fills its cell, so the row reads as one line rather than a
                       box floating in one. */
                    <Input
                      type="password"
                      className="w-full min-w-[8rem]"
                      aria-label={`${provider.label} key`}
                      placeholder="paste a key"
                      value={drafts[provider.id] ?? ''}
                      onChange={(event) =>
                        setDrafts((all) => ({ ...all, [provider.id]: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void save(provider.id)
                      }}
                    />
                  )}
                </td>
                <td className={acts}>
                  {connected ? (
                    <Button onClick={() => void app.forgetModelKey(provider.id)}>
                      Forget
                    </Button>
                  ) : (
                    <>
                      <LinkButton href={provider.keysUrl}>Get a Key</LinkButton>
                      <Button
                        onClick={() => void save(provider.id)}
                        disabled={busy === provider.id || !drafts[provider.id]?.trim()}
                      >
                        {busy === provider.id ? 'Saving…' : 'Save'}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Section>
  )
}
