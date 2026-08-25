'use client'

import { useEffect, useState } from 'react'
import type { DocRef } from '@broodmother/types/doc'
import { fileUrl } from '@/src/services/ApiDataSource'

/**
 * An image is opened by looking at it. There is nothing to edit and nothing to save, so
 * what the pane holds is the picture, its size, and room around it.
 */
export function ImageView({ root, path, revision }: DocRef & { revision: number }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setSize(null)
    setFailed(false)
  }, [path, revision])

  if (failed)
    return <div className="empty">{path.split('/').pop()} could not be read</div>

  return (
    <div className="image-view">
      <img
        // The file is on disk and can be written from anywhere; the revision changes when
        // the watcher says this file did, which is what makes the browser fetch it again.
        src={`${fileUrl({ root, path })}&v=${revision}`}
        alt={path.split('/').pop() ?? path}
        onLoad={(event) =>
          setSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        onError={() => setFailed(true)}
      />
      {size && (
        <p className="image-meta">
          {size.width} × {size.height}
        </p>
      )}
    </div>
  )
}
