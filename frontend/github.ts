// Contract. See lib/git.ts for why these live here rather than being imported from the daemon.

/** The half of the device flow a browser has to answer: a short code, and where to type it. */
export interface GithubDevice {
  /** Held by the app and sent back while waiting. Never shown — it is not what you type. */
  deviceCode: string
  /** The eight characters you read off the screen and type into GitHub. */
  userCode: string
  verificationUri: string
  /** How long GitHub asks to be left alone between asks. */
  intervalMs: number
}

/** A repository you can push to, as the picker needs it. */
export interface GithubRepo {
  fullName: string
  cloneUrl: string
  private: boolean
  defaultBranch: string
}

/** `owner/name`, which is the whole of what makes a slug one. */
export function isSlug(value: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(value)
}
