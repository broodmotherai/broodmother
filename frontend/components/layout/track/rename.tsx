'use client'

import { useEffect, useRef, useState } from 'react'
import type { TreeEntry } from '@broodmother/types/doc'
import { displayName } from '@/components/ui'

/** The name typed into where it shows — a tree row or a tab — editable as far as it is
 *  shown: a note hands back the extension its tag was standing in for, a code file
 *  already wore its own. */
export function RenameRow({
  entry,
  onDone,
}: {
  entry: Pick<TreeEntry, 'kind' | 'name'>
  onDone: (name: string | null) => void
}) {
  const shown = entry.kind === 'file' ? displayName(entry.name) : entry.name
  const extension = entry.name.slice(shown.length)
  const [value, setValue] = useState(shown)
  const input = useRef<HTMLInputElement>(null)
  // Enter commits then blurs, and the blur must not commit again; Escape must not be undone.
  const settled = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    input.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  function finish(name: string | null) {
    if (settled.current) return
    settled.current = true
    onDone(name)
  }

  function typed() {
    return value.trim() ? `${value.trim()}${extension}` : null
  }

  return (
    <input
      ref={input}
      className="name rename"
      aria-label={`Rename ${entry.name}`}
      spellCheck={false}
      autoComplete="off"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      // The row underneath opens a document on click and runs commands on a keypress.
      onClick={(event) => event.stopPropagation()}
      onBlur={() => finish(typed())}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(typed())
        else if (event.key === 'Escape') finish(null)
      }}
    />
  )
}
