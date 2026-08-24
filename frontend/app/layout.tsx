import type { ReactNode } from 'react'
import { Shell } from '@/components/shell/Shell'
import { Tooltips } from '@/components/core/Tooltips'
import { AppProvider } from '@/State'
import './globals.css'

// The window's title, and so the name in the Window menu and the app switcher. Lowercase,
// like the mark on the home pane and the name on the disk image.
export const metadata = { title: 'broodmother' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
        <Tooltips />
      </body>
    </html>
  )
}
