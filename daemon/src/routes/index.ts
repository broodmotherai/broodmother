import type { Hono } from 'hono'
import type { ApiRoute } from '@daemon/types/api/routes'
import type { AppContext } from '../context'
import { activity } from './activity'
import { branches } from './branches'
import { chat } from './chat'
import { agents } from './agents'
import { diff } from './diff'
import { docs } from './docs'
import { entities } from './entities'
import { git } from './git'
import { github } from './github'
import { ledger } from './ledger'
import { mother } from './mother'
import { profiles } from './profiles'
import { projects } from './projects'
import { repos } from './repos'
import type { Handler } from './route'
import { tasks } from './tasks'

const TABLES = [
  activity,
  branches,
  chat,
  agents,
  diff,
  docs,
  entities,
  git,
  github,
  ledger,
  mother,
  profiles,
  projects,
  repos,
  tasks,
]

type Registered =
  | keyof typeof activity
  | keyof typeof branches
  | keyof typeof chat
  | keyof typeof agents
  | keyof typeof diff
  | keyof typeof docs
  | keyof typeof entities
  | keyof typeof git
  | keyof typeof github
  | keyof typeof ledger
  | keyof typeof mother
  | keyof typeof profiles
  | keyof typeof projects
  | keyof typeof repos
  | keyof typeof tasks

/** The route table and the type table are one list written twice, and these two lines are
 *  what keeps them the same list: a route nobody typed, or a type nobody serves, fails here
 *  by name rather than at the first request that asks for it. */
type Assert<T extends never> = T
type _NoneUnserved = Assert<Exclude<ApiRoute, Registered>>
type _NoneUntyped = Assert<Exclude<Registered, ApiRoute>>

export function mount(app: Hono, ctx: AppContext): void {
  for (const table of TABLES)
    for (const [key, handler] of Object.entries(table) as [ApiRoute, Handler][]) {
      const [method, path] = key.split(' ')
      app.on(method, path, (c) => handler(c, ctx))
    }
}
