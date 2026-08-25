'use client'

import { useEffect, useRef, useState } from 'react'
import type { GithubDevice } from '@broodmother/types/github'
import { useApp } from '@/State'
import { Button, LinkButton } from '@/components/core/Button'
import { Code, Hint, Row } from './Layout'

type Step = { device: GithubDevice; failed: string | null } | null

/**
 * Signing in without a password, a key, or anything to paste back: GitHub shows the app a
 * short code, you type it into a page in the browser you are already signed in to, and the
 * app collects the answer.
 *
 * What it is for is the two walls a repository puts in front of someone who has never used
 * git from a terminal — having to make the repository on the web first, and having to add a
 * key before anything can be pushed. Connected, both are gone.
 *
 * The flow alone, opened by the row that offers it: whether GitHub is connected is a fact
 * about the profile, read where that row is drawn, so what is left here is the half about
 * getting a code onto the screen and waiting for the browser to answer it.
 */
export function GithubConnect({ onDone }: { onDone: () => void }) {
  const app = useApp()
  const [step, setStep] = useState<Step>(null)
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Asked for once, when the flow opens: opening it is the click that asks. */
  const started = useRef(false)

  // The poll outlives nothing: a panel that is gone has nobody to tell, and a timer that
  // fires into an unmounted tree is a warning in the console at best.
  useEffect(() => {
    return () => {
      if (waiting.current) clearTimeout(waiting.current)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true

    /** Asks once, then again on GitHub's own interval until the browser has answered. */
    const collect = (device: GithubDevice) => {
      waiting.current = setTimeout(() => {
        void app.connectGithub(device.deviceCode).then((answer) => {
          if (answer === true) return onDone()
          if (typeof answer === 'string') return setStep({ device, failed: answer })
          collect(device)
        })
      }, device.intervalMs)
    }

    void app.startGithub().then((device) => {
      if (typeof device === 'string') return onDone()
      setStep({ device, failed: null })
      collect(device)
    })
  }, [app, onDone])

  function stop() {
    if (waiting.current) clearTimeout(waiting.current)
    onDone()
  }

  if (!step) return <Hint>Connecting…</Hint>

  return (
    <>
      <Hint>Type this into GitHub. This page finishes on its own.</Hint>
      <Code>{step.device.userCode}</Code>
      <Row>
        <LinkButton href={step.device.verificationUri}>Open GitHub</LinkButton>
        <Button onClick={stop}>Cancel</Button>
      </Row>
      {step.failed && (
        <p className="field-error" role="alert">
          {step.failed}
        </p>
      )}
    </>
  )
}
