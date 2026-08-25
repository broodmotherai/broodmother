import { parse, query } from './request'
import type { RouteTable } from './route'
import {
  agentBody,
  agentLeadBody,
  agentModelBody,
  agentPlaceBody,
  newAgentBody,
} from './schemas'

export const agents = {
  'GET /api/agents': (c, ctx) => c.json(ctx.agents.list()),

  'POST /api/agents': async (c, ctx) =>
    c.json({ agent: await ctx.agents.create(await parse(c, newAgentBody)) }),

  'DELETE /api/agent': (c, ctx) => {
    ctx.agents.remove(query(c, 'agent'))
    return c.json({ ok: true } as const)
  },

  'POST /api/agent/clear': async (c, ctx) => {
    ctx.agents.clear((await parse(c, agentBody)).agent)
    return c.json({ ok: true } as const)
  },

  'POST /api/agent/model': async (c, ctx) => {
    const { agent, model } = await parse(c, agentModelBody)
    return c.json({ agent: ctx.agents.setModel(agent, model) })
  },

  'GET /api/agents/org': (c, ctx) => c.json(ctx.agents.org()),

  'POST /api/agent/lead': async (c, ctx) => {
    const { agent, lead } = await parse(c, agentLeadBody)
    ctx.agents.setLead(agent, lead)
    return c.json({ ok: true } as const)
  },

  'POST /api/agent/place': async (c, ctx) => {
    const { agent, x, y } = await parse(c, agentPlaceBody)
    ctx.agents.place(agent, x, y)
    return c.json({ ok: true } as const)
  },
} satisfies RouteTable
