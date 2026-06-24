// Tool Interceptor — post-execution tool result handlers.
//
// After StreamingToolExecutor completes all tools, certain tool results
// need special handling: selecting inline Procedures,
// replacing mock results with real data, or triggering escalations.
//
// This module extracts those handlers from the main AgentLoop to keep
// the ReAct loop body focused on control flow.

import { prisma } from '@intera/shared/prisma'
import type { Message, SSEEvent, AgentConfigData, CaseSchemaConfig, CaseStatus } from '@intera/shared/types'
import type { ProcedureV2Step } from '@intera/shared/types'
import type { HookEvaluationResult } from './hook-engine'
import type { ToolExecutionResult } from './streaming-tool-executor'
import type { ChatMemoryManager } from './memory'
import type { PersistencePort } from './persistence-port'
import type { TraceWriter } from './trace'
import type { ToolRouter } from './tools'
import type { CaseAgentLoop } from './case-agent-loop'
import { parseProcedure } from '@intera/shared/contracts/case-types'
import { isInvestigableCaseType } from './case-type-slugs'
import { escalationMessageForRuntime, latestUserText } from './customer-messages'
import { defaultHumanQueueForCaseSchema } from './human-handoff'
import { startProcedureRun } from './session-store'

type CaseTypeRowLike = {
  type: string
  displayName: string
  icon: string | null
  description: string | null
  requiredFacts: unknown
  defaultGoal: string
  escalateOn: unknown
  autoCloseConditions: unknown
  procedure?: string | null
  maxAutoTurns?: number | null
}

// ---------------------------------------------------------------------------
// Context — dependencies the interceptor needs from AgentLoop
// ---------------------------------------------------------------------------

export interface ToolInterceptorContext {
  caseId: string
  orgId: string
  agentConfigId: string
  userId: string
  chatId?: string | null
  config: AgentConfigData
  caseSchema?: CaseSchemaConfig | null
  chatMemory: ChatMemoryManager
  persistence: PersistencePort
  traceWriter: TraceWriter
  toolRouter: ToolRouter
  getCaseLoop: () => CaseAgentLoop | null
  dryRun: boolean
  messages: Message[]
  getCurrentStage: () => string
  setPendingEscalation: (value: boolean) => void
  activateProcedureContext?: (schema: CaseSchemaConfig) => Promise<void>
}

// ---------------------------------------------------------------------------
// Control-flow signals returned to the caller
// ---------------------------------------------------------------------------

export type InterceptAction =
  | { kind: 'continue' }            // Skip rest of loop iteration
  | { kind: 'return'; result: LoopResult }  // Return from loop
  | { kind: 'pass' }                // No interception — continue normally

interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'waiting_form' | 'error' | 'consultation_complete' | 'connection_lost' | 'machine_error'
  currentStage: string
  reason?: string
}

// ---------------------------------------------------------------------------
// Main entry point — intercept tool results after execution
// ---------------------------------------------------------------------------

/**
 * Process tool results that need special handling after execution.
 * Returns an action (continue/return/pass) and possibly transformed tool results.
 */
export async function interceptToolResults(
  ctx: ToolInterceptorContext,
  toolResults: ToolExecutionResult[],
  sendEvent: (event: SSEEvent) => void,
): Promise<{ action: InterceptAction; toolResults: ToolExecutionResult[] }> {
  // 1. Runtime tool: start_procedure
  const startProcedureResult = toolResults.find((r) => r.name === 'start_procedure')
  if (startProcedureResult) {
    const action = await handleStartProcedure(ctx, startProcedureResult, sendEvent)
    if (action.kind !== 'pass') return { action, toolResults }
  }

  // 2. Data tool: read_chat_memory
  const readMemResult = toolResults.find((r) => r.name === 'read_chat_memory')
  if (readMemResult) {
    await handleReadChatMemory(ctx)
  }

  // 3. Data tool: read_user_profile
  const readProfileResult = toolResults.find((r) => r.name === 'read_user_profile')
  if (readProfileResult) {
    await handleReadUserProfile(ctx)
  }

  // 4. Terminal tool: ask_user_questions (form)
  const formResult = toolResults.find((r) => r.name === 'ask_user_questions')
  if (formResult) {
    const action = await handleRequestUserInput(ctx, formResult, sendEvent)
    if (action.kind !== 'pass') return { action, toolResults }
  }

  return { action: { kind: 'pass' }, toolResults }
}

