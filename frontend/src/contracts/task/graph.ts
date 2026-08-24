import type { Task } from './schema'

/**
 * The order a run walks the graph: layers of node ids, triggers first, every node after
 * everything that feeds it. Null when the graph has a cycle — the editor refuses the edge
 * and the server refuses the run with the same answer.
 */
export function runOrder(task: Task): string[][] | null {
  const waiting = new Map(task.nodes.map((one) => [one.id, 0]))
  for (const edge of task.edges) waiting.set(edge.to, (waiting.get(edge.to) ?? 0) + 1)
  const layers: string[][] = []
  let ready = task.nodes.filter((one) => waiting.get(one.id) === 0).map((one) => one.id)
  let placed = 0
  while (ready.length > 0) {
    layers.push(ready)
    placed += ready.length
    const next: string[] = []
    for (const edge of task.edges) {
      if (!ready.includes(edge.from)) continue
      const left = (waiting.get(edge.to) ?? 0) - 1
      waiting.set(edge.to, left)
      if (left === 0) next.push(edge.to)
    }
    ready = next
  }
  return placed === task.nodes.length ? layers : null
}
