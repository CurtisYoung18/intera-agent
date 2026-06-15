// Intera Harness - Hook Engine
//
// Evaluates customer-service runtime Hooks at the first launch checkpoints:
// PreToolUse, PostToolUse, and Stop. Activation is additive across agent,
// CaseType, ProcedureStep, and Tool bindings.

import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_MEMORY_MODEL } from '@intera/shared/memory/contract'
import {
  hookCheckpointSchema,
  hookContextSchema,
  hookDecisionSchema,
  hookHandlerSchema,
  type HookCheckpoint,
  type HookContext,
  type HookDecision,
  type HookDecisionAction,
  type HookHandler,
  type HookSeverity,
  type HookScopeType,
} from '@intera/shared/contracts/hooks'
import { createAgentClient } from './api/provider-config'
import { withRetry, CannotRetryError } from './api/with-retry'

export interface PendingHookToolCall {
  tool: string
  reason: string
  hookName: string
}

export interface HookCheckResult {
  hookName: string
  action: HookDecisionAction
  checkpoint: HookCheckpoint
  reason?: string
  guidance?: string
  severity?: HookSeverity
  trace?: Record<string, unknown>
  modelUsed?: string
  scopeTypes?: HookScopeType[]
}

export interface HookEvaluationResult {
  checkpoint: HookCheckpoint
  results: HookCheckResult[]
  summary: HookDecisionAction
  feedbackMessage?: string
  pendingToolCalls?: PendingHookToolCall[]
}

export interface HookEngineCreateOptions {
  caseType?: {
    type: string
    displayName?: string
  } | null
}

interface RuntimeHook {
  id: string
  name: string
  description?: string | null
  checkpoint: HookCheckpoint
  handler: HookHandler
  handlerKind: 'declarative' | 'code' | 'http'
  enabled: boolean
  severity: HookSeverity
  bindings: RuntimeHookBinding[]
}

interface RuntimeHookBinding {
  scopeType: HookScopeType
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  toolId?: string | null
  enabled: boolean
}

interface DbHookRow {
  id: string
  name: string
  description?: string | null
  checkpoint: string
  handlerKind: string
  handler: string
  enabled: boolean
  severity?: string | null
}

interface DbHookBindingRow {
  scopeType: string
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  toolId?: string | null
  enabled: boolean
  hook: DbHookRow
}

const ACTION_RANK: Record<HookDecisionAction, number> = {
  allow: 0,
  warn: 1,
  block: 2,
  escalate: 3,
}

const SAFE_TOOL_ALLOWLIST = new Set(['create_human_task', 'ask_user_questions'])
const DEFAULT_FALLBACK_TOOL = 'create_human_task'
const DEFAULT_CODE_TIMEOUT_MS = 100
const DEFAULT_HTTP_TIMEOUT_MS = 5000

export class HookEngine {
  private hooks: RuntimeHook[] = []
  private toolIdsByName = new Map<string, string>()
  private caseTypeId?: string
  private caseTypeType?: string
  private hookModel: string
  private llmClient: Anthropic

  constructor(private readonly agentConfigId: string) {
    this.hookModel = process.env.HOOK_EVAL_MODEL || process.env.POLICY_EVAL_MODEL || DEFAULT_MEMORY_MODEL
    this.llmClient = createAgentClient(this.hookModel)
  }

  static async create(agentConfigId: string, options: HookEngineCreateOptions = {}): Promise<HookEngine> {
    const engine = new HookEngine(agentConfigId)
    engine.caseTypeType = options.caseType?.type

    try {
      const { prisma } = await import('@intera/shared/prisma')

      const dbTools = await prisma.tool.findMany({
        where: { agentConfigId },
        select: { id: true, name: true },
      })
      for (const tool of dbTools) {
        engine.toolIdsByName.set(tool.name, tool.id)
      }

      if (options.caseType?.type) {
        const caseType = await prisma.caseType.findUnique({
          where: { agentConfigId_type: { agentConfigId, type: options.caseType.type } },
          select: { id: true, type: true },
        })
        engine.caseTypeId = caseType?.id
      }

      const rows = await prisma.hookBinding.findMany({
        where: {
          agentConfigId,
          enabled: true,
          hook: { enabled: true },
        },
        include: { hook: true },
      })

      engine.loadBindings(rows as DbHookBindingRow[])
    } catch (err) {
      console.warn('[HookEngine] Failed to load Hooks from DB:', err)
    }

    return engine
  }

