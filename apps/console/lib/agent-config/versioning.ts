export const MAX_AGENT_CONFIG_VERSIONS = 5

export interface AgentVersionRow {
  id: string
  name: string
  version: number
  isActive: boolean
  parentId: string | null
}

export class AgentVersionLimitError extends Error {
  readonly code = 'agent_version_limit'
  readonly fields: Record<string, string>

  constructor(
    readonly agentName: string,
    readonly currentVersions: number,
    readonly maxVersions = MAX_AGENT_CONFIG_VERSIONS,
  ) {
    super(`Agent "${agentName}" already has ${currentVersions} versions. Maximum retained versions is ${maxVersions}.`)
    this.name = 'AgentVersionLimitError'
    this.fields = {
      agentName,
      currentVersions: String(currentVersions),
      maxVersions: String(maxVersions),
    }
  }
}

export class AgentDraftConflictError extends Error {
  readonly code = 'agent_draft_conflict'
  readonly fields: Record<string, string>

  constructor(readonly agentName: string, readonly draftIds: string[]) {
    super(`Agent "${agentName}" already has an existing draft. Choose an explicit import strategy before creating another draft.`)
    this.name = 'AgentDraftConflictError'
    this.fields = {
      agentName,
      draftIds: draftIds.join(','),
    }
  }
}

export interface AllocateAgentVersionOptions {
  allowExistingDraft?: boolean
  maxVersions?: number
}

export interface AgentVersionAllocation {
  version: number
  family: AgentVersionRow[]
  existingDrafts: AgentVersionRow[]
}

interface AgentVersioningRepo {
  agentConfig: {
    findMany: (args?: any) => PromiseLike<AgentVersionRow[]>
  }
}

export async function allocateNextAgentVersion(
  repo: AgentVersioningRepo,
  name: string,
  options: AllocateAgentVersionOptions = {},
): Promise<AgentVersionAllocation> {
  const maxVersions = options.maxVersions ?? MAX_AGENT_CONFIG_VERSIONS
  const family = await listAgentVersionFamily(repo, name)
  const existingDrafts = family.filter((config) => !config.isActive)

  if (family.length >= maxVersions) {
    throw new AgentVersionLimitError(name, family.length, maxVersions)
  }
  if (existingDrafts.length > 0 && !options.allowExistingDraft) {
    throw new AgentDraftConflictError(name, existingDrafts.map((draft) => draft.id))
  }

  return {
    version: (family.reduce((max, config) => Math.max(max, config.version), 0) || 0) + 1,
    family,
    existingDrafts,
  }
}

export async function listAgentVersionFamily(
  repo: AgentVersioningRepo,
  name: string,
): Promise<AgentVersionRow[]> {
  const family = await repo.agentConfig.findMany({
    where: { name },
    orderBy: { version: 'asc' },
    select: { id: true, name: true, version: true, isActive: true, parentId: true },
  })
  return [...family].sort((a, b) => a.version - b.version)
}

export function isAgentVersioningError(err: unknown): err is AgentVersionLimitError | AgentDraftConflictError {
  return err instanceof AgentVersionLimitError || err instanceof AgentDraftConflictError
}
