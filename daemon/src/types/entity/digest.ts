/**
 * What makes "have I written this before" answerable.
 *
 * Apart from the codec because the hash is the daemon's and the codec is everybody's: the
 * browser reads a record the same way the server writes one, and `node:crypto` would be the
 * one import that stopped it. The source keeps the same seam — `entity.go` says what a
 * record is, `digest.go` says what it hashes to.
 */

import { createHash } from 'node:crypto'
import { canonicalOf } from './codec'
import type { Entity } from './schema'

export function digestOf(entity: Entity): string {
  return createHash('sha256').update(canonicalOf(entity)).digest('hex')
}
