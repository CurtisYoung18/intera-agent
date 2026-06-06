// Tool Interceptor — post-execution tool result handlers.
//
// After StreamingToolExecutor completes all tools, certain tool results
// need special handling: creating cases, dispatching sub-agents,
// replacing mock results with real data, or triggering escalations.
//
// This module extracts those handlers from the main AgentLoop to keep
// the ReAct loop body focused on control flow.

import { prisma } from '@intera/shared/prisma'
import type { Message, SSEEvent, AgentConfigData, CaseSchemaConfig, CaseStatus, PolicyEvaluationResult } from '@intera/shared/types'
import type { ToolExecutionResult } from './streaming-tool-executor'
import type { ChatMemoryManager } from './memory'
import type { PersistencePort } from './persistence-port'
import type { TraceWriter } from './trace'
import type { ToolRouter } from './tools'
import type { CaseAgentLoop } from './case-agent-loop'
import { OrchestratorAgent } from './orchestrator'
import { generateCaseId } from '@/lib/utils'
import { isInvestigableCaseType } from './case-type-slugs'

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
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'waiting_form' | 'error' | 'consultation_complete' | 'stage_continue' | 'connection_lost' | 'machine_error'
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
  // 1. Terminal tool: dispatch_case_agent
  const dispatchCaseResult = toolResults.find((r) => r.name === 'dispatch_case_agent')
  if (dispatchCaseResult) {
    const action = await handleDispatchCaseAgent(ctx, dispatchCaseResult, sendEvent)
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

  // 4. Terminal tool: request_user_input (form)
  const formResult = toolResults.find((r) => r.name === 'request_user_input')
  if (formResult) {
    const action = await handleRequestUserInput(ctx, formResult, sendEvent)
    if (action.kind !== 'pass') return { action, toolResults }
  }

  return { action: { kind: 'pass' }, toolResults }
}

// ---------------------------------------------------------------------------
// dispatch_case_agent
// ---------------------------------------------------------------------------