// ---------------------------------------------------------------------------
// start_procedure
// ---------------------------------------------------------------------------

async function handleStartProcedure(
  ctx: ToolInterceptorContext,
  result: ToolExecutionResult,
  sendEvent: (event: SSEEvent) => void,
): Promise<InterceptAction> {
  const toolInput = result.toolUse?.input || {}
  const requestedProcedureId = String(toolInput.procedureId || toolInput.caseType || '')
  let reason = String(toolInput.reason || 'The customer raised an issue that matches this procedure.')
  const confidence = typeof toolInput.confidence === 'number' ? toolInput.confidence : undefined
  const requestedCurrentAction = normalizeCurrentProcedureAction(toolInput.currentProcedureAction)

  if (!requestedProcedureId || !isInvestigableCaseType(requestedProcedureId)) {
    return { kind: 'pass' }
  }

  try {
    const resolved = await resolveCaseTypeForProcedure(ctx.agentConfigId, requestedProcedureId)
    if (!resolved?.row) return { kind: 'pass' }
    const ctRow = resolved.row

    const requiredFacts = safeJson<string[]>(ctRow.requiredFacts, [])
    const procedureJson = (ctRow as { procedure?: string | null }).procedure
    const procedure = parseProcedure(procedureJson)

    const schema: CaseSchemaConfig = {
      type: ctRow.type,
      displayName: ctRow.displayName,
      icon: ctRow.icon ?? 'case',
      description: ctRow.description || undefined,
      requiredFacts: Array.isArray(requiredFacts) ? requiredFacts : [],
      defaultGoal: ctRow.defaultGoal,
      escalateOn: safeJson<string[]>(ctRow.escalateOn, []),
      autoCloseConditions: safeJson<Record<string, unknown> | undefined>(ctRow.autoCloseConditions, undefined),
      procedure: procedure ?? undefined,
      maxAutoTurns: ctRow.maxAutoTurns ?? undefined,
    }
    const start = startProcedureRun(ctx.caseId, {
      agentConfigId: ctx.agentConfigId,
      procedureId: ctRow.type,
      displayName: ctRow.displayName,
      procedure: schema.procedure,
      reason,
      confidence,
      requestId: typeof toolInput.requestId === 'string' ? toolInput.requestId : result.toolUse?.id,
      currentProcedureAction: requestedCurrentAction,
    })
    ctx.chatMemory.setCaseStatus('investigating')
    try {
      await prisma.case.upsert({
        where: { id: ctx.caseId },
        update: {
          type: ctRow.type,
          status: 'investigating',
          blocker: null,
        },
        create: {
          id: ctx.caseId,
          orgId: ctx.orgId,
          userId: ctx.userId,
          type: ctRow.type,
          status: 'investigating',
          chatId: ctx.chatId ?? ctx.caseId,
          blocker: null,
        },
      })
    } catch (err) {
      console.error('[ToolInterceptor] Failed to align case truth after start_procedure:', err)
    }
    await ctx.activateProcedureContext?.(schema)

    const procedureSummary = summarizeProcedure(schema)
    const inlineRoutingResult = {
      ok: true,
      mode: 'inline_procedure',
      caseId: ctx.caseId,
      durableCaseCreated: false,
      requestedProcedureId,
      routingCorrection: resolved.routingCorrection,
      procedureId: ctRow.type,
      caseType: ctRow.type,
      displayName: ctRow.displayName,
      procedureSummary,
      runId: start.run.runId,
      currentStepId: start.run.currentStepId,
      inputEpoch: start.run.inputEpoch,
      idempotent: start.idempotent,
      pausedRunId: start.pausedRun?.runId ?? null,
      currentProcedureAction: requestedCurrentAction ?? null,
      instruction:
        'Continue as the main customer-facing Agent inline. Runtime will append ProcedureRun state at the prompt tail and resolve Hook scopes; do not spawn background workers.',
    }

    result.output = inlineRoutingResult
    replaceToolResultMessage(ctx.messages, result.toolUse?.id, inlineRoutingResult)

    sendEvent({
      type: 'case_status',
      data: {
        caseId: ctx.caseId,
        caseType: ctRow.type,
        procedureId: ctRow.type,
        status: 'procedure_started',
        displayName: ctRow.displayName,
        icon: ctRow.icon,
        durableCaseCreated: false,
        runId: start.run.runId,
        currentStepId: start.run.currentStepId,
        inputEpoch: start.run.inputEpoch,
        idempotent: start.idempotent,
      },
      timestamp: new Date().toISOString(),
    })

    await ctx.traceWriter.write('loop_decision', `Procedure selected inline: ${ctRow.type}`, {
      procedureId: ctRow.type,
      caseId: ctx.caseId,
      durableCaseCreated: false,
      runId: start.run.runId,
      currentStepId: start.run.currentStepId,
      currentProcedureAction: requestedCurrentAction ?? null,
      requestedProcedureId,
      routingCorrection: resolved.routingCorrection,
      pausedRunId: start.pausedRun?.runId ?? null,
      idempotent: start.idempotent,
    })

    return { kind: 'continue' }
  } catch (err) {
    console.error('[ToolInterceptor] Failed to start inline procedure:', err)
    return { kind: 'pass' }
  }
}

