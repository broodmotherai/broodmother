import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { WEB_ORIGINS } from '@daemon/constants/server'
import { AppError } from '@daemon/types/error'
import type { AppContext } from './context'
import { mount } from './routes'

export function createApp(ctx: AppContext): Hono {
  const app = new Hono()
  app.use('/api/*', cors({ origin: WEB_ORIGINS }))

  mount(app, ctx)

  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ error: error.message }, error.status)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return c.json({ error: error.message }, 404)
    return c.json({ error: error.message }, 500)
  })

  return app
}
