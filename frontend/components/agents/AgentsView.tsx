'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { AgentSummary, NewAgent } from '@broodmother/types/api/agents'
import { useApp } from '@/State'
import { AgentRail } from './AgentRail'
import { AgentHeader, AgentView } from './AgentView'
import { NewAgentDialog } from './NewAgentDialog'

/**
 * The agents page: who this project has hired, the one you are talking to, and the box you
 * say the next thing into.
 *
 * Its own page rather than the foot of the chats, because an agent is not a conversation:
 * a chat is a thing you had and can go back to, and an agent is somebody who is still there
 * whether or not you said anything today. They keep their own tab in the sidebar for the same
 * reason the two lists never sorted together.
 *
 * Per-project, because that is where they are kept — moving project is arriving somewhere
 * else, and the page asks again when you do.
 */
export function AgentsView() {
  const app = useApp()
  const project = app.project?.path ?? null
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [hiring, setHiring] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  /** Bumped when a thread is emptied, so the view over it is made again and reads it again. */
  const [cleared, setCleared] = useState(0)

  const list = useCallback(async () => {
    const answer = await app.client.request('GET /api/agents', null).catch(() => null)
    if (!answer) return null
    setAgents(answer.agents)
    return answer.agents
  }, [app.client])

  // Whose thread was asked for, where somebody arrived by clicking one — the line under a
  // document, saying who last changed it. Only honoured if that agent is still here.
  const asked = useSearchParams().get('agent')

  // Who there is, asked again when the project changes under the page. The first of them is
  // opened on: a rail beside an empty pane is a page asking you to click the only thing on it.
  useEffect(() => {
    let alive = true
    setAgents([])
    setOpen(null)
    void list().then((found) => {
      if (!alive || !found) return
      const wanted = found.find((one) => one.id === asked)
      setOpen(wanted?.id ?? found[0]?.id ?? null)
    })
    return () => {
      alive = false
    }
  }, [list, project, asked])

  const hire = async (input: NewAgent): Promise<string | null> => {
    try {
      const { agent } = await app.client.request('POST /api/agents', input)
      await list()
      setOpen(agent.id)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'could not make an agent'
    }
  }

  const clear = (id: string) => {
    void app.client
      .request('POST /api/agent/clear', { agent: id })
      // The thread is the same place emptied: the view over it is made again to read it again.
      .then(() => setCleared((held) => held + 1))
      .catch(() => setFailed('could not clear that conversation'))
  }

  const retune = (id: string, model: string) => {
    void app.client
      .request('POST /api/agent/model', { agent: id, model })
      .then(() => list())
      .catch(() => setFailed('could not change that model'))
  }

  const fire = (id: string) => {
    void app.client
      .request('DELETE /api/agent', { agent: id })
      .then(() => list())
      .then((left) => {
        if (open === id) setOpen(left?.[0]?.id ?? null)
      })
      .catch(() => setFailed('could not remove that agent'))
  }

  const working = agents.map((one) => ({
    ...one,
    working: app.agentsWorking[one.id] ?? one.working,
  }))
  const agent = working.find((one) => one.id === open) ?? null

  return (
    <div className="chat-page agent-page">
      <AgentRail
        agents={working}
        open={open}
        onOpen={setOpen}
        onNew={() => setHiring(true)}
        onClear={clear}
        onDelete={fire}
      />
      <div className="agent-column">
        {agent && <AgentHeader agent={agent} working={agent.working} />}
        {agent ? (
          <AgentView
            key={`${agent.id}:${String(cleared)}`}
            agent={agent}
            error={failed}
            onModel={(model) => retune(agent.id, model)}
          />
        ) : (
          /* Nobody hired yet, or the last one let go. The rail's own button is the way out
             of this, so the pane says what the page is for and leaves it at that. */
          <section className="chat-main" aria-label="Conversation">
            <p className="chat-notice">
              Nobody here yet. An agent is a persona from this project&rsquo;s{' '}
              <code>.personas/</code> with a name, a face and one thread you hold with them.
            </p>
          </section>
        )}
      </div>
      {hiring && <NewAgentDialog onCreate={hire} onClose={() => setHiring(false)} />}
    </div>
  )
}
