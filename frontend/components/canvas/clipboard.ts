'use client'

import { useEffect, useRef } from 'react'
import { freshId, type Canvas } from '@broodmother/types/canvas/schema'
import { parseCanvas, serializeCanvas } from '@broodmother/types/canvas/codec'
import { GRID } from '@/src/surface'
import type { Picked } from './model'

const typing = (el: Element | null) =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable ||
    el.closest('[contenteditable="true"]') !== null)

export function useClipboard({
  canvas,
  picked,
  commit,
  setPicked,
  setOptions,
}: {
  canvas: Canvas | null
  picked: Picked | null
  commit: (next: Canvas) => void
  setPicked: (picked: Picked | null) => void
  setOptions: (open: boolean) => void
}) {
  const held = useRef<Canvas | null>(null)

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (typing(document.activeElement) || !canvas) return
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()

      if (key === 'a') {
        event.preventDefault()
        if (!canvas.nodes.length) return
        setPicked({ kind: 'nodes', ids: canvas.nodes.map((one) => one.id) })
        setOptions(true)
        return
      }

      if ((key === 'c' || key === 'x') && picked?.kind === 'nodes') {
        const ids = new Set(picked.ids)
        const cut: Canvas = {
          nodes: canvas.nodes.filter((one) => ids.has(one.id)),
          edges: canvas.edges.filter(
            (one) => ids.has(one.fromNode) && ids.has(one.toNode),
          ),
        }
        if (!cut.nodes.length) return
        event.preventDefault()
        held.current = structuredClone(cut)
        try {
          await navigator.clipboard?.writeText(serializeCanvas(cut))
        } catch {}
        if (key === 'x') {
          setPicked(null)
          commit({
            nodes: canvas.nodes.filter((one) => !ids.has(one.id)),
            edges: canvas.edges.filter(
              (one) => !ids.has(one.fromNode) && !ids.has(one.toNode),
            ),
          })
        }
        return
      }

      if (key !== 'v') return
      let coming: Canvas | null = held.current
      if (!coming) {
        try {
          const text = await navigator.clipboard?.readText()
          if (text) coming = parseCanvas(text)
        } catch {}
      }
      if (!coming || coming.nodes.length === 0) return
      event.preventDefault()
      const taken = new Set([
        ...canvas.nodes.map((one) => one.id),
        ...canvas.edges.map((one) => one.id),
      ])
      const renamed = new Map<string, string>()
      const nodes = coming.nodes.map((one) => {
        const id = freshId(taken, 'node')
        taken.add(id)
        renamed.set(one.id, id)
        return { ...structuredClone(one), id, x: one.x + GRID * 2, y: one.y + GRID * 2 }
      })
      const edges = coming.edges.map((one) => {
        const id = freshId(taken, 'edge')
        taken.add(id)
        return {
          ...structuredClone(one),
          id,
          fromNode: renamed.get(one.fromNode) ?? one.fromNode,
          toNode: renamed.get(one.toNode) ?? one.toNode,
        }
      })
      commit({ nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] })
      setPicked({ kind: 'nodes', ids: nodes.map((one) => one.id) })
      held.current = structuredClone(coming)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canvas, picked, commit, setPicked, setOptions])
}
