// Intera Harness - Agent Loop (核心引擎)
// Based on Claude Code's query.ts + StreamingToolExecutor pattern
//
// Streaming tool execution: tools begin executing as soon as their
// input_json is complete (content_block_stop), while text/thinking
// continues streaming to the frontend. This is the key difference
// from naive "wait for full response then execute" approaches.

import Anthropic from '@anthropic-ai/sdk'
import { createAgentClient } from './api/provider-config'
import type { Message, AssistantMessage, SSEEvent, CaseSchemaConfig, ToolDefinition } from '@intera/shared/types'
import { HUMAN_HANDOFF_PROMISE_PATTERN } from '@intera/shared/defaults'
import { ChatMemoryManager } from './memory'
import { HookEngine } from './hook-engine'
import { ToolRouter } from './tools'
import { TraceWriter } from './trace'
import { CaseAgentLoop, type CaseLoopServices } from './case-agent-loop'
import { ConversationLoop } from './conversation-loop'
import { Profiler } from './profiler'
import { writeDebugTranscript } from './debug-logger'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'
import { makeUserMessage, makeInternalRuntimeMessage, buildApiMessagesWithTranscriptHealth } from './message-builder'
import { selectPromptAndTools } from './prompt-selector'
import {
  interceptToolResults,
  processPendingHookToolCalls as hookToolCalls,
  refreshActiveProcedureRunForStartToolResult,
  type ToolInterceptorContext,
} from './tool-interceptor'
import {
  bindProcedureRuntimeAgentConfig,
  getActiveProcedureRun,
  latestInputEpoch,
  procedureRunPromptTail,
  recordProcedureTextReply,
} from './session-store'
import { hasRecognizedTokenUsage, readInputTokens, readOutputTokens } from './usage-accounting'
import { RuntimeMemoryLifecycle } from './runtime-memory-lifecycle'
import type { SynthesisReason } from '@intera/runtime-core/provider-tool-turn'
import { StopHookHandler } from './stop-hook-handler'
import { HumanTaskHandoffHandler, type PendingHumanTaskEscalation } from './human-task-handoff-handler'
import { buildHookHitCounts, TurnPreflight } from './turn-preflight'
import { ProcedureConditionCheckpoint } from './procedure-condition-checkpoint'
import { HookContextBuilder } from './hook-context-builder'
import { TurnExitHandler } from './turn-exit-handler'
import { PostToolUsePhase, addHookFeedbackMessage } from './post-tool-use-phase'
import { NoToolTurnHandler } from './no-tool-turn-handler'
import { ToolCompletionPhase } from './tool-completion-phase'
import { LlmStreamPhase } from './llm-stream-phase'
import { finalizeStreamingProviderToolTurn } from './provider-tool-turn-phase'
import { writeProviderTranscriptHealth } from './provider-transcript-health-writer'

const CASE_TERMINAL_TOOL_NAMES = new Set([
  'create_human_task',
  'finalize_procedure',
  'finalize_consultation',
])

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AgentLoopDeps {
  config: AgentConfigData
  /** AgentConfig ID for scoped Tool + Hook loading. */
  configId: string
  caseId: string
  orgId: string
  userId: string
  /** Case-execution prompt (used when case is active). Assembled by buildModePrompt. */
  systemPrompt: string
  /** Core/discovery prompt (used when no case is active). Resolved from CORE_SYSTEM_PROMPT. Falls back to systemPrompt if unset. */
  coreSystemPrompt?: string
  caseSchema?: CaseSchemaConfig | null
  /** Groups all cases in the same chat session — stored on Case.chatId. */
  chatId?: string | null
  /** When true, the case was created from an intent selection card. */
  bootstrapNewCase?: boolean
  /** Persistence port — if set, all DB writes use this port. Defaults to Prisma. */
  persistence?: import('./persistence-port').PersistencePort
  /** Dry-run mode — operational tools mocked, system_info allowed. Playground only. */
  dryRun?: boolean
  /** Allow runtime-managed memory tools to persist during dry-run style Playground sessions. */
  persistRuntimeMemory?: boolean
  /** Emit thinking_delta SSE to frontend. Default false (prod never emits). Playground sets per-turn. */
  emitThinking?: boolean
}

export interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'waiting_form' | 'error' | 'consultation_complete' | 'connection_lost' | 'machine_error'
  currentStage?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

export class AgentLoop {
  private messages: Message[] = []
  private chatMemory: ChatMemoryManager
  private hookEngine!: HookEngine
  private toolRouter: ToolRouter
  /** Case-specific execution engine — null in Core (discovery) mode. */
  private caseLoop: CaseAgentLoop | null = null
  /** Core (discovery) mode handler — prompt + tool filtering. */
  private conversationLoop: ConversationLoop
  private traceWriter: TraceWriter
  private profiler: Profiler = new Profiler()
  private iterationCount = 0
  private nudgeCount = 0
  private pendingEscalation = false
  private pendingHumanTaskEscalation: PendingHumanTaskEscalation | null = null
  /** Counter for cadence-driven compaction (compactEveryNMessages). Reset after each compaction. */
  private userMessagesSinceLastCompact = 0
  private abortController: AbortController
  private aborted = false
  private anthropicClient: Anthropic
  private persistence: import('./persistence-port').PersistencePort
  private dryRun: boolean
  private memoryLifecycle: RuntimeMemoryLifecycle
  private stopHookHandler: StopHookHandler
  private humanTaskHandoffHandler: HumanTaskHandoffHandler
  private turnPreflight: TurnPreflight
  private procedureConditionCheckpoint: ProcedureConditionCheckpoint
  private hookContextBuilder: HookContextBuilder
  private turnExitHandler: TurnExitHandler
  private postToolUsePhase: PostToolUsePhase
  private noToolTurnHandler: NoToolTurnHandler
  private toolCompletionPhase: ToolCompletionPhase
  private llmStreamPhase: LlmStreamPhase

  /** Current workflow stage — delegates to caseLoop when active. */
  private get currentStage(): string {
    return this.caseLoop?.currentStage ?? 'created'
  }

