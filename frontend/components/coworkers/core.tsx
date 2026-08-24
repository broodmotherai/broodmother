'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CoworkerSummary, NewCoworker } from '@/src/contracts/api/coworkers'
import { useApp } from '@/state'
import { CoworkerRail } from './rail'
import { CoworkerHeader, CoworkerView } from './view'
import { NewCoworkerDialog } from './hire'

/**
 * The coworkers page: who this project has hired, the one you are talking to, and the box you
 * say the next thing into.
 *
 * Its own page rather than the foot of the chats, because a coworker is not a conversation:
 * a chat is a thing you had and can go back to, and a coworker is somebody who is still there
 * whether or not you said anything today. They keep their own tab in the sidebar for the same
 * reason the two lists never sorted together.
 *
 * Per-project, because that is where they are kept — moving project is arriving somewhere
 * else, and the page asks again when you do.
 */
export function CoworkersView() {
  const app = useApp()
  const project = app.project?.path ?? null
  const [coworkers, setCoworkers] = useState<CoworkerSummary[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [hiring, setHiring] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  /** Bumped when a thread is emptied, so the view over it is made again and reads it again. */
  const [cleared, setCleared] = useState(0)

  const list = useCallback(async () => {
    const answer = await app.client.request('GET /api/coworkers', null).catch(() => null)
    if (!answer) return null
    setCoworkers(answer.coworkers)
    return answer.coworkers
  }, [app.client])

  // Who there is, asked again when the project changes under the page. The first of them is
  // opened on: a rail beside an empty pane is a page asking you to click the only thing on it.
  useEffect(() => {
    let alive = true
    setCoworkers([])
    setOpen(null)
    void list().then((found) => {
      if (alive && found) setOpen(found[0]?.id ?? null)
    })
    return () => {
      alive = false
    }
  }, [list, project])

  const hire = async (input: NewCoworker): Promise<string | null> => {
    try {
      const { coworker } = await app.client.request('POST /api/coworkers', input)
      await list()
      setOpen(coworker.id)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'could not make a coworker'
    }
  }

  const clear = (id: string) => {
    void app.client
      .request('POST /api/coworker/clear', { coworker: id })
      // The thread is the same place emptied: the view over it is made again to read it again.
      .then(() => setCleared((held) => held + 1))
      .catch(() => setFailed('could not clear that conversation'))
  }

  const fire = (id: string) => {
    void app.client
      .request('DELETE /api/coworker', { coworker: id })
      .then(() => list())
      .then((left) => {
        if (open === id) setOpen(left?.[0]?.id ?? null)
      })
      .catch(() => setFailed('could not remove that coworker'))
  }

  const working = coworkers.map((one) => ({
    ...one,
    working: app.coworkersWorking[one.id] ?? one.working,
  }))
  const coworker = working.find((one) => one.id === open) ?? null

  return (
    <div className="chat-page">
      {coworker && <CoworkerHeader coworker={coworker} working={coworker.working} />}
      <div className="chat-body">
        <CoworkerRail
          coworkers={working}
          open={open}
          onOpen={setOpen}
          onNew={() => setHiring(true)}
          onClear={clear}
          onDelete={fire}
        />
        {coworker ? (
          <CoworkerView
            key={`${coworker.id}:${String(cleared)}`}
            coworker={coworker}
            error={failed}
          />
        ) : (
          /* Nobody hired yet, or the last one let go. The rail's own button is the way out
             of this, so the pane says what the page is for and leaves it at that. */
          <section className="chat-main" aria-label="Conversation">
            <p className="chat-notice">
              Nobody here yet. A coworker is a persona from this project&rsquo;s{' '}
              <code>.personas/</code> with a name, a face and one thread you hold with them.
            </p>
          </section>
        )}
      </div>
      {hiring && <NewCoworkerDialog onCreate={hire} onClose={() => setHiring(false)} />}
    </div>
  )
}
