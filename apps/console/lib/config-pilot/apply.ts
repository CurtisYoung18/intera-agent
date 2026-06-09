import { apiOk } from '@intera/shared/contracts/envelope'
import { parseProcedure } from '@intera/shared/contracts/case-types'
import type { AuditWriter } from '@intera/shared/contracts/audit'
import type { RepoForOrg } from '@/lib/db/repo-for-org'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { clearConfigCache } from '@/lib/agent/config-cache'
import { markScenarioValidationChanged, getScenarioValidationSummary, saveScenario, updateScenario } from '@/lib/scenarios/store'
import {
  CHANNEL_TOOL_NAMES,
  SPECIAL_TOOL_NAMES,
  SYSTEM_TOOL_NAMES,
} from '@/lib/tool-classifications'
import {
  configPilotApplyResponseSchema,
  type BrainPatchFields,
  type ConfigPilotApplyRequest,
  type ConfigPilotApplyResponse,
  type ConfigPilotPatch,
} from './contracts'

type AnyRecord = Record<string, any>

function stringifyMaybe(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function protectedToolReason(name: string): string | null {
  if (SYSTEM_TOOL_NAMES.has(name)) return 'system Tool'
  if (CHANNEL_TOOL_NAMES.has(name)) return 'channel Tool'
  if (SPECIAL_TOOL_NAMES.has(name)) return 'special Tool'
  return null
}

function forbidProtectedTool(name: string): void {
  const reason = protectedToolReason(name)
  if (reason) {
    throw new ForbiddenError(`ConfigPilot cannot edit protected ${reason} "${name}"`)
  }
}

function agentData(fields: BrainPatchFields): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const key of ['model', 'temperature', 'thinkingBudget', 'maxIterations', 'maxOutputTokens', 'coreSystemPrompt', 'extendedThinking', 'resumePrompt'] as const) {
    if (fields[key] !== undefined) data[key] = fields[key]
  }
  if (fields.memoryStrategy !== undefined) data.memoryStrategy = stringifyMaybe(fields.memoryStrategy) ?? '{}'
  return data
}

async function forkDraftFromActive(repo: RepoForOrg, source: AnyRecord, audit: AuditWriter): Promise<AnyRecord> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await repo.agentConfig.findFirst({
      where: { name: source.name },
      orderBy: { version: 'desc' },
      select: { version: true },
    }) as AnyRecord | null
    const newVersion = (max?.version ?? 0) + 1
    try {
      const forked = await (repo.agentConfig.create as any)({
        data: {
          name: source.name,
          version: newVersion,
          isActive: false,
          parentId: source.id,
          model: source.model,
          temperature: source.temperature,
          thinkingBudget: source.thinkingBudget,
          maxIterations: source.maxIterations,
          maxOutputTokens: source.maxOutputTokens,
          coreSystemPrompt: source.coreSystemPrompt,
          extendedThinking: source.extendedThinking,
          memoryStrategy: source.memoryStrategy,
          gptbotsApiKey: source.gptbotsApiKey,
          resumePrompt: source.resumePrompt,
        },
      }) as AnyRecord

      await repo.raw.$transaction(async (tx: any) => {
        const toolIdMap = new Map<string, string>()
        const caseTypeIdMap = new Map<string, string>()
        const hookIdMap = new Map<string, string>()

        const tools = await tx.tool.findMany({ where: { agentConfigId: source.id } })
        for (const tool of tools) {
          const { id, createdAt, updatedAt, ...rest } = tool
          const created = await tx.tool.create({ data: { ...rest, agentConfigId: forked.id } })
          toolIdMap.set(id, created.id)
        }

        const caseTypes = await tx.caseType.findMany({ where: { agentConfigId: source.id } })
        for (const caseType of caseTypes) {
          const { id, createdAt, updatedAt, ...rest } = caseType
          const created = await tx.caseType.create({ data: { ...rest, agentConfigId: forked.id } })
          caseTypeIdMap.set(id, created.id)
        }

        const hooks = await tx.hook.findMany({ where: { agentConfigId: source.id } })
        for (const hook of hooks) {
          const { id, createdAt, updatedAt, ...rest } = hook
          const created = await tx.hook.create({ data: { ...rest, agentConfigId: forked.id } })
          hookIdMap.set(id, created.id)
        }

        const hookBindings = await tx.hookBinding.findMany({ where: { agentConfigId: source.id } })
        for (const binding of hookBindings) {
          const { id, createdAt, updatedAt, hookId, caseTypeId, toolId, scopeType, scopeKey, ...rest } = binding
          const mappedHookId = hookIdMap.get(hookId)
          if (!mappedHookId) continue
          const mappedCaseTypeId = caseTypeId ? caseTypeIdMap.get(caseTypeId) ?? null : null
          const mappedToolId = toolId ? toolIdMap.get(toolId) ?? null : null
          let mappedScopeKey = scopeKey
          if (scopeType === 'caseType' && mappedCaseTypeId) mappedScopeKey = `caseType:${mappedCaseTypeId}`
          if (scopeType === 'procedureStep' && mappedCaseTypeId) {
            const parts = String(scopeKey).split(':')
            mappedScopeKey = `procedureStep:${mappedCaseTypeId}:${parts[parts.length - 1] ?? ''}`
          }
          if (scopeType === 'tool' && mappedToolId) mappedScopeKey = `tool:${mappedToolId}`
          await tx.hookBinding.create({
            data: {
              ...rest,
              agentConfigId: forked.id,
              hookId: mappedHookId,
              scopeType,
              scopeKey: mappedScopeKey,
              caseTypeId: mappedCaseTypeId,
              toolId: mappedToolId,
            },
          })
        }

        const sources = await tx.knowledgeSource.findMany({ where: { agentConfigId: source.id } })
        for (const sourceRow of sources) {
          const { id, createdAt, updatedAt, ...rest } = sourceRow
          await tx.knowledgeSource.create({ data: { ...rest, agentConfigId: forked.id } })
        }

        const bindings = await tx.channelBinding.findMany({ where: { agentConfigId: source.id } })
        for (const binding of bindings) {
          const { id, createdAt, updatedAt, ...rest } = binding
          await tx.channelBinding.create({ data: { ...rest, agentConfigId: forked.id } })
        }
      })

      await audit({
        action: 'agent_config.fork',
        target: `agent_config:${forked.id}`,
        before: { sourceId: source.id },
        after: { id: forked.id, name: forked.name, version: forked.version },
      })
      return forked
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') continue
      throw err
    }
  }
  throw new ValidationError('Could not create a draft Agent version for ConfigPilot')
}