  constructor(private deps: AgentLoopDeps) {
    bindProcedureRuntimeAgentConfig(deps.caseId, deps.configId)
    this.chatMemory = new ChatMemoryManager(deps.caseId, deps.config.memoryStrategy)
    this.toolRouter = new ToolRouter()
    this.abortController = new AbortController()
    this.anthropicClient = createAgentClient(deps.config.model)
    // Persistence port — defaults to Prisma if not injected (playground injects memory port).
    // Must be assigned BEFORE TraceWriter so the writer can route through the port.
    this.persistence = deps.persistence || (() => { const { createPrismaPersistence } = require('./persistence-port'); return createPrismaPersistence() })()
    this.traceWriter = new TraceWriter(deps.caseId, this.persistence)
    if (deps.chatId) this.traceWriter.setChatId(deps.chatId)
    this.traceWriter.setRunId(getActiveProcedureRun(deps.caseId)?.runId ?? null)
    this.traceWriter.setRunIdProvider(() => getActiveProcedureRun(this.deps.caseId)?.runId ?? null)
    this.dryRun = deps.dryRun ?? false
    this.memoryLifecycle = new RuntimeMemoryLifecycle({
      config: deps.config,
      configId: deps.configId,
      caseId: deps.caseId,
      orgId: deps.orgId,
      userId: deps.userId,
      chatId: deps.chatId,
      dryRun: this.dryRun,
      persistRuntimeMemory: deps.persistRuntimeMemory,
      chatMemory: this.chatMemory,
      persistence: this.persistence,
      traceWriter: this.traceWriter,
      profiler: this.profiler,
      getMessages: () => this.messages,
      setMessages: (messages) => { this.messages = messages },
      getUserMessagesSinceLastCompact: () => this.userMessagesSinceLastCompact,
      setUserMessagesSinceLastCompact: (count) => { this.userMessagesSinceLastCompact = count },
    })
    this.stopHookHandler = new StopHookHandler({
      config: deps.config,
      caseId: deps.caseId,
      orgId: deps.orgId,
      userId: deps.userId,
      chatId: deps.chatId,
      caseSchema: deps.caseSchema,
      chatMemory: this.chatMemory,
      persistence: this.persistence,
      traceWriter: this.traceWriter,
      getMessages: () => this.messages,
      addMessage: (message) => this.messages.push(message),
      getCurrentStage: () => this.currentStage,
    })
    this.humanTaskHandoffHandler = new HumanTaskHandoffHandler({
      traceWriter: this.traceWriter,
      getMessages: () => this.messages,
      addMessage: (message) => this.messages.push(message),
    })
    this.turnPreflight = new TurnPreflight({
      caseId: deps.caseId,
      chatMemory: this.chatMemory,
      traceWriter: this.traceWriter,
      getHookEngine: () => this.hookEngine,
      getMessages: () => this.messages,
      addMessage: (message) => this.messages.push(message),
      getCurrentStage: () => this.currentStage,
      getIterationCount: () => this.iterationCount,
    })
    this.procedureConditionCheckpoint = new ProcedureConditionCheckpoint({
      caseId: deps.caseId,
      config: deps.config,
      traceWriter: this.traceWriter,
    })
    this.hookContextBuilder = new HookContextBuilder({
      agentConfigId: deps.configId,
      caseId: deps.caseId,
      chatId: deps.chatId,
      chatMemory: this.chatMemory,
      getCaseSchema: () => this.deps.caseSchema,
      getCurrentStage: () => this.currentStage,
      getIterationCount: () => this.iterationCount,
    })
    this.turnExitHandler = new TurnExitHandler({
      traceWriter: this.traceWriter,
      getMessages: () => this.messages,
      getCurrentStage: () => this.currentStage,
      getIterationCount: () => this.iterationCount,
      getNudgeCount: () => this.nudgeCount,
    })
    this.postToolUsePhase = new PostToolUsePhase({
      caseId: deps.caseId,
      chatMemory: this.chatMemory,
      getHookEngine: () => this.hookEngine,
      hookContextBuilder: this.hookContextBuilder,
      traceWriter: this.traceWriter,
      getToolRouter: () => this.toolRouter,
      addMessage: addHookFeedbackMessage(this.messages),
      buildToolInterceptorContext: () => this.buildToolInterceptorContext(),
      shouldDeferTerminalToolTrace: (toolName) => Boolean(this.caseLoop) && CASE_TERMINAL_TOOL_NAMES.has(toolName),
    })
    this.noToolTurnHandler = new NoToolTurnHandler({
      traceWriter: this.traceWriter,
      getMessages: () => this.messages,
      addMessage: (message) => this.messages.push(message),
      getCurrentStage: () => this.currentStage,
    })
    this.toolCompletionPhase = new ToolCompletionPhase({
      caseId: deps.caseId,
      orgId: deps.orgId,
      userId: deps.userId,
      chatId: deps.chatId,
      configId: deps.configId,
      config: deps.config,
      getCaseSchema: () => this.deps.caseSchema,
      getMessages: () => this.messages,
      chatMemory: this.chatMemory,
      persistence: this.persistence,
      traceWriter: this.traceWriter,
      profiler: this.profiler,
      dryRun: this.dryRun,
      persistRuntimeMemory: deps.persistRuntimeMemory,
      canCreateHumanTaskInGeneralMode: () => !this.caseLoop,
    })
    this.llmStreamPhase = new LlmStreamPhase({
      config: deps.config,
      configId: deps.configId,
      caseId: deps.caseId,
      getAnthropicClient: () => this.anthropicClient,
      abortController: this.abortController,
      traceWriter: this.traceWriter,
      profiler: this.profiler,
      chatMemory: this.chatMemory,
      getMessages: () => this.messages,
      setMessages: (messages) => { this.messages = messages },
      addMessage: (message) => this.messages.push(message),
      getCurrentStage: () => this.currentStage,
      getHookEngine: () => this.hookEngine,
      getToolRouter: () => this.toolRouter,
      hookContextBuilder: this.hookContextBuilder,
      buildToolInterceptorContext: () => this.buildToolInterceptorContext(),
      emitThinking: deps.emitThinking,
      dryRun: this.dryRun,
    })

    // Always initialize ConversationLoop — used in Core (discovery) mode
    this.conversationLoop = new ConversationLoop({
      coreSystemPrompt: deps.coreSystemPrompt || deps.systemPrompt,
    })

    // Initialize CaseAgentLoop if case schema is available (case active or known type)
    if (deps.caseSchema) {
      this.caseLoop = new CaseAgentLoop(
        deps.caseSchema,
        this.makeCaseLoopServices(),
        deps.bootstrapNewCase,
      )
    }
  }