// ---------------------------------------------------------------------------
// read_chat_memory
// ---------------------------------------------------------------------------

async function handleReadChatMemory(ctx: ToolInterceptorContext): Promise<void> {
  // The tool result is already in the message stream via S1 synthesis.
  // No additional processing needed — the chatMemory summary is available
  // to the model through the tool_result content block.
  //
  // Trace is already written by loop.ts (Tool: read_chat_memory).
}

// ---------------------------------------------------------------------------
// read_user_profile
// ---------------------------------------------------------------------------

async function handleReadUserProfile(ctx: ToolInterceptorContext): Promise<void>
{
  // Same as read_chat_memory — the tool result is already in the stream.
  // Trace is already written by loop.ts (Tool: read_user_profile).
}

// ---------------------------------------------------------------------------
// ask_user_questions (form)
// ---------------------------------------------------------------------------

async function handleRequestUserInput(
  ctx: ToolInterceptorContext,
  result: ToolExecutionResult,
  sendEvent: (event: SSEEvent) => void,
): Promise<InterceptAction> {
  const toolInput = result.toolUse?.input || {}
  const payload = normalizeAskUserQuestionsPayload(ctx, toolInput)

  if (!payload) {
    await ctx.traceWriter.write('loop_decision', 'Skip form_request: ask_user_questions missing renderable payload', {
      toolStatus: result.toolUse?.status ?? 'unknown',
      toolInput,
      toolOutput: result.output ?? null,
    })
    return { kind: 'pass' }
  }

  if (payload.repaired && result.toolUse) {
    const repairedToolInput = {
      ...toolInput,
      title: payload.title,
      description: payload.description,
      fields: payload.fields,
    }
    result.toolUse.input = repairedToolInput
    result.toolUse.status = 'completed'
    result.output = {
      ok: true,
      output: {
        status: 'form_request_repaired',
        title: payload.title,
        fieldCount: payload.fields.length,
      },
      latencyMs: result.latencyMs,
    }
    result.toolUse.result = result.output as never
    replaceToolResultMessage(ctx.messages, result.toolUse.id, result.output)
  }

  await ctx.traceWriter.write('loop_decision', 'Exit: form requested', {
    toolCount: 1,
    iteration: 0,
    repaired: payload.repaired,
    toolStatus: result.toolUse?.status ?? 'unknown',
  })

  sendEvent({
    type: 'form_request',
    data: {
      caseId: ctx.caseId,
      toolCallId: result.toolUse?.id || crypto.randomUUID(),
      title: payload.title,
      description: payload.description,
      fields: payload.fields,
    },
    timestamp: new Date().toISOString(),
  })

  return {
    kind: 'return',
    result: {
      messages: ctx.messages,
      caseStatus: ctx.getCurrentStage() as CaseStatus,
      transition: 'waiting_form',
      currentStage: ctx.getCurrentStage(),
    },
  }
}

// ---------------------------------------------------------------------------
// processPendingHookToolCalls
// ---------------------------------------------------------------------------

