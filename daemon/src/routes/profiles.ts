import { configured as githubConfigured } from '@daemon/utils/github'
import { identitySchema, machineAuthor, machineSshKey } from '@daemon/utils/profiles'
import { parse, query } from './request'
import type { RouteTable } from './route'
import { modelKeyBody, newProfileBody } from './schemas'

export const profiles = {
  'GET /api/profiles': async (c, ctx) =>
    c.json({
      profiles: await ctx.profiles.list(),
      active: ctx.profile,
      githubReady: githubConfigured(),
      suggestedAuthor: await machineAuthor(ctx.home),
      suggestedSshKey: await machineSshKey(),
    }),

  'POST /api/profiles': async (c, ctx) => {
    const profile = await ctx.profiles.add(await parse(c, newProfileBody))
    return c.json({ profile, project: ctx.project })
  },

  'PUT /api/profiles': async (c, ctx) =>
    c.json({ profile: await ctx.profiles.setIdentity(await parse(c, identitySchema)) }),

  'GET /api/profiles/key': async (c, ctx) => c.json({ publicKey: await ctx.profiles.publicKey() }),

  'POST /api/profiles/key': async (c, ctx) => c.json(await ctx.profiles.addKey()),

  /* A key for one model provider, kept in the profile file the way the GitHub token is. What
     comes back is the profile — which providers are connected, and nothing they connect with. */
  'PUT /api/model-keys': async (c, ctx) => {
    const { provider, key } = await parse(c, modelKeyBody)
    return c.json({ profile: await ctx.profiles.setModelKey(provider, { type: 'key', key }) })
  },

  'DELETE /api/model-keys': async (c, ctx) =>
    c.json({ profile: await ctx.profiles.setModelKey(query(c, 'provider'), null) }),
} satisfies RouteTable
