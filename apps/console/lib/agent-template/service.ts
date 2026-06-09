import {
  AGENT_TEMPLATE_SCHEMA_VERSION,
  interaAgentTemplateV1Schema,
  type InteraAgentTemplateV1,
  type TemplateSecretPlaceholder,
} from '@intera/shared/contracts/agent-template'
import {
  hookHandlerSchema,
  mapLegacyHookCheckpoint,
  type HookBindingContract,
  type HookContract,
  type HookHandler,
} from '@intera/shared/contracts/hooks'
import { procedureSchema } from '@intera/shared/contracts/case-types'
import { normalizeToolMode } from '@intera/shared/contracts/tools'
import { DEFAULT_MEMORY_STRATEGY, DEFAULT_MODEL } from '@intera/shared/defaults'

type AgentTemplateRepo = {
  orgId: string
  agentConfig: any
  raw: any
}

type AgentConfigRow = {
  id: string
  orgId: string
  name: string
  version: number
  parentId: string | null
  isActive: boolean
  model: string
  temperature: number
  thinkingBudget: number
  maxIterations: number
  coreSystemPrompt: string | null
  extendedThinking?: boolean
  maxOutputTokens: number | null
  memoryStrategy: string
  gptbotsApiKey?: string | null
  resumePrompt: string | null
}

export class AgentTemplateValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTemplateValidationError'
  }
}

export class AgentTemplateNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTemplateNotFoundError'
  }
}

export interface ExportAgentTemplateOptions {
  templateName?: string
}

export interface ImportAgentTemplateOptions {
  name?: string
  parentAgentConfigId?: string
}

export interface ImportAgentTemplateResult {
  config: {
    id: string
    name: string
    version: number
    parentId: string | null
    isActive: boolean
    model: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }
  imported: {
    caseTypes: number
    tools: number
    hooks: number
    hookBindings: number
    scenarios: number
    secretPlaceholders: number
  }
  warnings: string[]
}

const SECRET_PLACEHOLDER_RE = /^\{\{secret\.([a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*)\}\}$/
const SAFE_HEADER_NAMES = new Set(['accept', 'accept-language', 'content-type'])

class SecretRegistry {
  private readonly byName = new Map<string, TemplateSecretPlaceholder>()

  add(input: TemplateSecretPlaceholder): void {
    const name = toStableName(input.name, 'secret_placeholder')
    if (this.byName.has(name)) return
    this.byName.set(name, {
      ...input,
      name,
      required: input.required !== false,
    })
  }

  values(): TemplateSecretPlaceholder[] {
    return Array.from(this.byName.values()).sort((a, b) => a.name.localeCompare(b.name))
  }
}

export async function exportAgentTemplate(
  repo: AgentTemplateRepo,
  agentConfigId: string,
  options: ExportAgentTemplateOptions = {},
): Promise<InteraAgentTemplateV1> {
  const agent = await repo.agentConfig.findUnique({ where: { id: agentConfigId } }) as AgentConfigRow | null
  if (!agent) throw new AgentTemplateNotFoundError('Agent config not found')

  const [caseTypes, tools, hooks, hookBindings] = await Promise.all([
    repo.raw.caseType.findMany({ where: { agentConfigId }, orderBy: { type: 'asc' } }),
    repo.raw.tool.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }),
    repo.raw.hook.findMany({ where: { agentConfigId }, orderBy: { name: 'asc' } }),
    repo.raw.hookBinding.findMany({ where: { agentConfigId }, orderBy: [{ scopeType: 'asc' }, { scopeKey: 'asc' }] }),
  ])

  const secrets = new SecretRegistry()
  if (agent.gptbotsApiKey) {
    secrets.add({
      name: 'gptbots_api_key',
      description: 'GPTBots API key for the imported Agent configuration.',
      required: false,
      exampleRef: 'agent.gptbotsApiKey',
    })
  }

  const caseTypeById = new Map<string, any>(caseTypes.map((ct: any) => [ct.id, ct]))
  const toolById = new Map<string, any>(tools.map((tool: any) => [tool.id, tool]))
  const hookById = new Map<string, any>(hooks.map((hook: any) => [hook.id, hook]))

  const template: InteraAgentTemplateV1 = interaAgentTemplateV1Schema.parse({
    schemaVersion: AGENT_TEMPLATE_SCHEMA_VERSION,
    metadata: {
      templateId: toStableName(options.templateName ?? agent.name, 'agent_template'),
      name: options.templateName?.trim() || agent.name,
      locales: ['en-US', 'zh-CN'],
    },
    agent: compactRecord({
      name: agent.name,
      model: agent.model,
      temperature: agent.temperature,
      thinkingBudget: agent.thinkingBudget,
      maxIterations: agent.maxIterations,
      coreSystemPrompt: agent.coreSystemPrompt ?? undefined,
      memoryStrategy: parseJson(agent.memoryStrategy, {}),
      maxOutputTokens: agent.maxOutputTokens ?? undefined,
      resumePrompt: agent.resumePrompt ?? undefined,
      extendedThinking: agent.extendedThinking,
      gptbotsApiKeyRef: agent.gptbotsApiKey ? '{{secret.gptbots_api_key}}' : undefined,
    }),
    caseTypes: caseTypes.map((ct: any) => exportCaseType(ct)),
    tools: tools.map((tool: any) => exportTool(tool, secrets)),
    hooks: hooks.map((hook: any) => exportHook(hook, secrets)),
    hookBindings: hookBindings
      .map((binding: any) => exportHookBinding(binding, hookById, caseTypeById, toolById))
      .filter((binding: HookBindingContract | null): binding is HookBindingContract => binding !== null),
    scenarios: [],
    secrets: secrets.values(),
    legacy: compactRecord({
      caseTypes: caseTypes.map((ct: any) => sanitizeLegacyRow(ct)),
      skills: tools.map((tool: any) => sanitizeLegacyRow(tool)),
    }),
  })

  return template
}