export async function processPendingHookToolCalls(
  ctx: ToolInterceptorContext,
  hookEval: HookEvaluationResult,
  sendEvent: (event: SSEEvent) => void,
  options: {
    sendCustomerFallback?: boolean
  } = {},
): Promise<{ createdHumanTask: boolean }> {
  let createdHumanTask = false
  const escalatedResults = hookEval.results.filter((r) => r.action === 'escalate')
  const escalatedReasons = escalatedResults
    .map((r) => `${r.hookName}: ${r.reason || 'Hook escalation'}`)
    .join('; ')

  await ctx.traceWriter.write('loop_decision', 'Auto-escalate from Hook', {
    hookNames: escalatedResults.map((r) => r.hookName),
    reasons: escalatedReasons,
    pendingToolCalls: hookEval.pendingToolCalls,
  })

  const pendingCalls = hookEval.pendingToolCalls || []
  for (const ptc of pendingCalls) {
    if (ptc.tool === 'create_human_task') {
      try {
        const resolvedCaseType = ctx.caseSchema?.type || 'general'
        const queue = defaultHumanQueueForCaseSchema(ctx.caseSchema)
        await ctx.persistence.ensureCase({
          id: ctx.caseId,
          orgId: ctx.orgId,
          userId: ctx.userId,
          type: resolvedCaseType,
          status: 'waiting_human',
          blocker: `Waiting for ${queue}`,
          chatId: ctx.chatId ?? ctx.caseId,
        })
        await ctx.persistence.saveMemory(ctx.caseId, {
          caseId: ctx.caseId,
          ...ctx.chatMemory.getDbFields(),
          humanTaskStatus: 'pending',
        })
        const question = `Auto-escalated by Hook "${ptc.hookName}". ${ptc.reason}. Tools called: ${ctx.chatMemory.getToolsCalled().join(', ')}.`
        const task = await ctx.persistence.createHumanTask({
          caseId: ctx.caseId,
          queue,
          question,
          status: 'pending',
        })
        await ctx.traceWriter.writeHumanTaskCreated(task.id, queue)
        sendEvent({
          type: 'human_task_created',
          data: { taskId: task.id, queue, question, status: 'pending' },
          timestamp: new Date().toISOString(),
        })
        sendEvent({
          type: 'escalated',
          data: { stage: ctx.getCurrentStage(), reason: 'human_task_created', taskId: task.id, queue },
          timestamp: new Date().toISOString(),
        })
        await ctx.traceWriter.writeEscalated('human_task_created', { taskId: task.id, queue, stage: ctx.getCurrentStage() })
        createdHumanTask = true
      } catch (err) {
        console.error('[ToolInterceptor] Failed to auto-create human task from Hook:', err)
      }
    }
  }

  // Fallback: escalated results but no pendingToolCalls
  if (pendingCalls.length === 0 && escalatedResults.length > 0) {
    try {
      const resolvedCaseType = ctx.caseSchema?.type || 'general'
      const queue = defaultHumanQueueForCaseSchema(ctx.caseSchema)
      await ctx.persistence.ensureCase({
        id: ctx.caseId,
        orgId: ctx.orgId,
        userId: ctx.userId,
        type: resolvedCaseType,
        status: 'escalated',
        blocker: `Hook escalation: ${escalatedReasons}`,
        chatId: ctx.chatId ?? ctx.caseId,
      })
      await ctx.persistence.saveMemory(ctx.caseId, {
        caseId: ctx.caseId,
        ...ctx.chatMemory.getDbFields(),
        humanTaskStatus: 'pending',
      })
      const question = `Auto-escalated by Hook. ${escalatedReasons}. Tools called: ${ctx.chatMemory.getToolsCalled().join(', ')}.`
      const task = await ctx.persistence.createHumanTask({
        caseId: ctx.caseId,
        queue,
        question,
        status: 'pending',
      })
      await ctx.traceWriter.writeHumanTaskCreated(task.id, queue)
      sendEvent({
        type: 'human_task_created',
        data: { taskId: task.id, queue, question, status: 'pending' },
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[ToolInterceptor] Failed to auto-create human task from Hook escalation:', err)
    }
  }

  if (options.sendCustomerFallback !== false) {
    sendEvent({
      type: 'text_delta',
      data: escalationMessageForRuntime(latestUserText(ctx.messages), ctx.config),
      timestamp: new Date().toISOString(),
    })
    sendEvent({
      type: 'escalated',
      data: { stage: ctx.getCurrentStage(), reason: escalatedReasons },
      timestamp: new Date().toISOString(),
    })
    await ctx.traceWriter.writeEscalated(
      Array.isArray(escalatedReasons) ? escalatedReasons.join('; ') : String(escalatedReasons),
      { stage: ctx.getCurrentStage() },
    )
  }

  ctx.setPendingEscalation(true)
  return { createdHumanTask }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(value as string) as T } catch { return fallback }
}

async function resolveCaseTypeForProcedure(
  agentConfigId: string,
  requestedProcedureId: string,
): Promise<{
  row: CaseTypeRowLike
  routingCorrection: null | {
    requestedProcedureId: string
    resolvedProcedureId: string
    reason: string
  }
} | null> {
  const direct = await prisma.caseType.findUnique({
    where: { agentConfigId_type: { agentConfigId, type: requestedProcedureId } },
  }) as CaseTypeRowLike | null
  if (direct) {
    return { row: direct, routingCorrection: null }
  }

  const candidates = await prisma.caseType.findMany({
    where: { agentConfigId, enabled: true },
  }).catch(() => []) as CaseTypeRowLike[]
  const resolved = rankCaseTypeCandidates(candidates, requestedProcedureId)[0]
  if (!resolved) return null

  return {
    row: resolved.row,
    routingCorrection: {
      requestedProcedureId,
      resolvedProcedureId: resolved.row.type,
      reason: resolved.reason,
    },
  }
}

function rankCaseTypeCandidates(
  rows: CaseTypeRowLike[],
  requestedProcedureId: string,
): Array<{ row: CaseTypeRowLike; score: number; reason: string }> {
  const requested = normalizeMatcherText(requestedProcedureId)
  if (!requested) return []
  const scored: Array<{ row: CaseTypeRowLike; score: number; reason: string }> = []

  for (const row of rows) {
    const type = normalizeMatcherText(row.type)
    const displayName = normalizeMatcherText(row.displayName)
    const description = normalizeMatcherText(row.description ?? '')
    const procedureText = normalizeMatcherText(row.procedure ?? '')
    const toolNames = collectProcedureToolNames(row.procedure)
    const toolNameMatch = toolNames.find((toolName) => normalizeMatcherText(toolName) === requested)
    const toolNameContains = toolNames.find((toolName) => {
      const normalizedToolName = normalizeMatcherText(toolName)
      return normalizedToolName.includes(requested) || requested.includes(normalizedToolName)
    })

    if (type === requested) {
      scored.push({ row, score: 100, reason: 'exact_case_type' })
    } else if (displayName === requested) {
      scored.push({ row, score: 96, reason: 'exact_display_name' })
    } else if (toolNameMatch) {
      scored.push({ row, score: 94, reason: `procedure_tool:${toolNameMatch}` })
    } else if (type.includes(requested) || requested.includes(type)) {
      scored.push({ row, score: 88, reason: 'case_type_similarity' })
    } else if (displayName.includes(requested) || requested.includes(displayName)) {
      scored.push({ row, score: 84, reason: 'display_name_similarity' })
    } else if (toolNameContains) {
      scored.push({ row, score: 78, reason: `procedure_tool_similarity:${toolNameContains}` })
    } else if (procedureText.includes(requested)) {
      scored.push({ row, score: 64, reason: 'procedure_definition_similarity' })
    } else if (description.includes(requested)) {
      scored.push({ row, score: 42, reason: 'description_similarity' })
    }
  }

  return scored
    .filter((entry) => entry.score >= 64)
    .sort((a, b) => b.score - a.score || a.row.type.localeCompare(b.row.type))
}

function normalizeMatcherText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function collectProcedureToolNames(procedureJson: unknown): string[] {
  const toolNames = new Set<string>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const record = value as Record<string, unknown>
    if (typeof record.toolName === 'string' && record.toolName.trim()) {
      toolNames.add(record.toolName.trim())
    }
    for (const child of Object.values(record)) visit(child)
  }

  try {
    const parsed = typeof procedureJson === 'string' ? JSON.parse(procedureJson) : procedureJson
    visit(parsed)
  } catch {
    // Ignore malformed Procedure JSON here; parseProcedure will handle exact rows later.
  }
  return Array.from(toolNames)
}