  /** Build the service accessor bag for CaseAgentLoop. Called once at init
   *  or when a new case is created mid-loop. The callbacks close over `this`
   *  so they always reflect the latest AgentLoop state (e.g. after loadMessages). */
  private makeCaseLoopServices(): CaseLoopServices {
    return {
      caseId: this.deps.caseId,
      orgId: this.deps.orgId,
      agentConfigId: this.deps.configId,
      userId: this.deps.userId,
      chatId: this.deps.chatId,
      config: this.deps.config,
      chatMemory: this.chatMemory,
      getHookEngine: () => this.hookEngine,
      traceWriter: this.traceWriter,
      toolRouter: this.toolRouter,
      getMessages: () => this.messages,
      addMessage: (msg) => this.messages.push(msg),
    }
  }

  /** Create and initialize an AgentLoop — loads Tools/Hooks from DB. */
  static async create(deps: AgentLoopDeps): Promise<AgentLoop> {
    const loop = new AgentLoop(deps)
    loop.toolRouter = await ToolRouter.create(deps.configId, deps.dryRun ?? false)
    loop.hookEngine = await HookEngine.create(deps.configId, {
      caseType: deps.caseSchema
        ? { type: deps.caseSchema.type, displayName: deps.caseSchema.displayName }
        : null,
    })
    return loop
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.toolRouter.getTool(name)
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  async run(
    userMessage: string,
    rawSendEvent: (event: SSEEvent) => void,
    contentBlocks?: import('@intera/shared/types').ContentBlock[],
  ): Promise<LoopResult> {
    // Dev/diagnostic flags — env-only, not in operator config (Phase 4)
    const debugLogsEnabled = process.env.INTERA_DEBUG_LOGS === '1'
    const invariantCheckEnabled = process.env.INTERA_INVARIANT_CHECK === '1'

    if (debugLogsEnabled) {
      console.log(`[DebugMode] ENABLED for case ${this.deps.caseId} — writing full API payloads to debug-logs/`)
    }

    // Wrap sendEvent to catch stream-closed errors safely.
    // Only abort on actual connection loss (AbortError), not on serialization errors.
    const sendEvent = (event: SSEEvent) => {
      if (this.aborted) return
      try { rawSendEvent(event) } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          this.aborted = true
          this.abortController.abort()
        }
      }
    }

    // 0. Chain tracking for agent tree observability
    const chainId = crypto.randomUUID()
    const agentName = this.deps.caseId ? `Main[${this.deps.caseId.slice(-8)}]` : 'Main'

    // 1. Record user message
    this.profiler.startTurn()
    const userMsg = makeUserMessage(userMessage, contentBlocks)
    this.messages.push(userMsg)
    this.userMessagesSinceLastCompact++
    await this.traceWriter.write('user_message', 'User sent message', userMessage)
    await this.traceWriter.writeAgentTreeNode(agentName, 0, chainId, 'run start')

    // 2. ReAct loop — CC pattern: first LLM call runs unconditionally,
    // end_turn exits immediately, only tool_use enters the follow-up loop.
    let stopReason: string | null = null
    let usage: Record<string, unknown> | null = null
    // S1 tool-result invariant: track why each tool_use didn't produce a real result
    const missingReasons = new Map<string, SynthesisReason>()
    const pendingHookFeedback: string[] = []
    let stopRetryCount = 0