export async function importAgentTemplate(
  repo: AgentTemplateRepo,
  input: unknown,
  options: ImportAgentTemplateOptions = {},
): Promise<ImportAgentTemplateResult> {
  const parsed = interaAgentTemplateV1Schema.safeParse(input)
  if (!parsed.success) {
    throw new AgentTemplateValidationError(parsed.error.issues.map((issue) => issue.message).join('; '))
  }
  const template = parsed.data
  assertUniqueNames('case type', template.caseTypes.map((ct) => ct.type))
  assertUniqueNames('tool', template.tools.map((tool) => tool.name))
  assertUniqueNames('hook', template.hooks.map((hook) => hook.name))
  assertUniqueNames('scenario', template.scenarios.map((scenario) => scenario.name))
  validateTemplateReferences(template)

  await repo.raw.organization.upsert({
    where: { id: repo.orgId },
    update: {},
    create: { id: repo.orgId, name: 'Demo Org' },
  })

  const parent = options.parentAgentConfigId
    ? await repo.agentConfig.findUnique({ where: { id: options.parentAgentConfigId } }) as AgentConfigRow | null
    : null
  if (options.parentAgentConfigId && !parent) {
    throw new AgentTemplateNotFoundError('Parent agent config not found')
  }

  const config = await createDraftAgentConfig(repo, template, options, parent)
  const warnings: string[] = []
  const registry = new SecretRegistry()
  for (const secret of template.secrets ?? []) registry.add(secret)

  const counts = await repo.raw.$transaction(async (tx: any) => {
    const toolsByName = new Map<string, { id: string }>()
    const caseTypesByName = new Map<string, { id: string; procedure?: { steps: Array<{ id: string }> } }>()
    const hooksByName = new Map<string, { id: string }>()

    for (const tool of template.tools) {
      const headers = sanitizeHeaders(tool.headers, registry, `tool_${tool.name}`)
      const created = await tx.tool.create({
        data: {
          agentConfigId: config.id,
          name: tool.name,
          description: tool.description,
          inputSchema: JSON.stringify(tool.inputSchema ?? {}),
          outputSchema: JSON.stringify(tool.outputSchema ?? {}),
          mode: tool.mode,
          endpoint: tool.endpoint ?? null,
          httpMethod: tool.httpMethod ?? 'POST',
          headers: headers ? JSON.stringify(headers) : null,
          timeoutMs: tool.timeoutMs ?? 8000,
          mockFixture: tool.staticFixture === undefined ? null : JSON.stringify(tool.staticFixture),
          guardPhase: typeof tool.legacy?.guardPhase === 'string' ? tool.legacy.guardPhase : 'post',
          displayVerb: tool.displayVerb ? JSON.stringify(tool.displayVerb) : null,
          renderHints: tool.renderHints ? JSON.stringify(tool.renderHints) : null,
          toolCategory: tool.toolCategory ?? null,
          isConcurrencySafe: tool.isConcurrencySafe !== false,
          enabled: tool.enabled !== false,
        },
      })
      toolsByName.set(tool.name, created)
    }

    for (const ct of template.caseTypes) {
      const created = await tx.caseType.create({
        data: {
          agentConfigId: config.id,
          type: ct.type,
          displayName: ct.displayName,
          description: ct.description ?? null,
          icon: ct.icon ?? '📋',
          requiredFacts: JSON.stringify(ct.requiredFacts ?? []),
          defaultGoal: ct.defaultGoal ?? '',
          escalateOn: JSON.stringify(ct.escalateOn ?? []),
          autoCloseConditions: ct.autoCloseConditions ? JSON.stringify(ct.autoCloseConditions) : null,
          enabled: ct.enabled !== false,
          procedure: ct.procedure ? JSON.stringify(ct.procedure) : null,
          maxAutoTurns: ct.maxAutoTurns ?? 10,
        },
      })
      caseTypesByName.set(ct.type, { id: created.id, procedure: ct.procedure })
    }

    for (const hook of template.hooks) {
      const handler = sanitizeHookHandler(hook.handler, registry, `hook_${hook.name}`)
      const created = await tx.hook.create({
        data: {
          agentConfigId: config.id,
          name: hook.name,
          displayName: hook.displayName ?? null,
          description: hook.description ?? null,
          checkpoint: hook.checkpoint,
          handlerKind: handler.kind,
          handler: JSON.stringify(handler),
          enabled: hook.enabled !== false,
          severity: hook.severity ?? 'medium',
        },
      })
      hooksByName.set(hook.name, created)
    }

    let hookBindingCount = 0
    for (const binding of template.hookBindings) {
      const hook = hooksByName.get(binding.hookName)
      if (!hook) {
        throw new AgentTemplateValidationError(`HookBinding references unknown hook "${binding.hookName}"`)
      }
      const scope = resolveImportedScope(binding, caseTypesByName, toolsByName)
      await tx.hookBinding.create({
        data: {
          agentConfigId: config.id,
          hookId: hook.id,
          scopeType: binding.scopeType,
          scopeKey: scope.scopeKey,
          caseTypeId: scope.caseTypeId ?? null,
          procedureStepId: scope.procedureStepId ?? null,
          toolId: scope.toolId ?? null,
          enabled: binding.enabled !== false,
        },
      })
      hookBindingCount += 1
    }

    return {
      caseTypes: template.caseTypes.length,
      tools: template.tools.length,
      hooks: template.hooks.length,
      hookBindings: hookBindingCount,
    }
  })

  if (template.scenarios.length > 0) {
    warnings.push('Scenario definitions are validated in the package but are not persisted until Scenario storage lands.')
  }

  return {
    config,
    imported: {
      ...counts,
      scenarios: 0,
      secretPlaceholders: registry.values().length,
    },
    warnings,
  }
}

