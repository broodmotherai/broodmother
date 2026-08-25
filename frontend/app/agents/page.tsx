import { Suspense } from 'react'
import { AgentsView } from '@/components/agents/AgentsView'
/* The page reads `?agent=` for who to open on, which is a thing only the browser knows —
   so the render waits for it rather than being prerendered without it. */
export default function Page() {
  return (
    <Suspense>
      <AgentsView />
    </Suspense>
  )
}
