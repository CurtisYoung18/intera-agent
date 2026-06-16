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
  const runs = await repo.raw.procedureRun.findMany({
    where: { orgId: repo.orgId, agentConfigId },
    orderBy: { updatedAt: 'desc' as const },
    select: { id: true, caseId: true },
  })
  const caseIds = [...new Set(runs.map((run: AgentScopedRun) => run.caseId))]
  const runIds = [...new Set(runs.map((run: AgentScopedRun) => run.id))]

  return { agentConfigId, runs, caseIds, runIds }
}

export async function resolveRequiredAgentCaseScope(
  repo: RepoForOrg,
  input: { agentId?: string | null; agentConfigId?: string | null },
): Promise<AgentCaseScope> {
  return resolveAgentCaseScope(repo, requireSelectedAgentFromInput(input))
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