function validateTemplateReferences(template: InteraAgentTemplateV1): void {
  const caseTypesByName = new Map(template.caseTypes.map((ct) => [ct.type, ct]))
  const toolsByName = new Set(template.tools.map((tool) => tool.name))
  const hooksByName = new Set(template.hooks.map((hook) => hook.name))

  for (const binding of template.hookBindings) {
    if (!hooksByName.has(binding.hookName)) {
      throw new AgentTemplateValidationError(`HookBinding references unknown hook "${binding.hookName}"`)
    }
    if (binding.scopeType === 'caseType') {
      const caseTypeName = binding.caseTypeName ?? parseScopeName(binding.scopeKey, 'caseType')
      if (!caseTypeName || !caseTypesByName.has(caseTypeName)) {
        throw new AgentTemplateValidationError(`HookBinding references unknown CaseType "${caseTypeName ?? binding.scopeKey}"`)
      }
    }
    if (binding.scopeType === 'procedureStep') {
      const parsed = parseProcedureScope(binding.scopeKey)
      const caseTypeName = binding.caseTypeName ?? parsed?.caseTypeName
      const caseType = caseTypeName ? caseTypesByName.get(caseTypeName) : undefined
      if (!caseTypeName || !caseType) {
        throw new AgentTemplateValidationError(`HookBinding references unknown CaseType "${caseTypeName ?? binding.scopeKey}"`)
      }
      const stepExists = caseType.procedure?.steps.some((step) => step.id === binding.procedureStepId)
      if (!stepExists) {
        throw new AgentTemplateValidationError(`HookBinding references unknown ProcedureStep "${binding.procedureStepId}" in CaseType "${caseTypeName}"`)
      }
    }
    if (binding.scopeType === 'tool') {
      const toolName = binding.toolName ?? parseScopeName(binding.scopeKey, 'tool')
      if (!toolName || !toolsByName.has(toolName)) {
        throw new AgentTemplateValidationError(`HookBinding references unknown Tool "${toolName ?? binding.scopeKey}"`)
      }
    }
  }
}

