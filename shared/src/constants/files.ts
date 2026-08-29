export const REPOS_DIR = '.repos'
export const TOOLS_DIR = '.tools'
export const SKILLS_DIR = '.tools/.skills'
export const PERSONAS_DIR = '.personas'
export const TASKS_DIR = '.tasks'
export const ATTACHMENTS_DIR = '.attachments'
export const PROFILE_FILE = 'profile.json'

/** The checkout a root is opened on before any branch is cut. */
export const PRIMARY = 'local'

export const TEMP_SUFFIX = '.broodmothertmp'

/** Names a document may not take, because the folders behind them are not documents. */
export const RESERVED = new Set(['.git', '.broodmother', REPOS_DIR])
