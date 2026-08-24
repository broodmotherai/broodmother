import { startServer } from './server'

/** `npm run dev` hands out ports so two checkouts can run at once; alone, the usual one. */
const port = process.env.BROODMOTHER_PORT ? Number(process.env.BROODMOTHER_PORT) : undefined

const { url, context } = await startServer({ port })
const where = context.config.projectPath ?? `no project yet — set one up in ${context.home}`
console.log(`broodmother server on ${url} — ${where}`)
