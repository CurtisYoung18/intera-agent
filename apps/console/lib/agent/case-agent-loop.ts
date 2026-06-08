// Intera Harness - CaseAgentLoop
// Case-specific execution engine: stage progression, sub-agent orchestration,
// Hook enforcement, and terminal case tool handling.
// Extracted from AgentLoop (loop.ts) as Phase 2 of the architectural split.
//
// Responsibilities:
//   • Owns stage state (stageExecutor, orchestrator, currentStage)
//   • Builds Case-mode system prompts (with stage context + mode banner)
//   • Dispatches and merges sub-agents for each stage
//   • Handles terminal case tools: finalize_case, finalize_consultation, create_human_task
//   • Applies stage transitions evaluated by StageExecutor

import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Message, SSEEvent, CaseSchemaConfig, TodoItem } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { StageExecutor, type TransitionEval } from './stage-executor'
import { ProcedureExecutor } from './procedure-executor'
import { OrchestratorAgent } from './orchestrator'
import type { ChatMemoryManager } from './memory'
import type { HookEngine } from './hook-engine'
import type { TraceWriter } from './trace'
import type { ToolRouter } from './tools'
import { unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'
import type { LoopResult } from './loop'

// ---------------------------------------------------------------------------
// Service bag — injected by AgentLoop so CaseAgentLoop never owns the
// mutable message list or Hook engine directly.
// ---------------------------------------------------------------------------

export interface CaseLoopServices {
  caseId: string
  orgId: string
  agentConfigId: string
  userId: string
  chatId?: string | null
  config: AgentConfigData
  chatMemory: ChatMemoryManager
  /** Live accessor — called at usage time, never captured at construction. */
  getHookEngine: () => HookEngine
  traceWriter: TraceWriter
  toolRouter: ToolRouter
  /** Always returns the current message array (survives loadMessages replacement). */
  getMessages: () => Message[]
  addMessage: (msg: Message) => void
  makeUserMessage: (content: string) => Message
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CaseToolResult =
  /** No case-specific terminal tool matched — caller processes normally. */
  | { type: 'none' }
  /** Tool handled, but the outer loop should continue to the next iteration. */
  | { type: 'continue' }
  /** Terminal result — caller must return this from run(). */
  | { type: 'terminal'; result: LoopResult }

// ---------------------------------------------------------------------------
// CaseAgentLoop
// ---------------------------------------------------------------------------

export class CaseAgentLoop {
  private stageExecutor: StageExecutor
  private procedureExecutor: ProcedureExecutor | null = null
  private orchestrator: OrchestratorAgent | null = null
  private _currentStage: string

  constructor(
    private readonly caseSchema: CaseSchemaConfig,
    private readonly services: CaseLoopServices,
    bootstrapNewCase?: boolean,
  ) {
    this.stageExecutor = new StageExecutor(
      caseSchema,
      services.config,
      services.chatMemory,
      bootstrapNewCase,
    )
    // Procedure refactor (Phase 2, additive): when the case type carries a typed
    // Procedure, it runs the structured single-agent path (rendered via the cc prompt
    // branch). Case types without a procedure keep the legacy stage/sop behaviour.
    if (caseSchema.procedure && caseSchema.procedure.steps.length > 0) {
      this.procedureExecutor = new ProcedureExecutor(caseSchema.procedure, caseSchema.type)
    }
    this._currentStage = this.stageExecutor.getCurrentStage()
    this.orchestrator = new OrchestratorAgent(
      caseSchema,
      services.toolRouter.getToolDefinitions(),
      services.userId,
      services.chatMemory,
    )
  }

  // ── Public state ──────────────────────────────────────────────────────────

  get currentStage(): string { return this._currentStage }

  getProcedureStepIdsForTool(toolName?: string): string[] {
    if (!this.procedureExecutor) return []
    return this.procedureExecutor.stepIdsForTool(toolName, this.services.chatMemory.getTodos())
  }

  getStopProcedureStepIds(): string[] {
    if (!this.procedureExecutor) return []
    return this.procedureExecutor.stepIdsForStop(this.services.chatMemory.getTodos())
  }

  /**
   * True when the case is past the "created" discovery stage.
   * Step mode: also returns true for "created" so the step prompt with todo
   * tools is shown immediately after dispatch_case_agent, without waiting for a
   * no-tools iteration to trigger stage transition.
   */
  isStageActive(): boolean {
    if (this._currentStage !== 'created') return true
    return this.caseSchema.executionMode === 'cc'
  }

  /** Re-sync stage from CaseMemory — call this after loadMemory. */
  syncStage(): void {
    this._currentStage = this.stageExecutor.getCurrentStage()
  }

  // ── Prompt & tool selection ───────────────────────────────────────────────

  /**
   * Build the Case-Execution mode system prompt.
   * Prepends an explicit mode/stage banner, then delegates to
   * StageExecutor.buildStagePrompt() for stage-specific instructions.
   */
  /** True when this case type uses SOP-driven autonomous todo execution. */
  isSopMode(): boolean {
    return this.caseSchema.executionMode === 'cc'
  }

  /** True when this case type carries a typed Procedure (structured-SOP path). */
  isProcedureMode(): boolean {
    return this.procedureExecutor !== null
  }

  /** Tool targets the Procedure hard-requires before completion (empty when not in procedure mode). */
  procedureRequiredTools(): string[] {
    return this.procedureExecutor?.requiredTools() ?? []
  }

  /**
   * Build the Procedure-mode system prompt (structured successor to buildSopPrompt).
   * Renders the ordered steps + todos + facts; only called when isProcedureMode().
   */
  buildProcedurePrompt(basePrompt: string, todos: TodoItem[], facts: Record<string, unknown>): string {
    return this.procedureExecutor!.buildPrompt(basePrompt, this._currentStage, todos, facts)
  }

  /**
   * Build the SOP-mode system prompt.
   * Embeds the natural-language SOP document and current todo list so the
   * agent can plan and track its own investigation steps — CC full-trust pattern.
   */
  buildSopPrompt(basePrompt: string, todos: TodoItem[], facts: Record<string, unknown>): string {
    const sopDoc = this.caseSchema.sop?.trim() || '(No SOP document provided — use your best judgment.)'

    const todoLines = todos.length === 0
      ? '  ⚠️ EMPTY — Proceed with investigation to gather required evidence.'
      : todos.map((t) => {
          const icon = t.status === 'completed' ? '✓' : t.status === 'cancelled' ? '✗' : t.status === 'in_progress' ? '→' : '○'
          const notes = t.notes ? ` — ${t.notes}` : ''
          return `  [${icon}] ${t.id} ${t.text}${notes}`
        }).join('\n')

    const factLines = Object.entries(facts).length === 0
      ? '  (none yet)'
      : Object.entries(facts)
          .filter(([k]) => !k.startsWith('__'))
          .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
          .join('\n')

    const header = [
      `[INTERA MODE: SOP EXECUTION | type: ${this.caseSchema.type} | stage: ${this._currentStage}]`,
      '',
      '## Standard Operating Procedure',
      sopDoc,
      '',
      '## Current Investigation Todos',
      todoLines,
      '',
      '## Confirmed Facts',
      factLines,
      '',
      '## NON-NEGOTIABLE EXECUTION RULES',
      '',
      'Rule 1 — Decision conditions are HARD TRIGGERS, not suggestions.',
      'When a condition is satisfied, call the prescribed tool IN THAT SAME TURN.',
      'Rule 2 — Complete each investigation when its tool call succeeds.',
    ].join('\n')
    return header + '\n\n' + basePrompt
  }

  buildPrompt(basePrompt: string): string {
    const header = [
      `[INTERA MODE: CASE EXECUTION | type: ${this.caseSchema.type} | stage: ${this._currentStage}]`,
      'You are executing a structured case investigation.',
      'Follow stage requirements strictly. Use tools for all actions —',
      'text-only assertions are not sufficient and will trigger a correction nudge.',
      '',
    ].join('\n')
    return header + this.stageExecutor.buildStagePrompt(this._currentStage, basePrompt)
  }

  /** Filter tools to those allowed in the current stage. */
  filterTools(allTools: Tool[], nudgeCount: number): Tool[] {
    return this.stageExecutor.filterTools(this._currentStage, allTools, nudgeCount)
  }

  getStageConfig(stage: string) {
    return this.stageExecutor.getStageConfig(stage)
  }

  hasStageConfigs(): boolean {
    return this.stageExecutor.hasStageConfigs()
  }

  /**
   * Filter tools for step mode — all customer skills.
   * dispatch_case_agent is not needed in SOP mode — the case already exists.
   */
  filterSopTools(allTools: Tool[]): Tool[] {
    const excludedInSop = new Set(['dispatch_case_agent'])
    return allTools.filter((t) => !excludedInSop.has(t.name))
  }

  // ── No-tools stage evaluation ─────────────────────────────────────────────

  /**
   * Result of evaluating stage state after a turn with no tool calls.
   * Tells the outer loop whether to continue (stage advanced), nudge, or escalate.
   */
  evaluateStageAfterNoTools(iterationCount: number, nudgeCount = 0): {
    advanced: boolean
    needsNudge: boolean
    nudgeMessage: string
    missingSkills: string[]
    missingEvidence: string[]
  } {
    // Step mode: no stage nudges — the agent drives itself via todos
    if (this.caseSchema.executionMode === 'cc') {
      return { advanced: false, needsNudge: false, nudgeMessage: '', missingSkills: [], missingEvidence: [] }
    }

    if (!this.stageExecutor.hasStageConfigs()) {
      return { advanced: false, needsNudge: false, nudgeMessage: '', missingSkills: [], missingEvidence: [] }
    }

    // 1. Evaluate stage transition (even without tools, stages can auto-advance)
    const skillCheck = this.stageExecutor.checkRequiredSkills(this._currentStage)
    const evidenceCheck = this.stageExecutor.checkEvidenceRequirements(this._currentStage)

    if (!skillCheck.met || !evidenceCheck.met) {
      // nudgeCount is the CURRENT count (before increment). buildNudge expects the
      // upcoming nudge number (1-indexed), so add 1. This way the first nudge shows
      // the gentle reminder, the second shows STOP, and ≥3 shows FINAL WARNING.
      const nudgeMsg = this.stageExecutor.buildNudge(this._currentStage, nudgeCount + 1)
      return {
        advanced: false,
        needsNudge: true,
        nudgeMessage: nudgeMsg,
        missingSkills: skillCheck.missing,
        missingEvidence: evidenceCheck.missing,
      }
    }

    return { advanced: false, needsNudge: false, nudgeMessage: '', missingSkills: [], missingEvidence: [] }
  }

  /**
   * Evaluate stage transition after no tools were called.
   * Uses rule-based checks (required skills + evidence) instead of LLM evaluation.
   * Includes a "created → next stage" fallback.
   */
  async evaluateStageTransitionAfterNoTools(
    iterationCount: number,
  ): Promise<TransitionEval> {
    // Step mode: skip stage machine — advance 'created' → first stage automatically,
    // then let the agent drive via todos (no further stage machine transitions).
    if (this.caseSchema.executionMode === 'cc') {
      if (this._currentStage === 'created') {
        const next = this.stageExecutor.getNextStageName('created')
        if (next) {
          return {
            shouldTransition: true,
            nextStage: next,
            reason: 'Step mode: auto-advance from created to investigation stage.',
          }
        }
      }
      return { shouldTransition: false, reason: 'Step mode: stage progression driven by todos.' }
    }

    // Rule-based transition: check skills + evidence requirements
    const skillCheck = this.stageExecutor.checkRequiredSkills(this._currentStage)
    const evidenceCheck = this.stageExecutor.checkEvidenceRequirements(this._currentStage)
    const nextStage = this.stageExecutor.getNextStageName(this._currentStage)

    if (skillCheck.met && evidenceCheck.met && nextStage) {
      return {
        shouldTransition: true,
        nextStage,
        reason: `Rule-based: all skills and evidence met for ${this._currentStage}.`,
      }
    }

    // Fallback: advance from 'created' after first assistant turn
    if (this._currentStage === 'created') {
      const fbNext = this.stageExecutor.getNextStageName('created')
      if (fbNext) {
        return {
          shouldTransition: true,
          nextStage: fbNext,
          reason: 'Fallback advance from created after first assistant turn.',
        }
      }
    }

    return { shouldTransition: false, reason: 'Requirements not yet met.' }
  }

  // ── Sub-agent management ──────────────────────────────────────────────────

  getPendingAgentNames(): string[] {
    return this.orchestrator?.getPendingAgentNames() ?? []
  }

  hasNewSubAgentResults(): boolean {
    return this.orchestrator?.hasNewResults() ?? false
  }

  drainSubAgentResults() {
    return this.orchestrator?.drainNewResults() ?? []
  }

  /**
   * Merge newly-arrived background sub-agent results into CaseMemory and
   * inject their findings as user-visible context messages.
   */
  mergeNewSubAgentResults(): boolean {
    if (!this.orchestrator?.hasNewResults()) return false
    const newResults = this.orchestrator.drainNewResults()
    const mem = this.services.chatMemory.getSummary()
    this.orchestrator.mergeResults(
      newResults,
      mem.confirmedFacts as Record<string, unknown>,
      mem.skillResults as Record<string, unknown>,
      mem.keyEvents as Array<{ at: string; text: string; source: string }>,
    )
    for (const r of newResults) {
      this.services.addMessage(
        this.services.makeUserMessage(OrchestratorAgent.toContextMessage(r)),
      )
    }
    return true
  }

  /** Emit the core_agent_progress SSE event (case mode only). */
  emitProgressEvent(iterationCount: number, sendEvent: (event: SSEEvent) => void): void {
    const stageCfg = this.stageExecutor.getStageConfig(this._currentStage)
    const stageLabel = (stageCfg as any)?.name || this._currentStage
    sendEvent({
      type: 'core_agent_progress',
      data: {
        stage: this._currentStage,
        iteration: iterationCount,
        task: `${stageLabel} · iter ${iterationCount}`,
        pendingSubAgents: this.getPendingAgentNames(),
      },
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Dispatch sub-agents for the current stage (non-blocking / fire-and-forget).
   * Idempotent — does nothing if agents have already been dispatched for this stage.
   */
  async startDedicatedAgents(sendEvent: (event: SSEEvent) => void): Promise<void> {
    if (!this.orchestrator?.isEnabled()) return
    const stageCfg = this.stageExecutor.getStageConfig(this._currentStage)
    if (!stageCfg?.subAgents?.length) return

    const agentNames = stageCfg.subAgents.map((c) => c.name)
    if (this.services.chatMemory.hasDispatchedSubAgentsFor(this._currentStage, agentNames)) return

    const mem = this.services.chatMemory.getSummary()
    try {
      const tasks = await this.orchestrator.planInvestigation(
        this._currentStage,
        stageCfg.subAgents,
        mem as any,
        stageCfg.description || this._currentStage,
      )

      if (tasks.length > 0) {
        for (const task of tasks) {
          sendEvent({
            type: 'sub_agent_start',
            data: {
              agentId: task.id,
              agentName: task.agentConfig.name,
              taskDescription: task.taskPrompt.slice(0, 200),
              stage: this._currentStage,
              caseId: this.services.caseId,
            },
            timestamp: new Date().toISOString(),
          })
        }

        this.orchestrator.dispatchInBackground(tasks, sendEvent)
        this.services.chatMemory.recordSubAgentsDispatched(
          this._currentStage,
          tasks.map((t) => t.agentConfig.name),
        )

        sendEvent({
          type: 'core_agent_progress',
          data: {
            stage: this._currentStage,
            iteration: 0,
            task: `Coordinating ${tasks.length} sub-agent(s) for parallel investigation`,
            pendingSubAgents: tasks.map((t) => t.agentConfig.name),
          },
          timestamp: new Date().toISOString(),
        })

        await this.services.traceWriter.write('loop_decision', 'Sub-agents dispatched (background)', {
          stage: this._currentStage,
          subAgents: tasks.map((t) => t.agentConfig.name),
        })
      }
    } catch (err) {
      console.error('[CaseAgentLoop] startDedicatedAgents failed:', err)
    }
  }

  /**
   * Dispatch a single sub-agent by name (used by dispatch_subagent tool in CC mode).
   * Searches all stages for the sub-agent config matching agentName.
   */
  async dispatchSingle(
    agentName: string,
    taskDescription: string,
    taskPrompt: string,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<void> {
    if (!this.orchestrator?.isEnabled()) {
      throw new Error('Orchestrator is not enabled for this case type')
    }

    let config: import('@intera/shared/types').SubAgentConfig | undefined
    for (const stageName of this.caseSchema.stages ?? []) {
      const stageCfg = this.stageExecutor.getStageConfig(stageName)
      const cfg = stageCfg?.subAgents?.find((c) => c.name === agentName)
      if (cfg) { config = cfg; break }
    }
    if (!config) {
      throw new Error(`Unknown sub-agent: ${agentName}`)
    }

    const task: import('@intera/shared/types').SubAgentTask = {
      id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentConfig: config,
      taskPrompt,
      context: {
        caseId: this.services.caseId,
        chatMemory: this.services.chatMemory.getSummary(),
        stageGoal: this._currentStage,
      },
    }

    await this.orchestrator.dispatch([task], sendEvent, this._currentStage)
  }

  // ── Case terminal tool dispatch ───────────────────────────────────────────

  /**
   * Handle all case-specific terminal tools from a batch of tool results.
   *
   * Returns:
   *   { type: 'none' }        — no case tool matched; caller processes normally
   *   { type: 'continue' }    — tool handled; outer loop should `continue`
   *   { type: 'terminal' }    — terminal result; caller must return from run()
   *
   * Also evaluates stage transitions when no terminal tool was triggered.
   */
  async handleCaseTerminalTools(
    toolResults: ToolExecutionResult[],
    iterationCount: number,
    /** Boxed so CaseAgentLoop can reset it on stage transition. */
    nudgeCount: { value: number },
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    // ── create_human_task ─────────────────────────────────────
    const humanTaskResult = toolResults.find((r) => r.name === 'create_human_task')
    if (humanTaskResult) {
      return this.handleCreateHumanTask(humanTaskResult, iterationCount, sendEvent)
    }

    // ── finalize_case ─────────────────────────────────────────
    const finalizeResult = toolResults.find((r) => r.name === 'finalize_case')
    if (finalizeResult) {
      return this.handleFinalizeCase(finalizeResult, sendEvent)
    }

    // ── finalize_consultation ─────────────────────────────────
    const consultResult = toolResults.find((r) => r.name === 'finalize_consultation')
    if (consultResult) {
      return this.handleFinalizeConsultation(consultResult, sendEvent)
    }

    // ── Stage transition eval (non-terminal) ──────────────────
    // Rule-based first, then optional LLM eval gate
    if (this.stageExecutor.hasStageConfigs()) {
      let transitionEval: TransitionEval
      try {
        transitionEval = await this.stageExecutor.evaluateTransition(this._currentStage, iterationCount)
      } catch (err) {
        console.error('[CaseAgentLoop] Stage evaluation (post-tools) failed:', err)
        transitionEval = { shouldTransition: false, reason: `evaluation error: ${err}` }
      }
      if (transitionEval.modelUsed) {
        await this.services.traceWriter.write(
          'stage_eval',
          `Stage eval (post-tools): ${this._currentStage} → ${transitionEval.nextStage || 'stay'}`,
          {
            model: transitionEval.modelUsed,
            stage: this._currentStage,
            shouldTransition: transitionEval.shouldTransition,
            reason: transitionEval.reason,
          },
        )
      }
      await this.applyStageTransitionFromEval(transitionEval, nudgeCount, sendEvent)
    }

    return { type: 'none' }
  }

  // ── Private terminal handlers ─────────────────────────────────────────────

  private buildHitCounts(): Map<string, number> {
    const m = new Map<string, number>()
    const hookEngine = this.services.getHookEngine()
    for (const name of hookEngine.getHookNames()) {
      const c = this.services.chatMemory.getPolicyHitCount(name)
      if (c > 0) m.set(name, c)
    }
    return m
  }

  private async handleCreateHumanTask(
    humanTaskResult: ToolExecutionResult,
    iterationCount: number,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    const toolInput = humanTaskResult.toolUse?.input || {}
    const queue = String(toolInput.queue || 'general')
    const question = String(toolInput.question || 'Human task requested')
    const taskFields = toolInput.fields as Array<Record<string, unknown>> | undefined

    const { caseId, orgId, userId, chatId } = this.services
    const resolvedCaseType = this.caseSchema.type || 'general'
    const chatMemory = this.services.chatMemory

    let taskId: string | null = null
    const MAX_HT_RETRIES = 3

    for (let attempt = 1; attempt <= MAX_HT_RETRIES; attempt++) {
      try {
        await prisma.organization.upsert({
          where: { id: orgId },
          update: {},
          create: { id: orgId, name: orgId },
        })

        await prisma.case.upsert({
          where: { id: caseId },
          update: { status: 'waiting_human', blocker: `Waiting for ${queue}` },
          create: {
            id: caseId,
            orgId,
            userId,
            type: resolvedCaseType,
            status: 'waiting_human',
            blocker: `Waiting for ${queue}`,
            chatId: chatId ?? caseId,
          },
        })

        const dbFields = chatMemory.getDbFields()
        await prisma.chatMemory.upsert({
          where: { caseId },
          update: {
            ...dbFields,
            humanTaskStatus: 'pending',
          },
          create: {
            caseId,
            ...dbFields,
            humanTaskStatus: 'pending',
          },
        })

        const task = await prisma.humanTask.create({
          data: {
            caseId,
            queue,
            question,
            fields: taskFields && taskFields.length > 0 ? JSON.stringify(taskFields) : null,
            status: 'pending',
          },
        })
        taskId = task.id

        await this.services.traceWriter.writeHumanTaskCreated(task.id, queue)

        // Replace mock result with real task ID in message history
        const messages = this.services.getMessages()
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (
            m.role === 'assistant' &&
            typeof m.content === 'string' &&
            m.content.startsWith('Tool create_human_task result:')
          ) {
            m.content = `Tool create_human_task result: ${JSON.stringify({ taskId: task.id, queue, status: 'pending' })}`
            break
          }
        }

        sendEvent({
          type: 'human_task_created',
          data: { taskId: task.id, queue, status: 'pending' },
          timestamp: new Date().toISOString(),
        })

        // Also emit escalated so the bridge triggers transfer_chat for LiveChat channels
        sendEvent({
          type: 'escalated',
          data: { reason: 'human_task_created', taskId: task.id, queue },
          timestamp: new Date().toISOString(),
        })

        break // success
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[CaseAgentLoop] Failed to persist human task (attempt ${attempt}/${MAX_HT_RETRIES}):`, msg)
        if (attempt < MAX_HT_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt * 200))
        }
      }
    }

    // All retries failed — surface error without aborting the agent
    if (!taskId) {
      sendEvent({
        type: 'core_agent_progress',
        data: {
          stage: this._currentStage,
          iteration: iterationCount,
          task: 'Human task creation failed — please try again or contact support',
          pendingSubAgents: [],
        },
        timestamp: new Date().toISOString(),
      })
      return { type: 'continue' }
    }

    // Exit: case now waiting for human. Agent already told the customer — no extra hardcoded message.
    sendEvent({
      type: 'message_stop',
      data: { reason: 'waiting_human', stage: this._currentStage },
      timestamp: new Date().toISOString(),
    })
    return {
      type: 'terminal',
      result: {
        messages: this.services.getMessages(),
        caseStatus: 'waiting_human' as CaseStatus,
        transition: 'waiting_human',
        currentStage: this._currentStage,
        reason: 'human_task_created',
      },
    }
  }

  private async handleFinalizeCase(
    finalizeResult: ToolExecutionResult,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    // Mandatory human review check
    if (
      this.caseSchema.requireHumanReview &&
      !this.services.chatMemory.getSkillsCalled().includes('create_human_task')
    ) {
      const blockedMsg =
        '[HOOK: Stop] This case type requires human review before finalizing. ' +
        'Call create_human_task to escalate to a human specialist.'
      await this.services.traceWriter.write('loop_decision', 'Finalize blocked: mandatory human review required', {
        checkpoint: 'Stop',
        requirement: 'mandatory_human_review',
      })
      sendEvent({
        type: 'policy_blocked',
        data: { toolName: 'finalize_case', hookNames: ['mandatory_human_review'] },
        timestamp: new Date().toISOString(),
      })
      this.services.addMessage(this.services.makeUserMessage(blockedMsg))
      return { type: 'continue' }
    }

    const finalizedPayload = unwrapToolExecutionPayload(finalizeResult.output)
    const hookEngine = this.services.getHookEngine()
    const stopEval = await hookEngine.evaluate(
      'Stop',
      {
        checkpoint: 'Stop',
        agentConfigId: this.services.agentConfigId,
        caseId: this.services.caseId,
        chatId: this.services.chatId ?? undefined,
        caseType: {
          type: this.caseSchema.type,
          displayName: this.caseSchema.displayName,
        },
        procedureStepIds: this.getStopProcedureStepIds(),
        tool: {
          name: 'finalize_case',
          input: finalizeResult.toolUse?.input,
          output: finalizedPayload,
        },
        caseFacts: this.services.chatMemory.getConfirmedFacts(),
        missingFacts: this.services.chatMemory.getMissingFacts(),
        previousToolCalls: this.services.chatMemory.getSkillsCalled().map((name) => ({
          name,
          output: this.services.chatMemory.getSkillResult(name),
        })),
        traceSummary: this.services.chatMemory.getKeyEvents().slice(-10).map((event) => ({
          at: event.at,
          text: event.text,
          source: event.source,
        })),
        replyDraft: typeof finalizedPayload === 'string' ? finalizedPayload : JSON.stringify(finalizedPayload),
        metadata: {
          currentStage: this._currentStage,
          terminalTool: 'finalize_case',
        },
      },
      this.buildHitCounts(),
    )

    if (stopEval.summary === 'block' || stopEval.summary === 'escalate') {
      for (const r of stopEval.results) {
        if (r.action !== 'allow') this.services.chatMemory.recordPolicyHit(r.hookName)
      }
      await this.services.traceWriter.write(
        'loop_decision',
        'Finalize blocked by Stop Hook',
        stopEval as unknown as Record<string, unknown>,
      )
      sendEvent({
        type: 'error',
        data: `Finalize blocked by Stop Hook: ${stopEval.results
          .filter((r) => r.action === 'block' || r.action === 'escalate')
          .map((r) => r.hookName)
          .join(', ')}`,
        timestamp: new Date().toISOString(),
      })
      if (stopEval.feedbackMessage) {
        this.services.addMessage(this.services.makeUserMessage(stopEval.feedbackMessage))
      }
      return { type: 'continue' }
    }

    await this.services.traceWriter.writeFinalResolution('resolved', JSON.stringify(finalizedPayload))

    try {
      await prisma.case.update({
        where: { id: this.services.caseId },
        data: { status: 'resolved', resolvedAt: new Date(), blocker: null },
      })
    } catch (err) {
      console.error('[CaseAgentLoop] Failed to persist case resolution:', err)
    }

    sendEvent({ type: 'finalized', data: finalizedPayload, timestamp: new Date().toISOString() })
    return {
      type: 'terminal',
      result: {
        messages: this.services.getMessages(),
        caseStatus: 'resolved' as CaseStatus,
        transition: 'resolved',
        currentStage: this._currentStage,
      },
    }
  }

  private async handleFinalizeConsultation(
    consultResult: ToolExecutionResult,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<CaseToolResult> {
    // Read from tool input first — mock executor returns static fixture
    // {"status":"consultation_closed"}, dropping the model's summary/resolution.
    const toolInput = (consultResult.toolUse?.input || {}) as Record<string, unknown>
    const output = unwrapToolExecutionPayload(consultResult.output) as Record<string, unknown> | undefined
    const summary = String(toolInput.summary || output?.summary || 'Your case has been reviewed by our specialist.')
    const resolution = String(toolInput.resolution || output?.resolution || 'resolved')

    await this.services.traceWriter.write('final_resolution', `Consultation complete: ${resolution}`, output ?? {})

    try {
      await prisma.case.update({
        where: { id: this.services.caseId },
        data: { status: 'investigating', blocker: null },
      })
      await prisma.humanTask.updateMany({
        where: { caseId: this.services.caseId, status: 'in_progress' },
        data: { status: 'resolved', verdict: resolution, notes: summary },
      })
    } catch (err) {
      console.error('[CaseAgentLoop] Failed to finalize consultation:', err)
    }

    sendEvent({
      type: 'consultation_complete',
      data: { summary, resolution },
      timestamp: new Date().toISOString(),
    })
    return {
      type: 'terminal',
      result: {
        messages: this.services.getMessages(),
        caseStatus: 'investigating' as CaseStatus,
        transition: 'consultation_complete',
        currentStage: this._currentStage,
      },
    }
  }

  // ── Stage transition ──────────────────────────────────────────────────────

  /**
   * Apply an evaluator-approved stage transition.
   * Updates currentStage, resets nudgeCount, and dispatches any sub-agents
   * configured for the new stage. Hook activation is owned by HookBinding
   * scope, not legacy stage config mutation.
   *
   * Returns true if a transition actually occurred.
   */
  async applyStageTransitionFromEval(
    transitionEval: TransitionEval,
    nudgeCount: { value: number },
    sendEvent: (event: SSEEvent) => void,
  ): Promise<boolean> {
    if (!transitionEval.shouldTransition || !transitionEval.nextStage) return false

    const next = transitionEval.nextStage
    if (!this.caseSchema.stages.includes(next)) {
      console.warn('[CaseAgentLoop] Ignoring evaluator nextStage not in schema:', next)
      return false
    }

    const prevStage = this._currentStage
    if (next === prevStage) return false

    this._currentStage = next
    this.services.chatMemory.setCaseStatus(next)
    nudgeCount.value = 0
    this.services.chatMemory.resetPolicyHits()

    await this.services.traceWriter.write('loop_decision', 'Stage transition', {
      from: prevStage,
      to: this._currentStage,
      reason: transitionEval.reason,
    })

    sendEvent({
      type: 'case_status',
      data: {
        stage: this._currentStage,
        previousStage: prevStage,
        reason: transitionEval.reason,
      },
      timestamp: new Date().toISOString(),
    })

    if (this.orchestrator?.isEnabled()) {
      const stageCfg = this.stageExecutor.getStageConfig(this._currentStage)
      if (stageCfg?.subAgents?.length) {
        try {
          const mem = this.services.chatMemory.getSummary()
          const tasks = await this.orchestrator.planInvestigation(
            this._currentStage,
            stageCfg.subAgents,
            mem as any,
            stageCfg.description || this._currentStage,
          )
          if (tasks.length > 0) {
            const results = await this.orchestrator.dispatch(tasks, sendEvent, this._currentStage)
            this.orchestrator.mergeResults(
              results,
              mem.confirmedFacts as Record<string, unknown>,
              mem.skillResults as Record<string, unknown>,
              mem.keyEvents as Array<{ at: string; text: string; source: string }>,
            )
            for (const r of results) {
              this.services.addMessage(
                this.services.makeUserMessage(OrchestratorAgent.toContextMessage(r)),
              )
            }
            await this.services.traceWriter.write('loop_decision', 'Sub-agents dispatched', {
              stage: this._currentStage,
              subAgents: results.map((r) => r.agentName),
            })
          }
        } catch (err) {
          console.error('[CaseAgentLoop] Sub-agent dispatch on transition failed:', err)
        }
      }
    }

    return true
  }
}
