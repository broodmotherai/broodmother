/** Loopback only: there is no auth and full read/write access to the repo. */
export const HOST = '127.0.0.1'
export const PORT = 4242

/** How often a socket is asked whether anything is still on the other end of it. */
export const HEARTBEAT_MS = 30 * 1000

/** `npm run dev` picks its ports at run time and names the origins here; started on its own
 *  the daemon expects the site on the port it always uses. */
export const WEB_ORIGINS = process.env.BROODMOTHER_WEB_ORIGINS
  ? process.env.BROODMOTHER_WEB_ORIGINS.split(',').filter(Boolean)
  : ['http://localhost:4243', 'http://127.0.0.1:4243']