function exportCaseType(ct: any) {
  const procedure = procedureSchema.safeParse(parseJsonLoose(ct.procedure))
  const legacy = compactRecord({ id: ct.id })

  return compactRecord({
    type: ct.type,
    displayName: ct.displayName,
    description: ct.description ?? undefined,
    icon: ct.icon ?? undefined,
    requiredFacts: parseStringArray(ct.requiredFacts),
    defaultGoal: ct.defaultGoal ?? '',
    escalateOn: parseStringArray(ct.escalateOn),
    autoCloseConditions: parseRecord(ct.autoCloseConditions) ?? undefined,
    enabled: ct.enabled !== false,
    procedure: procedure.success ? procedure.data : undefined,
    maxAutoTurns: clampPositiveInt(ct.maxAutoTurns, 10, 50),
    legacy,
  })
}

function exportTool(tool: any, secrets: SecretRegistry) {
  const headers = sanitizeHeaders(parseHeaders(tool.headers), secrets, `tool_${tool.name}`)
  const displayVerb = parseRecord(tool.displayVerb)
  const renderHints = parseRecord(tool.renderHints)
  const toolCategory = tool.toolCategory === 'system_info' || tool.toolCategory === 'operational'
    ? tool.toolCategory
    : undefined

  return compactRecord({
    name: tool.name,
    description: tool.description ?? '',
    mode: normalizeToolMode(tool.mode),
    inputSchema: parseRecord(tool.inputSchema) ?? {},
    outputSchema: parseRecord(tool.outputSchema) ?? {},
    endpoint: tool.endpoint ?? undefined,
    httpMethod: tool.httpMethod === 'GET' ? 'GET' : 'POST',
    headers: headers ?? undefined,
    timeoutMs: clampPositiveInt(tool.timeoutMs, 8000, 30000),
    staticFixture: parseJsonLoose(tool.mockFixture),
    displayVerb: displayVerb && typeof displayVerb.text === 'string' ? displayVerb : undefined,
    renderHints: renderHints ?? undefined,
    toolCategory,
    isConcurrencySafe: tool.isConcurrencySafe !== false,
    enabled: tool.enabled !== false,
    legacy: compactRecord({
      id: tool.id,
      mode: tool.mode,
      mockFixture: parseJsonLoose(tool.mockFixture),
      guardPhase: tool.guardPhase,
    }),
  })
}

