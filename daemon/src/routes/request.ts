import type { Context } from 'hono'
import type { z } from 'zod'
import { AppError } from '@daemon/types/error'
import type { DocRoot } from '@daemon/services/Tree'
import type { DiffBasis } from '@daemon/utils/git'
import { ACTOR_HEADER, parseActor, type Actor } from '@daemon/types/ledger'
import { rootSchema } from './schemas'

export class BadRequest extends AppError {}

export async function parse<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const raw = await c.req.json().catch(() => {
    throw new BadRequest('body must be JSON')
  })
  const result = schema.safeParse(raw)
  if (!result.success)
    throw new BadRequest(result.error.issues.map((i) => i.message).join('; '))
  return result.data
}

export function query(c: Context, name: string): string {
  const value = c.req.query(name)
  if (!value) throw new BadRequest(`missing ${name}`)
  return value
}

/** Which tree a GET is asking about. Every read names one, the same way every write does. */
export function root(c: Context): DocRoot {
  const result = rootSchema.safeParse(c.req.query('root'))
  if (!result.success) throw new BadRequest('root must be "project" or "repo:<name>"')
  return result.data
}

/** Who says they are doing this, for the ledger. The header is a claim and is read as one:
 *  an absent one is a person, which is what the editor's save is, and one that will not parse
 *  is nobody rather than a guess. */
export function actor(c: Context): Actor {
  return parseActor(c.req.header(ACTOR_HEADER))
}

/** Which two points a comparison is between. Unsaid is the branches as they stand, which is
 *  what the app opens on and what every caller before this one meant. */
export function basis(c: Context): DiffBasis {
  return c.req.query('basis') === 'split' ? 'split' : 'now'
}
