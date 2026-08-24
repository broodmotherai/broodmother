'use client'

import { useEffect, useState } from 'react'
import { tilde } from '@broodmother/path'
import { useApp } from '@/state'
import { Button, LinkButton } from '@/components/ui'
import { Hint, KeyReadout, Row, Section } from './layout'

/** Where the key goes once you have copied it, for the host most people are pasting into.
 *  A link beats a description of where to look. */
const GITHUB_KEYS = 'https://github.com/settings/ssh/new'

/**
 * The key a profile offers, and the one gesture that makes one. broodmother already uses
 * whatever ssh and git have — an agent, a key in `~/.ssh`, a credential helper — so this is
 * for the person who has none of that yet, and it does in one click the two steps that
 * otherwise mean a terminal.
 *
 * Only the public half is ever shown, because only the public half goes anywhere.
 */
export function ProfileKey() {
  const app = useApp()
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const profile = app.profile?.name ?? null

  useEffect(() => {
    if (!profile) return setPublicKey(null)
    void app.client
      .request('GET /api/profiles/key', null)
      .then((result) => setPublicKey(result.publicKey))
      .catch(() => setPublicKey(null))
  }, [app.client, profile])

  if (!app.profile) return null

  async function generate() {
    setBusy(true)
    setFailed(null)
    try {
      const result = await app.client.request('POST /api/profiles/key', null)
      setPublicKey(result.publicKey)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!publicKey) return
    await navigator.clipboard.writeText(publicKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    // Folded into the profile's Git box, so it keeps the box's spacing rather than
    // standing off it the way a section on its own does.
    <Section title="Key" inset>
      {publicKey ? (
        <>
          <Hint>
            The public half. Paste it into your git host and this profile can push. The private
            half stays in {tilde(app.home || '~/.broodmother')}.
          </Hint>
          <KeyReadout>{publicKey}</KeyReadout>
          <Row>
            <Button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy Key'}</Button>
            <LinkButton href={GITHUB_KEYS}>Add to GitHub</LinkButton>
          </Row>
        </>
      ) : (
        <>
          <Hint>
            broodmother already uses whatever ssh and git have on this machine — your agent,
            the keys in <code>~/.ssh</code>, git&rsquo;s credential helper. Make one only if
            you have none, or want this profile to push with its own.
          </Hint>
          <Row>
            <Button onClick={() => void generate()} disabled={busy}>
              {busy ? 'Generating…' : 'Generate a Key'}
            </Button>
          </Row>
        </>
      )}

      {failed && (
        <p className="field-error" role="alert">
          {failed}
        </p>
      )}
    </Section>
  )
}
