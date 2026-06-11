import type { RepoForOrg } from '@/lib/db/repo-for-org'
import type { RouteSession } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { getScenarioValidationSummary, listScenarios } from '@/lib/scenarios/store'
import {
  CHANNEL_TOOL_NAMES,
  RETIRED_TOOL_NAMES,
  SPECIAL_TOOL_NAMES,
  SYSTEM_TOOL_NAMES,
} from '@/lib/tool-classifications'
import {
  configPilotContextResponseSchema,
  type ConfigPilotAgentVersionSummary,
  type ConfigPilotContextResponse,
  type LockedCapability,
} from './contracts'
import { buildPilotDraftFingerprint } from '@/lib/pilot/fingerprint'

const RUNTIME_LOCKED_CAPABILITIES: LockedCapability[] = [
  {
    id: 'procedure_run_tracker',
    name: 'Procedure Run Tracker',
    surface: 'runtime',
    reason: 'Runtime-managed ProcedureRun state is visible for audit but not editable by ConfigPilot.',
    editable: false,
  },
  {
    id: 'hook_engine',
    name: 'Hook Engine',
    surface: 'runtime',
    reason: 'HookEngine behavior is platform runtime, not business configuration.',
    editable: false,
  },
  {
    id: 'memory_extractor',
    name: 'Memory Extractor',
    surface: 'runtime',
    reason: 'Memory extraction behavior is runtime-managed; ConfigPilot may edit Memory strategy only.',
    editable: false,
  },
  {
    id: 'scenario_runner',
    name: 'Scenario Runner',
    surface: 'runtime',
    reason: 'Scenario Runner execution and validation semantics cannot be bypassed or edited.',
    editable: false,
  },
]

type AnyRecord = Record<string, any>

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

function summarizeVersion(row: AnyRecord | null | undefined): ConfigPilotAgentVersionSummary | null {
  if (!row) return null
  return {
    id: String(row.id),
    name: String(row.name),
    version: Number(row.version ?? 1),
    isActive: Boolean(row.isActive),
    model: String(row.model ?? ''),
    updatedAt: iso(row.updatedAt),
    publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
  }
}

function safeJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function redactUnknown(value: unknown, path = 'secret'): unknown {
  if (Array.isArray(value)) return value.map((item, index) => redactUnknown(item, `${path}.${index}`))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('secret')
      || lower.includes('token')
      || lower.includes('password')
      || lower.includes('apikey')
      || lower.includes('api_key')
      || lower.includes('authorization')
      || lower.includes('credential')
      || lower === 'key'
    ) {
      result[key] = `{{secretRef:${path}.${key}}}`
    } else {
      result[key] = redactUnknown(child, `${path}.${key}`)
    }
  }
  return result
}

function redactJsonString(value: unknown, ref: string): unknown {
  const parsed = safeJson(value)
  if (!parsed || parsed === value && typeof value === 'string') {
    return value ? `{{secretRef:${ref}}}` : value
  }
  return redactUnknown(parsed, ref)
}

function lockedToolReason(name: string): string | null {
  if (SYSTEM_TOOL_NAMES.has(name)) return 'Agent-callable system Tool is locked.'
  if (CHANNEL_TOOL_NAMES.has(name)) return 'Channel/system managed Tool is locked.'
  if (SPECIAL_TOOL_NAMES.has(name)) return 'Special platform Tool is locked.'
  return null
}

function serializeTool(tool: AnyRecord) {
  const lockedReason = lockedToolReason(String(tool.name))
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    mode: tool.mode,
    endpoint: tool.endpoint,
    httpMethod: tool.httpMethod,
    timeoutMs: tool.timeoutMs,
    enabled: tool.enabled,
    inputSchema: safeJson(tool.inputSchema),
    outputSchema: safeJson(tool.outputSchema),
    headers: redactJsonString(tool.headers, `tool.${tool.name}.headers`),
    mockFixture: safeJson(tool.mockFixture),
    displayVerb: safeJson(tool.displayVerb),
    renderHints: safeJson(tool.renderHints),
    locked: Boolean(lockedReason),
    lockedReason,
  }
}

function serializeHook(hook: AnyRecord) {
  const handler = safeJson(hook.handler)
  return {
    id: hook.id,
    name: hook.name,
    displayName: hook.displayName,
    description: hook.description,
    checkpoint: hook.checkpoint,
    handlerKind: hook.handlerKind,
    handler: redactUnknown(handler, `hook.${hook.name}.handler`),
    enabled: hook.enabled,
    severity: hook.severity,
  }
}

function serializeCaseType(caseType: AnyRecord) {
  return {
    id: caseType.id,
    type: caseType.type,
    displayName: caseType.displayName,
    description: caseType.description,
    requiredFacts: safeJson(caseType.requiredFacts),
    defaultGoal: caseType.defaultGoal,
    escalateOn: safeJson(caseType.escalateOn),
    autoCloseConditions: safeJson(caseType.autoCloseConditions),
    enabled: caseType.enabled,
    procedure: safeJson(caseType.procedure),
    maxAutoTurns: caseType.maxAutoTurns,
  }
}

