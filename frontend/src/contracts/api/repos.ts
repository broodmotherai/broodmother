import type { BroodmotherConfig } from '@/src/contracts/config'
import type { NewRepo, RepoSummary } from '@/src/contracts/repo'

export interface GetRepos {
  request: null
  response: { repos: RepoSummary[] } // the open project's, every one of them open
}

/** Makes the folder if it is not there yet, then links it to a project. */
export interface PostRepos {
  request: NewRepo
  response: { repo: RepoSummary; config: BroodmotherConfig }
}

export interface DeleteRepos {
  request: { name: string } // the link and the checkouts broodmother made; never the repository
  response: { config: BroodmotherConfig } // the scope falls back to the project if it was here
}
