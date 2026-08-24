import { parse, query } from './request'
import type { RouteTable } from './route'
import { newProjectBody, openProjectBody, pickProfileBody } from './schemas'

export const projects = {
  'GET /api/projects': async (c, ctx) =>
    c.json({ home: ctx.home, projects: await ctx.workspace.listProjects(), active: ctx.project }),

  'POST /api/projects': async (c, ctx) => {
    const project = await ctx.workspace.addProject(await parse(c, newProjectBody))
    return c.json({ project, config: ctx.config })
  },

  'POST /api/projects/open': async (c, ctx) => {
    const { path } = await parse(c, openProjectBody)
    return c.json({ config: await ctx.workspace.openProject(path) })
  },

  'PUT /api/projects': async (c, ctx) => {
    const { profile } = await parse(c, pickProfileBody)
    return c.json({ project: await ctx.profiles.select(profile) })
  },

  'DELETE /api/projects': async (c, ctx) => {
    const active = await ctx.workspace.removeProject(query(c, 'name'))
    return c.json({ active, config: ctx.config })
  },
} satisfies RouteTable
