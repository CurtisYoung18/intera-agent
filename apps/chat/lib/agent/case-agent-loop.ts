// Intera Harness - CaseAgentLoop
// Case-specific execution engine: stage progression, sub-agent orchestration,
// policy enforcement, and terminal case tool handling.
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
import { OrchestratorAgent } from './orchestrator'
import type { CaseMemoryManager } from './memory'
import type { PolicyEngine } from './policy'
import type { TraceWriter } from './trace'
import type { SkillRouter } from './skills'
import { SOP_INTERNAL_SKILLS } from './skills'
import { unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'
import type { LoopResult } from './loop'

// ---------------------------------------------------------------------------
// Service bag — injected by AgentLoop so CaseAgentLoop never owns the
// mutable message list or policy engine directly.
// ---------------------------------------------------------------------------

export interface CaseLoopServices {
  caseId: string
  customerId: string
  userId: string
  chatId?: string | null
  config: AgentConfigData
  caseMemory: CaseMemoryManager
  /** Live accessor — called at usage time, never captured at construction. */
  getPolicyEngine: () => PolicyEngine
  traceWriter: TraceWriter
  skillRouter: SkillRouter
  /** Always returns the current message array (survives loadMessages replacement). */
  getMessages: () => Message[]
  addMessage: (msg: Message) => void
  makeUserMessage: (content: string) => Message
  writeProfilerSnapshot: () => Promise<void>
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
      services.caseMemory,
      bootstrapNewCase,
    )
    this._currentStage = this.stageExecutor.getCurrentStage()
    this.orchestrator = new OrchestratorAgent(
      caseSchema,
      services.skillRouter.getToolDefinitions(),
      services.userId,
      services.caseMemory,
    )
  }

  // ── Public state ──────────────────────────────────────────────────────────

  get currentStage(): string { return this._currentStage }

  /**
   * True when the case is past the "created" discovery stage.
   * SOP mode: also returns true for "created" so the SOP prompt with todo
   * tools is shown immediately after create_case, without waiting for a
   * no-tools iteration to trigger stage transition.
   */
  isStageActive(): boolean {
    if (this._currentStage !== 'created') return true
    return this.isSopMode()
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

  /** True when this case type uses SOP-driven autonomous todo execution. */
  isSopMode(): boolean {
    return this.caseSchema.executionMode === 'sop'
  }

  // ── SOP mode: prompt + tool selection ────────────────────────────────────

  /**
   * Build the SOP-mode system prompt.
   * Embeds the natural-language SOP document and current todo list so the
   * agent can plan and track its own investigation steps.
   */
  buildSopPrompt(basePrompt: string, todos: TodoItem[], facts: Record<string, unknown>): string {
    const sopDoc = this.caseSchema.sop?.trim() || '(No SOP document provided — use your best judgment.)'

    const todoLines = todos.length === 0
      ? '  ⚠️ EMPTY — You MUST create todos via todo_write BEFORE calling any investigation tools. Read the SOP above and break each step into a todo item.'
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
      '## ⚠️ NON-NEGOTIABLE EXECUTION RULES',
      '',
      '**Rule 1 — Decision conditions are HARD TRIGGERS, not suggestions:**',
      'The SOP\'s decision / 判断结果 section maps conditions to required tool calls.',
      'When you determine that a condition is satisfied, you MUST call the prescribed tool',
      'IN THAT SAME TURN — not the next turn, not after collecting more data.',
      '',
      '  ✅ CORRECT: Condition met → immediately call create_human_task / finalize_case / etc.',
      '  ❌ WRONG:   Condition met → describe the situation in text → ask user for more info',
      '',
      'Example: SOP says "账号状态与客户描述冲突 → create_human_task(queue=\'account_ops\')".',
      'If you see account status=Active but customer cannot log in, call create_human_task NOW.',
      'Do NOT say "需要人工核查" and then ask the customer questions. That is hallucination.',
      '',
      '**Rule 2 — Never narrate without acting:**',
      'If you write "this needs human review" or "I will escalate this" — you MUST call the',
      'corresponding tool in the SAME response. Text without the tool call is a failed turn.',
      '',
      '**Rule 3 — Never ask follow-up questions when SOP prescribes an action:**',
      'Once a decision condition is met, additional customer input cannot change the outcome.',
      'The SOP has already decided. Execute it. Do NOT ask "Can you tell me more about..."',
      'or "What error message did you see?" — that information cannot override the SOP.',
      '',
      '**Rule 4 — One turn = one decisive action:**',
      'After each set of tool results, either:',
      '  (a) Call the next tool in your plan, OR',
      '  (b) If a decision condition is met → call the required terminal tool, OR',
      '  (c) If all todos complete → call finalize_case.',
      'A text-only response is only valid when you are asking the user for input via request_user_input,',
      'or when you are delivering the final resolution message after finalize_case / create_human_task.',
      '',
      '## Instructions',
      '',
      '**CRITICAL — Plan ALL steps at once BEFORE acting:**',
      '- If the todo list is empty, you MUST plan ALL investigation steps from the SOP in a SINGLE turn.',
      '  Call todo_write for EACH SOP step to create the full todo list. Do NOT create one todo then',
      '  immediately start investigating — create ALL todos first, then execute them.',
      '  Example: if the SOP has 3 steps, call todo_write 3 times in your first turn to add all 3 items.',
      '- After planning, use todo_write to mark items complete (with findings in notes) as you finish each step.',
      '- After receiving any tool result, use todo_write to mark related items as DONE, then immediately call the next tool OR the terminal tool.',
      '- When all todos are done and the case is resolved, call finalize_case.',
      '- Add new todos if investigation reveals additional steps.',
      '- Never produce a text-only turn unless using request_user_input or delivering a final message after a terminal tool.',
      '',
      '## todo_write usage (exact format required)',
      '```',
      '# Add a new item:',
      '  todo_write({ "action": "add", "text": "Query order status" })',
      '',
      '# Mark complete with findings:',
      '  todo_write({ "action": "complete", "id": "<id-from-add-result>", "notes": "Order completed, amount matched" })',
      '',
      '# Cancel an irrelevant item:',
      '  todo_write({ "action": "cancel", "id": "<id>" })',
      '```',
      'The "action" field is REQUIRED. Call todo_write once per item — do NOT batch.',
      '',
    ].join('\n')

    return header + basePrompt
  }

  /**
   * Filter tools for SOP mode — all customer skills plus the internal
   * todo_write/todo_read tools (injected only in SOP execution).
   */
  filterSopTools(allTools: Tool[]): Tool[] {
    const sopNames = new Set(SOP_INTERNAL_SKILLS.map((s) => s.name))
    // create_case is not needed in SOP mode — the case already exists
    const excludedInSop = new Set(['create_case'])
    // Prepend todo tools so the LLM sees them first, then deduplicate
    const sopTools: Tool[] = SOP_INTERNAL_SKILLS.map((s) => ({
      name: s.name,
      description: s.description,
      input_schema: s.inputSchema as Tool['input_schema'],
    }))
    return [...sopTools, ...allTools.filter((t) => !sopNames.has(t.name) && !excludedInSop.has(t.name))]
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
    // SOP mode: no stage nudges — the agent drives itself via todos
    if (this.isSopMode()) {
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
   * Includes the "created → next stage" fallback when the evaluator returns no transition.
   */
  async evaluateStageTransitionAfterNoTools(
    iterationCount: number,
  ): Promise<TransitionEval> {
    // SOP mode: skip LLM stage evaluator — advance 'created' → first stage automatically,
    // then let the agent drive via todos (no further stage machine transitions).
    if (this.isSopMode()) {
      if (this._currentStage === 'created') {
        const next = this.stageExecutor.getNextStageName('created')
        if (next) {
          return {
            shouldTransition: true,
            nextStage: next,
            reason: 'SOP mode: auto-advance from created to investigation stage.',
          }
        }
      }
      return { shouldTransition: false, reason: 'SOP mode: stage progression driven by todos.' }
    }

    let transitionEval: TransitionEval
    try {
      transitionEval = await this.stageExecutor.evaluateTransition(this._currentStage, iterationCount)
    } catch (err) {
      console.error('[CaseAgentLoop] Stage evaluation failed:', err)
      transitionEval = { shouldTransition: false, reason: `evaluation error: ${err}` }
    }

    // Fallback: advance from 'created' after first assistant turn when evaluator returns nothing
    if (
      !(transitionEval.shouldTransition && transitionEval.nextStage) &&
      this._currentStage === 'created'
    ) {
      const fbNext = this.stageExecutor.getNextStageName('created')
      if (fbNext) {
        transitionEval = {
          shouldTransition: true,
          nextStage: fbNext,
          reason: 'Fallback advance from created after first assistant turn (evaluator returned no transition).',
        }
      }
    }

    return transitionEval
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
    const mem = this.services.caseMemory.getSummary()
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
    if (this.services.caseMemory.hasDispatchedSubAgentsFor(this._currentStage, agentNames)) return

    const mem = this.services.caseMemory.getSummary()
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
        this.services.caseMemory.recordSubAgentsDispatched(
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
    const policyEngine = this.services.getPolicyEngine()
    for (const name of policyEngine.getPolicyNames()) {
      const c = this.services.caseMemory.getPolicyHitCount(name)
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

    const { caseId, customerId, userId, chatId } = this.services
    const resolvedCaseType = this.caseSchema.type || 'general'
    const caseMemory = this.services.caseMemory

    let taskId: string | null = null
    const MAX_HT_RETRIES = 3

    for (let attempt = 1; attempt <= MAX_HT_RETRIES; attempt++) {
      try {
        await prisma.customer.upsert({
          where: { id: customerId },
          update: {},
          create: { id: customerId, name: customerId },
        })

        await prisma.case.upsert({
          where: { id: caseId },
          update: { status: 'waiting_human', blocker: `Waiting for ${queue}` },
          create: {
            id: caseId,
            customerId,
            userId,
            type: resolvedCaseType,
            status: 'waiting_human',
            blocker: `Waiting for ${queue}`,
            chatId: chatId ?? null,
          },
        })

        const dbFields = caseMemory.getDbFields()
        await prisma.caseMemory.upsert({
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

    // Exit: case now waiting for human
    const waitMsg =
      'A specialist from our team is now reviewing your case. You can continue to send messages here — I will relay any updates as soon as the review is complete.'
    sendEvent({ type: 'text_delta', data: waitMsg, timestamp: new Date().toISOString() })
    sendEvent({
      type: 'message_stop',
      data: { reason: 'waiting_human', stage: this._currentStage },
      timestamp: new Date().toISOString(),
    })
    await this.services.writeProfilerSnapshot()
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
      !this.services.caseMemory.getSkillsCalled().includes('create_human_task')
    ) {
      const blockedMsg =
        '[POLICY] This case type requires human review before finalizing. ' +
        'Call create_human_task to escalate to a human specialist.'
      await this.services.traceWriter.write('policy_hit', 'Finalize blocked: mandatory human review required', {})
      sendEvent({
        type: 'policy_blocked',
        data: { toolName: 'finalize_case', policyNames: ['mandatory_human_review'] },
        timestamp: new Date().toISOString(),
      })
      this.services.addMessage(this.services.makeUserMessage(blockedMsg))
      return { type: 'continue' }
    }

    const finalizedPayload = unwrapToolExecutionPayload(finalizeResult.output)
    const policyEngine = this.services.getPolicyEngine()
    const preFinalizeEval = await policyEngine.evaluate(
      'preFinalize',
      {
        skillName: 'finalize_case',
        skillOutput: finalizedPayload,
        confirmedFacts: this.services.caseMemory.getConfirmedFacts(),
        skillsCalled: this.services.caseMemory.getSkillsCalled(),
        skillResults: this.services.caseMemory.getSummary().skillResults as Record<string, unknown>,
      },
      this.buildHitCounts(),
    )

    if (preFinalizeEval.summary === 'blocked' || preFinalizeEval.summary === 'escalated') {
      for (const r of preFinalizeEval.results) {
        if (r.result !== 'pass') this.services.caseMemory.recordPolicyHit(r.policyName)
      }
      await this.services.traceWriter.write(
        'policy_hit',
        'Finalize blocked',
        preFinalizeEval as unknown as Record<string, unknown>,
      )
      sendEvent({
        type: 'error',
        data: `Finalize blocked by policy: ${preFinalizeEval.results
          .filter((r) => r.result === 'blocked')
          .map((r) => r.policyName)
          .join(', ')}`,
        timestamp: new Date().toISOString(),
      })
      if (preFinalizeEval.feedbackMessage) {
        this.services.addMessage(this.services.makeUserMessage(preFinalizeEval.feedbackMessage))
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
    await this.services.writeProfilerSnapshot()
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
    await this.services.writeProfilerSnapshot()
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
   * Updates currentStage, resets nudgeCount, reloads stage guardrails,
   * and dispatches any sub-agents configured for the new stage.
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
    this.services.caseMemory.setCaseStatus(next)
    nudgeCount.value = 0
    this.services.caseMemory.resetPolicyHits()
    this.stageExecutor.resetEvalParseFailures()

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

    const policyEngine = this.services.getPolicyEngine()
    policyEngine.clearStageGuardrails()
    const stageGuardrails = this.stageExecutor.getStageGuardrails(this._currentStage)
    if (stageGuardrails.length > 0) {
      policyEngine.loadStageGuardrails(stageGuardrails)
    }

    if (this.orchestrator?.isEnabled()) {
      const stageCfg = this.stageExecutor.getStageConfig(this._currentStage)
      if (stageCfg?.subAgents?.length) {
        try {
          const mem = this.services.caseMemory.getSummary()
          const tasks = await this.orchestrator.planInvestigation(
            this._currentStage,
            stageCfg.subAgents,
            mem as any,
            stageCfg.description || this._currentStage,
          )
          if (tasks.length > 0) {
            const results = await this.orchestrator.dispatch(tasks, sendEvent)
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