async function ensureDraft(repo: RepoForOrg, agentConfigId: string, audit: AuditWriter): Promise<{ draft: AnyRecord; createdDraft: boolean }> {
  await assertAgentInOrg(repo, agentConfigId)
  const selected = await repo.raw.agentConfig.findUnique({ where: { id: agentConfigId } }) as AnyRecord | null
  if (!selected) throw new NotFoundError('Agent config not found')
  if (!selected.isActive) return { draft: selected, createdDraft: false }
  return { draft: await forkDraftFromActive(repo, selected, audit), createdDraft: true }
}

function caseTypeData(fields: AnyRecord, agentConfigId?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (agentConfigId) data.agentConfigId = agentConfigId
  for (const key of ['type', 'displayName', 'description', 'icon', 'defaultGoal'] as const) {
    if (fields[key] !== undefined) data[key] = fields[key]
  }
  if (fields.requiredFacts !== undefined) data.requiredFacts = stringifyMaybe(fields.requiredFacts) ?? '[]'
  if (fields.escalateOn !== undefined) data.escalateOn = stringifyMaybe(fields.escalateOn) ?? '[]'
  if (fields.autoCloseConditions !== undefined) data.autoCloseConditions = stringifyMaybe(fields.autoCloseConditions)
  if (fields.enabled !== undefined) data.enabled = fields.enabled !== false
  if (fields.procedure !== undefined) data.procedure = stringifyMaybe(fields.procedure)
  if (fields.maxAutoTurns !== undefined) data.maxAutoTurns = Math.max(1, Math.min(50, Number(fields.maxAutoTurns) || 10))
  return data
}

function toolData(fields: AnyRecord, agentConfigId?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (agentConfigId) data.agentConfigId = agentConfigId
  for (const key of ['name', 'description', 'mode', 'endpoint', 'httpMethod', 'guardPhase', 'toolCategory'] as const) {
    if (fields[key] !== undefined) data[key] = fields[key]
  }
  for (const key of ['inputSchema', 'outputSchema', 'headers', 'mockFixture', 'displayVerb', 'renderHints'] as const) {
    if (fields[key] !== undefined) data[key] = stringifyMaybe(fields[key])
  }
  if (fields.timeoutMs !== undefined) data.timeoutMs = fields.timeoutMs
  if (fields.isConcurrencySafe !== undefined) data.isConcurrencySafe = fields.isConcurrencySafe
  if (fields.enabled !== undefined) data.enabled = fields.enabled
  return data
}