    do {
      this.iterationCount++
      this.profiler.incrementIteration()

      const preflight = await this.turnPreflight.run(sendEvent)
      if (preflight.kind === 'terminal') return preflight.result
      const buildHitCounts = () => buildHookHitCounts(this.hookEngine, this.chatMemory)

      // ── isCaseActive for this iteration ─────────────────────────────────
      const isCaseActive = this.caseLoop?.isStageActive() ?? false
      // Consultation mode: human operator is reviewing the case via the same chat UI.
      // Restrict the agent to pure conversation + finalize_consultation only.
      const isConsultation = this.chatMemory.getSummary().caseStatus === 'waiting_human'

      await this.procedureConditionCheckpoint.run()
      this.traceWriter.setRunId(getActiveProcedureRun(this.deps.caseId)?.runId ?? null)

      // Emit case progress for active Procedure cases.
      if (isCaseActive) {
        this.caseLoop!.emitProgressEvent(this.iterationCount, sendEvent)
      }

      // Context compaction (simplified)
      const compactResult = await this.memoryLifecycle.checkAndCompact()
      if (compactResult.shouldCompact) {
        sendEvent({
          type: 'withheld',
          data: 'Compacting context...',
          timestamp: new Date().toISOString(),
        })
      }

      const iterationBasedOnInputEpoch = latestInputEpoch(this.deps.caseId)

      // ── Phase 1: Dual-mode prompt + tool selection ──────────────────────────
      const { prompt: stagePrompt, tools: stageTools } = selectPromptAndTools({
        isCaseActive,
        isConsultation,
        caseSchema: this.deps.caseSchema,
        systemPrompt: this.deps.systemPrompt,
        currentStage: this.currentStage,
        nudgeCount: this.nudgeCount,
        conversationLoop: this.conversationLoop,
        caseLoop: this.caseLoop,
        allTools: this.toolRouter.getTools(),
        procedureRunTail: procedureRunPromptTail(this.deps.caseId),
      })

      // Reset per-iteration
      stopReason = null
      usage = null

      const iterationStartTime = Date.now()

      if (this.abortController.signal.aborted) break

      const { messages: apiMessages, metrics: transcriptHealth } = this.buildApiMessages()
      await writeProviderTranscriptHealth(this.traceWriter, transcriptHealth)

      if (debugLogsEnabled) {
        console.log('[DebugMode] stagePrompt:', stagePrompt.slice(0, 3000))
        console.log('[DebugMode] stageTools:', stageTools.map(t => t.name).join(', '))
        console.log('[DebugMode] isCaseActive:', isCaseActive, 'stage:', this.currentStage)
      }

      const streamPhase = await this.llmStreamPhase.run({
        stagePrompt,
        stageTools,
        apiMessages,
        iterationCount: this.iterationCount,
        iterationBasedOnInputEpoch,
        missingReasons,
        pendingHookFeedback,
        debugLogsEnabled,
        sendEvent,
      })
      if (streamPhase.kind === 'continue') continue
      if (streamPhase.kind === 'terminal') return streamPhase.result

      let assistantMessage = streamPhase.assistantMessage
      let assistantPushed = streamPhase.assistantPushed
      const fullText = streamPhase.fullText
      stopReason = streamPhase.stopReason
      usage = streamPhase.usage
      const streamFatalError = streamPhase.streamFatalError
      const streamEndedAt = streamPhase.streamEndedAt
      const blocks = streamPhase.blocks
      const toolExecutor = streamPhase.toolExecutor
      const toolBasedOnEpoch = streamPhase.toolBasedOnEpoch
      const flushVisibleText = streamPhase.flushVisibleText
      const discardVisibleText = streamPhase.discardVisibleText

      // Stream complete — finalize the assistant message
      if (!assistantMessage) {
        throw new Error(`No assistant message received${streamFatalError ? `: ${streamFatalError}` : ''}`)
      }
      assistantMessage.content = fullText
      assistantMessage.isStreaming = false

      // ── Wait for all tools to finish ─────────────────────────
      const toolCompletion = await this.toolCompletionPhase.run({
        toolExecutor,
        toolBasedOnEpoch,
        iterationBasedOnInputEpoch,
      })
      const toolResults = toolCompletion.toolResults
      if (toolCompletion.pendingHumanTaskEscalation) {
        this.pendingHumanTaskEscalation = toolCompletion.pendingHumanTaskEscalation
      }

      let stopBlockedThisIteration = false
      if (fullText.trim().length > 0) {
        const textReplyRuntime = recordProcedureTextReply(this.deps.caseId, {
          text: fullText,
          basedOnInputEpoch: iterationBasedOnInputEpoch,
          alreadyStreamed: false,
        })
        if (textReplyRuntime.stale) {
          discardVisibleText()
          assistantMessage.content = ''
          this.messages.push(makeInternalRuntimeMessage('[PROCEDURE RUNTIME] A customer-visible reply was withheld because newer input arrived before send. Continue from the latest runtime input before any further tool use, finalization, or customer reply.'))
          await this.traceWriter.write('loop_decision', 'Stale ProcedureRun text reply withheld', {
            basedOnInputEpoch: iterationBasedOnInputEpoch,
            latestInputEpoch: latestInputEpoch(this.deps.caseId),
            runId: textReplyRuntime.run?.runId,
          })
          stopReason = null
          continue
        }
        const stopEval = await this.hookEngine.evaluate('Stop', {
          ...this.hookContextBuilder.build('Stop', {
            replyDraft: fullText,
            currentToolCalls: toolResults.map((result) => ({
              name: result.name,
              input: result.toolUse?.input,
              output: result.output,
            })),
          }),
        }, buildHitCounts())

        await this.traceWriter.write(
          'loop_decision',
          `Hook checkpoint Stop: ${stopEval.summary}`,
          stopEval as unknown as Record<string, unknown>,
        )

        const preserveAutoHandoffReply =
          stopEval.summary === 'escalate' &&
          toolResults.length === 0 &&
          hasPendingCreateHumanTask(stopEval) &&
          matchesHumanHandoffPromise(fullText)

        if (stopEval.summary === 'warn' || stopEval.summary === 'allow') {
          for (const r of stopEval.results) {
            if (r.action === 'warn') this.chatMemory.recordHookHit(r.hookName)
          }
          flushVisibleText()
          if (stopEval.feedbackMessage && stopEval.summary === 'warn') {
            pendingHookFeedback.push(stopEval.feedbackMessage)
          }
        } else if (preserveAutoHandoffReply) {
          for (const r of stopEval.results) {
            if (r.action !== 'allow') this.chatMemory.recordHookHit(r.hookName)
          }
          const hookAutoEscalation = await hookToolCalls(
            this.buildToolInterceptorContext(),
            stopEval,
            sendEvent,
            { sendCustomerFallback: false },
          )
          if (hookAutoEscalation.createdHumanTask) {
            flushVisibleText()
            if (!assistantPushed && assistantMessage) {
              this.messages.push(assistantMessage)
              assistantPushed = true
            }
            sendEvent({
              type: 'message_stop',
              data: { reason: 'waiting_human', stage: 'waiting_human' },
              timestamp: new Date().toISOString(),
            })
            await this.persistTurnMemory()
            return {
              messages: this.messages,
              caseStatus: 'waiting_human',
              transition: 'waiting_human',
              currentStage: 'waiting_human',
              reason: 'hook_auto_human_task',
            }
          }

          stopBlockedThisIteration = true
          discardVisibleText()
          assistantMessage.content = ''
        } else {
          stopBlockedThisIteration = true
          discardVisibleText()
          for (const r of stopEval.results) {
            if (r.action !== 'allow') this.chatMemory.recordHookHit(r.hookName)
          }
          assistantMessage.content = ''

          if (toolResults.length === 0) {
            const stopAction = await this.stopHookHandler.handle(
              stopEval,
              stopRetryCount,
              sendEvent,
            )
            if (stopAction.kind === 'retry') {
              stopRetryCount++
              if (stopAction.feedbackMessage) {
                this.messages.push(makeInternalRuntimeMessage(stopAction.feedbackMessage, 'hook_feedback'))
              }
              stopReason = null
              continue
            }
            await this.persistTurnMemory()
            return stopAction.result
          }

          if (stopEval.feedbackMessage) {
            pendingHookFeedback.push(stopEval.feedbackMessage)
          }
          if (stopEval.pendingToolCalls?.length) {
            await hookToolCalls(this.buildToolInterceptorContext(), stopEval, sendEvent)
          }
        }
      }

      // ── Ensure assistant message is pushed before tool results ──
      // For blocked/escalated tools, the message was already pushed in onToolUseCompleted.
      // For normal tools, we push it here so the tool_result message comes after it.
      if (!assistantPushed && assistantMessage) {
        this.messages.push(assistantMessage)
        assistantPushed = true
      }

      // ── S1: Post-stream synthesis — guarantee one tool_result per tool_use ──
      // Always runs: wraps ALL tool results (success + error) into Anthropic
      // API-format user messages with structured tool_result blocks.
      // This replaces the legacy addToolResultMessages (assistant text format).
      if (assistantMessage) {
        finalizeStreamingProviderToolTurn({
          messages: this.messages,
          assistantMessage,
          blocks,
          toolResults,
          missingReasons,
          pendingHookFeedback,
          invariantCheckEnabled,
        })
      }

      // ── Stream fatal error after S1 synthesis: exit gracefully ──
      if (streamFatalError) {
        await this.traceWriter.write('loop_decision', 'Fatal stream error after S1 synthesis', {
          error: streamFatalError, iteration: this.iterationCount,
        })
        sendEvent({ type: 'error', data: `Stream error: ${streamFatalError}`, timestamp: new Date().toISOString() })
        await this.persistTurnMemory()
        return {
          messages: this.messages,
          caseStatus: 'escalated',
          transition: 'error',
          currentStage: this.currentStage,
          reason: 'stream_error',
        }
      }

      if (stopBlockedThisIteration && toolResults.length > 0) {
        await this.traceWriter.write('loop_decision', 'Stop Hook blocked streamed reply; continuing for repair', {
          iteration: this.iterationCount,
          toolCount: toolResults.length,
        })
      }

      if (usage && hasRecognizedTokenUsage(usage)) {
        const iterationEndedAt = Date.now()
        const llmWallMs = Math.max(0, streamEndedAt - iterationStartTime)
        const toolsWallMs = Math.max(0, iterationEndedAt - streamEndedAt)
        await this.traceWriter.write('loop_decision', 'Iteration Snapshot', {
          iteration: this.iterationCount,
          llmWallMs,
          toolsWallMs,
          iterationWallMs: iterationEndedAt - iterationStartTime,
          wallMs: iterationEndedAt - iterationStartTime,
          inputTokens: readInputTokens(usage),
          outputTokens: readOutputTokens(usage),
        })
      }

      if (toolResults.length === 0) {
        const noToolTurn = await this.noToolTurnHandler.handle({
          fullText,
          nudgeCount: this.nudgeCount,
          iterationCount: this.iterationCount,
          assistantMessage,
          assistantPushed,
          isProcedureMode: this.caseLoop?.isProcedureMode() ?? false,
          isConsultation,
          stopReason,
          usage,
          sendEvent,
        })
        assistantPushed = noToolTurn.assistantPushed
        if (noToolTurn.kind === 'continue') {
          this.nudgeCount = noToolTurn.nudgeCount
          this.iterationCount += noToolTurn.iterationDelta
          continue
        }
        await this.persistTurnMemory()
        return noToolTurn.result
      }

      await refreshActiveProcedureRunForStartToolResult(
        this.buildToolInterceptorContext(),
        toolResults,
        sendEvent,
      )

      const postToolUse = await this.postToolUsePhase.run({
        toolResults,
        toolBasedOnEpoch,
        iterationBasedOnInputEpoch,
        iterationCount: this.iterationCount,
        nudgeCount: this.nudgeCount,
        sendEvent,
      })
      this.nudgeCount = postToolUse.nudgeCount

      // ── Add to message history ───────────────────────────────
      // NOTE: Tool results are now added via S1 synthesis above (unified format).
      if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }


      // ── Tool interception: start_procedure compatibility, read_chat_memory, etc. ──
      const interceptorResult = await interceptToolResults(
        this.buildToolInterceptorContext(),
        toolResults,
        sendEvent,
      )
      if (interceptorResult.action.kind === 'continue') continue
      if (interceptorResult.action.kind === 'return') {
        await this.persistTurnMemory()
        return interceptorResult.action.result
      }

      // ── Phase 2: Delegate case terminal tools to CaseAgentLoop ─────────────
      // Handles: create_human_task, finalize_procedure, finalize_consultation.
      if (this.caseLoop) {
        const nudgeBox = { value: this.nudgeCount }
        const caseToolResult = await this.caseLoop.handleCaseTerminalTools(
          toolResults,
          this.iterationCount,
          nudgeBox,
          sendEvent,
        )
        this.nudgeCount = nudgeBox.value
        if (caseToolResult.type === 'terminal') {
          await this.persistTurnMemory()
          return caseToolResult.result
        }
        if (caseToolResult.type === 'continue') continue
      }

      if (this.pendingHumanTaskEscalation) {
        const pending = this.pendingHumanTaskEscalation
        this.pendingHumanTaskEscalation = null
        const handoffResult = await this.humanTaskHandoffHandler.complete(pending, fullText, sendEvent)
        await this.persistTurnMemory()
        return handoffResult
      }