async function handleDispatchCaseAgent(
  ctx: ToolInterceptorContext,
  result: ToolExecutionResult,
  sendEvent: (event: SSEEvent) => void,
): Promise<InterceptAction> {
  const toolInput = result.toolUse?.input || {}
  const caseType = String(toolInput.caseType || '')

  if (!caseType || !isInvestigableCaseType(caseType)) {
    return { kind: 'pass' }
  }

  try {
    const ctRow = await prisma.caseType.findUnique({
      where: { agentConfigId_type: { agentConfigId: ctx.agentConfigId, type: caseType } },
    })
    if (!ctRow) return { kind: 'pass' }

    const stages = safeJson<string[]>(ctRow.stages, [])
    const requiredFacts = safeJson<string[]>(ctRow.requiredFacts, [])
    const stageConfigs = safeJson<Record<string, unknown>>(ctRow.stageConfigs || '{}', {})
    const executionMode = normalizeExecutionMode((ctRow as any).executionMode)
    const allSkills = ctx.toolRouter.getToolDefinitions()

    const schema: CaseSchemaConfig = {
      type: ctRow.type,
      displayName: ctRow.displayName,
      icon: ctRow.icon,
      description: ctRow.description || undefined,
      requiredFacts: Array.isArray(requiredFacts) ? requiredFacts : [],
      stages: Array.isArray(stages) ? stages : [],
      stageConfigs: stageConfigs as any,
      defaultGoal: ctRow.defaultGoal,
      escalateOn: safeJson<string[]>(ctRow.escalateOn, []),
      requireHumanReview: (ctRow as any).requireHumanReview === true,
      executionMode,
      sop: (ctRow as any).sop || undefined,
    }

    // Create sub-case
    const subCaseId = generateCaseId()
    await ctx.persistence.ensureCase({
      id: subCaseId,
      orgId: ctx.orgId,
      userId: ctx.userId,
      type: caseType,
      status: 'created',
      chatId: ctx.chatId ?? ctx.caseId,
    })

    await ctx.persistence.saveMemory(subCaseId, {
      caseId: subCaseId,
      confirmedFacts: JSON.stringify(ctx.chatMemory.getConfirmedFacts()),
      skillsCalled: JSON.stringify([]),
      skillResults: JSON.stringify({}),
      keyEvents: JSON.stringify([]),
      humanTaskStatus: 'none',
      needsContinuation: false,
    })

    // Build SubAgentConfig
    const stageSkillNames = collectStageSkillNames(stageConfigs, executionMode)
    const casePrompt = ctRow.defaultGoal || `Investigate and resolve the customer's ${ctRow.displayName} issue.`
    const taskPrompt = buildTaskPrompt(executionMode, ctRow, stages, casePrompt)
    const subAgentMaxIterations = resolveMaxIterations(stageConfigs)

    const subAgentConfig: import('@intera/shared/types').SubAgentConfig = {
      name: `case_agent_${caseType}`,
      model: ctx.config.model,
      systemPrompt: ctx.config.systemPrompt,
      skills: Array.from(stageSkillNames),
      taskTemplate: taskPrompt,
      parallel: true,
      maxIterations: subAgentMaxIterations,
      fallbackModel: ctx.config.fallbackModel,
    }

    if (!ctx.dryRun) {
      const orchestrator = new OrchestratorAgent(
        schema,
        allSkills,
        ctx.userId,
        ctx.chatMemory,
      )

      const caseMem = ctx.chatMemory.getSummary()
      const tasks = await orchestrator.planInvestigation(
        schema.stages[0] || 'created',
        [subAgentConfig],
        { ...caseMem, caseId: subCaseId } as any,
        casePrompt,
      )

      if (tasks.length > 0) {
        orchestrator.dispatchInBackground(tasks, sendEvent)

        sendEvent({
          type: 'sub_agent_start',
          data: {
            agentId: tasks[0].id,
            agentName: subAgentConfig.name,
            taskDescription: casePrompt.slice(0, 200),
            stage: 'created',
            caseId: subCaseId,
          },
          timestamp: new Date().toISOString(),
        })
      }
    } else {
      // Dry-run: emit mock event, skip OrchestratorAgent
      sendEvent({
        type: 'sub_agent_start',
        data: {
          agentId: `dryrun_${subCaseId}`,
          agentName: subAgentConfig.name,
          taskDescription: casePrompt.slice(0, 200),
          stage: 'created',
          caseId: subCaseId,
          dryRun: true,
        },
        timestamp: new Date().toISOString(),
      })
    }

    sendEvent({
      type: 'case_created',
      data: {
        caseId: subCaseId,
        caseType: caseType,
        displayName: ctRow.displayName,
        icon: ctRow.icon,
      },
      timestamp: new Date().toISOString(),
    })

    await ctx.traceWriter.write('loop_decision', `Case agent dispatched: ${caseType}`, { caseType, caseId: subCaseId })

    return { kind: 'continue' }
  } catch (err) {
    console.error('[ToolInterceptor] Failed to dispatch case agent:', err)
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
// request_user_input (form)
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
      skillCallId: result.toolUse?.id || crypto.randomUUID(),
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
// processPendingGuardrailToolCalls
// ---------------------------------------------------------------------------

export async function processPendingGuardrailToolCalls(
  ctx: ToolInterceptorContext,
  policyEval: PolicyEvaluationResult,
  sendEvent: (event: SSEEvent) => void,
): Promise<void> {
  const escalatedResults = policyEval.results.filter((r) => r.result === 'escalated')
  const escalatedReasons = escalatedResults
    .map((r) => `${r.policyName}: ${r.reason || 'guardrail escalation'}`)
    .join('; ')

  await ctx.traceWriter.write('loop_decision', 'Auto-escalate from guardrail policy', {
    policyNames: escalatedResults.map((r) => r.policyName),
    reasons: escalatedReasons,
    pendingToolCalls: policyEval.pendingToolCalls,
  })

  const pendingCalls = policyEval.pendingToolCalls || []
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
          blocker: `Guardrail escalation (${ptc.hookName}): ${ptc.reason}`,
          chatId: ctx.chatId ?? ctx.caseId,
        })
        await ctx.persistence.createHumanTask({
          caseId: ctx.caseId,
          queue: ctx.caseSchema?.escalateOn?.[0] || 'general',
          question: `Auto-escalated by guardrail "${ptc.hookName}". ${ptc.reason}. Skills called: ${ctx.chatMemory.getSkillsCalled().join(', ')}.`,
          status: 'pending',
        })
      } catch (err) {
        console.error('[ToolInterceptor] Failed to auto-create human task from guardrail:', err)
      }
    }
  }

  // Legacy fallback: escalated results but no pendingToolCalls
  if (pendingCalls.length === 0 && escalatedResults.length > 0) {
    try {
      const resolvedCaseType = ctx.caseSchema?.type || 'general'
      await ctx.persistence.ensureCase({
        id: ctx.caseId,
        orgId: ctx.orgId,
        userId: ctx.userId,
        type: resolvedCaseType,
        status: 'escalated',
        blocker: `Policy escalation: ${escalatedReasons}`,
        chatId: ctx.chatId ?? ctx.caseId,
      })
      await ctx.persistence.createHumanTask({
        caseId: ctx.caseId,
        queue: ctx.caseSchema?.escalateOn?.[0] || 'general',
        question: `Auto-escalated by policy. ${escalatedReasons}. Skills called: ${ctx.chatMemory.getSkillsCalled().join(', ')}.`,
        status: 'pending',
      })
    } catch (err) {
      console.error('[ToolInterceptor] Failed to auto-create human task from legacy escalation:', err)
    }
  }

  // Customer-facing fallback
  sendEvent({
    type: 'text_delta',
    data: '非常抱歉，您的问题需要由人工专员协助处理。我们已为您创建工单，专员将尽快与您联系，感谢您的耐心等待。',
    timestamp: new Date().toISOString(),
  })
  sendEvent({
    type: 'escalated',
    data: { stage: ctx.getCurrentStage(), reason: escalatedReasons },
    timestamp: new Date().toISOString(),
  })

  ctx.setPendingEscalation(true)
}