function hookData(fields: AnyRecord, agentConfigId?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (agentConfigId) data.agentConfigId = agentConfigId
  for (const key of ['name', 'displayName', 'description', 'checkpoint', 'handlerKind', 'enabled', 'severity'] as const) {
    if (fields[key] !== undefined) data[key] = fields[key]
  }
  if (fields.handler !== undefined) data.handler = JSON.stringify(fields.handler)
  return data
}

function knowledgeData(fields: AnyRecord, agentConfigId?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (agentConfigId) data.agentConfigId = agentConfigId
  for (const key of ['name', 'description', 'embeddingRate', 'topK', 'rerankVersion', 'docCorrelation', 'modelControlTopK', 'caseTypeTag', 'enabled'] as const) {
    if (fields[key] !== undefined) data[key] = fields[key]
  }
  if (fields.groupIds !== undefined) data.groupIds = JSON.stringify(fields.groupIds)
  if (fields.dataIds !== undefined) data.dataIds = fields.dataIds ? JSON.stringify(fields.dataIds) : null
  return data
}

function integrationData(fields: AnyRecord, channel: string, agentConfigId: string): Record<string, unknown> {
  const data: Record<string, unknown> = { agentConfigId, channel }
  if (fields.enabled !== undefined) data.enabled = fields.enabled
  if (fields.credentialRefs !== undefined) data.credentials = JSON.stringify({ secretRefs: fields.credentialRefs })
  if (fields.toolOverrides !== undefined) data.toolOverrides = stringifyMaybe(fields.toolOverrides)
  if (fields.defaults !== undefined) data.defaults = stringifyMaybe(fields.defaults)
  if (fields.transferStrategy !== undefined) data.transferStrategy = fields.transferStrategy
  if (fields.transferTarget !== undefined) data.transferTarget = stringifyMaybe(fields.transferTarget)
  return data
}

async function resolveHookBindingScope(repo: RepoForOrg, agentConfigId: string, value: AnyRecord) {
  if (value.scopeType === 'agent') {
    return { scopeType: 'agent', scopeKey: 'agent', caseTypeId: null, procedureStepId: null, toolId: null }
  }
  if (value.scopeType === 'caseType') {
    if (!value.caseTypeType) throw new ValidationError('caseTypeType is required for caseType Hook bindings')
    const caseType = await repo.raw.caseType.findUnique({ where: { agentConfigId_type: { agentConfigId, type: value.caseTypeType } } }) as AnyRecord | null
    if (!caseType) throw new ValidationError(`Procedure type "${value.caseTypeType}" not found for Hook binding`)
    return { scopeType: 'caseType', scopeKey: `caseType:${caseType.id}`, caseTypeId: caseType.id, procedureStepId: null, toolId: null }
  }
  if (value.scopeType === 'procedureStep') {
    if (!value.caseTypeType) throw new ValidationError('caseTypeType is required for ProcedureStep Hook bindings')
    if (!value.procedureStepId) throw new ValidationError('procedureStepId is required for ProcedureStep Hook bindings')
    const caseType = await repo.raw.caseType.findUnique({ where: { agentConfigId_type: { agentConfigId, type: value.caseTypeType } } }) as AnyRecord | null
    if (!caseType) throw new ValidationError(`Procedure type "${value.caseTypeType}" not found for Hook binding`)
    const procedure = parseProcedure(caseType.procedure)
    if (!procedure?.steps.some((step) => step.id === value.procedureStepId)) {
      throw new ValidationError(`Procedure step "${value.procedureStepId}" not found on "${value.caseTypeType}"`)
    }
    return { scopeType: 'procedureStep', scopeKey: `procedureStep:${caseType.id}:${value.procedureStepId}`, caseTypeId: caseType.id, procedureStepId: value.procedureStepId, toolId: null }
  }
  if (!value.toolName) throw new ValidationError('toolName is required for Tool Hook bindings')
  forbidProtectedTool(value.toolName)
  const tool = await repo.raw.tool.findUnique({ where: { agentConfigId_name: { agentConfigId, name: value.toolName } } }) as AnyRecord | null
  if (!tool) throw new ValidationError(`Tool "${value.toolName}" not found for Hook binding`)
  return { scopeType: 'tool', scopeKey: `tool:${tool.id}`, caseTypeId: null, procedureStepId: null, toolId: tool.id }
}

