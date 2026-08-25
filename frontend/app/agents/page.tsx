import { Suspense } from 'react'
import { AgentsView } from '@/components/agents/AgentsView'

// The view reads whose thread was asked for out of the query string, and a page that does
// that is a page Next renders on the client.
export default function Page() {
  return (
    <Suspense>
      <AgentsView />
    </Suspense>
  )
}
