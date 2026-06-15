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
import { escalationMessageFor, latestUserText } from './customer-messages'
import { startProcedureRun } from './session-store'

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
  const procedureId = String(toolInput.procedureId || toolInput.caseType || '')
  const reason = String(toolInput.reason || 'The customer raised an issue that matches this procedure.')
  const confidence = typeof toolInput.confidence === 'number' ? toolInput.confidence : undefined
  const requestedCurrentAction = normalizeCurrentProcedureAction(toolInput.currentProcedureAction)

  if (!procedureId || !isInvestigableCaseType(procedureId)) {
    return { kind: 'pass' }
  }

  try {
    const ctRow = await prisma.caseType.findUnique({
      where: { agentConfigId_type: { agentConfigId: ctx.agentConfigId, type: procedureId } },
    })
    if (!ctRow) return { kind: 'pass' }

    const requiredFacts = safeJson<string[]>(ctRow.requiredFacts, [])
    const procedureJson = (ctRow as { procedure?: string | null }).procedure
    const procedure = parseProcedure(procedureJson)

    const schema: CaseSchemaConfig = {
      type: ctRow.type,
      displayName: ctRow.displayName,
      icon: ctRow.icon,
      description: ctRow.description || undefined,
      requiredFacts: Array.isArray(requiredFacts) ? requiredFacts : [],
      defaultGoal: ctRow.defaultGoal,
      escalateOn: safeJson<string[]>(ctRow.escalateOn, []),
      autoCloseConditions: safeJson<Record<string, unknown> | undefined>(ctRow.autoCloseConditions, undefined),
      procedure: procedure ?? undefined,
      maxAutoTurns: ctRow.maxAutoTurns ?? undefined,
    }
    const start = startProcedureRun(ctx.caseId, {
      procedureId: ctRow.type,
      displayName: ctRow.displayName,
      procedure: schema.procedure,
      reason,
      confidence,
      requestId: typeof toolInput.requestId === 'string' ? toolInput.requestId : result.toolUse?.id,
      collectedFacts: isRecord(toolInput.collectedFacts) ? toolInput.collectedFacts : undefined,
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
      procedureId: ctRow.type,
      caseType: ctRow.type,
      displayName: ctRow.displayName,
      procedureSummary,
      runId: start.run.runId,
      currentStepId: start.run.currentStepId,
      inputEpoch: start.run.inputEpoch,
      needsReconcile: start.run.needsReconcile,
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
        needsReconcile: start.run.needsReconcile,
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
  await ctx.traceWriter.write('loop_decision', 'Exit: form requested', {
    toolCount: 1,
    iteration: 0,
  })

  const toolInput = result.toolUse?.input || {}
  const title = String(toolInput.title || 'Information Needed')
  const description = String(toolInput.description || '')
  const fields = (toolInput.fields as Array<Record<string, unknown>>) || []

  sendEvent({
    type: 'form_request',
    data: {
      caseId: ctx.caseId,
      toolCallId: result.toolUse?.id || crypto.randomUUID(),
      title,
      description,
      fields,
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
): Promise<void> {
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
        await ctx.persistence.ensureCase({
          id: ctx.caseId,
          orgId: ctx.orgId,
          userId: ctx.userId,
          type: resolvedCaseType,
          status: 'escalated',
          blocker: `Hook escalation (${ptc.hookName}): ${ptc.reason}`,
          chatId: ctx.chatId ?? ctx.caseId,
        })
        await ctx.persistence.saveMemory(ctx.caseId, {
          caseId: ctx.caseId,
          ...ctx.chatMemory.getDbFields(),
          humanTaskStatus: 'pending',
        })
        const task = await ctx.persistence.createHumanTask({
          caseId: ctx.caseId,
          queue: ctx.caseSchema?.escalateOn?.[0] || 'general',
          question: `Auto-escalated by Hook "${ptc.hookName}". ${ptc.reason}. Tools called: ${ctx.chatMemory.getToolsCalled().join(', ')}.`,
          status: 'pending',
        })
        await ctx.traceWriter.writeHumanTaskCreated(task.id, ctx.caseSchema?.escalateOn?.[0] || 'general')
        sendEvent({
          type: 'human_task_created',
          data: { taskId: task.id, queue: ctx.caseSchema?.escalateOn?.[0] || 'general', status: 'pending' },
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        console.error('[ToolInterceptor] Failed to auto-create human task from Hook:', err)
      }
    }
  }

  // Fallback: escalated results but no pendingToolCalls
  if (pendingCalls.length === 0 && escalatedResults.length > 0) {
    try {
      const resolvedCaseType = ctx.caseSchema?.type || 'general'
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
      const task = await ctx.persistence.createHumanTask({
        caseId: ctx.caseId,
        queue: ctx.caseSchema?.escalateOn?.[0] || 'general',
        question: `Auto-escalated by Hook. ${escalatedReasons}. Tools called: ${ctx.chatMemory.getToolsCalled().join(', ')}.`,
        status: 'pending',
      })
      await ctx.traceWriter.writeHumanTaskCreated(task.id, ctx.caseSchema?.escalateOn?.[0] || 'general')
      sendEvent({
        type: 'human_task_created',
        data: { taskId: task.id, queue: ctx.caseSchema?.escalateOn?.[0] || 'general', status: 'pending' },
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[ToolInterceptor] Failed to auto-create human task from Hook escalation:', err)
    }
  }

  // Customer-facing fallback
  sendEvent({
    type: 'text_delta',
    data: escalationMessageFor(latestUserText(ctx.messages)),
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

  ctx.setPendingEscalation(true)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(value as string) as T } catch { return fallback }
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
