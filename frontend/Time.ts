/**
 * How long ago, in the roundest unit that still says something. Two surfaces ask it — a
 * task's last run, and who last changed the document you are reading — so it is one answer
 * rather than two that drift.
 */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