function exportHook(hook: any, secrets: SecretRegistry): HookContract {
  const rawHandler = parseJsonLoose(hook.handler)
  const parsed = hookHandlerSchema.safeParse(rawHandler)
  const handler = parsed.success
    ? sanitizeHookHandler(parsed.data, secrets, `hook_${hook.name}`)
    : {
      kind: 'declarative' as const,
      check: { legacyUnsupportedHandler: true },
      effect: { decision: 'warn', guidance: 'Legacy handler could not be parsed during export.' },
      legacy: { rawHandler },
    }

  return {
    name: hook.name,
    displayName: hook.displayName ?? undefined,
    description: hook.description ?? undefined,
    checkpoint: mapLegacyHookCheckpoint(hook.checkpoint),
    handlerKind: handler.kind,
    handler,
    enabled: hook.enabled !== false,
    severity: hook.severity ?? 'medium',
  }
}

function exportHookBinding(
  binding: any,
  hookById: Map<string, any>,
  caseTypeById: Map<string, any>,
  toolById: Map<string, any>,
): HookBindingContract | null {
  const hook = hookById.get(binding.hookId)
  if (!hook) return null

  if (binding.scopeType === 'agent') {
    return { hookName: hook.name, enabled: binding.enabled !== false, scopeType: 'agent', scopeKey: 'agent' }
  }
  if (binding.scopeType === 'caseType') {
    const caseType = binding.caseTypeId ? caseTypeById.get(binding.caseTypeId) : undefined
    const caseTypeName = caseType?.type ?? parseScopeName(binding.scopeKey, 'caseType')
    if (!caseTypeName) return null
    return {
      hookName: hook.name,
      enabled: binding.enabled !== false,
      scopeType: 'caseType',
      scopeKey: `caseType:${caseTypeName}`,
      caseTypeName,
    }
  }
  if (binding.scopeType === 'procedureStep') {
    const caseType = binding.caseTypeId ? caseTypeById.get(binding.caseTypeId) : undefined
    const parsedScope = parseProcedureScope(binding.scopeKey)
    const caseTypeName = caseType?.type ?? parsedScope?.caseTypeName
    const procedureStepId = binding.procedureStepId ?? parsedScope?.procedureStepId
    if (!caseTypeName || !procedureStepId) return null
    return {
      hookName: hook.name,
      enabled: binding.enabled !== false,
      scopeType: 'procedureStep',
      scopeKey: `procedureStep:${caseTypeName}:${procedureStepId}`,
      caseTypeName,
      procedureStepId,
    }
  }
  if (binding.scopeType === 'tool') {
    const tool = binding.toolId ? toolById.get(binding.toolId) : undefined
    const toolName = tool?.name ?? parseScopeName(binding.scopeKey, 'tool')
    if (!toolName) return null
    return {
      hookName: hook.name,
      enabled: binding.enabled !== false,
      scopeType: 'tool',
      scopeKey: `tool:${toolName}`,
      toolName,
    }
  }
  return null
}

