import type { BroodmotherConfig } from '@daemon/types/config'
import type { ProjectSummary } from '@daemon/types/project'

export interface GetProjects {
  request: null
  response: { home: string; projects: ProjectSummary[]; active: ProjectSummary | null } // active is null on a fresh machine
}

export interface PostProjects {
  request: {
    name: string
    git: 'none' | 'local' | 'remote'
    remoteUrl?: string | null // required for `remote`
    branch?: string | null // to clone or to start on; ignored for `none`
  }
  response: { project: ProjectSummary; config: BroodmotherConfig }
}

export interface PostProjectOpen {
  request: { path: string }
  response: { config: BroodmotherConfig }
}

export interface PutProjects {
  request: { profile: string }
  // null on first run: nothing to bind it to yet
  response: { project: ProjectSummary | null }
}

export interface DeleteProjects {
  request: { name: string } // the folder and everything in it
  response: { active: ProjectSummary | null; config: BroodmotherConfig }
}
