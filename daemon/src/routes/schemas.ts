import { z } from 'zod'
import { CHAT_MODELS, CHAT_PROVIDERS } from '@daemon/types/api/chat'
import type { DocRoot } from '@daemon/services/Tree'
import { remoteUrlSchema } from '@daemon/utils/config'
import { identitySchema } from '@daemon/utils/profiles'

/** `project`, or `repo:<name>` — a path alone stopped being an address the moment a project
 *  could link more than one repository. */
export const rootSchema = z.custom<DocRoot>(
  (value) =>
    value === 'project' || (typeof value === 'string' && /^repo:.+$/.test(value)),
  'root must be "project" or "repo:<name>"',
)

const modelId = () => z.enum(CHAT_MODELS.map((one) => one.id) as [string, ...string[]])

export const rootBody = z.object({ root: rootSchema })
export const folderBody = z.object({ root: rootSchema, path: z.string() })
export const docBody = z.object({
  root: rootSchema,
  path: z.string(),
  markdown: z.string(),
})
export const moveBody = z.object({
  root: rootSchema,
  from: z.string(),
  to: z.string(),
})
export const branchBody = z.object({ root: rootSchema, name: z.string().min(1) })

/** Git is optional, so the remote and branch are too — but a project asked to sync needs
 *  somewhere to sync to, and that is worth refusing early rather than half-creating. */
export const newProjectBody = z
  .object({
    name: z.string().min(1),
    git: z.enum(['none', 'local', 'remote']),
    remoteUrl: remoteUrlSchema.nullish(),
    branch: z.string().min(1).nullish(),
  })
  .refine(
    (body) => body.git !== 'remote' || Boolean(body.remoteUrl?.trim()),
    'a project that syncs needs a remote',
  )
export const openProjectBody = z.object({ path: z.string().min(1) })

/** The same shape a project is made from, plus which project it goes in: a repo is a
 *  repository too, and it is made the same way. */
export const newRepoBody = z
  .object({
    name: z.string().min(1),
    project: z.string().min(1).nullish(),
    git: z.enum(['none', 'local', 'remote']).optional(),
    remoteUrl: remoteUrlSchema.nullish(),
    branch: z.string().min(1).nullish(),
  })
  .refine(
    (body) => body.git !== 'remote' || Boolean(body.remoteUrl?.trim()),
    'a repo cloned from a remote needs one',
  )

export const newProfileBody = identitySchema.extend({ name: z.string().min(1) })
export const pickProfileBody = z.object({ profile: z.string().min(1) })
export const deviceCodeBody = z.object({ deviceCode: z.string().min(1) })
export const newGithubRepoBody = z.object({
  name: z.string().min(1),
  private: z.boolean(),
})

/** A provider nobody serves is refused here rather than written and never read. */
export const modelKeyBody = z.object({
  provider: z.enum(CHAT_PROVIDERS.map((one) => one.id) as [string, ...string[]]),
  key: z.string().min(1),
})

/** Which model the conversation opens on. Named at the start rather than assumed, because the
 *  picker in the composer is the answer and it has one before anything is said. */
export const newChatBody = z.object({ model: modelId() })

/** An agent: a name, a persona the project carries, a model, a colour. The persona is
 *  checked against the project rather than here, since here does not know what it carries. */
export const newAgentBody = z.object({
  name: z.string().trim().min(1).max(60),
  persona: z.string().min(1),
  model: modelId(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})
export const agentBody = z.object({ agent: z.string().min(1) })
export const agentModelBody = z.object({
  agent: z.string().min(1),
  model: modelId(),
})
