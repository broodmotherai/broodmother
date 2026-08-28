/**
 * Where the site is, for the config and for whatever has to name the same address.
 *
 * The site's port is fixed and no daemon's is: one build serves every worker, and each
 * worker's daemon takes whatever the OS hands it, so the suite is as parallel as the machine
 * is. It is not the port `make dev` uses, so a run and a person's own app can be up at once.
 *
 * Nothing may be imported here. Playwright maps `@daemon/*` for test files and explicitly not
 * for the config or anything the config reaches, and the config reaches this.
 */
export const SITE_PORT = 4343

export const SITE_URL = `http://127.0.0.1:${SITE_PORT}`

/** Both spellings of loopback, because CORS compares the origin as a string. */
export const SITE_ORIGINS = [SITE_URL, `http://localhost:${SITE_PORT}`]