async function createDraftAgentConfig(
  repo: AgentTemplateRepo,
  template: InteraAgentTemplateV1,
  options: ImportAgentTemplateOptions,
  parent: AgentConfigRow | null,
): Promise<ImportAgentTemplateResult['config']> {
  const agent = template.agent as Record<string, unknown>
  const name = (options.name || parent?.name || stringOrUndefined(agent.name) || template.metadata.name).trim()
  const memoryStrategy = JSON.stringify(isRecord(agent.memoryStrategy)
    ? agent.memoryStrategy
    : parent ? parseJson(parent.memoryStrategy, DEFAULT_MEMORY_STRATEGY) : DEFAULT_MEMORY_STRATEGY)

  for (let attempt = 0; attempt < 5; attempt++) {
    const max = await repo.agentConfig.findFirst({
      where: { name },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const version = (max?.version ?? 0) + 1
    try {
      return await repo.agentConfig.create({
        data: {
          name,
          version,
          isActive: false,
          parentId: parent?.id ?? null,
          model: stringOrUndefined(agent.model) ?? parent?.model ?? DEFAULT_MODEL,
          temperature: typeof agent.temperature === 'number' ? agent.temperature : parent?.temperature ?? 0.5,
          thinkingBudget: intOrUndefined(agent.thinkingBudget) ?? parent?.thinkingBudget ?? 4096,
          maxIterations: intOrUndefined(agent.maxIterations) ?? parent?.maxIterations ?? 20,
          maxOutputTokens: intOrUndefined(agent.maxOutputTokens) ?? parent?.maxOutputTokens ?? 4096,
          coreSystemPrompt: stringOrUndefined(agent.coreSystemPrompt) ?? parent?.coreSystemPrompt ?? null,
          extendedThinking: typeof agent.extendedThinking === 'boolean' ? agent.extendedThinking : parent?.extendedThinking ?? false,
          memoryStrategy,
          gptbotsApiKey: null,
          resumePrompt: stringOrUndefined(agent.resumePrompt) ?? parent?.resumePrompt ?? null,
        },
        select: {
          id: true,
          name: true,
          version: true,
          parentId: true,
          isActive: true,
          model: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    } catch (err: unknown) {
      if ((err as any)?.code === 'P2002') continue
      throw err
    }
  }
  throw new AgentTemplateValidationError('Could not allocate a new draft Agent version')
}

function resolveImportedScope(
  binding: HookBindingContract,
  caseTypesByName: Map<string, { id: string; procedure?: { steps: Array<{ id: string }> } }>,
  toolsByName: Map<string, { id: string }>,
): { scopeKey: string; caseTypeId?: string; procedureStepId?: string; toolId?: string } {
  if (binding.scopeType === 'agent') return { scopeKey: 'agent' }

  if (binding.scopeType === 'caseType') {
    const caseTypeName = binding.caseTypeName ?? parseScopeName(binding.scopeKey, 'caseType')
    const caseType = caseTypeName ? caseTypesByName.get(caseTypeName) : undefined
    if (!caseType || !caseTypeName) {
      throw new AgentTemplateValidationError(`HookBinding references unknown CaseType "${caseTypeName ?? binding.scopeKey}"`)
    }
    return { scopeKey: `caseType:${caseType.id}`, caseTypeId: caseType.id }
  }

  if (binding.scopeType === 'procedureStep') {
    const parsed = parseProcedureScope(binding.scopeKey)
    const caseTypeName = binding.caseTypeName ?? parsed?.caseTypeName
    const caseType = caseTypeName ? caseTypesByName.get(caseTypeName) : undefined
    if (!caseType || !caseTypeName) {
      throw new AgentTemplateValidationError(`HookBinding references unknown CaseType "${caseTypeName ?? binding.scopeKey}"`)
    }
    const stepExists = caseType.procedure?.steps.some((step) => step.id === binding.procedureStepId)
    if (!stepExists) {
      throw new AgentTemplateValidationError(`HookBinding references unknown ProcedureStep "${binding.procedureStepId}" in CaseType "${caseTypeName}"`)
    }
    return {
      scopeKey: `procedureStep:${caseType.id}:${binding.procedureStepId}`,
      caseTypeId: caseType.id,
      procedureStepId: binding.procedureStepId,
    }
  }

  const toolName = binding.toolName ?? parseScopeName(binding.scopeKey, 'tool')
  const tool = toolName ? toolsByName.get(toolName) : undefined
  if (!tool || !toolName) {
    throw new AgentTemplateValidationError(`HookBinding references unknown Tool "${toolName ?? binding.scopeKey}"`)
  }
  return { scopeKey: `tool:${tool.id}`, toolId: tool.id }
}

function sanitizeHookHandler(handler: HookHandler, secrets: SecretRegistry, owner: string): HookHandler {
  if (handler.kind !== 'http') return handler
  const headers = sanitizeHeaders(handler.headers, secrets, owner)
  for (const secretRef of handler.secretRefs ?? []) {
    secrets.add({
      name: secretRef.name,
      description: `Secret reference for ${owner}.`,
      required: true,
      exampleRef: secretRef.ref,
    })
  }
  return compactRecord({
    ...handler,
    headers: headers ?? undefined,
  }) as HookHandler
}

function sanitizeHeaders(
  headers: Record<string, string> | undefined | null,
  secrets: SecretRegistry,
  owner: string,
): Record<string, string> | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined
  const output: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(headers)) {
    const value = String(rawValue)
    const placeholder = value.match(SECRET_PLACEHOLDER_RE)
    if (placeholder) {
      output[key] = value
      secrets.add({
        name: placeholder[1],
        description: `Secret placeholder for ${owner} ${key} header.`,
        required: true,
        exampleRef: `headers.${key}`,
      })
      continue
    }
    if (value.startsWith('secret://')) {
      const name = toStableName(value.split('/').filter(Boolean).pop() ?? `${owner}_${key}`, `${owner}_${key}`)
      output[key] = value
      secrets.add({
        name,
        description: `Secret reference for ${owner} ${key} header.`,
        required: true,
        exampleRef: value,
      })
      continue
    }
    const lower = key.toLowerCase()
    if (SAFE_HEADER_NAMES.has(lower)) {
      output[key] = value
      continue
    }
    const secretName = toStableName(`${owner}_${key}`, `${owner}_header`)
    output[key] = `{{secret.${secretName}}}`
    secrets.add({
      name: secretName,
      description: `Secret placeholder for ${owner} ${key} header.`,
      required: true,
      exampleRef: `headers.${key}`,
    })
  }
  return output
}

function sanitizeLegacyRow(row: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    copy[key] = sanitizeLegacyValue(key, value)
  }
  return copy
}

function sanitizeLegacyValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase()
  if (lower.includes('apikey') || lower.includes('api_key') || lower.includes('secret') || lower.includes('token') || lower.includes('password')) {
    return value ? '{{secret.redacted}}' : value
  }
  if (lower === 'headers') return sanitizeLegacyHeaders(value)

  const parsed = typeof value === 'string' ? parseJsonLoose(value) : value
  if (parsed !== undefined && parsed !== value) return sanitizeLegacyUnknown(parsed)
  return sanitizeLegacyUnknown(value)
}

function sanitizeLegacyUnknown(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => sanitizeLegacyUnknown(item))
  if (!isRecord(value)) return value

  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    out[key] = sanitizeLegacyValue(key, nested)
  }
  return out
}