function normalizeAskUserQuestionsPayload(
  ctx: ToolInterceptorContext,
  toolInput: Record<string, unknown>,
): {
  title: string
  description: string
  fields: Record<string, unknown>[]
  repaired: boolean
} | null {
  const rawTitle = typeof toolInput.title === 'string' ? toolInput.title.trim() : ''
  const rawDescription = typeof toolInput.description === 'string' ? toolInput.description : ''
  const initialValues = isRecord(toolInput.initialValues) ? toolInput.initialValues : {}
  const rawFields = Array.isArray(toolInput.fields)
    ? toolInput.fields.filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === 'object')
    : []
  const validFields = rawFields
    .map((field) => normalizeFormField(field, initialValues))
    .filter((field): field is Record<string, unknown> => Boolean(field))

  if (rawTitle && validFields.length > 0) {
    return {
      title: rawTitle,
      description: rawDescription,
      fields: validFields,
      repaired: false,
    }
  }

  const requiredFacts = Array.isArray(ctx.caseSchema?.requiredFacts)
    ? ctx.caseSchema.requiredFacts.filter((fact): fact is string => typeof fact === 'string' && fact.trim().length > 0)
    : []
  const fallbackFacts = requiredFacts.length > 0 ? requiredFacts : ['member_id']
  const fallbackFields = fallbackFacts
    .map(formFieldFromFact)
    .filter((field): field is Record<string, unknown> => Boolean(field))

  if (fallbackFields.length === 0) return null
  return {
    title: rawTitle || fallbackFormTitle(fallbackFacts),
    description: rawDescription || fallbackFormDescription(fallbackFacts),
    fields: fallbackFields,
    repaired: true,
  }
}

