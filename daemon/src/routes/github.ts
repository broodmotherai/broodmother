import { parse } from './request'
import type { RouteTable } from './route'
import { deviceCodeBody, newGithubRepoBody } from './schemas'

export const github = {
  /* Signing in is two requests: one that opens a code, and one asked again while the browser
     is being answered. Holding a request open for as long as someone takes to find their
     password is a request nobody can tell from a hang. */
  'POST /api/github/device': async (c, ctx) => c.json(await ctx.profiles.startGithub()),

  'POST /api/github/connect': async (c, ctx) => {
    const { deviceCode } = await parse(c, deviceCodeBody)
    return c.json(await ctx.profiles.connectGithub(deviceCode))
  },

  'DELETE /api/github': async (c, ctx) => c.json({ profile: await ctx.profiles.disconnectGithub() }),

  'GET /api/github/repos': async (c, ctx) => c.json({ repos: await ctx.profiles.githubRepos() }),

  'POST /api/github/repos': async (c, ctx) =>
    c.json({ repo: await ctx.profiles.createGithubRepo(await parse(c, newGithubRepoBody)) }),
} satisfies RouteTable
