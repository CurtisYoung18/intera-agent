import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
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

export function selectedAgentFromInput(input: { agentId?: string | null; agentConfigId?: string | null }): string | undefined {
  return input.agentConfigId ?? input.agentId ?? undefined
}

export async function resolveAgentCaseScope(repo: RepoForOrg, agentConfigId: string | undefined): Promise<AgentCaseScope | null> {
  if (!agentConfigId) return null

  await assertAgentInOrg(repo, agentConfigId)
  const runs = await repo.raw.procedureRun.findMany({
    where: { orgId: repo.orgId, agentConfigId },
    orderBy: { updatedAt: 'desc' as const },
    select: { id: true, caseId: true },
  })
  const caseIds = [...new Set(runs.map((run: AgentScopedRun) => run.caseId))]
  const runIds = [...new Set(runs.map((run: AgentScopedRun) => run.id))]

  return { agentConfigId, runs, caseIds, runIds }
}

export function caseIdFilterForScope(scope: AgentCaseScope | null): Record<string, unknown> {
  return scope ? { id: { in: scope.caseIds } } : {}
}

export function childCaseIdFilterForScope(scope: AgentCaseScope | null): Record<string, unknown> {
  return scope ? { caseId: { in: scope.caseIds } } : {}
}
