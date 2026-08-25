import { Suspense } from 'react'
import { ChatView } from '@/components/chat/ChatView'

// The view reads which conversation was asked for out of the query string, and a page that
// does that is a page Next renders on the client.
export default function Page() {
  return (
    <Suspense>
      <ChatView />
    </Suspense>
  )
}