function serializeKnowledge(source: AnyRecord) {
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    groupIds: safeJson(source.groupIds),
    dataIds: safeJson(source.dataIds),
    embeddingRate: source.embeddingRate,
    topK: source.topK,
    rerankVersion: source.rerankVersion,
    docCorrelation: source.docCorrelation,
    modelControlTopK: source.modelControlTopK,
    caseTypeTag: source.caseTypeTag,
    enabled: source.enabled,
  }
}

function serializeIntegration(binding: AnyRecord) {
  return {
    id: binding.id,
    channel: binding.channel,
    enabled: binding.enabled,
    credentials: redactJsonString(binding.credentials, `integration.${binding.channel}.credentials`),
    toolOverrides: safeJson(binding.toolOverrides),
    defaults: safeJson(binding.defaults),
    transferStrategy: binding.transferStrategy,
    transferTarget: safeJson(binding.transferTarget),
  }
}

function lockedCapabilitiesFromTools(tools: AnyRecord[]): LockedCapability[] {
  return tools.flatMap((tool) => {
    const reason = lockedToolReason(String(tool.name))
    if (!reason) return []
    return [{
      id: `tool:${tool.name}`,
      name: String(tool.name),
      surface: 'tools',
      reason,
      editable: false as const,
    }]
  })
}

export async function getConfigPilotContext(
  repo: RepoForOrg,
  session: RouteSession,
  agentConfigId: string,
): Promise<ConfigPilotContextResponse> {
  await assertAgentInOrg(repo, agentConfigId)

  const selected = await repo.raw.agentConfig.findUnique({ where: { id: agentConfigId } }) as AnyRecord | null
  if (!selected) {
    throw new Error('Agent config not found after ownership check')
  }

  const [active, latestDraft, caseTypes, tools, hooks, hookBindings, knowledgeSources, channelBindings, scenarioResult, validation, draftFingerprint] = await Promise.all([
    repo.agentConfig.findFirst({ where: { name: selected.name, isActive: true } }) as Promise<AnyRecord | null>,
    repo.agentConfig.findFirst({ where: { name: selected.name, isActive: false }, orderBy: { version: 'desc' } }) as Promise<AnyRecord | null>,
    repo.raw.caseType.findMany({ where: { agentConfigId }, orderBy: { type: 'asc' } }) as Promise<AnyRecord[]>,
    repo.raw.tool.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }) as Promise<AnyRecord[]>,
    repo.raw.hook.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }) as Promise<AnyRecord[]>,
    repo.raw.hookBinding.findMany({ where: { agentConfigId }, orderBy: [{ scopeType: 'asc' }, { createdAt: 'asc' }] }) as Promise<AnyRecord[]>,
    repo.raw.knowledgeSource.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }) as Promise<AnyRecord[]>,
    repo.raw.channelBinding.findMany({ where: { agentConfigId }, orderBy: { channel: 'asc' } }) as Promise<AnyRecord[]>,
    listScenarios(agentConfigId),
    getScenarioValidationSummary(agentConfigId),
    buildPilotDraftFingerprint(repo, agentConfigId),
  ])

  const selectedSummary = summarizeVersion(selected)
  if (!selectedSummary) throw new Error('Agent config summary could not be built')

  const canApply = session.role === 'admin' || session.role === 'owner'
  const visibleTools = tools.filter((tool) => !RETIRED_TOOL_NAMES.has(String(tool.name)))
  const serializedTools = visibleTools.map(serializeTool)

  return configPilotContextResponseSchema.parse({
    agentConfigId,
    selected: selectedSummary,
    active: summarizeVersion(active),
    draft: summarizeVersion(selected.isActive ? latestDraft : selected),
    draftFingerprint,
    permissions: {
      role: session.role,
      canRead: true,
      canPropose: canApply,
      canApply,
      canPublish: false,
    },
    lockedCapabilities: [
      ...RUNTIME_LOCKED_CAPABILITIES,
      ...lockedCapabilitiesFromTools(visibleTools),
    ],
    configuration: {
      brain: {
        model: selected.model,
        temperature: selected.temperature,
        thinkingBudget: selected.thinkingBudget,
        maxIterations: selected.maxIterations,
        maxOutputTokens: selected.maxOutputTokens,
        coreSystemPrompt: selected.coreSystemPrompt,
        extendedThinking: selected.extendedThinking,
        memoryStrategy: safeJson(selected.memoryStrategy),
        resumePrompt: selected.resumePrompt,
        gptbotsApiKey: selected.gptbotsApiKey ? '{{secretRef:agent.gptbotsApiKey}}' : null,
      },
      procedures: caseTypes.map(serializeCaseType),
      tools: serializedTools,
      hooks: hooks.map(serializeHook),
      hookBindings: hookBindings.map((binding) => ({
        id: binding.id,
        hookId: binding.hookId,
        scopeType: binding.scopeType,
        scopeKey: binding.scopeKey,
        caseTypeId: binding.caseTypeId,
        procedureStepId: binding.procedureStepId,
        toolId: binding.toolId,
        enabled: binding.enabled,
      })),
      knowledge: knowledgeSources.map(serializeKnowledge),
      integrations: channelBindings.map(serializeIntegration),
      scenarios: scenarioResult.scenarios,
      receipts: scenarioResult.receipts.slice(0, 5),
    },
    validation,
  })
}
