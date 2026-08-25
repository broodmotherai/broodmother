import path from 'node:path'
import type { BroodmotherConfig } from '@daemon/types/config'
import { NoProfileError } from '@daemon/types/error'
import type { GithubDevice, GithubRepo } from '@daemon/types/github'
import type { Identity, Profile } from '@daemon/types/profile'
import type { ProjectSummary } from '@daemon/types/project'
import {
  GithubError,
  createRepo as createGithubRepo,
  login as githubLogin,
  poll as githubPoll,
  repos as githubRepos,
  startDevice,
} from '@daemon/utils/github'
import {
  ProfileError,
  createProfile,
  findProfile,
  generateKey,
  keyFile,
  listProfiles,
  profileDir,
  readAccount,
  readModelKeys,
  readPublicKey,
  writeAccount,
  writeIdentity,
  writeModelKey,
  type ModelKey,
  type ModelKeys,
} from '@daemon/utils/profiles'
import { listProjects } from '@daemon/utils/project'

export interface ProfileDeps {
  home: string
  config(): BroodmotherConfig
  save(config: BroodmotherConfig): Promise<BroodmotherConfig>
  /** The key a checkout's git offers is fixed when it opens, so anything that changes the
   *  key, the token or the identity reopens the project behind it. */
  reopen(projectPath: string | null): Promise<void>
  /** Whose Claude sessions to watch, once the profile saying where they live has changed. */
  followActivity(): Promise<void>
  project(): ProjectSummary | null
}

/**
 * Who the daemon is working as: the profile on disk, the GitHub token it pushes with and
 * the model keys it speaks with. The last two are held rather than read per use — a git
 * command per file read and a disk read per streamed token is what reading them costs.
 */
export class ProfileService {
  private profile: Profile | null = null
  private hostToken: string | null = null
  private modelKeys: ModelKeys = {}

  constructor(private readonly deps: ProfileDeps) {}

  get active(): Profile | null {
    return this.profile
  }

  get token(): string | null {
    return this.hostToken
  }

  get keys(): ModelKeys {
    return this.modelKeys
  }

  get dir(): string | null {
    return this.profile ? profileDir(this.profile) : null
  }

  /** Throws rather than returning null: nothing that commits works without an identity. */
  get require(): Profile {
    if (!this.profile)
      throw new NoProfileError('no profile yet — pick one for this project first')
    return this.profile
  }

  list(): Promise<Profile[]> {
    return listProfiles(this.deps.home)
  }

  /** A profile made from the project menu is one you meant to work as, so it is worked as on
   *  the spot. It holds no projects yet, which is the first-run state with a name on it. */
  async add(input: { name: string } & Identity): Promise<Profile> {
    const profile = await createProfile(input, this.deps.home)
    await this.use(profile)
    return profile
  }

  /** Working as someone else is standing in their folder, so what opens is one of their
   *  projects. Null when they have none yet, which is where a new profile starts. */
  async select(name: string): Promise<ProjectSummary | null> {
    const profile = await findProfile(name, this.deps.home)
    if (!profile) throw new ProfileError(`no profile named "${name}"`)
    await this.use(profile)
    return this.deps.project()
  }

  async setIdentity(identity: Identity): Promise<Profile> {
    this.profile = await writeIdentity(this.require, identity)
    await this.deps.reopen(this.deps.config().projectPath)
    return this.profile
  }

  /** The public half of the open profile's key, or null when it has none yet. */
  publicKey(): Promise<string | null> {
    return this.profile ? readPublicKey(this.profile) : Promise.resolve(null)
  }

  /** Makes a key and points the profile at it, so the next git command offers it. */
  async addKey(): Promise<{ profile: Profile; publicKey: string }> {
    const profile = this.require
    const publicKey = await generateKey(profile)
    this.profile = await writeIdentity(profile, { ...profile, sshKeyPath: keyFile(profile) })
    await this.deps.reopen(this.deps.config().projectPath)
    return { profile: this.profile, publicKey }
  }

  /**
   * The key a profile speaks to one model provider with. Written to the profile's own file
   * and held in memory from here on, so the chat that uses it next does not go to disk for
   * it. What comes back is the profile as the browser may see it: which providers are
   * connected, and not a character of what they are connected with.
   */
  async setModelKey(provider: string, credential: ModelKey | null): Promise<Profile> {
    this.profile = await writeModelKey(this.require, provider, credential)
    this.modelKeys = await readModelKeys(this.profile)
    return this.profile
  }

  startGithub(): Promise<GithubDevice> {
    return startDevice()
  }

  /** The answer to a device code, once the browser has given one. Connecting is the
   *  profile's — the token is what it pushes with, the way its key is. */
  async connectGithub(deviceCode: string): Promise<{ pending: boolean; profile: Profile }> {
    const profile = this.require
    const answer = await githubPoll(deviceCode)
    if (!answer.token) return { pending: true, profile }

    const login = await githubLogin(answer.token)
    this.profile = await writeAccount(profile, { login, token: answer.token })
    this.hostToken = answer.token
    await this.deps.reopen(this.deps.config().projectPath)
    return { pending: false, profile: this.profile }
  }

  /** The token goes and nothing else does. What was pushed with it stays pushed, and the
   *  projects it reached are still there — this is a credential, not a relationship. */
  async disconnectGithub(): Promise<Profile> {
    this.profile = await writeAccount(this.require, null)
    this.hostToken = null
    await this.deps.reopen(this.deps.config().projectPath)
    return this.profile
  }

  async githubRepos(): Promise<GithubRepo[]> {
    return githubRepos(await this.requireToken())
  }

  async createGithubRepo(input: { name: string; private: boolean }): Promise<GithubRepo> {
    return createGithubRepo(await this.requireToken(), input)
  }

  /**
   * The open project sits inside the profile it commits as, so the path names it. With no
   * project the config remembers who you were working as, and a name pointing at nothing
   * falls back to whichever profile is on disk.
   */
  async load(): Promise<void> {
    const target = this.deps.config().projectPath
    const name = target ? path.basename(path.dirname(target)) : this.deps.config().profile
    this.profile = name ? await findProfile(name, this.deps.home) : null
    if (!this.profile && !target)
      this.profile = (await listProfiles(this.deps.home))[0] ?? null
    await this.reload()
  }

  forget(): void {
    this.profile = null
  }

  private async use(profile: Profile): Promise<void> {
    this.profile = profile
    await this.reload()
    const target = (await listProjects(profileDir(profile)))[0]?.path ?? null
    await this.deps.save({
      ...this.deps.config(),
      profile: profile.name,
      projectPath: target,
    })
    await this.deps.reopen(target)
  }

  private async reload(): Promise<void> {
    this.hostToken = this.profile ? ((await readAccount(this.profile))?.token ?? null) : null
    this.modelKeys = this.profile ? await readModelKeys(this.profile) : {}
    await this.deps.followActivity()
  }

  /** Throws rather than returning empty: a picker with nothing in it and no reason why is
   *  worse than being told the connection is gone. */
  private async requireToken(): Promise<string> {
    const account = await readAccount(this.require)
    if (!account) throw new GithubError(`${this.require.name} is not connected to GitHub`)
    return account.token
  }
}
