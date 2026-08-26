'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useApp } from '@/State'
import { Icon } from '@/components/core/Icons'
import { docRoute } from '@/components/shell/ScopeTabs'

/** How long an untouched popup stands before retiring into the badge. */
const RETIRE_MS = 8000

/**
 * Mother's popup: one suggestion at most, bottom-right, staged the ProactiveVA way.
 * Untouched for a few seconds it retires into the badge on her row rather than vanishing —
 * expiry is recorded, and the badge is how a missed popup is still findable. Accepting
 * navigates to the anchor; both answers are recorded, and the record moves her gate.
 */
export function MotherPopup() {
  const app = useApp()
  const router = useRouter()
  const pathname = usePathname()
  const suggestion = app.motherSuggestion
  const fresh = suggestion && !suggestion.verdict ? suggestion : null

  useEffect(() => {
    if (!fresh) return
    const timer = setTimeout(() => void app.answerMother(fresh.id, 'expired'), RETIRE_MS)
    return () => clearTimeout(timer)
    // The timer belongs to the suggestion, not to the render: a new one restarts it, and
    // the same one re-rendered does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh?.id])

  // Her own page already shows everything, popup included, so nothing floats over it.
  if (!fresh || pathname === '/mother') return null

  const accept = () => {
    void app.answerMother(fresh.id, 'accepted')
    router.push(fresh.ref ? docRoute(fresh.ref) : '/mother')
  }

  return (
    <aside className="mother-popup" role="status" aria-label="Mother suggests">
      <header>
        <Icon name="spider" />
        <span className="mother-popup-title">Mother</span>
        {fresh.ref && (
          <button
            type="button"
            className="mother-popup-anchor"
            onClick={() => router.push(docRoute(fresh.ref!))}
          >
            {fresh.ref.path}
          </button>
        )}
      </header>
      <p>{fresh.text}</p>
      <div className="mother-popup-actions">
        <button type="button" onClick={accept}>
          Accept
        </button>
        <button
          type="button"
          onClick={() => void app.answerMother(fresh.id, 'dismissed')}
        >
          Dismiss
        </button>
      </div>
    </aside>
  )
}
