'use client'

import { useEffect, useState } from 'react'
import { DiffEditor } from './editor'
import { basename } from '@broodmother/path'
import type { DocRef } from '@broodmother/types/doc'
import { isImage } from '@broodmother/media'
import type { DiffBasis } from '@broodmother/types/git'
import { useApp } from '@/state'

interface Sides {
  against: string | null
  current: string | null
}

/**
 * One file as the two branches have it, side by side. A side the file is not on is empty
 * rather than missing — that is what an added file looks like against a branch that has
 * never had it, and what a removed one looks like the other way round.
 */
export function DiffView({
  root,
  path,
  against,
  basis,
}: DocRef & {
  /** The branch being compared against, which is the left-hand side. */
  against: string
  /** Which two points, so the pane is reading the same comparison the tree is. */
  basis: DiffBasis
}) {
  const app = useApp()
  const [sides, setSides] = useState<Sides | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A picture has no lines to set beside each other, and reading its bytes as text is how
  // you get a page of replacement characters.
  const picture = isImage(path)

  useEffect(() => {
    if (picture) return
    setSides(null)
    setError(null)
    app.client
      .request('GET /api/diff/file', { root, against, path, basis })
      .then(setSides)
      .catch((cause: Error) => setError(cause.message))
  }, [app.client, root, against, path, basis, picture])

  if (picture)
    return (
      <div className="empty">{basename(path)} is a picture, not lines to compare.</div>
    )
  if (error) return <div className="empty">{error}</div>
  // Blank rather than "loading …": the read lands in a frame or two.
  if (!sides) return <div className="empty" />

  return (
    <article className="doc">
      <div className="doc-body">
        <div className="broodmother-editor">
          <DiffEditor
            against={sides.against ?? ''}
            current={sides.current ?? ''}
            path={path}
          />
        </div>
      </div>
    </article>
  )
}
