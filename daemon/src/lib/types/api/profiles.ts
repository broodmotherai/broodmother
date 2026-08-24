import type { GitAuthor } from '@broodmother/types/git'
import type { Identity, Profile } from '@broodmother/types/profile'
import type { ProjectSummary } from '@broodmother/types/project'

export interface GetProfiles {
  request: null
  response: {
    profiles: Profile[]
    active: Profile | null // null until a project picks one
    /** Whether this build can connect to GitHub at all. A button that cannot work is worse
     *  than no button, and only a build with a client id can. */
    githubReady: boolean
    /** Who git on this machine says you are, for filling in a profile nobody has made yet.
     *  Null where git has never been told. */
    suggestedAuthor: GitAuthor | null
    /** The key ssh on this machine would use by default, for the same form. Null where
     *  there is none. */
    suggestedSshKey: string | null
  }
}

export interface PostProfiles {
  request: { name: string } & Identity
  response: { profile: Profile; project: ProjectSummary | null } // also selects it, if a project is open
}

export interface PutProfiles {
  request: Identity // the name is the file, so it is not editable here
  response: { profile: Profile }
}

/** Holds a key for one model provider, or replaces the one held. Answers with the profile,
 *  which says which providers are connected and never what with — the same bargain the
 *  GitHub connection makes. */
export interface PutModelKey {
  request: { provider: string; key: string }
  response: { profile: Profile }
}

/** Forgets one provider's key. The rest of the profile is untouched. */
export interface DeleteModelKey {
  request: { provider: string }
  response: { profile: Profile }
}

/** The public half of the profile's key, or null when it has none. Only ever the public
 *  half: the private one stays on disk and has no reason to cross the wire. */
export interface GetProfileKey {
  request: null
  response: { publicKey: string | null }
}

/** Makes one, and points the profile at it. Refuses rather than overwriting a key that is
 *  already there — the one it replaced would stop opening whatever it opened. */
export interface PostProfileKey {
  request: null
  response: { profile: Profile; publicKey: string }
}
