import { createHash } from 'node:crypto'
import type { RepoForOrg } from '@/lib/db/repo-for-org'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { listScenarios } from '@/lib/scenarios/store'

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

function stripVolatile(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!row) return null
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'createdAt') continue
    clean[key] = value instanceof Date ? value.toISOString() : value
  }
  return clean
}

function sortedRows(rows: Array<Record<string, unknown>>, key: string): Array<Record<string, unknown> | null> {
  return rows
    .slice()
    .sort((a, b) => String(a[key] ?? a.id ?? '').localeCompare(String(b[key] ?? b.id ?? '')))
    .map(stripVolatile)
}

export async function buildPilotDraftFingerprint(repo: RepoForOrg, agentConfigId: string): Promise<string> {
  await assertAgentInOrg(repo, agentConfigId)

  const [agent, procedures, tools, hooks, hookBindings, knowledgeSources, channelBindings, scenarios] = await Promise.all([
    repo.raw.agentConfig.findUnique({
      where: { id: agentConfigId },
      select: {
        id: true,
        orgId: true,
        name: true,
        version: true,
        parentId: true,
        isActive: true,
        model: true,
        temperature: true,
        thinkingBudget: true,
        maxIterations: true,
        coreSystemPrompt: true,
        extendedThinking: true,
        maxOutputTokens: true,
        resumePrompt: true,
        memoryStrategy: true,
        updatedAt: true,
      },
    }) as Promise<Record<string, unknown> | null>,
    repo.raw.caseType.findMany({ where: { agentConfigId }, orderBy: { type: 'asc' } }) as Promise<Array<Record<string, unknown>>>,
    repo.raw.tool.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }) as Promise<Array<Record<string, unknown>>>,
    repo.raw.hook.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }) as Promise<Array<Record<string, unknown>>>,
    repo.raw.hookBinding.findMany({ where: { agentConfigId }, orderBy: [{ scopeType: 'asc' }, { scopeKey: 'asc' }] }) as Promise<Array<Record<string, unknown>>>,
    repo.raw.knowledgeSource.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }) as Promise<Array<Record<string, unknown>>>,
    repo.raw.channelBinding.findMany({ where: { agentConfigId }, orderBy: { channel: 'asc' } }) as Promise<Array<Record<string, unknown>>>,
    listScenarios(agentConfigId),
  ])

  const payload = {
    agent: stripVolatile(agent),
    procedures: sortedRows(procedures, 'type'),
    tools: sortedRows(tools, 'name'),
    hooks: sortedRows(hooks, 'name'),
    hookBindings: sortedRows(hookBindings, 'scopeKey'),
    knowledgeSources: sortedRows(knowledgeSources, 'name'),
    channelBindings: sortedRows(channelBindings, 'channel'),
    scenarios: scenarios.scenarios.map((scenario) => ({
      name: scenario.name,
      updatedAt: scenario.updatedAt,
      lastRunId: scenario.lastRunId,
      lastRunStatus: scenario.lastRunStatus,
    })),
    validation: {
      state: scenarios.validationState,
      changedAt: scenarios.changedAt,
      lastReceiptId: scenarios.lastReceiptId,
      lastRuntimeReceiptId: scenarios.lastRuntimeReceiptId,
    },
  }

  return createHash('sha256').update(stableJson(payload)).digest('hex')
}
