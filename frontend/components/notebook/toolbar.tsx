'use client'

import type { NotebookCell } from '@broodmother/notebook/codec'
import type { KernelState } from '@broodmother/types/api/kernel'
import { Icon } from '@/components/ui'

export function Toolbar({
  state,
  detail,
  onAdd,
}: {
  state: KernelState
  detail: string
  onAdd: (type: NotebookCell['type']) => void
}) {
  const dead = state === 'dead'
  const why = dead ? detail : undefined
  return (
    <div className="notebook-bar">
      <button
        type="button"
        className="notebook-button"
        data-tip="add code cell"
        aria-label="add code cell"
        onClick={() => onAdd('code')}
      >
        <Icon name="terminal" />
      </button>
      <button
        type="button"
        className="notebook-button"
        data-tip="add markdown cell"
        aria-label="add markdown cell"
        onClick={() => onAdd('markdown')}
      >
        <Icon name="file-text" />
      </button>
      <button
        type="button"
        className="notebook-button"
        disabled={dead}
        data-tip={why ?? 'run all cells'}
        aria-label="run all cells"
      >
        <Icon name="chevrons-right" />
      </button>
      <button
        type="button"
        className="notebook-button"
        disabled={dead}
        data-tip={why ?? 'interrupt the kernel'}
        aria-label="interrupt the kernel"
      >
        <Icon name="square" />
      </button>
      <button
        type="button"
        className="notebook-button"
        disabled={dead}
        data-tip={why ?? 'restart the kernel'}
        aria-label="restart the kernel"
      >
        <Icon name="rotate-ccw" />
      </button>
      <span className="notebook-kernel" data-state={state}>
        {dead ? detail : state}
      </span>
    </div>
  )
}