// ---------------------------------------------------------------------------
// processDispatchSubagent (CC mode)
// ---------------------------------------------------------------------------

export async function processDispatchSubagent(
  ctx: ToolInterceptorContext,
  toolResults: ToolExecutionResult[],
  sendEvent: (event: SSEEvent) => void,
): Promise<ToolExecutionResult[]> {
  const caseLoop = ctx.getCaseLoop()
  if (!caseLoop) return toolResults

  const dispatchResults: ToolExecutionResult[] = []
  for (const tr of toolResults) {
    if (tr.name !== 'dispatch_subagent') {
      dispatchResults.push(tr)
      continue
    }
    const input = tr.output as { agentName?: string; taskDescription?: string; taskPrompt?: string } | undefined
    if (!input?.agentName || !input?.taskPrompt) {
      dispatchResults.push({
        ...tr,
        output: { ok: false, error: 'dispatch_subagent requires agentName, taskDescription, and taskPrompt' },
      })
      continue
    }
    try {
      await caseLoop.dispatchSingle(
        input.agentName,
        input.taskDescription ?? input.agentName,
        input.taskPrompt,
        sendEvent,
      )
      dispatchResults.push({ ...tr, output: { ok: true, status: 'dispatched', agentName: input.agentName } })
    } catch (err) {
      dispatchResults.push({
        ...tr,
        output: { ok: false, error: String(err) },
      })
    }
  }
  return dispatchResults
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(value as string) as T } catch { return fallback }
}

function normalizeExecutionMode(raw: unknown): 'stage' | 'cc' {
  return (raw === 'sop' ? 'cc' : raw) === 'cc' ? 'cc' : 'stage'
}

function collectStageSkillNames(
  stageConfigs: Record<string, unknown>,
  executionMode: 'stage' | 'cc',
): Set<string> {
  const names = new Set<string>()
  for (const sc of Object.values(stageConfigs)) {
    const cfg = sc as Record<string, unknown>
    const skills = Array.isArray(cfg.availableSkills) ? cfg.availableSkills : []
    for (const s of skills) names.add(s)
  }
  // Always allow terminal tools
  for (const t of ['create_human_task', 'finalize_case', 'request_user_input']) {
    names.add(t)
  }
  if (executionMode === 'cc') {
    names.add('todo_write')
    names.add('todo_read')
    names.add('dispatch_subagent')
  }
  return names
}

function buildTaskPrompt(
  executionMode: 'stage' | 'cc',
  ctRow: { defaultGoal?: string | null; displayName: string; sop?: string | null },
  stages: string[],
  casePrompt: string,
): string {
  const sopDoc = (ctRow as any).sop?.trim()
  if (executionMode === 'cc' && sopDoc) {
    return `[Case Agent: ${ctRow.displayName}]\n\n## SOP\n${sopDoc}\n\n## Goal\n${casePrompt}\n\nFollow the SOP. Use todo_write to plan, then execute each step. Call finalize_case when done.`
  }
  return `[Case Agent: ${ctRow.displayName}]\n\n## Goal\n${casePrompt}\n\nInvestigate through these stages: ${stages.join(' → ')}. Call finalize_case when resolved.`
}

function resolveMaxIterations(stageConfigs: Record<string, unknown>): number {
  let max = 5
  const values = Object.values(stageConfigs)
    .map((sc) => (sc as Record<string, unknown>).maxIterations)
    .filter((v): v is number => typeof v === 'number' && v > 0)
  if (values.length > 0) max = Math.max(...values)
  return max
}
