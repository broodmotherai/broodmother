import type { Profile } from '@daemon/types/profile'
import type { GithubDevice, GithubRepo } from '../github'

/** Opens the device flow: what comes back is a code and the page to type it into. */
export interface PostGithubDevice {
  request: null
  response: GithubDevice
}

/**
 * One ask for the answer to a code. `pending` is the ordinary case — it means the browser
 * has not been through it yet, and the app asks again after the interval it was given.
 */
export interface PostGithubConnect {
  request: { deviceCode: string }
  response: { pending: boolean; profile: Profile }
}

export interface DeleteGithub {
  request: null
  response: { profile: Profile }
}

export interface GetGithubRepos {
  request: null
  response: { repos: GithubRepo[] } // only ones this connection can push to
}

export interface PostGithubRepos {
  request: { name: string; private: boolean }
  response: { repo: GithubRepo }
}
