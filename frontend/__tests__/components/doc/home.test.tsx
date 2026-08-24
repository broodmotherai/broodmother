import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { HomeView } from '@/components/doc/home'

/* The pane used to say ⌘K opened everything without saying what it opened, and nothing at
   all about the other keys. */
it('names the keys the app is worked by, and what each does', () => {
  render(<HomeView />)

  expect(screen.getByText('⌘K')).toBeInTheDocument()
  expect(screen.getByText(/Search every document/)).toBeInTheDocument()
  expect(screen.getByText('⌘J')).toBeInTheDocument()
  expect(screen.getByText(/terminal/)).toBeInTheDocument()
  expect(screen.getByText('⌘⇧S')).toBeInTheDocument()
  expect(screen.getByText(/sync the project now/i)).toBeInTheDocument()
})

/* A command reachable only through ⌘K stays there: a second list of those here is one
   that goes stale. What earns a line is a chord of its own. */
it('says nothing about the commands that have no key', () => {
  render(<HomeView />)
  expect(screen.queryByText('Settings')).not.toBeInTheDocument()
  expect(screen.queryByText('New note')).not.toBeInTheDocument()
})