async function applyPatch(repo: RepoForOrg, audit: AuditWriter, agentConfigId: string, patch: ConfigPilotPatch): Promise<{ surface: ConfigPilotPatch['surface']; operation: string; target: string; artifact?: unknown }> {
  if (patch.surface === 'brain') {
    const before = await repo.raw.agentConfig.findUnique({ where: { id: agentConfigId } }) as AnyRecord | null
    const config = await repo.raw.agentConfig.update({ where: { id: agentConfigId }, data: agentData(patch.fields) })
    await audit({ action: 'configpilot.brain.update', target: `agent_config:${agentConfigId}`, before: before ?? undefined, after: config as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: 'Agent Brain' }
  }

  if (patch.surface === 'procedures' && patch.operation === 'create') {
    const caseType = await repo.raw.caseType.create({ data: caseTypeData(patch.value as AnyRecord, agentConfigId) as any })
    await audit({ action: 'configpilot.procedure.create', target: `case_type:${caseType.type}`, after: caseType as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: caseType.type, artifact: caseType }
  }
  if (patch.surface === 'procedures' && patch.operation === 'update') {
    const existing = await repo.raw.caseType.findUnique({ where: { agentConfigId_type: { agentConfigId, type: patch.target.type } } }) as AnyRecord | null
    if (!existing) throw new NotFoundError(`Procedure type "${patch.target.type}" not found`)
    const caseType = await repo.raw.caseType.update({ where: { agentConfigId_type: { agentConfigId, type: patch.target.type } }, data: caseTypeData(patch.fields as AnyRecord) })
    await audit({ action: 'configpilot.procedure.update', target: `case_type:${caseType.type}`, before: existing, after: caseType as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: caseType.type, artifact: caseType }
  }

  if (patch.surface === 'tools' && patch.operation === 'create') {
    forbidProtectedTool(patch.value.name)
    const tool = await repo.raw.tool.create({ data: toolData(patch.value as AnyRecord, agentConfigId) as any })
    await audit({ action: 'configpilot.tool.create', target: `tool:${tool.name}`, after: tool as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: tool.name, artifact: tool }
  }
  if (patch.surface === 'tools' && patch.operation === 'update') {
    forbidProtectedTool(patch.target.name)
    const existing = await repo.raw.tool.findUnique({ where: { agentConfigId_name: { agentConfigId, name: patch.target.name } } }) as AnyRecord | null
    if (!existing) throw new NotFoundError(`Tool "${patch.target.name}" not found`)
    if (patch.fields.name) forbidProtectedTool(patch.fields.name)
    const tool = await repo.raw.tool.update({ where: { agentConfigId_name: { agentConfigId, name: patch.target.name } }, data: toolData(patch.fields as AnyRecord) })
    await audit({ action: 'configpilot.tool.update', target: `tool:${tool.name}`, before: existing, after: tool as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: tool.name, artifact: tool }
  }

  if (patch.surface === 'hooks' && patch.operation === 'create') {
    const hook = await repo.raw.hook.create({ data: hookData(patch.value as AnyRecord, agentConfigId) as any })
    await audit({ action: 'configpilot.hook.create', target: `hook:${hook.name}`, after: hook as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: hook.name, artifact: hook }
  }
  if (patch.surface === 'hooks' && patch.operation === 'update') {
    const existing = await repo.raw.hook.findUnique({ where: { agentConfigId_name: { agentConfigId, name: patch.target.name } } }) as AnyRecord | null
    if (!existing) throw new NotFoundError(`Hook "${patch.target.name}" not found`)
    if (patch.fields.handlerKind && !patch.fields.handler) throw new ValidationError('Hook handler is required when changing handlerKind')
    const hook = await repo.raw.hook.update({ where: { agentConfigId_name: { agentConfigId, name: patch.target.name } }, data: hookData(patch.fields as AnyRecord) })
    await audit({ action: 'configpilot.hook.update', target: `hook:${hook.name}`, before: existing, after: hook as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: hook.name, artifact: hook }
  }

  if (patch.surface === 'hookBindings') {
    const hook = await repo.raw.hook.findUnique({ where: { agentConfigId_name: { agentConfigId, name: patch.value.hookName } } }) as AnyRecord | null
    if (!hook) throw new NotFoundError(`Hook "${patch.value.hookName}" not found`)
    const scope = await resolveHookBindingScope(repo, agentConfigId, patch.value as AnyRecord)
    const existing = await repo.raw.hookBinding.findFirst({ where: { agentConfigId, hookId: hook.id, scopeKey: scope.scopeKey } }) as AnyRecord | null
    if (existing) throw new ConflictError(`Hook "${hook.name}" is already bound to ${scope.scopeKey}`)
    const binding = await repo.raw.hookBinding.create({ data: { agentConfigId, hookId: hook.id, enabled: patch.value.enabled, ...scope } })
    await audit({ action: 'configpilot.hookBinding.create', target: `hook:${hook.name}/binding:${scope.scopeKey}`, after: binding as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: `${hook.name} -> ${scope.scopeKey}`, artifact: binding }
  }

  if (patch.surface === 'knowledge' && patch.operation === 'create') {
    const source = await repo.raw.knowledgeSource.create({ data: knowledgeData(patch.value as AnyRecord, agentConfigId) as any })
    await audit({ action: 'configpilot.knowledge.create', target: `knowledge:${source.name}`, after: source as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: source.name, artifact: source }
  }
  if (patch.surface === 'knowledge' && patch.operation === 'update') {
    const existing = await repo.raw.knowledgeSource.findUnique({ where: { agentConfigId_name: { agentConfigId, name: patch.target.name } } }) as AnyRecord | null
    if (!existing) throw new NotFoundError(`Knowledge source "${patch.target.name}" not found`)
    const source = await repo.raw.knowledgeSource.update({ where: { agentConfigId_name: { agentConfigId, name: patch.target.name } }, data: knowledgeData(patch.fields as AnyRecord) })
    await audit({ action: 'configpilot.knowledge.update', target: `knowledge:${source.name}`, before: existing, after: source as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: source.name, artifact: source }
  }

  if (patch.surface === 'integrations') {
    const data = integrationData(patch.fields as AnyRecord, patch.target.channel, agentConfigId)
    const binding = await repo.raw.channelBinding.upsert({
      where: { agentConfigId_channel: { agentConfigId, channel: patch.target.channel } },
      create: data as any,
      update: data as any,
    })
    await audit({ action: 'configpilot.integration.upsert', target: `integration:${binding.channel}`, after: binding as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: binding.channel, artifact: binding }
  }

  if (patch.surface === 'scenarios' && patch.operation === 'create') {
    const scenario = await saveScenario(agentConfigId, patch.value)
    await audit({ action: 'configpilot.scenario.create', target: `scenario:${scenario.name}`, after: scenario as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: scenario.name, artifact: scenario }
  }
  if (patch.surface === 'scenarios' && patch.operation === 'update') {
    const scenario = await updateScenario(agentConfigId, patch.target.name, patch.fields)
    if (!scenario) throw new NotFoundError(`Scenario "${patch.target.name}" not found`)
    await audit({ action: 'configpilot.scenario.update', target: `scenario:${scenario.name}`, after: scenario as Record<string, unknown> })
    return { surface: patch.surface, operation: patch.operation, target: scenario.name, artifact: scenario }
  }

  throw new ValidationError('Unsupported ConfigPilot patch')
}

export async function applyConfigPilotProposal(
  input: ConfigPilotApplyRequest,
  repo: RepoForOrg,
  audit: AuditWriter,
): Promise<ConfigPilotApplyResponse> {
  if (!input.accepted) {
    throw new ValidationError('Explicit user acceptance is required before ConfigPilot can apply a proposal')
  }

  const { draft, createdDraft } = await ensureDraft(repo, input.agentConfigId, audit)
  const applied = []
  const scenarios = []

  for (const patch of input.proposal.patches) {
    const result = await applyPatch(repo, audit, draft.id, patch)
    applied.push({ surface: result.surface, operation: result.operation, target: result.target })
    if (patch.surface === 'scenarios' && result.artifact) scenarios.push(result.artifact)
  }

  clearConfigCache(draft.id)
  await markScenarioValidationChanged([draft.id])
  const validation = await getScenarioValidationSummary(draft.id)

  return configPilotApplyResponseSchema.parse({
    appliedPatches: applied,
    draftAgentConfigId: draft.id,
    createdDraft,
    validation,
    artifacts: { scenarios },
  })
}

export function applyConfigPilotProposalEnvelope(
  input: ConfigPilotApplyRequest,
  repo: RepoForOrg,
  audit: AuditWriter,
) {
  return applyConfigPilotProposal(input, repo, audit).then((data) => apiOk(data))
}