function sanitizeLegacyHeaders(value: unknown): unknown {
  const record = parseRecord(value)
  if (!record) return value
  const masked: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(record)) {
    masked[key] = SAFE_HEADER_NAMES.has(key.toLowerCase()) ? raw : '{{secret.redacted}}'
  }
  return masked
}

function parseHeaders(value: unknown): Record<string, string> | undefined {
  const record = parseRecord(value)
  if (!record) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (raw === null || raw === undefined) continue
    out[key] = String(raw)
  }
  return out
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJsonLoose(value)
  return isRecord(parsed) ? parsed : undefined
}

function parseJson<T>(value: unknown, fallback: T): T {
  const parsed = parseJsonLoose(value)
  return parsed === undefined ? fallback : parsed as T
}

function parseJsonLoose(value: unknown): unknown | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseStringArray(value: unknown): string[] {
  return asStringArray(parseJsonLoose(value), [])
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) out[key] = value
  }
  return out as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function intOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function clampPositiveInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, Math.max(1, Math.floor(n)))
}

function assertUniqueNames(kind: string, names: string[]): void {
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) throw new AgentTemplateValidationError(`Duplicate ${kind} name "${name}" in package`)
    seen.add(name)
  }
}

function parseScopeName(scopeKey: string, prefix: 'caseType' | 'tool'): string | undefined {
  const expected = `${prefix}:`
  return scopeKey.startsWith(expected) ? scopeKey.slice(expected.length) : undefined
}

function parseProcedureScope(scopeKey: string): { caseTypeName: string; procedureStepId: string } | undefined {
  if (!scopeKey.startsWith('procedureStep:')) return undefined
  const [, caseTypeName, ...rest] = scopeKey.split(':')
  const procedureStepId = rest.join(':')
  return caseTypeName && procedureStepId ? { caseTypeName, procedureStepId } : undefined
}

function toStableName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+/g, '_')
    .replace(/[_.-]+$/g, '')
  return cleaned || fallback
}
