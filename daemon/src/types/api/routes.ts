import type {
  DeleteBranches,
  GetBranches,
  PostBranchOpen,
  PostBranches,
} from './branches'
import type { DeleteData } from './data'
import type { GetDiff, GetDiffFile } from './diff'
import type { GetTaskLog, GetTaskRuns, GetTasks, PostTaskRun } from './tasks'
import type { DeleteChat, GetChat, GetChats, PostChats } from './chat'
import type {
  DeleteAgent,
  GetAgentOrg,
  GetAgents,
  PostAgentClear,
  PostAgentLead,
  PostAgentModel,
  PostAgentPlace,
  PostAgents,
} from './agents'
import type { GetDiagrams } from './canvas'
import type { GetActivity } from './activity'
import type {
  GetEntities,
  GetEntitiesCatalogue,
  PostEntities,
  PostEntityLink,
} from './entities'
import type { GetPersonas } from './personas'
import type { DeleteTerminal } from './terminal'
import type {
  DeleteDoc,
  GetDoc,
  GetFile,
  GetLinks,
  PostDocMove,
  PostFolder,
  PutDoc,
} from './docs'
import type {
  GetConfig,
  GetGit,
  GetSync,
  PostSyncClearConflict,
  PostSyncNow,
  PostGitCheck,
  PutConfig,
  PutGit,
} from './git'
import type {
  DeleteGithub,
  GetGithubRepos,
  PostGithubConnect,
  PostGithubDevice,
  PostGithubRepos,
} from './github'
import type {
  DeleteModelKey,
  GetProfileKey,
  GetProfiles,
  PostProfileKey,
  PostProfiles,
  PutModelKey,
  PutProfiles,
} from './profiles'
import type { DeleteRepos, GetRepos, PostRepos } from './repos'
import type { PostScope } from './scope'
import type { GetTree } from './tree'
import type {
  DeleteProjects,
  GetProjects,
  PostProjectOpen,
  PostProjects,
  PutProjects,
} from './projects'

interface ApiRoutes {
  'GET /api/profiles': GetProfiles
  'POST /api/profiles': PostProfiles
  'PUT /api/profiles': PutProfiles
  'GET /api/profiles/key': GetProfileKey
  'POST /api/profiles/key': PostProfileKey
  'PUT /api/model-keys': PutModelKey
  'DELETE /api/model-keys': DeleteModelKey
  'POST /api/github/device': PostGithubDevice
  'POST /api/github/connect': PostGithubConnect
  'DELETE /api/github': DeleteGithub
  'GET /api/github/repos': GetGithubRepos
  'POST /api/github/repos': PostGithubRepos
  'GET /api/tree': GetTree
  'GET /api/branches': GetBranches
  'POST /api/branches': PostBranches
  'POST /api/branches/open': PostBranchOpen
  'DELETE /api/branches': DeleteBranches
  'GET /api/diff': GetDiff
  'GET /api/diff/file': GetDiffFile
  'DELETE /api/terminal': DeleteTerminal
  'GET /api/projects': GetProjects
  'POST /api/projects': PostProjects
  'POST /api/projects/open': PostProjectOpen
  'PUT /api/projects': PutProjects
  'DELETE /api/projects': DeleteProjects
  'GET /api/repos': GetRepos
  'POST /api/repos': PostRepos
  'DELETE /api/repos': DeleteRepos
  'POST /api/scope': PostScope
  'POST /api/task/run': PostTaskRun
  'GET /api/task/runs': GetTaskRuns
  'GET /api/tasks': GetTasks
  'GET /api/task/log': GetTaskLog
  'POST /api/task/stop': PostTaskRun
  'GET /api/chats': GetChats
  'POST /api/chats': PostChats
  'GET /api/chat': GetChat
  'DELETE /api/chat': DeleteChat
  'GET /api/agents': GetAgents
  'POST /api/agents': PostAgents
  'DELETE /api/agent': DeleteAgent
  'POST /api/agent/clear': PostAgentClear
  'POST /api/agent/model': PostAgentModel
  'GET /api/agents/org': GetAgentOrg
  'POST /api/agent/lead': PostAgentLead
  'POST /api/agent/place': PostAgentPlace
  'GET /api/entities': GetEntities
  'POST /api/entities': PostEntities
  'GET /api/entities/catalogue': GetEntitiesCatalogue
  'POST /api/entity/link': PostEntityLink
  'GET /api/diagrams': GetDiagrams
  'GET /api/activity': GetActivity
  'GET /api/personas': GetPersonas
  'GET /api/file': GetFile
  'GET /api/doc': GetDoc
  'PUT /api/doc': PutDoc
  'POST /api/doc/move': PostDocMove
  'DELETE /api/doc': DeleteDoc
  'POST /api/folder': PostFolder
  'GET /api/links': GetLinks
  'GET /api/config': GetConfig
  'PUT /api/config': PutConfig
  'POST /api/git/check': PostGitCheck
  'GET /api/git': GetGit
  'PUT /api/git': PutGit
  'GET /api/sync': GetSync
  'POST /api/sync/now': PostSyncNow
  'POST /api/sync/clear-conflict': PostSyncClearConflict
  'DELETE /api/data': DeleteData
}

export type ApiRoute = keyof ApiRoutes
export type ApiRequest<R extends ApiRoute> = ApiRoutes[R]['request']
export type ApiResponse<R extends ApiRoute> = ApiRoutes[R]['response']

export interface ApiError {
  error: string
}