const FORM_FIELD_LIMITS = {
  label: 120,
  placeholder: 180,
  option: 120,
  defaultValue: 500,
}

function normalizeFormField(field: Record<string, unknown>, initialValues: Record<string, unknown> = {}): Record<string, unknown> | null {
  const key = typeof field.key === 'string'
    ? field.key.trim()
    : typeof field.id === 'string'
      ? field.id.trim()
      : ''
  const label = cleanFormString(
    typeof field.label === 'string' ? field.label : undefined,
    FORM_FIELD_LIMITS.label,
  ) ?? humanizeFieldKey(key)
  const type = typeof field.type === 'string' ? field.type : 'text'
  if (!key || !label) return null
  const existingDefaultValue = field.defaultValue
  const inferredDefaultValue = existingDefaultValue == null ? initialValues[key] : existingDefaultValue
  const defaultValue = typeof inferredDefaultValue === 'string'
    ? inferredDefaultValue
    : typeof inferredDefaultValue === 'number' || typeof inferredDefaultValue === 'boolean'
      ? String(inferredDefaultValue)
      : undefined
  const placeholder = cleanFormString(
    typeof field.placeholder === 'string' ? field.placeholder : undefined,
    FORM_FIELD_LIMITS.placeholder,
  ) ?? defaultPlaceholderForField(key)
  const options = Array.isArray(field.options)
    ? field.options
      .map((option) => cleanFormString(typeof option === 'string' ? option : undefined, FORM_FIELD_LIMITS.option))
      .filter((option): option is string => Boolean(option))
      .slice(0, 50)
    : undefined
  const cleanedDefaultValue = cleanFormString(defaultValue, FORM_FIELD_LIMITS.defaultValue)
  const inferredFromPlaceholder = cleanedDefaultValue == null && placeholder && shouldPromotePlaceholderToDefault(key, placeholder)
    ? placeholder
    : undefined
  const effectiveDefaultValue = cleanedDefaultValue ?? inferredFromPlaceholder

  const normalized = {
    ...field,
    key,
    label,
    type: ['text', 'number', 'select', 'textarea', 'file', 'date'].includes(type) ? type : 'text',
    required: field.required !== false,
  } as Record<string, unknown>

  if (placeholder) normalized.placeholder = placeholder
  else delete normalized.placeholder

  if (options && options.length > 0) normalized.options = options
  else delete normalized.options

  if (effectiveDefaultValue != null) normalized.defaultValue = effectiveDefaultValue
  else delete normalized.defaultValue

  return normalized
}

function cleanFormString(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  if (!trimmed) return undefined
  if (looksLikeEncodedBlob(trimmed)) return undefined
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed
}

