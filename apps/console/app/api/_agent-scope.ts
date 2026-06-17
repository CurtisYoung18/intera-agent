import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { NotFoundError } from '@/lib/api/define-route'
import type { RepoForOrg } from '@/lib/db/repo-for-org'

export interface AgentScopedRun {
  id: string
  caseId: string
}

export interface AgentCaseScope {
  agentConfigId: string
  runs: AgentScopedRun[]
  caseIds: string[]
  runIds: string[]
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

function isLegacyRunAgentConfig(agentConfigId: string | null | undefined): boolean {
  const normalized = agentConfigId?.trim().toLowerCase()
  return !normalized || normalized === 'unknown'
}

function isPlaygroundChatForAgent(chatId: string, agentConfigId: string): boolean {
  return chatId.startsWith(`pg_${agentConfigId}_`)
}

export function selectedAgentFromInput(input: { agentId?: string | null; agentConfigId?: string | null }): string | undefined {
  return input.agentConfigId ?? input.agentId ?? undefined
}

export function requireSelectedAgentFromInput(input: { agentId?: string | null; agentConfigId?: string | null }): string {
  const agentConfigId = selectedAgentFromInput(input)
  if (!agentConfigId) throw new NotFoundError('Agent config not found')
  return agentConfigId
}

export async function resolveAgentCaseScope(repo: RepoForOrg, agentConfigId: string): Promise<AgentCaseScope> {
  await assertAgentInOrg(repo, agentConfigId)
  const [runs, channelConversations, playgroundCases] = await Promise.all([
    repo.raw.procedureRun.findMany({
      where: { orgId: repo.orgId, agentConfigId },
      orderBy: { updatedAt: 'desc' as const },
      select: { id: true, caseId: true },
    }),
    repo.externalConversation.findMany({
      where: {
        internalCaseId: { not: null },
        metadata: { path: ['agentConfigId'], equals: agentConfigId },
      },
      select: { internalCaseId: true },
    }),
    repo.raw.case.findMany({
      where: {
        orgId: repo.orgId,
        chatId: { startsWith: `pg_${agentConfigId}_` },
      },
      select: { id: true },
    }),
  ])
  const caseIds = uniqueStrings([
    ...runs.map((run: AgentScopedRun) => run.caseId),
    ...channelConversations.map((conversation: { internalCaseId: string | null }) => conversation.internalCaseId),
    ...playgroundCases.map((caseRow: { id: string }) => caseRow.id),
  ])
  const runIds = uniqueStrings(runs.map((run: AgentScopedRun) => run.id))

  return { agentConfigId, runs, caseIds, runIds }
}

export async function resolveRequiredAgentCaseScope(
  repo: RepoForOrg,
  input: { agentId?: string | null; agentConfigId?: string | null },
): Promise<AgentCaseScope> {
  return resolveAgentCaseScope(repo, requireSelectedAgentFromInput(input))
}

export async function resolveAgentCaseScopeForChat(
  repo: RepoForOrg,
  agentConfigId: string,
  chatId: string,
): Promise<AgentCaseScope> {
  const scope = await resolveAgentCaseScope(repo, agentConfigId)
  const scopedCaseIds = new Set(scope.caseIds)
  const chatCases = await repo.raw.case.findMany({
    where: { orgId: repo.orgId, chatId },
    select: { id: true },
  })
  const chatCaseIds = chatCases.map((caseRow: { id: string }) => caseRow.id)
  if (chatCaseIds.length === 0) return scope

  const runsForChat = await repo.raw.procedureRun.findMany({
    where: { orgId: repo.orgId, caseId: { in: chatCaseIds } },
    select: { caseId: true, agentConfigId: true },
  })
  const casesWithRuns = new Set(runsForChat.map((run: { caseId: string }) => run.caseId))
  const runsByCase = new Map<string, Array<{ caseId: string; agentConfigId: string | null }>>()
  for (const run of runsForChat) {
    const bucket = runsByCase.get(run.caseId) ?? []
    bucket.push(run)
    runsByCase.set(run.caseId, bucket)
  }
  const unscopedCaseIds = chatCaseIds.filter((caseId: string) => !casesWithRuns.has(caseId))
  const legacyPlaygroundCaseIds = isPlaygroundChatForAgent(chatId, agentConfigId)
    ? chatCaseIds.filter((caseId: string) => {
        const runs = runsByCase.get(caseId) ?? []
        return !scopedCaseIds.has(caseId) && runs.length > 0 && runs.every((run) => isLegacyRunAgentConfig(run.agentConfigId))
      })
    : []
  if (unscopedCaseIds.length === 0 && legacyPlaygroundCaseIds.length === 0) return scope

  return {
    ...scope,
    caseIds: uniqueStrings([...scope.caseIds, ...unscopedCaseIds, ...legacyPlaygroundCaseIds]),
  }
}

export async function resolveRequiredAgentCaseScopeForChat(
  repo: RepoForOrg,
  input: { agentId?: string | null; agentConfigId?: string | null },
  chatId: string,
): Promise<AgentCaseScope> {
  return resolveAgentCaseScopeForChat(repo, requireSelectedAgentFromInput(input), chatId)
}

export function caseIdFilterForScope(scope: AgentCaseScope): Record<string, unknown> {
  return { id: { in: scope.caseIds } }
}

export function childCaseIdFilterForScope(scope: AgentCaseScope): Record<string, unknown> {
  return { caseId: { in: scope.caseIds } }
}

export async function assertCaseInAgentScope(
  repo: RepoForOrg,
  caseId: string,
  agentConfigId: string,
): Promise<{ runId: string }> {
  await assertAgentInOrg(repo, agentConfigId)
  const run = await repo.raw.procedureRun.findFirst({
    where: { orgId: repo.orgId, caseId, agentConfigId },
    orderBy: { updatedAt: 'desc' as const },
    select: { id: true },
  })
  if (!run) throw new NotFoundError('ProcedureRun not found')
  return { runId: run.id }
}
