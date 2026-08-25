'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type {
  MotherItem,
  MotherSettings,
  RuleStatus,
  SuggestionVerdict,
} from '@broodmother/types/api/mother'
import { useApp } from '@/State'
import { docRoute } from '@/components/shell/ScopeTabs'
import { ago } from '@/Time'

const POLL_MS = 2000

interface MotherStatus {
  settings: MotherSettings
  rules: RuleStatus[]
  items: MotherItem[]
  sweptAt: number | null
}

/**
 * The Mother page: everything she has been doing in the background. The feed is each
 * moment's whole story — noticed, then held or deliberated, then said or kept quiet, with
 * the record where one was written — and the knobs are PRISM's, worn as UI: the frequency
 * slider is C_FA, each rule has a switch, and turning her off entirely is one more.
 */
export function MotherView() {
  const app = useApp()
  const router = useRouter()
  const [status, setStatus] = useState<MotherStatus | null>(null)
  /** The slider mid-drag, before the write goes out on release. */
  const [sliding, setSliding] = useState<number | null>(null)
  const [sweeping, setSweeping] = useState(false)

  useEffect(() => {
    let alive = true
    const ask = () => {
      void app.client
        .request('GET /api/mother', null)
        .then((result) => alive && setStatus(result))
        .catch(() => null)
    }
    ask()
    const timer = setInterval(ask, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [app.client])

  const configure = (input: { on?: boolean; cfa?: number; rules?: Record<string, boolean> }) =>
    void app.client
      .request('PUT /api/mother/settings', input)
      .then((result) =>
        setStatus((held) => (held ? { ...held, ...result } : held)),
      )
      .catch(() => null)

  const answer = (suggestion: string, verdict: SuggestionVerdict) =>
    void app.answerMother(suggestion, verdict).then(() =>
      app.client
        .request('GET /api/mother', null)
        .then(setStatus)
        .catch(() => null),
    )

  const sweepNow = () => {
    setSweeping(true)
    void app.client
      .request('POST /api/mother/sweep', null)
      .then(({ sweptAt }) =>
        setStatus((held) => (held ? { ...held, sweptAt } : held)),
      )
      .catch(() => null)
      .finally(() => setSweeping(false))
  }

  if (!status) return <div className="tasks-page mother-page" />
  const { settings, rules, items, sweptAt } = status
  const now = Date.now()
  const cfa = sliding ?? settings.cfa

  return (
    <div className="tasks-page mother-page">
      <section aria-label="mother">
        <h2>Mother</h2>
        <p className="tasks-dim">
          She watches everything already flowing through the project — runs, agents, sync,
          the records — and, rarely and well, suggests the next thing worth doing. She is
          judged by the popups she does not show.
        </p>
        <div className="mother-controls">
          <label className="mother-switch">
            <input
              type="checkbox"
              checked={settings.on}
              onChange={(event) => configure({ on: event.target.checked })}
            />
            watching
          </label>
          <label className="mother-slider" data-tip="Right is quieter: a false alarm costs more, and the bar for speaking rises everywhere">
            <span className="tasks-dim">chatty</span>
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.05}
              value={cfa}
              disabled={!settings.on}
              onChange={(event) => setSliding(Number(event.target.value))}
              onPointerUp={() => {
                if (sliding !== null) configure({ cfa: sliding })
                setSliding(null)
              }}
            />
            <span className="tasks-dim">quiet</span>
          </label>
          <span className="tasks-dim">
            {sweptAt === null ? 'no sweep yet' : `last sweep ${ago(sweptAt, now)}`}
          </span>
          <button type="button" disabled={sweeping || !settings.on} onClick={sweepNow}>
            {sweeping ? 'sweeping…' : 'Sweep now'}
          </button>
        </div>
        {rules.length > 0 && (
          <ul className="mother-rules" aria-label="Rules">
            {rules.map((rule) => (
              <li key={rule.rule}>
                <label className="mother-switch">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) =>
                      configure({ rules: { [rule.rule]: event.target.checked } })
                    }
                  />
                  {rule.rule}
                </label>
                <span className="tasks-dim">
                  {rule.accepted}/{rule.shown} accepted
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="what mother has seen">
        <h2>Seen</h2>
        {items.length === 0 && (
          <p className="tasks-empty">
            All quiet. What she notices lands here — what she said, and what she kept to
            herself.
          </p>
        )}
        {items.length > 0 && (
          <ol className="tasks-log mother-feed">
            {items.map(({ moment, suggestion }) => (
              <li key={moment.id}>
                <div className="mother-item">
                  <span className="mother-outcome" data-outcome={moment.outcome}>
                    {moment.outcome}
                  </span>
                  <span className="mother-rule">{moment.rule}</span>
                  {moment.ref && (
                    <button
                      type="button"
                      className="mother-anchor"
                      onClick={() => router.push(docRoute(moment.ref!))}
                    >
                      {moment.ref.path}
                    </button>
                  )}
                  <span className="tasks-dim">{ago(moment.seenAt, now)}</span>
                </div>
                <p className="mother-evidence">{moment.evidence}</p>
                {suggestion && (
                  <div className="mother-said">
                    <p>{suggestion.text}</p>
                    {suggestion.record && (
                      <button
                        type="button"
                        className="mother-anchor"
                        onClick={() =>
                          router.push(docRoute({ root: 'project', path: suggestion.record! }))
                        }
                      >
                        {suggestion.record}
                      </button>
                    )}
                    {suggestion.verdict === 'accepted' || suggestion.verdict === 'dismissed' ? (
                      <span className="tasks-dim">{suggestion.verdict}</span>
                    ) : (
                      <span className="mother-said-actions">
                        <button
                          type="button"
                          onClick={() => answer(suggestion.id, 'accepted')}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => answer(suggestion.id, 'dismissed')}
                        >
                          Dismiss
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