      const turnExit = this.turnExitHandler.completePostToolTurn({
        pendingEscalation: this.pendingEscalation,
        stopReason,
      }, sendEvent)
      if (turnExit.kind === 'terminal') {
        await this.persistTurnMemory()
        return turnExit.result
      }
    } while (
      this.iterationCount < this.deps.config.maxIterations &&
      stopReason !== 'end_turn' &&
      stopReason !== 'max_tokens'
    )

    await this.persistTurnMemory()
    return this.turnExitHandler.maxIterations(stopReason, sendEvent)
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildToolInterceptorContext(): ToolInterceptorContext {
    return {
      caseId: this.deps.caseId,
      orgId: this.deps.orgId,
      agentConfigId: this.deps.configId,
      userId: this.deps.userId,
      chatId: this.deps.chatId,
      config: this.deps.config,
      caseSchema: this.deps.caseSchema,
      chatMemory: this.chatMemory,
      persistence: this.persistence,
      traceWriter: this.traceWriter,
      toolRouter: this.toolRouter,
      getCaseLoop: () => this.caseLoop,
      dryRun: this.dryRun,
      messages: this.messages,
      getCurrentStage: () => this.currentStage,
      setPendingEscalation: (v) => { this.pendingEscalation = v },
      activateProcedureContext: (schema) => this.activateProcedureContext(schema),
    }
  }

  private async activateProcedureContext(schema: CaseSchemaConfig): Promise<void> {
    this.deps.caseSchema = schema
    this.caseLoop = new CaseAgentLoop(
      schema,
      this.makeCaseLoopServices(),
      true,
    )
    this.caseLoop.syncStage()
  }

  private buildApiMessages() {
    return buildApiMessagesWithTranscriptHealth(this.messages, this.chatMemory, this.deps.config.memoryStrategy)
  }

  // -----------------------------------------------------------------------
  getCaseType(): string {
    return this.deps.caseSchema?.type || 'general'
  }

  private async persistTurnMemory(): Promise<void> {
    this.memoryLifecycle.compactUserProfile().catch(() => {})
    await Promise.allSettled([
      this.memoryLifecycle.persistChatMemory(),
      this.memoryLifecycle.persistChatSession(),
    ])
  }

  private async checkAndCompact(): Promise<{ shouldCompact: boolean; reason?: string }> { return this.memoryLifecycle.checkAndCompact() }

  private async persistChatSession(): Promise<void> { return this.memoryLifecycle.persistChatSession() }

  private async compactUserProfile(): Promise<void> { return this.memoryLifecycle.compactUserProfile() }

  private shouldPersistRuntimeMemory(): boolean { return this.memoryLifecycle.shouldPersistRuntimeMemory() }

  private async persistChatMemory(): Promise<void> { return this.memoryLifecycle.persistChatMemory() }

  abort() {
    this.aborted = true
    this.abortController.abort()
  }

  /** Restore prior-turn messages from DB so the agent has conversation context. */
  loadMessages(msgs: Message[]): void {
    this.messages = msgs
  }

  /** Directly ingest form answers as facts, bypassing LLM extraction.
   *  Follows CC's pattern: the model keyed the fields, the user filled them —
   *  no second LLM call needed. */
  ingestFormAnswers(answers: Record<string, string>): void {
    this.chatMemory.ingestFormAnswers(answers)
  }

  getMemorySummary() {
    return this.chatMemory.getSummary()
  }

  loadMemory(data: Parameters<ChatMemoryManager['loadFromDb']>[0]) {
    this.chatMemory.loadFromDb(data)
    this.caseLoop?.syncStage()
  }
}

function hasPendingCreateHumanTask(stopEval: { pendingToolCalls?: Array<{ tool: string }> }): boolean {
  return (stopEval.pendingToolCalls ?? []).some((call) => call.tool === 'create_human_task')
}

function matchesHumanHandoffPromise(text: string): boolean {
  if (!text.trim()) return false
  try {
    return new RegExp(HUMAN_HANDOFF_PROMISE_PATTERN, 'i').test(text)
  } catch {
    return false
  }
}