  getHookNames(): string[] {
    return this.hooks.map((h) => h.name)
  }

  setHook(
    hook: {
      id?: string
      name: string
      description?: string | null
      checkpoint: HookCheckpoint
      handlerKind?: 'declarative' | 'code' | 'http'
      handler: HookHandler | string
      severity?: HookSeverity
      enabled?: boolean
    },
    bindings: Array<Partial<RuntimeHookBinding>> = [{ scopeType: 'agent', scopeKey: 'agent', enabled: true }],
  ): void {
    const handler = typeof hook.handler === 'string'
      ? hookHandlerSchema.parse(JSON.parse(hook.handler))
      : hookHandlerSchema.parse(hook.handler)

    this.hooks.push({
      id: hook.id ?? hook.name,
      name: hook.name,
      description: hook.description,
      checkpoint: hookCheckpointSchema.parse(hook.checkpoint),
      handlerKind: hook.handlerKind ?? handler.kind,
      handler,
      enabled: hook.enabled ?? true,
      severity: hook.severity ?? 'medium',
      bindings: bindings.map((b) => ({
        scopeType: (b.scopeType ?? 'agent') as HookScopeType,
        scopeKey: b.scopeKey ?? 'agent',
        caseTypeId: b.caseTypeId ?? null,
        procedureStepId: b.procedureStepId ?? null,
        toolId: b.toolId ?? null,
        enabled: b.enabled ?? true,
      })),
    })
  }

  async evaluate(
    checkpoint: HookCheckpoint,
    rawContext: Omit<HookContext, 'checkpoint'> | HookContext,
    hitCounts?: Map<string, number>,
  ): Promise<HookEvaluationResult> {
    const context = hookContextSchema.parse({
      ...rawContext,
      checkpoint,
      agentConfigId: (rawContext as HookContext).agentConfigId ?? this.agentConfigId,
    })

    const activeHooks = this.hooks
      .filter((hook) => hook.enabled && hook.checkpoint === checkpoint)
      .map((hook) => ({
        hook,
        bindings: hook.bindings.filter((binding) => this.bindingApplies(binding, context)),
      }))
      .filter((entry) => entry.bindings.length > 0)

    if (activeHooks.length === 0) {
      return { checkpoint, results: [], summary: 'allow' }
    }

    const results: HookCheckResult[] = []
    const pendingToolCalls: PendingHookToolCall[] = []

    for (const entry of activeHooks) {
      const { hook } = entry
      let decision: HookDecision | null

      try {
        decision = await this.dispatchHook(hook, context)
      } catch (err) {
        decision = {
          action: 'block',
          reason: `Hook execution failed: ${err instanceof Error ? err.message : String(err)}`,
          guidance: 'Route this case to a human if the Hook cannot be evaluated safely.',
          severity: hook.severity,
        }
      }

      if (!decision) continue

      const parsed = hookDecisionSchema.safeParse(decision)
      const safeDecision = parsed.success
        ? parsed.data
        : {
            action: 'block' as const,
            reason: 'Hook returned an invalid decision payload.',
            guidance: 'Route this case to a human if the Hook cannot be evaluated safely.',
            severity: hook.severity,
          }

      const result: HookCheckResult = {
        hookName: hook.name,
        checkpoint,
        action: safeDecision.action,
        reason: safeDecision.reason,
        guidance: safeDecision.guidance,
        severity: safeDecision.severity ?? hook.severity,
        trace: safeDecision.trace,
        scopeTypes: [...new Set(entry.bindings.map((b) => b.scopeType))],
      }
      results.push(result)

      const tool = this.pendingToolForDecision(hook, safeDecision)
      if (tool) {
        pendingToolCalls.push({
          tool,
          reason: safeDecision.reason || safeDecision.guidance || `Hook "${hook.name}" escalated`,
          hookName: hook.name,
        })
      }
    }

    const summary = results.reduce<HookDecisionAction>(
      (worst, result) => (ACTION_RANK[result.action] > ACTION_RANK[worst] ? result.action : worst),
      'allow',
    )

    const feedbackMessage = this.buildFeedbackMessage(checkpoint, results, summary, hitCounts)
    return {
      checkpoint,
      results,
      summary,
      feedbackMessage,
      ...(pendingToolCalls.length > 0 ? { pendingToolCalls } : {}),
    }
  }