function looksLikeEncodedBlob(value: string): boolean {
  if (value.length > 240 && (value.match(/\.\.\./g)?.length ?? 0) >= 3) return true
  if (value.length < 320) return false
  const compact = value.replace(/\s+/g, '')
  const encodedChars = compact.match(/[A-Za-z0-9+/=_-]/g)?.length ?? 0
  return encodedChars / Math.max(compact.length, 1) > 0.9
}

function shouldPromotePlaceholderToDefault(key: string, value: string): boolean {
  if (normalizeFactKey(key) === 'member_id') return false

  const normalized = value.trim()
  if (!normalized) return false
  if (normalized.length > 120) return false
  if (normalized.includes('...')) return false
  if (/[?？]$/.test(normalized)) return false

  const lower = normalized.toLowerCase()
  if (/^(e\.?g\.?|example|sample|enter|select|choose|please|your|input|type|provide)\b/.test(lower)) return false
  if (/\b(e\.?g\.?|example|sample|placeholder|optional|required|yyyy|dd\/mm|mm\/dd|your|please enter|select one)\b/.test(lower)) return false

  return true
}

function defaultPlaceholderForField(key: string): string | undefined {
  return undefined
}

function formFieldFromFact(fact: string): Record<string, unknown> {
  const key = normalizeFactKey(fact)
  return {
    key,
    label: humanizeFieldKey(key),
    type: 'text',
    required: true,
  }
}

function normalizeFactKey(fact: string): string {
  const normalized = normalizeMatcherText(fact)
  if (['memberid', 'member_id', 'playerid', 'player_id', 'user_id', 'userid'].includes(normalized)) return 'member_id'
  if (['issuetype', 'issue_type', 'intent_type'].includes(normalized)) return 'issue_type'
  return normalized || fact
}

function humanizeFieldKey(key: string): string {
  if (key === 'member_id') return 'Member ID'
  if (key === 'issue_type') return 'Issue type'
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function fallbackFormTitle(requiredFacts: string[]): string {
  const normalized = requiredFacts.map(normalizeFactKey)
  if (normalized.length === 1 && normalized[0] === 'member_id') return 'Member ID Required'
  if (normalized.includes('issue_type')) return 'Please choose the issue type'
  return 'Information Required'
}

function fallbackFormDescription(requiredFacts: string[]): string {
  const normalized = requiredFacts.map(normalizeFactKey)
  if (normalized.length === 1 && normalized[0] === 'member_id') {
    return 'Please provide your Member ID so I can continue.'
  }
  if (normalized.includes('issue_type')) {
    return 'Please provide the issue type so I can route this correctly.'
  }
  return 'Please provide the missing details so I can continue.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCurrentProcedureAction(raw: unknown): 'pause' | 'complete' | 'abandon' | undefined {
  return raw === 'pause' || raw === 'complete' || raw === 'abandon' ? raw : undefined
}

function summarizeProcedure(schema: CaseSchemaConfig): {
  stepCount: number
  steps: Array<{
    id: string
    title: string
    actionKinds: string[]
    branchCount: number
    requiredActionCount: number
  }>
} {
  const steps = (schema.procedure?.steps ?? []) as ProcedureV2Step[]
  return {
    stepCount: steps.length,
    steps: steps.map((step) => ({
      id: step.id,
      title: step.title,
      actionKinds: [...new Set(collectProcedureStepActions(step).map((action) => action.kind))],
      branchCount: step.branches?.length ?? 0,
      requiredActionCount: collectProcedureStepActions(step).filter((action) => action.required !== false).length,
    })),
  }
}

function collectProcedureStepActions(
  step: {
    actions?: Array<{ kind: string; required?: boolean; toolName?: string; queue?: string; fields?: string[]; suggestedSources?: string[] }>
    branches?: Array<{ actions: Array<{ kind: string; required?: boolean; toolName?: string; queue?: string; fields?: string[]; suggestedSources?: string[] }> }>
  },
) {
  return [
    ...(step.actions ?? []),
    ...(step.branches?.flatMap((branch) => branch.actions) ?? []),
  ]
}

function replaceToolResultMessage(
  messages: Message[],
  toolUseId: string | undefined,
  payload: unknown,
): void {
  if (!toolUseId) return
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const content = msg.content as unknown
    if (!Array.isArray(content)) continue
    const block = content.find((b) => isRecord(b) && b.tool_use_id === toolUseId)
    if (block && isRecord(block)) {
      block.content = JSON.stringify(payload)
      block.is_error = false
      return
    }
  }
}
