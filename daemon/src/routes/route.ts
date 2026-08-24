import type { Context } from 'hono'
import type { ApiRoute } from '@daemon/types/api/routes'
import type { AppContext } from '../context'

export type Handler = (c: Context, ctx: AppContext) => Response | Promise<Response>

/** A domain's routes, keyed the way `ApiRoutes` keys them. `satisfies RouteTable` on each
 *  table keeps the literal keys, which is what lets the registry prove it covers them all. */
export type RouteTable = Partial<Record<ApiRoute, Handler>>