  private loadBindings(rows: DbHookBindingRow[]): void {
    const byHookId = new Map<string, RuntimeHook>()

    for (const row of rows) {
      if (!row.enabled) continue
      const hookRow = row.hook
      if (!hookRow?.enabled) continue

      let runtimeHook = byHookId.get(hookRow.id)
      if (!runtimeHook) {
        const parsed = this.parseHookRow(hookRow)
        if (!parsed) continue
        runtimeHook = parsed
        byHookId.set(hookRow.id, runtimeHook)
        this.hooks.push(runtimeHook)
      }

      const scopeType = this.parseScopeType(row.scopeType)
      if (!scopeType) continue
      runtimeHook.bindings.push({
        scopeType,
        scopeKey: row.scopeKey,
        caseTypeId: row.caseTypeId ?? null,
        procedureStepId: row.procedureStepId ?? null,
        toolId: row.toolId ?? null,
        enabled: row.enabled,
      })
    }
  }

  private parseHookRow(row: DbHookRow): RuntimeHook | null {
    const checkpoint = hookCheckpointSchema.safeParse(row.checkpoint)
    if (!checkpoint.success) {
      console.warn(`[HookEngine] Hook "${row.name}" has invalid checkpoint "${row.checkpoint}"`)
      return null
    }

    try {
      const handler = hookHandlerSchema.parse(JSON.parse(row.handler))
      const handlerKind = handler.kind
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        checkpoint: checkpoint.data,
        handler,
        handlerKind,
        enabled: row.enabled,
        severity: this.parseSeverity(row.severity),
        bindings: [],
      }
    } catch (err) {
      console.warn(`[HookEngine] Failed to parse handler for Hook "${row.name}":`, err)
      return null
    }
  }

  private parseScopeType(value: string): HookScopeType | null {
    if (value === 'agent' || value === 'caseType' || value === 'procedureStep' || value === 'tool') {
      return value
    }
    return null
  }

  private parseSeverity(value: string | null | undefined): HookSeverity {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
      ? value
      : 'medium'
  }

  private bindingApplies(binding: RuntimeHookBinding, context: HookContext): boolean {
    if (!binding.enabled) return false

    switch (binding.scopeType) {
      case 'agent':
        return binding.scopeKey === 'agent'
      case 'caseType': {
        const caseTypeKeys = new Set<string>()
        if (this.caseTypeId) caseTypeKeys.add(`caseType:${this.caseTypeId}`)
        if (this.caseTypeType) caseTypeKeys.add(`caseType:${this.caseTypeType}`)
        if (context.caseType?.id) caseTypeKeys.add(`caseType:${context.caseType.id}`)
        if (context.caseType?.type) caseTypeKeys.add(`caseType:${context.caseType.type}`)
        return (
          (!!binding.caseTypeId && (binding.caseTypeId === this.caseTypeId || binding.caseTypeId === context.caseType?.id)) ||
          caseTypeKeys.has(binding.scopeKey)
        )
      }
      case 'procedureStep': {
        const stepIds = new Set(context.procedureStepIds ?? [])
        if (stepIds.size === 0) return false
        if (binding.procedureStepId && stepIds.has(binding.procedureStepId)) return true
        for (const stepId of stepIds) {
          if (binding.scopeKey.endsWith(`:${stepId}`)) return true
          if (this.caseTypeId && binding.scopeKey === `procedureStep:${this.caseTypeId}:${stepId}`) return true
          if (this.caseTypeType && binding.scopeKey === `procedureStep:${this.caseTypeType}:${stepId}`) return true
        }
        return false
      }
      case 'tool': {
        const toolName = context.tool?.name
        if (!toolName) return false
        const toolId = context.tool?.id ?? this.toolIdsByName.get(toolName)
        if (binding.toolId && toolId && binding.toolId === toolId) return true
        if (toolId && binding.scopeKey === `tool:${toolId}`) return true
        return binding.scopeKey === `tool:${toolName}`
      }
      default:
        return false
    }
  }

  private async dispatchHook(hook: RuntimeHook, context: HookContext): Promise<HookDecision | null> {
    switch (hook.handler.kind) {
      case 'declarative':
        return this.evaluateDeclarativeHook(hook, context)
      case 'code':
        return this.evaluateCodeHook(hook.handler.source, context)
      case 'http':
        return this.evaluateHttpHook(hook.handler, context)
      default:
        return { action: 'block', reason: `Unsupported Hook handler kind: ${(hook.handler as { kind?: string }).kind}` }
    }
  }

  private async evaluateDeclarativeHook(hook: RuntimeHook, context: HookContext): Promise<HookDecision | null> {
    const handler = hook.handler
    if (handler.kind !== 'declarative') return null

    const legacyConfig = getRecord(getRecord(handler, 'legacy'), 'guardrailConfig')
    const check = handler.check
    if (!this.matchesDeclarativeContext(check, legacyConfig, context)) return null

    const normalizedCheck = this.resolveLegacyCheck(check, legacyConfig)
    if (getString(normalizedCheck, 'kind') === 'ai' && getString(normalizedCheck, 'evaluationPrompt')) {
      return this.evaluateAiHook(hook, normalizedCheck, handler.effect, legacyConfig, context)
    }

    const violation = this.evaluateDeclarativeRule(normalizedCheck, context)
    if (!violation.violated) return { action: 'allow', reason: violation.reason }

    return this.effectDecision(hook, handler.effect, legacyConfig, violation.reason)
  }

  private matchesDeclarativeContext(
    check: Record<string, unknown>,
    legacyConfig: Record<string, unknown> | undefined,
    context: HookContext,
  ): boolean {
    const match = getRecord(check, 'match') ?? getRecord(legacyConfig, 'match')
    const tools = getStringArray(match, 'tools')
    if (tools.length > 0) {
      if (!context.tool?.name) return false
      if (!tools.includes(context.tool.name)) return false
    }

    const pattern = getString(match, 'ifPattern') ?? getString(check, 'ifPattern')
    if (pattern) {
      const payload = context.checkpoint === 'PreToolUse'
        ? JSON.stringify(context.tool?.input ?? {})
        : JSON.stringify(context.tool?.output ?? context.replyDraft ?? {})
      try {
        if (!new RegExp(pattern, 'i').test(payload)) return false
      } catch {
        return false
      }
    }

    return true
  }

  private resolveLegacyCheck(
    check: Record<string, unknown>,
    legacyConfig: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (getString(check, 'kind') !== 'legacy_policy') return check
    return getRecord(legacyConfig, 'check') ?? getRecord(legacyConfig, 'rule') ?? check
  }

  private evaluateDeclarativeRule(
    check: Record<string, unknown>,
    context: HookContext,
  ): { violated: boolean; reason?: string } {
    const configuredReason = getString(check, 'reason')
    if (getBoolean(check, 'always')) {
      return { violated: true, reason: configuredReason ?? 'Hook rule matched.' }
    }

    const denyTools = getStringArray(check, 'denyTools')
    if (context.tool?.name && denyTools.includes(context.tool.name)) {
      return { violated: true, reason: configuredReason ?? `Tool "${context.tool.name}" is denied by Hook rule.` }
    }

    const requireTools = getStringArray(check, 'requireTools')
    if (requireTools.length > 0) {
      const called = new Set(context.previousToolCalls.map((call) => call.name))
      const missing = requireTools.filter((name) => !called.has(name))
      if (missing.length > 0) {
        return { violated: true, reason: configuredReason ?? `Required tools not called: ${missing.join(', ')}` }
      }
    }

    const requireToolsAny = getStringArray(check, 'requireToolsAny')
    if (requireToolsAny.length > 0) {
      const called = new Set(context.previousToolCalls.map((call) => call.name))
      const ok = requireToolsAny.some((name) => called.has(name))
      if (!ok) {
        return { violated: true, reason: configuredReason ?? `Must call at least one of: ${requireToolsAny.join(', ')}` }
      }
    }

    const forbiddenPhrases = [
      ...getStringArray(check, 'forbiddenPhrases'),
      ...getStringArray(check, 'replyContains'),
    ]
    if (forbiddenPhrases.length > 0 && context.replyDraft) {
      const lowered = context.replyDraft.toLowerCase()
      const hit = forbiddenPhrases.find((phrase) => lowered.includes(phrase.toLowerCase()))
      if (hit) {
        return { violated: true, reason: configuredReason ?? `Reply draft contains forbidden phrase: ${hit}` }
      }
    }

    const outputContains = getStringArray(check, 'outputContains')
    if (outputContains.length > 0) {
      const payload = JSON.stringify(context.tool?.output ?? {})
      const hit = outputContains.find((phrase) => payload.includes(phrase))
      if (hit) return { violated: true, reason: configuredReason ?? `Tool output matched Hook condition: ${hit}` }
    }

    const inputContains = getStringArray(check, 'inputContains')
    if (inputContains.length > 0) {
      const payload = JSON.stringify(context.tool?.input ?? {})
      const hit = inputContains.find((phrase) => payload.includes(phrase))
      if (hit) return { violated: true, reason: configuredReason ?? `Tool input matched Hook condition: ${hit}` }
    }

    return { violated: false }
  }

  private effectDecision(
    hook: RuntimeHook,
    effect: Record<string, unknown>,
    legacyConfig: Record<string, unknown> | undefined,
    reason?: string,
  ): HookDecision {
    const action = normalizeAction(getString(effect, 'decision') ?? getString(effect, 'action')) ?? 'block'
    const legacyViolation = getRecord(legacyConfig, 'onViolation')
    return {
      action,
      reason,
      guidance:
        getString(effect, 'guidance') ??
        getString(legacyViolation, 'guidance') ??
        hook.description ??
        undefined,
      severity: hook.severity,
      humanTask: getRecord(effect, 'humanTask') as HookDecision['humanTask'],
      trace: getRecord(effect, 'trace'),
    }
  }

  private async evaluateAiHook(
    hook: RuntimeHook,
    check: Record<string, unknown>,
    effect: Record<string, unknown>,
    legacyConfig: Record<string, unknown> | undefined,
    context: HookContext,
  ): Promise<HookDecision> {
    const prompt = this.resolvePlaceholders(getString(check, 'evaluationPrompt') ?? '', context)
    const hookTool: Anthropic.Tool = {
      name: 'evaluate_hook',
      description: 'Record a Hook checkpoint decision. Call once.',
      input_schema: {
        type: 'object' as const,
        properties: {
          action: { type: 'string' as const, enum: ['allow', 'warn', 'block', 'escalate'] },
          reason: { type: 'string' as const },
        },
        required: ['action', 'reason'],
      },
    }

    try {
      const msg = await withRetry(
        (retryClient) => retryClient.messages.create({
          model: this.hookModel,
          max_tokens: 512,
          temperature: 0,
          system: 'You evaluate Intera Hooks. Return one evaluate_hook tool call with the safest valid decision.',
          tools: [hookTool as any],
          messages: [{ role: 'user', content: prompt }],
        }),
        { querySource: 'main_loop', model: this.hookModel },
        () => this.llmClient,
      ) as Anthropic.Messages.Message

      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue
        const input = (block as { input?: Record<string, unknown> }).input
        const action = normalizeAction(String(input?.action ?? ''))
        if (!action) continue
        if (action === 'allow') {
          return { action, reason: String(input?.reason ?? ''), severity: hook.severity, trace: { modelUsed: this.hookModel } }
        }
        const effectDecision = this.effectDecision(hook, effect, legacyConfig, String(input?.reason ?? 'Hook AI check matched.'))
        return { ...effectDecision, trace: { ...(effectDecision.trace ?? {}), modelUsed: this.hookModel } }
      }

      return { action: 'allow', reason: 'Hook AI evaluator returned no blocking decision.', severity: hook.severity }
    } catch (err) {
      return this.unavailableDecision(hook, legacyConfig, err)
    }
  }

  private unavailableDecision(
    hook: RuntimeHook,
    legacyConfig: Record<string, unknown> | undefined,
    err: unknown,
  ): HookDecision {
    const unavailable = getRecord(legacyConfig, 'onUnavailable')
    const rawAction = getString(unavailable, 'action')
    const errorClass = err instanceof CannotRetryError ? err.errorClass : 'unknown'

    if (rawAction === 'open') {
      return {
        action: 'warn',
        reason: `Hook AI evaluation unavailable; allowed with warning (${errorClass}).`,
        severity: hook.severity,
      }
    }

    if (rawAction === 'invoke_tool') {
      return {
        action: 'escalate',
        reason: `Hook AI evaluation unavailable; escalating for human review (${errorClass}).`,
        guidance: getString(unavailable, 'guidance'),
        severity: hook.severity,
      }
    }

    if (rawAction === 'closed') {
      return {
        action: 'block',
        reason: `Hook AI evaluation unavailable; blocked for safety (${errorClass}).`,
        severity: hook.severity,
      }
    }

    return {
      action: 'warn',
      reason: `Hook AI evaluation unavailable; allowed with warning (${errorClass}).`,
      severity: hook.severity,
    }
  }

  private async evaluateCodeHook(source: string, context: HookContext): Promise<HookDecision> {
    const { Script, createContext } = await import('node:vm')
    const sandbox = createContext({
      ctx: JSON.parse(JSON.stringify(context)),
      JSON,
      Math,
      Date,
      URL,
      URLSearchParams,
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
    })

    const script = new Script(`
      "use strict";
      ${source}
      const __hook = typeof hook === "function" ? hook : undefined;
      if (!__hook) throw new Error("Code Hook must define async function hook(ctx)");
      Promise.resolve(__hook(ctx));
    `)

    const resultPromise = script.runInContext(sandbox, { timeout: DEFAULT_CODE_TIMEOUT_MS }) as Promise<unknown>
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Code Hook timed out')), DEFAULT_CODE_TIMEOUT_MS)
    })
    const result = await Promise.race([resultPromise, timeoutPromise])
    return hookDecisionSchema.parse(result)
  }

  private async evaluateHttpHook(handler: Extract<HookHandler, { kind: 'http' }>, context: HookContext): Promise<HookDecision> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), handler.timeoutMs || DEFAULT_HTTP_TIMEOUT_MS)

    try {
      const response = await fetch(handler.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(handler.headers ?? {}),
        },
        body: JSON.stringify({ context }),
        signal: controller.signal,
      })

      if (!response.ok) {
        return {
          action: 'block',
          reason: `HTTP Hook returned ${response.status}.`,
          guidance: 'Route this case to a human if the Hook cannot be evaluated safely.',
        }
      }

      const payload = await response.json()
      return hookDecisionSchema.parse(payload)
    } finally {
      clearTimeout(timeout)
    }
  }

  private pendingToolForDecision(hook: RuntimeHook, decision: HookDecision): string | null {
    if (decision.action !== 'escalate') return null

    const handler = hook.handler
    if (handler.kind === 'declarative') {
      const effectTool = getString(handler.effect, 'tool') ?? getString(handler.effect, 'invokeTool')
      if (effectTool && SAFE_TOOL_ALLOWLIST.has(effectTool)) return effectTool

      const legacyConfig = getRecord(getRecord(handler, 'legacy'), 'guardrailConfig')
      const legacyTool = getString(getRecord(legacyConfig, 'onViolation'), 'tool') ?? getString(getRecord(legacyConfig, 'onUnavailable'), 'tool')
      if (legacyTool && SAFE_TOOL_ALLOWLIST.has(legacyTool)) return legacyTool
    }

    return DEFAULT_FALLBACK_TOOL
  }

  private buildFeedbackMessage(
    checkpoint: HookCheckpoint,
    results: HookCheckResult[],
    summary: HookDecisionAction,
    hitCounts?: Map<string, number>,
  ): string | undefined {
    const nonAllow = results.filter((r) => r.action !== 'allow')
    if (nonAllow.length === 0) return undefined

    const lines: string[] = [`[HOOK: ${checkpoint}]`]
    for (const result of nonAllow) {
      const count = hitCounts?.get(result.hookName) || 0
      const repeat = count >= 2 ? ` (hit #${count})` : ''
      lines.push(`"${result.hookName}": ${result.action}${repeat}${result.reason ? ` - ${result.reason}` : ''}`)
      if (result.guidance) lines.push(`Guidance: ${result.guidance}`)
    }

    if (checkpoint === 'PreToolUse' && (summary === 'block' || summary === 'escalate')) {
      lines.push('The Tool was not executed. Address the Hook feedback before retrying.')
    } else if (checkpoint === 'PostToolUse' && summary === 'escalate') {
      lines.push('A Hook escalated this result for human review.')
    } else if (checkpoint === 'Stop' && (summary === 'block' || summary === 'escalate')) {
      lines.push('The reply draft was not sent. Revise the answer using the Hook feedback.')
    }

    return lines.join('\n')
  }

  private resolvePlaceholders(template: string, context: HookContext): string {
    return template
      .replace(/\{\{tool_name\}\}/g, context.tool?.name ?? 'unknown')
      .replace(/\{\{tool_input\}\}/g, JSON.stringify(context.tool?.input ?? null))
      .replace(/\{\{skill_input\}\}/g, JSON.stringify(context.tool?.input ?? null))
      .replace(/\{\{tool_output\}\}/g, JSON.stringify(context.tool?.output ?? context.replyDraft ?? null))
      .replace(/\{\{tools_called\}\}/g, JSON.stringify(context.previousToolCalls.map((call) => call.name)))
      .replace(/\{\{reply_draft\}\}/g, context.replyDraft ?? '')
  }
}

function normalizeAction(value: string | undefined): HookDecisionAction | null {
  if (value === 'allow' || value === 'warn' || value === 'block' || value === 'escalate') return value
  if (value === 'pass') return 'allow'
  if (value === 'hint') return 'warn'
  if (value === 'blocked') return 'block'
  if (value === 'escalated') return 'escalate'
  if (value === 'invoke_tool') return 'escalate'
  return null
}

function getRecord(value: unknown, key?: string): Record<string, unknown> | undefined {
  const target = key && value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : value
  return target && typeof target === 'object' && !Array.isArray(target)
    ? target as Record<string, unknown>
    : undefined
}

function getString(value: unknown, key: string): string | undefined {
  const record = getRecord(value)
  const raw = record?.[key]
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function getBoolean(value: unknown, key: string): boolean {
  const record = getRecord(value)
  return record?.[key] === true
}

function getStringArray(value: unknown, key: string): string[] {
  const record = getRecord(value)
  const raw = record?.[key]
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}
