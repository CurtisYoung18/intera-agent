// Intera Harness - Agent Loop (核心引擎)
// Based on Claude Code's query.ts + StreamingToolExecutor pattern
//
// Streaming tool execution: tools begin executing as soon as their
// input_json is complete (content_block_stop), while text/thinking
// continues streaming to the frontend. This is the key difference
// from naive "wait for full response then execute" approaches.
//
// [MOCK] In-memory state. Production path:
//   - Load persisted Case state from DB via Prisma
//   - Persist messages, traces, memory on every mutation

import Anthropic from '@anthropic-ai/sdk'
import type { Message, AssistantMessage, ToolUse, SSEEvent, CaseSchemaConfig } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { StreamingToolExecutor, unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import { CaseMemoryManager } from './memory'
import { PolicyEngine } from './policy'
import { SkillRouter } from './skills'
import { StageExecutor, type TransitionEval } from './stage-executor'
import { OrchestratorAgent } from './orchestrator'
import { TraceWriter } from './trace'
import { microCompact } from './microCompact'
import { trySessionMemoryCompact } from './sessionMemoryCompact'
import { compactConversation } from './compact'
import { Profiler } from './profiler'
import { isInvestigableCaseType } from './case-type-slugs'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'

// ---------------------------------------------------------------------------
// Content block tracking during streaming
// ---------------------------------------------------------------------------

interface StreamContentBlock {
  index: number
  type: 'text' | 'tool_use' | 'thinking'
  id: string
  name: string
  content: string
  completed: boolean
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AgentLoopDeps {
  config: AgentConfigData
  caseId: string
  customerId: string
  userId: string
  systemPrompt: string
  caseSchema?: CaseSchemaConfig | null
}

export interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'waiting_form' | 'error' | 'consultation_complete' | 'stage_continue' | 'awaiting_clarification' | 'awaiting_interaction'
  currentStage?: string
  reason?: string
  pendingSubAgents?: string[]
}

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

export class AgentLoop {
  private messages: Message[] = []
  private caseMemory: CaseMemoryManager
  private policyEngine!: PolicyEngine
  private skillRouter: SkillRouter
  private stageExecutor: StageExecutor | null = null
  private orchestrator: OrchestratorAgent | null = null
  private traceWriter: TraceWriter
  private profiler: Profiler = new Profiler()
  private iterationCount = 0
  private nudgeCount = 0
  private currentStage = 'created'
  private abortController: AbortController
  private aborted = false
  private anthropicClient: Anthropic

  constructor(private deps: AgentLoopDeps) {
    this.caseMemory = new CaseMemoryManager(deps.caseId, deps.config.memoryStrategy)
    this.skillRouter = new SkillRouter(deps.customerId)
    this.traceWriter = new TraceWriter(deps.caseId)
    this.abortController = new AbortController()
    this.anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })

    // Initialize stage executor if case schema with stage configs is available
    if (deps.caseSchema) {
      this.stageExecutor = new StageExecutor(
        deps.caseSchema,
        deps.config,
        this.caseMemory,
      )
      this.currentStage = this.stageExecutor.getCurrentStage()

      // Initialize orchestrator for sub-agent dispatch (pass skill defs for real tool execution)
      this.orchestrator = new OrchestratorAgent(deps.caseSchema, this.skillRouter.getToolDefinitions(), deps.userId)
    }
  }

  /** Create and initialize an AgentLoop — loads skills/policies from DB. */
  static async create(deps: AgentLoopDeps): Promise<AgentLoop> {
    const loop = new AgentLoop(deps)
    loop.skillRouter = await SkillRouter.create(deps.customerId)
    loop.policyEngine = await PolicyEngine.create(deps.customerId, deps.config.policyHooks)
    return loop
  }

  // -----------------------------------------------------------------------
  // Dedicated Agent Dispatch on case creation
  // -----------------------------------------------------------------------

  /** Dispatch sub-agents for the current stage (non-blocking, runs alongside ReAct loop). */
  private async startDedicatedAgents(
    sendEvent: (event: SSEEvent) => void,
  ): Promise<void> {
    if (!this.orchestrator?.isEnabled()) return

    const stageCfg = this.stageExecutor?.getStageConfig(this.currentStage)
    if (!stageCfg?.subAgents?.length) return

    const agentNames = stageCfg.subAgents.map((c) => c.name)
    if (this.caseMemory.hasDispatchedSubAgentsFor(this.currentStage, agentNames)) {
      return
    }

    const mem = this.caseMemory.getSummary()
    try {
      const tasks = await this.orchestrator.planInvestigation(
        this.currentStage,
        stageCfg.subAgents,
        mem as any,
        stageCfg.description || this.currentStage,
      )

      if (tasks.length > 0) {
        // Emit sub_agent_start for each task
        for (const task of tasks) {
          sendEvent({
            type: 'sub_agent_start',
            data: {
              agentId: task.id,
              agentName: task.agentConfig.name,
              taskDescription: task.taskPrompt.slice(0, 200),
              stage: this.currentStage,
              caseId: this.deps.caseId,
            },
            timestamp: new Date().toISOString(),
          })
        }

        // Non-blocking — results merge as they arrive, ReAct loop checks each iteration
        this.orchestrator.dispatchInBackground(tasks, sendEvent, mem as any)

        this.caseMemory.recordSubAgentsDispatched(
          this.currentStage,
          tasks.map((t) => t.agentConfig.name),
        )

        sendEvent({
          type: 'core_agent_progress',
          data: {
            stage: this.currentStage,
            iteration: 0,
            task: `Coordinating ${tasks.length} sub-agent(s) for parallel investigation`,
            pendingSubAgents: tasks.map((t) => t.agentConfig.name),
          },
          timestamp: new Date().toISOString(),
        })

        await this.traceWriter.write('loop_decision', 'Sub-agents dispatched (background)', {
          stage: this.currentStage,
          subAgents: tasks.map((t) => t.agentConfig.name),
        })
      }
    } catch (err) {
      console.error('[AgentLoop] Start-dispatch failed:', err)
    }
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  async run(
    userMessage: string,
    rawSendEvent: (event: SSEEvent) => void,
  ): Promise<LoopResult> {
    // Wrap sendEvent to catch stream-closed errors safely
    const sendEvent = (event: SSEEvent) => {
      if (this.aborted) return
      try { rawSendEvent(event) } catch { this.aborted = true; this.abortController.abort() }
    }

    // 1. Record user message
    this.profiler.startTurn()
    const userMsg = this.makeUserMessage(userMessage)
    this.messages.push(userMsg)
    await this.traceWriter.write('user_message', 'User sent message', userMessage)

    // 2. Ingest facts into Case Memory (LLM-based extraction)
    const requiredFacts = this.deps.caseSchema?.requiredFacts
    await this.caseMemory.ingestUserMessageFacts(userMessage, requiredFacts)
    sendEvent({
      type: 'memory_update',
      data: this.caseMemory.getSummary(),
      timestamp: new Date().toISOString(),
    })

    // 2.5 Dispatch dedicated agents on case creation (first stage)
    await this.startDedicatedAgents(sendEvent)

    // 3. ReAct loop
    let stopReason: string | null = null
    let usage: Record<string, unknown> | null = null

    while (this.iterationCount < this.deps.config.maxIterations) {
      this.iterationCount++
      this.profiler.incrementIteration()

      // Emit core agent progress — only when a Case is active. Keep label short for UI.
      if (this.stageExecutor) {
        const stageCfg = this.stageExecutor.getStageConfig(this.currentStage)
        const stageLabel = stageCfg?.name || this.currentStage
        const taskDesc = `${stageLabel} · iter ${this.iterationCount}`
        sendEvent({
          type: 'core_agent_progress',
          data: {
            stage: this.currentStage,
            iteration: this.iterationCount,
            task: taskDesc,
            pendingSubAgents: this.orchestrator?.getPendingAgentNames() ?? [],
          },
          timestamp: new Date().toISOString(),
        })
      }

      // Check for new sub-agent results (from background dispatch)
      if (this.orchestrator?.hasNewResults()) {
        const newResults = this.orchestrator.drainNewResults()
        const mem = this.caseMemory.getSummary()
        this.orchestrator.mergeResults(
          newResults,
          mem.confirmedFacts as Record<string, unknown>,
          mem.skillResults as Record<string, unknown>,
          mem.keyEvents as Array<{ at: string; text: string; source: string }>,
        )
        // Inject sub-agent output as user-visible context for the main agent
        for (const r of newResults) {
          this.messages.push(this.makeUserMessage(
            OrchestratorAgent.toContextMessage(r),
          ))
        }
        sendEvent({
          type: 'memory_update',
          data: this.caseMemory.getSummary(),
          timestamp: new Date().toISOString(),
        })
      }

      // Context compaction (simplified)
      const compactResult = await this.checkAndCompact()
      if (compactResult.shouldCompact) {
        sendEvent({
          type: 'withheld',
          data: 'Compacting context...',
          timestamp: new Date().toISOString(),
        })
      }

      sendEvent({
        type: 'stream_request_start',
        data: null,
        timestamp: new Date().toISOString(),
      })

      // ── StreamingToolExecutor is created BEFORE the stream so tools
      //    can be enqueued incrementally as each tool_use block completes.
      const toolExecutor = new StreamingToolExecutor(
        this.skillRouter.getToolDefinitions(),
        (toolUse, status) => {
          sendEvent({
            type: status === 'executing' ? 'tool_executing' : 'skill_result',
            data: { name: toolUse.name, status },
            timestamp: new Date().toISOString(),
          })
        },
      )

      // ── Stream API call ──────────────────────────────────────────
      const stagePrompt = this.stageExecutor
        ? this.stageExecutor.buildStagePrompt(this.currentStage, this.deps.systemPrompt)
        : this.deps.systemPrompt
      const allTools = this.skillRouter.getTools()
      const stageTools = this.stageExecutor
        ? this.stageExecutor.filterTools(this.currentStage, allTools)
        : allTools

      const blocks = new Map<number, StreamContentBlock>()
      let assistantMessage: AssistantMessage | null = null
      let fullText = ''
      // Reset per-iteration
      stopReason = null
      usage = null

      const iterationStartTime = Date.now()
      let streamEndedAt = iterationStartTime

      if (this.abortController.signal.aborted) break

      const stream = this.anthropicClient.messages.stream({
        model: this.deps.config.model,
        max_tokens: this.deps.config.maxOutputTokens ?? 4096,
        system: stagePrompt,
        messages: this.buildApiMessages(),
        tools: stageTools,
        ...(this.deps.config.showThinking ? {
          thinking: { type: 'enabled' as const, budget_tokens: this.deps.config.thinkingBudget || 4096 },
        } : {}),
      }, { signal: this.abortController.signal })

      await this.traceWriter.writeLlmRequestStart(
        this.deps.config.model,
        this.messages.length,
        stagePrompt,
        this.buildApiMessages(),
      )

      try {
      for await (const event of stream) {
        switch (event.type) {
          // ── message start ──────────────────────────────────────
          case 'message_start':
            assistantMessage = {
              id: event.message.id,
              role: 'assistant',
              content: '',
              createdAt: new Date(),
              isStreaming: true,
            }
            break

          // ── content block start ────────────────────────────────
          case 'content_block_start': {
            const b = event.content_block
            if (b.type === 'tool_use') {
              blocks.set(event.index, {
                index: event.index,
                type: 'tool_use',
                id: b.id,
                name: b.name,
                content: '',
                completed: false,
              })
            } else if (b.type === 'text') {
              blocks.set(event.index, {
                index: event.index,
                type: 'text',
                id: '',
                name: '',
                content: '',
                completed: false,
              })
            } else if (b.type === 'thinking') {
              blocks.set(event.index, {
                index: event.index,
                type: 'thinking',
                id: '',
                name: '',
                content: '',
                completed: false,
              })
            }
            break
          }

          // ── content block delta ────────────────────────────────
          case 'content_block_delta': {
            const d = event.delta
            const cb = blocks.get(event.index)
            if (!cb) break

            if (d.type === 'text_delta') {
              if (!fullText) this.profiler.recordFirstToken()
              cb.content += d.text
              fullText += d.text
              sendEvent({
                type: 'text_delta',
                data: d.text,
                timestamp: new Date().toISOString(),
              })
            } else if (d.type === 'input_json_delta') {
              cb.content += d.partial_json
            } else if (d.type === 'thinking_delta') {
              cb.content += d.thinking
              if (this.deps.config.showThinking) {
                sendEvent({
                  type: 'thinking_delta',
                  data: d.thinking,
                  timestamp: new Date().toISOString(),
                })
              }
            }
            break
          }

          // ── content block stop ─────────────────────────────
          // This is the critical moment: a tool_use block just
          // finished streaming its input JSON. Parse it and
          // enqueue for immediate execution.
          case 'content_block_stop': {
            const stoppedBlock = blocks.get(event.index)
            if (!stoppedBlock) break
            stoppedBlock.completed = true

            if (stoppedBlock.type === 'tool_use') {
              let input: Record<string, unknown> = {}
              try {
                input = JSON.parse(stoppedBlock.content || '{}')
              } catch {
                // Malformed JSON — tool will run with empty input
              }

              const toolUse: ToolUse = {
                id: stoppedBlock.id,
                name: stoppedBlock.name,
                input,
              }

              // PreTool policy check
              const policyResult = await this.policyEngine.check('preTool', {
                skillName: toolUse.name,
                skillInput: toolUse.input,
                confirmedFacts: this.caseMemory.getConfirmedFacts(),
                skillsCalled: this.caseMemory.getSkillsCalled(),
              })

              if (policyResult.result === 'blocked') {
                await this.traceWriter.write(
                  'policy_hit',
                  `Blocked: ${toolUse.name}`,
                  policyResult as unknown as Record<string, unknown>,
                )
                sendEvent({
                  type: 'error',
                  data: `Tool blocked by policy: ${toolUse.name}`,
                  timestamp: new Date().toISOString(),
                })
                continue
              }

              // ★ Enqueue — starts executing immediately.
              // text/thinking blocks that follow will stream to the
              // frontend concurrently while this tool runs.
              toolExecutor.enqueue(toolUse)
            }
            break
          }

          // ── message delta (usage + stop_reason) ──────────────
          case 'message_delta': {
            const msgDelta = event as unknown as {
              type: 'message_delta'
              delta: { stop_reason?: string | null; usage?: Record<string, unknown> }
              usage?: Record<string, unknown>
            }
            const delta = msgDelta.delta
            if (delta?.stop_reason != null) {
              stopReason = delta.stop_reason
              await this.traceWriter.write(
                'stream_event',
                `stop_reason: ${stopReason}`,
                { stopReason, iteration: this.iterationCount },
              )
            }
            const mergedUsage = msgDelta.usage ?? delta?.usage
            if (mergedUsage) {
              usage = mergedUsage
            }
            break
          }

          // ── message stop ──────────────────────────────────────
          case 'message_stop':
            break
        }
      }
      } catch (streamErr) {
        console.error('[AgentLoop] Stream error:', streamErr)
        if (this.abortController.signal.aborted) {
          // Graceful abort — drain pending tools and exit iteration
        }
      }

      streamEndedAt = Date.now()

      // Final usage per assistant completion (streaming APIs may emit usage on multiple deltas).
      if (
        usage &&
        ((usage.input_tokens as number | undefined) != null ||
          (usage.output_tokens as number | undefined) != null ||
          (usage.inputTokens as number | undefined) != null ||
          (usage.outputTokens as number | undefined) != null)
      ) {
        const calledToolNames = [...blocks.values()].filter(b => b.type === 'tool_use').map(b => b.name)
        await this.traceWriter.writeLlmResponse(stopReason, usage, this.iterationCount, fullText, calledToolNames)
        this.profiler.addTokens(
          Number((usage.input_tokens as number | undefined) ?? (usage.inputTokens as number | undefined) ?? 0),
          Number((usage.output_tokens as number | undefined) ?? (usage.outputTokens as number | undefined) ?? 0),
        )
      }

      // Stream complete — finalize the assistant message
      if (!assistantMessage) {
        throw new Error('No assistant message received')
      }
      assistantMessage.content = fullText
      assistantMessage.isStreaming = false

      // ── Wait for all tools to finish ─────────────────────────
      const toolResults = await toolExecutor.waitForAll()
      for (const tr of toolResults) {
        this.profiler.addToolExecution(tr.latencyMs || 0)
      }

      if (
        usage &&
        ((usage.input_tokens as number | undefined) != null ||
          (usage.output_tokens as number | undefined) != null ||
          (usage.inputTokens as number | undefined) != null ||
          (usage.outputTokens as number | undefined) != null)
      ) {
        const iterationEndedAt = Date.now()
        const llmWallMs = Math.max(0, streamEndedAt - iterationStartTime)
        const toolsWallMs = Math.max(0, iterationEndedAt - streamEndedAt)
        await this.traceWriter.write('loop_decision', 'Iteration Snapshot', {
          iteration: this.iterationCount,
          llmWallMs,
          toolsWallMs,
          iterationWallMs: iterationEndedAt - iterationStartTime,
          wallMs: iterationEndedAt - iterationStartTime,
          inputTokens: Number(
            (usage.input_tokens as number | undefined) ?? (usage.inputTokens as number | undefined) ?? 0,
          ),
          outputTokens: Number(
            (usage.output_tokens as number | undefined) ?? (usage.outputTokens as number | undefined) ?? 0,
          ),
        })
      }

      if (toolResults.length === 0) {
        // No tools called — stage evaluator may still advance (e.g. created → collecting)
        if (this.stageExecutor && this.stageExecutor.hasStageConfigs()) {
          let transitionEval: TransitionEval
          try {
            transitionEval = await this.stageExecutor.evaluateTransition(
              this.currentStage,
              this.iterationCount,
            )
          } catch (err) {
            console.error('[AgentLoop] Stage evaluation failed:', err)
            transitionEval = { shouldTransition: false, reason: `evaluation error: ${err}` }
          }
          if (transitionEval.modelUsed) {
            await this.traceWriter.write('stage_eval', `Stage eval: ${this.currentStage} → ${transitionEval.nextStage || 'stay'}`, { model: transitionEval.modelUsed, stage: this.currentStage, shouldTransition: transitionEval.shouldTransition, reason: transitionEval.reason })
          }

          if (
            !(transitionEval.shouldTransition && transitionEval.nextStage) &&
            this.currentStage === 'created'
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

          const advanced = await this.applyStageTransitionFromEval(transitionEval, sendEvent)
          if (advanced) {
            this.messages.push(assistantMessage)
            sendEvent({
              type: 'message_stop',
              data: { reason: 'stage_transition', stage: this.currentStage },
              timestamp: new Date().toISOString(),
            })
            continue
          }

          const skillCheck = this.stageExecutor.checkRequiredSkills(this.currentStage)
          const evidenceCheck = this.stageExecutor.checkEvidenceRequirements(this.currentStage)

          if (!skillCheck.met || !evidenceCheck.met) {
            // Stage incomplete — inject nudge and continue loop
            this.nudgeCount++
            const nudgeMsg = this.stageExecutor.buildNudge(this.currentStage, this.nudgeCount)
            this.messages.push(assistantMessage)
            this.messages.push(this.makeUserMessage(nudgeMsg))

            await this.traceWriter.write('loop_decision', 'Nudge: stage incomplete', {
              stage: this.currentStage,
              nudgeCount: this.nudgeCount,
              missingSkills: skillCheck.missing,
              missingEvidence: evidenceCheck.missing,
              iteration: this.iterationCount,
            })

            // After 3 consecutive nudges, escalate to human
            if (this.nudgeCount >= 3) {
              await this.traceWriter.write('loop_decision', 'Exit: max nudges', {
                stage: this.currentStage, nudgeCount: this.nudgeCount,
              })
              sendEvent({
                type: 'error',
                data: `Agent stuck in stage "${this.currentStage}" — needs human intervention`,
                timestamp: new Date().toISOString(),
              })
              await this.writeProfilerSnapshot()
              return {
                messages: this.messages,
                caseStatus: 'escalated',
                transition: 'error',
                currentStage: this.currentStage,
                reason: 'max_nudges',
              }
            }

            sendEvent({
              type: 'message_stop',
              data: { reason: 'nudge', stage: this.currentStage },
              timestamp: new Date().toISOString(),
            })
            continue
          }
        }

        // Stage goals met (or no stage config) — legitimate exit, model wants user input
        await this.traceWriter.write('loop_decision', 'Exit: no tools called', {
          stopReason, iteration: this.iterationCount, textLength: fullText.length,
          stage: this.currentStage,
        })
        this.messages.push(assistantMessage)
        sendEvent({
          type: 'message_stop',
          data: { reason: 'no_tools', stopReason, usage } as any,
          timestamp: new Date().toISOString(),
        })
        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          // Persist actual workflow stage — never hard-code investigating or the next HTTP turn
          // mis-reads StageExecutor.getCurrentStage() and skips collecting / request_user_input.
          caseStatus: this.currentStage as CaseStatus,
          transition: 'next_turn',
          currentStage: this.currentStage,
        }
      }

      // ── Apply tool results to Case Memory ────────────────────
      for (const result of toolResults) {
        const payload = unwrapToolExecutionPayload(result.output)
        await this.caseMemory.applySkillResult(result.name, payload)
        await this.traceWriter.write(
          'skill_result',
          `Skill: ${result.name}`,
          { output: payload, latencyMs: result.latencyMs, iteration: this.iterationCount, skillName: result.name },
        )
      }

      // ── Batch postTool policy evaluation (LLM-based, single call) ──
      if (toolResults.length > 0) {
        try {
        const postToolInputs = toolResults.map((r) => ({
          name: r.name,
          output: unwrapToolExecutionPayload(r.output),
        }))
        const batchResults = await this.policyEngine.evaluatePostToolBatch(
          postToolInputs,
          this.caseMemory.getConfirmedFacts(),
        )
        for (const pr of batchResults) {
          if (pr.result === 'escalated') {
            await this.traceWriter.write('policy_hit', `Escalated: ${pr.policyName}`, { result: pr.result, reason: pr.reason, model: pr.modelUsed })
          }
          if (pr.result === 'blocked') {
            await this.traceWriter.write('policy_hit', `Blocked: ${pr.policyName}`, { result: pr.result, reason: pr.reason, model: pr.modelUsed })
          }
        }
        } catch (policyErr) {
          console.error('[AgentLoop] PostTool batch evaluation failed:', policyErr)
        }
      }

      // ── Add to message history ───────────────────────────────
      this.messages.push(assistantMessage)
      this.addToolResultMessages(toolResults)

      // ── Terminal tool: propose_cases (multi-intent clarification) ──
      const proposeResult = toolResults.find(
        (r) => r.name === 'propose_cases',
      )
      if (proposeResult && !this.stageExecutor) {
        const toolInput = proposeResult.toolUse?.input || {}
        const proposedCases = (toolInput.cases as Array<{ caseType: string; summary: string }>) || []

        if (proposedCases.length > 0) {
          sendEvent({
            type: 'clarification',
            data: {
              cases: proposedCases.map((c) => ({
                caseType: c.caseType,
                summary: c.summary,
              })),
            },
            timestamp: new Date().toISOString(),
          })

          await this.traceWriter.write('loop_decision', 'Clarification: multiple intents proposed', {
            proposedCases: proposedCases.map((c) => c.caseType),
          })

          // Replace mock result with meaningful feedback for the model
          for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i]
            if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool propose_cases result:')) {
              m.content = `Tool propose_cases result: ${JSON.stringify({ status: 'presented', message: 'The customer will select which cases to open. Wait for their selection before proceeding.' })}`
              break
            }
          }

          await this.writeProfilerSnapshot()
          return {
            messages: this.messages,
            caseStatus: 'created',
            transition: 'awaiting_clarification',
            currentStage: this.currentStage,
            reason: 'multi_intent_clarification',
          }
        }
      }

      // ── Terminal tool: create_case ─────────────────────────
      const createCaseResult = toolResults.find(
        (r) => r.name === 'create_case',
      )
      if (createCaseResult && !this.stageExecutor) {
        const toolInput = createCaseResult.toolUse?.input || {}
        const caseType = String(toolInput.caseType || '')
        if (caseType && isInvestigableCaseType(caseType)) {
          try {
            // Load case type from DB to build schema
            const ctRow = await prisma.caseType.findUnique({
              where: { customerId_type: { customerId: this.deps.customerId, type: caseType } },
            })
            if (ctRow) {
              const stages = (() => { try { return JSON.parse(ctRow.stages) } catch { return [] } })() as string[]
              const requiredFacts = (() => { try { return JSON.parse(ctRow.requiredFacts) } catch { return [] } })() as string[]
              const stageConfigs = (() => { try { return JSON.parse(ctRow.stageConfigs || '{}') } catch { return {} } })() as Record<string, unknown>
              const schema: CaseSchemaConfig = {
                type: ctRow.type, displayName: ctRow.displayName, icon: ctRow.icon,
                description: ctRow.description || undefined,
                requiredFacts: Array.isArray(requiredFacts) ? requiredFacts : [],
                stages: Array.isArray(stages) ? stages : [],
                stageConfigs: stageConfigs as any,
                defaultGoal: ctRow.defaultGoal,
                escalateOn: (() => { try { return JSON.parse(ctRow.escalateOn) } catch { return [] } })() as string[] || [],
              }
              this.deps.caseSchema = schema
              this.stageExecutor = new StageExecutor(schema, this.deps.config, this.caseMemory)
              this.currentStage = this.stageExecutor.getCurrentStage()
              this.orchestrator = new OrchestratorAgent(schema, this.skillRouter.getToolDefinitions(), this.deps.userId)

              // Persist case in DB
              await prisma.case.upsert({
                where: { id: this.deps.caseId },
                update: { type: caseType, status: 'created' },
                create: {
                  id: this.deps.caseId,
                  customerId: this.deps.customerId,
                  userId: this.deps.userId,
                  type: caseType,
                  status: 'created',
                },
              })

              sendEvent({
                type: 'case_created',
                data: {
                  caseId: this.deps.caseId,
                  caseType: caseType,
                  displayName: ctRow.displayName,
                  icon: ctRow.icon,
                },
                timestamp: new Date().toISOString(),
              })

              await this.traceWriter.write('loop_decision', `Case created: ${caseType}`, { caseType, caseId: this.deps.caseId })

              // Replace mock create_case result with real case ID so the LLM
              // doesn't repeat the fake mock ID to the customer.
              for (let i = this.messages.length - 1; i >= 0; i--) {
                const m = this.messages[i]
                if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool create_case result:')) {
                  m.content = `Tool create_case result: ${JSON.stringify({ caseId: this.deps.caseId, status: 'created' })}`
                  break
                }
              }

              // Continue loop — next iteration has stage executor
              continue
            }
          } catch (err) {
            console.error('[AgentLoop] Failed to create case from create_case tool:', err)
          }
        } else if (createCaseResult && this.stageExecutor) {
          // create_case called but a case is already active — replace mock
          // result so the LLM doesn't see a fake case_mock_001 ID.
          for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i]
            if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool create_case result:')) {
              m.content = `Tool create_case result: ${JSON.stringify({ caseId: this.deps.caseId, status: 'already_active', note: 'Case already exists — continue with the active case' })}`
              break
            }
          }
        }
      }

      // ── Terminal tool: request_user_input (form) ─────────
      const formResult = toolResults.find(
        (r) => r.name === 'request_user_input',
      )
      if (formResult) {
        await this.traceWriter.write('loop_decision', 'Exit: form requested', {
          stopReason, toolCount: toolResults.length, iteration: this.iterationCount,
        })
        const toolInput = formResult.toolUse?.input || {}
        const title = String(toolInput.title || 'Information Needed')
        const description = String(toolInput.description || '')
        const fields = (toolInput.fields as Array<Record<string, unknown>>) || []

        sendEvent({
          type: 'form_request',
          data: {
            caseId: this.deps.caseId,
            skillCallId: formResult.toolUse?.id || crypto.randomUUID(),
            title,
            description,
            fields,
          },
          timestamp: new Date().toISOString(),
        })

        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          caseStatus: 'collecting',
          transition: 'waiting_form',
          currentStage: this.currentStage,
        }
      }

      // ── Terminal tool: propose_interaction ──────────────────
      const interactionResult = toolResults.find(
        (r) => r.name === 'propose_interaction',
      )
      if (interactionResult) {
        const toolInput = interactionResult.toolUse?.input || {}
        const opts = (toolInput.options as Array<Record<string, unknown>>) || []
        if (opts.length > 0) {
          await this.traceWriter.write('loop_decision', 'Exit: interaction proposed', {
            iteration: this.iterationCount, optionCount: opts.length,
          })

          sendEvent({
            type: 'interaction_proposed',
            data: {
              caseId: this.deps.caseId,
              skillCallId: interactionResult.toolUse?.id || crypto.randomUUID(),
              title: String(toolInput.title || ''),
              description: String(toolInput.description || ''),
              options: opts,
              multiSelect: !!toolInput.multiSelect,
            },
            timestamp: new Date().toISOString(),
          })

          // Replace mock result so the model sees the interaction is pending
          for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i]
            if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool propose_interaction result:')) {
              m.content = `Tool propose_interaction result: ${JSON.stringify({ status: 'presented', message: 'The customer will respond. Wait for their selection before proceeding.' })}`
              break
            }
          }

          await this.writeProfilerSnapshot()
          return {
            messages: this.messages,
            caseStatus: this.currentStage as CaseStatus,
            transition: 'awaiting_interaction',
            currentStage: this.currentStage,
            reason: 'interaction_proposed',
          }
        }
      }

      // ── Terminal tool: create_human_task ─────────────────────
      // Pre-escalation guard is enforced via PolicyEngine preTool hook
      // (policy: investigate_before_escalation) — see policy.ts.
      const humanTaskResult = toolResults.find(
        (r) => r.name === 'create_human_task',
      )
      if (humanTaskResult) {
        const toolInput = humanTaskResult.toolUse?.input || {}
        const queue = String(toolInput.queue || 'general')
        const question = String(toolInput.question || 'Human task requested')

        try {
          // Ensure customer exists
          await prisma.customer.upsert({
            where: { id: this.deps.customerId },
            update: {},
            create: { id: this.deps.customerId, name: this.deps.customerId },
          })

          // Ensure case exists
          const resolvedCaseType = this.deps.caseSchema?.type || 'general'
          await prisma.case.upsert({
            where: { id: this.deps.caseId },
            update: { status: 'waiting_human', blocker: `Waiting for ${queue}` },
            create: {
              id: this.deps.caseId,
              customerId: this.deps.customerId,
              userId: this.deps.userId,
              type: resolvedCaseType,
              status: 'waiting_human',
              blocker: `Waiting for ${queue}`,
            },
          })

          // Persist case memory
          const mem = this.caseMemory.getSummary()
          await prisma.caseMemory.upsert({
            where: { caseId: this.deps.caseId },
            update: {
              confirmedFacts: JSON.stringify(mem.confirmedFacts),
              missingFacts: JSON.stringify(mem.missingFacts),
              skillsCalled: JSON.stringify(mem.skillsCalled),
              skillResults: JSON.stringify(mem.skillResults),
              keyEvents: JSON.stringify(mem.keyEvents),
              humanTaskStatus: 'pending',
            },
            create: {
              caseId: this.deps.caseId,
              confirmedFacts: JSON.stringify(mem.confirmedFacts),
              missingFacts: JSON.stringify(mem.missingFacts),
              skillsCalled: JSON.stringify(mem.skillsCalled),
              skillResults: JSON.stringify(mem.skillResults),
              keyEvents: JSON.stringify(mem.keyEvents),
              humanTaskStatus: 'pending',
            },
          })

          // Create human task
          const task = await prisma.humanTask.create({
            data: {
              caseId: this.deps.caseId,
              queue,
              question,
              status: 'pending',
            },
          })

          // Write trace via TraceWriter (DB persistence handled internally)
          await this.traceWriter.writeHumanTaskCreated(task.id, queue)

          // Replace mock create_human_task result with real task ID
          for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i]
            if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool create_human_task result:')) {
              m.content = `Tool create_human_task result: ${JSON.stringify({ taskId: task.id, queue, status: 'pending' })}`
              break
            }
          }

          sendEvent({
            type: 'human_task_created',
            data: { taskId: task.id, queue, status: 'pending' },
            timestamp: new Date().toISOString(),
          })
        } catch (err) {
          console.error('[AgentLoop] Failed to persist human task:', err)
        }

        // Exit immediately — case is now waiting for human. Send a clear
        // customer-facing message so they know a specialist is reviewing.
        const waitMsg = 'A specialist from our team is now reviewing your case. You can continue to send messages here — I will relay any updates as soon as the review is complete.'
        sendEvent({
          type: 'text_delta',
          data: waitMsg,
          timestamp: new Date().toISOString(),
        })
        sendEvent({
          type: 'message_stop',
          data: { reason: 'waiting_human', stage: this.currentStage },
          timestamp: new Date().toISOString(),
        })
        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          caseStatus: 'waiting_human',
          transition: 'waiting_human',
          currentStage: this.currentStage,
          reason: 'human_task_created',
        }
      }

      // ── Terminal tool: finalize_case ─────────────────────────
      // Guard: if a human task was just created, don't finalize in the same turn.
      const humanTaskCreatedThisTurn = toolResults.some(
        (r) => r.name === 'create_human_task',
      )
      if (humanTaskCreatedThisTurn) {
        continue
      }

      const finalizeResult = toolResults.find(
        (r) => r.name === 'finalize_case',
      )
      if (finalizeResult) {
        const finalizedPayload = unwrapToolExecutionPayload(finalizeResult.output)
        const policyResult = await this.policyEngine.check('preFinalize', {
          skillName: 'finalize_case',
          skillOutput: finalizedPayload,
          confirmedFacts: this.caseMemory.getConfirmedFacts(),
          skillsCalled: this.caseMemory.getSkillsCalled(),
        })

        if (policyResult.result === 'blocked') {
          await this.traceWriter.write(
            'policy_hit',
            'Finalize blocked',
            policyResult as unknown as Record<string, unknown>,
          )
          sendEvent({
            type: 'error',
            data: 'Finalize blocked by policy',
            timestamp: new Date().toISOString(),
          })
          continue // Keep looping
        }

        // Trace already written via traceWriter.write above (DB persistence handled internally)
        await this.traceWriter.writeFinalResolution('resolved', JSON.stringify(finalizedPayload))

        // Persist case status to DB
        try {
          await prisma.case.update({
            where: { id: this.deps.caseId },
            data: { status: 'resolved', resolvedAt: new Date(), blocker: null },
          })
        } catch (err) {
          console.error('[AgentLoop] Failed to persist case resolution:', err)
        }

        sendEvent({
          type: 'finalized',
          data: finalizedPayload,
          timestamp: new Date().toISOString(),
        })
        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          caseStatus: 'resolved',
          transition: 'resolved',
          currentStage: this.currentStage,
        }
      }

      // ── Terminal tool: finalize_consultation (human chat) ────
      const consultResult = toolResults.find(
        (r) => r.name === 'finalize_consultation',
      )
      if (consultResult) {
        const output = unwrapToolExecutionPayload(consultResult.output) as Record<string, unknown> | undefined
        const summary = String(output?.summary || 'Your case has been reviewed by our specialist.')
        const resolution = String(output?.resolution || 'resolved')

        await this.traceWriter.write('final_resolution', `Consultation complete: ${resolution}`, output ?? {})

        try {
          await prisma.case.update({
            where: { id: this.deps.caseId },
            data: { status: 'investigating', blocker: null },
          })
          await prisma.humanTask.updateMany({
            where: { caseId: this.deps.caseId, status: 'in_progress' },
            data: { status: 'resolved', verdict: resolution, notes: summary },
          })
        } catch (err) {
          console.error('[AgentLoop] Failed to finalize consultation:', err)
        }

        sendEvent({
          type: 'consultation_complete',
          data: { summary, resolution },
          timestamp: new Date().toISOString(),
        })
        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          caseStatus: 'investigating',
          transition: 'consultation_complete',
          currentStage: this.currentStage,
        }
      }

      // ── Tools executed, no terminal action — evaluate stage transition ──
      if (this.stageExecutor && this.stageExecutor.hasStageConfigs()) {
        let transitionEval: TransitionEval
        try {
          transitionEval = await this.stageExecutor.evaluateTransition(
            this.currentStage,
            this.iterationCount,
          )
        } catch (err) {
          console.error('[AgentLoop] Stage evaluation (post-tools) failed:', err)
          transitionEval = { shouldTransition: false, reason: `evaluation error: ${err}` }
        }
        if (transitionEval.modelUsed) {
          await this.traceWriter.write('stage_eval', `Stage eval (post-tools): ${this.currentStage} → ${transitionEval.nextStage || 'stay'}`, { model: transitionEval.modelUsed, stage: this.currentStage, shouldTransition: transitionEval.shouldTransition, reason: transitionEval.reason })
        }
        await this.applyStageTransitionFromEval(transitionEval, sendEvent)
      }

      sendEvent({
        type: 'message_stop',
        data: { reason: 'next_turn', stage: this.currentStage },
        timestamp: new Date().toISOString(),
      })
    }

    // Max iterations reached
    await this.traceWriter.write('loop_decision', 'Exit: max iterations', {
      stopReason, iteration: this.iterationCount, messageCount: this.messages.length,
    })
    sendEvent({
      type: 'error',
      data: 'Max iterations reached',
      timestamp: new Date().toISOString(),
    })
    await this.writeProfilerSnapshot()
    return {
      messages: this.messages,
      caseStatus: 'escalated',
      transition: 'error',
      currentStage: this.currentStage,
      reason: 'max_iterations',
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Apply evaluator-approved stage transition; returns true if stage changed. */
  private async applyStageTransitionFromEval(
    transitionEval: TransitionEval,
    sendEvent: (event: SSEEvent) => void,
  ): Promise<boolean> {
    if (
      !this.stageExecutor ||
      !this.deps.caseSchema ||
      !transitionEval.shouldTransition ||
      !transitionEval.nextStage
    ) {
      return false
    }

    const next = transitionEval.nextStage
    if (!this.deps.caseSchema.stages.includes(next)) {
      console.warn('[AgentLoop] Ignoring evaluator nextStage not in schema:', next)
      return false
    }

    const prevStage = this.currentStage
    if (next === prevStage) return false

    this.currentStage = next
    this.caseMemory.setCaseStatus(next)
    this.nudgeCount = 0
    this.stageExecutor.resetEvalParseFailures()

    await this.traceWriter.write('loop_decision', 'Stage transition', {
      from: prevStage,
      to: this.currentStage,
      reason: transitionEval.reason,
    })

    sendEvent({
      type: 'case_status',
      data: {
        stage: this.currentStage,
        previousStage: prevStage,
        reason: transitionEval.reason,
      },
      timestamp: new Date().toISOString(),
    })

    this.policyEngine.clearStageGuardrails()
    const stageGuardrails = this.stageExecutor.getStageGuardrails(this.currentStage)
    if (stageGuardrails.length > 0) {
      this.policyEngine.loadStageGuardrails(stageGuardrails)
    }

    if (this.orchestrator?.isEnabled()) {
      const stageCfg = this.stageExecutor.getStageConfig(this.currentStage)
      if (stageCfg?.subAgents?.length) {
        try {
          const mem = this.caseMemory.getSummary()
          const tasks = await this.orchestrator.planInvestigation(
            this.currentStage,
            stageCfg.subAgents,
            mem as any,
            stageCfg.description || this.currentStage,
          )
          if (tasks.length > 0) {
            const results = await this.orchestrator.dispatch(tasks, sendEvent)
            this.orchestrator.mergeResults(
              results,
              mem.confirmedFacts as Record<string, unknown>,
              mem.skillResults as Record<string, unknown>,
              mem.keyEvents as Array<{ at: string; text: string; source: string }>,
            )
            // Inject sub-agent output as user-visible context for the main agent
            for (const r of results) {
              this.messages.push(this.makeUserMessage(
                OrchestratorAgent.toContextMessage(r),
              ))
            }
            await this.traceWriter.write('loop_decision', 'Sub-agents dispatched', {
              stage: this.currentStage,
              subAgents: results.map((r) => r.agentName),
            })
          }
        } catch (err) {
          console.error('[AgentLoop] Sub-agent dispatch failed:', err)
        }
      }
    }

    return true
  }


  private buildApiMessages() {
    const limit = this.deps.config.memoryStrategy.l1MaxMessages * 2
    const recentMessages = this.messages.slice(-limit)

    if (this.caseMemory.hasSummary()) {
      const maxSummaryChars = this.deps.config.memoryStrategy.l2SummaryMaxTokens * 3
      let summaryText = this.caseMemory.getSummary().summary || ''
      if (summaryText.length > maxSummaryChars) {
        summaryText = summaryText.slice(0, maxSummaryChars) + '...'
      }
      const summaryMsg = this.makeUserMessage(
        `[Case context from previous turns — use this to stay oriented]\n${summaryText}`
      )
      return [summaryMsg, ...recentMessages] as any
    }

    return recentMessages as any
  }

  private makeUserMessage(content: string): Message {
    return {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date(),
    }
  }

  private addToolResultMessages(results: ToolExecutionResult[]) {
    for (const result of results) {
      const payload = unwrapToolExecutionPayload(result.output)
      this.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: `Tool ${result.name} result: ${JSON.stringify(payload)}`,
        createdAt: new Date(),
      })
    }
  }

  private async checkAndCompact(): Promise<{
    shouldCompact: boolean
    reason?: string
  }> {
    // Master switch — admin can disable all auto-compaction
    if (!this.deps.config.memoryStrategy.enableAutocompact) {
      return { shouldCompact: false }
    }

    // MicroCompact: clear old tool results before assessment (free, local)
    if (this.deps.config.memoryStrategy.enableMicrocompact !== false) {
      const ms = this.deps.config.memoryStrategy
      const minAge = ms.microcompactMinAgeMs ?? 60000
      const mcResult = microCompact(this.messages, ms.compactableTools, ms.toolResultTokenRatio, minAge)
      if (mcResult.clearedCount > 0) {
        this.messages = mcResult.messages
        await this.traceWriter.write('microcompact', 'Cleared tool results', {
          clearedCount: mcResult.clearedCount,
          tokensSaved: mcResult.tokensSaved,
        })
      }
    }

    // Session Memory Compact: reuse existing persisted summary if recent enough
    if (this.caseMemory.hasSummary()) {
      const smResult = trySessionMemoryCompact(
        this.caseMemory.getSummary().summary,
        this.caseMemory.getLastCompactedAt(),
        this.deps.config.memoryStrategy.sessionMemoryMaxAgeMs ?? 1800000,
      )
      if (smResult.used) {
        return { shouldCompact: false, reason: 'session_memory_still_fresh' }
      }
    }

    const messageContents = this.messages.map((m) => typeof m.content === 'string' ? m.content : '')
    const estimatedTokens = this.caseMemory.estimateTokens(messageContents)

    const assessment = this.caseMemory.assessCompaction(estimatedTokens, this.messages.length)

    if (assessment.isBlocking) {
      if (this.caseMemory.isCompactCircuitBroken()) {
        return { shouldCompact: false, reason: 'circuit_breaker' }
      }
      try {
        await this.performCompaction()
        const keepCount = this.caseMemory.compactionKeepCount(this.messages.length)
        if (this.deps.config.memoryStrategy.enableSnip !== false) {
          this.messages = this.messages.slice(-keepCount)
        }
        await this.traceWriter.write('loop_decision', 'Compacted', {
          reason: 'blocking', kept: keepCount, percentLeft: assessment.percentLeft,
        })
        return { shouldCompact: true, reason: 'blocking' }
      } catch {
        this.caseMemory.recordCompactionFailure()
        return { shouldCompact: false, reason: 'failed' }
      }
    }

    if (assessment.shouldCompact) {
      if (this.caseMemory.isCompactCircuitBroken()) {
        return { shouldCompact: false, reason: 'circuit_breaker' }
      }
      try {
        await this.performCompaction()
        const keepCount = this.caseMemory.compactionKeepCount(this.messages.length)
        if (this.deps.config.memoryStrategy.enableSnip !== false) {
          this.messages = this.messages.slice(-keepCount)
        }
        await this.traceWriter.write('loop_decision', 'Compacted', {
          reason: 'auto', kept: keepCount, percentLeft: assessment.percentLeft,
        })
        return { shouldCompact: true, reason: 'auto' }
      } catch {
        this.caseMemory.recordCompactionFailure()
        return { shouldCompact: false, reason: 'failed' }
      }
    }

    if (assessment.isWarning) {
      console.warn(`[AgentLoop] Context: ${assessment.percentLeft.toFixed(0)}% remaining`)
    }

    return { shouldCompact: false }
  }

  /** Write profiler snapshot to ActionTrace for observability. */
  private async writeProfilerSnapshot(): Promise<void> {
    const snapshot = this.profiler.snapshot()
    if (snapshot.totalDurationMs > 0) {
      await this.traceWriter.write('loop_decision', 'Profiler Snapshot', snapshot as unknown as Record<string, unknown>)
    }
  }

  /** Run LLM-driven compaction with fallback to programmatic summary. */
  private async performCompaction(): Promise<void> {
    this.profiler.incrementCompaction()
    const strategy = this.deps.config.memoryStrategy

    try {
      const result = await compactConversation(this.messages, strategy)
      if (result.summary) {
        this.caseMemory.setSummary(result.summary)
        await this.traceWriter.write('loop_decision', 'LLM Compact', {
          model: result.model,
          provider: result.provider,
          tokensUsed: result.tokensUsed,
        })
        return
      }
      console.warn('[AgentLoop] LLM compact returned empty summary, falling back to programmatic')
    } catch (err) {
      console.warn('[AgentLoop] LLM compact failed, falling back to programmatic:', err)
    }

    // Fallback: programmatic XML summary
    this.caseMemory.recordCompaction()
  }

  abort() {
    this.aborted = true
    this.abortController.abort()
  }

  /** Directly ingest form answers as facts, bypassing LLM extraction.
   *  Follows CC's pattern: the model keyed the fields, the user filled them —
   *  no second LLM call needed. */
  ingestFormAnswers(answers: Record<string, string>): void {
    this.caseMemory.ingestFormAnswers(answers)
  }

  getMemorySummary() {
    return this.caseMemory.getSummary()
  }

  loadMemory(data: Parameters<CaseMemoryManager['loadFromDb']>[0]) {
    this.caseMemory.loadFromDb(data)
    // Re-sync currentStage from restored memory so StageExecutor picks up
    // the persisted stage instead of defaulting to the first schema stage.
    if (this.stageExecutor) {
      this.currentStage = this.stageExecutor.getCurrentStage()
    }
  }
}
