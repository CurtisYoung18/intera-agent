// Intera Harness - Agent Loop (核心引擎)
// Based on Claude Code's query.ts + StreamingToolExecutor pattern
//
// Streaming tool execution: tools begin executing as soon as their
// input_json is complete (content_block_stop), while text/thinking
// continues streaming to the frontend. This is the key difference
// from naive "wait for full response then execute" approaches.

import Anthropic from '@anthropic-ai/sdk'
import { createAgentClient } from './api/provider-config'
import type { Message, AssistantMessage, ToolUse, SSEEvent, CaseSchemaConfig, ToolDefinition } from '@intera/shared/types'
import { StreamingToolExecutor, unwrapToolExecutionPayload } from './streaming-tool-executor'
import { ChatMemoryManager } from './memory'
import { HookEngine } from './hook-engine'
import { ToolRouter } from './tools'
import { TraceWriter } from './trace'
import { CaseAgentLoop, type CaseLoopServices } from './case-agent-loop'
import { ConversationLoop } from './conversation-loop'
import { classifyError } from './api/error-classifier'
import { withRetry, CannotRetryError, FallbackTriggeredError } from './api/with-retry'
import { reactiveCompact } from './compact'
import { Profiler } from './profiler'
import { writeDebugRequest, writeDebugResponse, writeDebugTranscript } from './debug-logger'
import { buildModelList } from './build-model-list'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'
import { consumeStream, type StreamContentBlock, type StreamConsumeCallbacks } from './stream-handler'
import type { HookCheckpoint, HookContext } from '@intera/shared/contracts/hooks'

// ---------------------------------------------------------------------------
// StreamingTextSanitizer
// Strips <think>…</think>, orphan </think>, and "Tool X result: …" leakage
// from the streaming text before it reaches the client.  The 60-char hold-back
// ensures patterns that straddle chunk boundaries are caught correctly.
// ---------------------------------------------------------------------------

import { StreamingTextSanitizer } from './streaming-text-sanitizer'
import { makeUserMessage, buildApiMessagesWithTranscriptHealth } from './message-builder'
import { selectPromptAndTools } from './prompt-selector'
import type { TranscriptHealthMetrics } from './provider-transcript'
import { interceptToolResults, processPendingHookToolCalls as hookToolCalls, type ToolInterceptorContext } from './tool-interceptor'
import {
  getActiveProcedureRun,
  latestInputEpoch,
  procedureRunPromptTail,
  recordProcedureTextReply,
  recordProcedureToolCall,
  recordProcedureToolResult,
} from './session-store'
import { hasRecognizedTokenUsage, readInputTokens, readOutputTokens } from './usage-accounting'
import {
  RuntimeManagedToolResolver,
  shouldPersistToolResultToChatMemory,
  shouldRecordProcedureEvidence,
} from './runtime-managed-tools'
import { RuntimeMemoryLifecycle } from './runtime-memory-lifecycle'
import {
  assertProviderToolTurnInvariant,
  finalizeProviderToolTurn,
  type SynthesisReason,
} from '@intera/runtime-core/provider-tool-turn'
import { StopHookHandler } from './stop-hook-handler'
import { HumanTaskHandoffHandler, type PendingHumanTaskEscalation } from './human-task-handoff-handler'
import { buildHookHitCounts, TurnPreflight } from './turn-preflight'
import { ProcedureConditionCheckpoint } from './procedure-condition-checkpoint'

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

function isInternalProcedureUserMessage(message: Message): boolean {
  if (message.role !== 'user') return false

  const transcriptKind = message.providerMeta?.transcriptKind
  if (transcriptKind === 'tool_result' || transcriptKind === 'hook_feedback') {
    return true
  }

  if (Array.isArray(message.providerContent)) {
    if (message.providerContent.some((block: any) => block?.type === 'tool_result')) {
      return true
    }
  }

  if (Array.isArray(message.content)) {
    return message.content.some((block: any) => block?.type === 'tool_result')
  }

  return false
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

  /** Current workflow stage — delegates to caseLoop when active. */
  private get currentStage(): string {
    return this.caseLoop?.currentStage ?? 'created'
  }

  constructor(private deps: AgentLoopDeps) {
    this.chatMemory = new ChatMemoryManager(deps.caseId, deps.config.memoryStrategy)
    this.toolRouter = new ToolRouter()
    this.abortController = new AbortController()
    this.anthropicClient = createAgentClient(deps.config.model)
    // Persistence port — defaults to Prisma if not injected (playground injects memory port).
    // Must be assigned BEFORE TraceWriter so the writer can route through the port.
    this.persistence = deps.persistence || (() => { const { createPrismaPersistence } = require('./persistence-port'); return createPrismaPersistence() })()
    this.traceWriter = new TraceWriter(deps.caseId, this.persistence)
    if (deps.chatId) this.traceWriter.setChatId(deps.chatId)
    this.dryRun = deps.dryRun ?? false
    this.memoryLifecycle = new RuntimeMemoryLifecycle({
      config: deps.config,
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
      makeUserMessage: (content) => makeUserMessage(content),
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
      const toolBasedOnEpoch = new Map<string, number>()

      sendEvent({
        type: 'stream_request_start',
        data: null,
        timestamp: new Date().toISOString(),
      })

      // Per-iteration streaming sanitizer — strips <think>/Tool-result leakage
      // from text_delta events before they reach the client.
      const textSanitizer = new StreamingTextSanitizer()

      // ── StreamingToolExecutor is created BEFORE the stream so tools
      //    can be enqueued incrementally as each tool_use block completes.
      const toolExecutor = new StreamingToolExecutor(
        this.toolRouter.getToolDefinitions(),
        (toolUse, status, renderHints) => {
          const skillDef = this.toolRouter.getTool(toolUse.name)
          sendEvent({
            type: status === 'executing' ? 'tool_executing' : 'tool_result',
            data: {
              name: toolUse.name,
              status,
              result: status !== 'executing' ? toolUse.result : undefined,
              displayVerb: status === 'executing' ? skillDef?.displayVerb : undefined,
              renderHints: renderHints ?? skillDef?.renderHints,
            },
            timestamp: new Date().toISOString(),
          })
        },
        this.dryRun,
        this.deps.configId,
      )

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

      const blocks = new Map<number, StreamContentBlock>()
      let assistantMessage: AssistantMessage | null = null
      let assistantPushed = false
      let fullText = ''
      let reconcileGateBlockedThisIteration = false
      const visibleTextBuffer: string[] = []
      const streamSendEvent = (event: SSEEvent) => {
        if (event.type === 'text_delta') {
          visibleTextBuffer.push(String(event.data ?? ''))
          return
        }
        sendEvent(event)
      }
      const flushVisibleText = () => {
        for (const chunk of visibleTextBuffer) {
          if (!chunk) continue
          sendEvent({
            type: 'text_delta',
            data: chunk,
            timestamp: new Date().toISOString(),
          })
        }
        visibleTextBuffer.length = 0
      }
      const discardVisibleText = () => {
        visibleTextBuffer.length = 0
      }
      // Reset per-iteration
      stopReason = null
      usage = null

      const iterationStartTime = Date.now()
      let streamEndedAt = iterationStartTime
      let streamFatalError: string | null = null

      if (this.abortController.signal.aborted) break

      const { messages: apiMessages, metrics: transcriptHealth } = this.buildApiMessages()
      await this.writeProviderTranscriptHealth(transcriptHealth)

      if (debugLogsEnabled) {
        console.log('[DebugMode] stagePrompt:', stagePrompt.slice(0, 3000))
        console.log('[DebugMode] stageTools:', stageTools.map(t => t.name).join(', '))
        console.log('[DebugMode] isCaseActive:', isCaseActive, 'stage:', this.currentStage)
      }

      // ── S2: Stream creation with classified retry ──
      let stream: ReturnType<typeof this.anthropicClient.messages.stream>
      try {
        stream = await withRetry(
          async (_client, ctx) => {
            return this.anthropicClient.messages.stream({
              model: ctx.model,
              max_tokens: ctx.maxTokensOverride ?? (this.deps.config.maxOutputTokens ?? 4096),
              system: stagePrompt,
              messages: apiMessages,
              tools: stageTools,
              tool_choice: { type: 'auto' as const, disable_parallel_tool_use: false },
              ...(this.deps.config.extendedThinking &&
                (buildModelList().find(m => m.id === ctx.model)?.supportsThinking ?? false) ? {
                thinking: { type: 'enabled' as const, budget_tokens: this.deps.config.thinkingBudget || 4096 },
              } : {}),
            }, { signal: this.abortController.signal })
          },
          {
            querySource: 'main_loop',
            model: this.deps.config.model,
            fallbackModel: this.deps.config.fallbackModel,
            signal: this.abortController.signal,
            onRetry: (info) => {
              sendEvent({
                type: 'retry_pending',
                data: { attempt: info.attempt, delayMs: info.delayMs, errorClass: info.errorClass, message: info.message },
                timestamp: new Date().toISOString(),
              })
            },
          },
          () => this.anthropicClient,
        )
      } catch (err) {
        // P1-4: Transient LLM API errors should NOT trigger escalated/transfer.
        // Only intentional handoffs (Hook escalation, max_nudges) should escalate.
        if (err instanceof FallbackTriggeredError) {
          sendEvent({ type: 'error', data: `Model fallback exhausted: ${err.originalModel}`, timestamp: new Date().toISOString() })
          return { messages: this.messages, transition: 'machine_error' as const, caseStatus: this.currentStage as CaseStatus, reason: 'llm_fallback_exhausted' }
        }
        if (err instanceof CannotRetryError && err.errorClass === 'context_overflow') {
          this.messages = reactiveCompact(this.messages)
          await this.traceWriter.write('loop_decision', 'Reactive compact on context overflow', { error: String(err) })
          continue
        }
        if (err instanceof CannotRetryError && err.errorClass === 'aborted') {
          await this.traceWriter.write('loop_decision', 'Stream aborted', { iteration: this.iterationCount })
          return { messages: this.messages, caseStatus: this.currentStage as CaseStatus, transition: 'connection_lost', currentStage: this.currentStage, reason: 'connection_lost' }
        }
        const classified = err instanceof CannotRetryError ? err.errorClass : classifyError(err)
        const detail = (err as any)?.message || (err as any)?.error?.message || String(err)
        sendEvent({ type: 'error', data: `LLM API error (${classified}): ${detail}`, timestamp: new Date().toISOString() })
        return { messages: this.messages, transition: 'machine_error' as const, caseStatus: this.currentStage as CaseStatus, reason: `llm_error:${classified}` }
      }

      // Debug: full API request
      let debugSeq = -1
      if (debugLogsEnabled) {
        console.log(`[DebugMode] Writing request log for case ${this.deps.caseId} iteration ${this.iterationCount}`)
        debugSeq = writeDebugRequest(this.deps.caseId, this.iterationCount, this.deps.config.model, {
          system: stagePrompt,
          messages: apiMessages as any,
          tools: stageTools as any,
          max_tokens: this.deps.config.maxOutputTokens ?? 4096,
          temperature: this.deps.config.temperature,
        })
      }

      await this.traceWriter.writeLlmRequestStart(
        this.deps.config.model,
        this.messages.length,
        stagePrompt,
        apiMessages,
        stageTools,
        { type: 'auto' as const, disable_parallel_tool_use: false },
      )

      sendEvent({
        type: 'llm_request_start',
        data: {
          model: this.deps.config.model,
          systemPrompt: stagePrompt,
          messages: apiMessages,
          tools: stageTools,
          toolChoice: { type: 'auto' as const, disable_parallel_tool_use: false },
        },
        timestamp: new Date().toISOString(),
      })

      try {
        const streamResult = await consumeStream(stream, blocks, {
          sendEvent: streamSendEvent,
          sanitizeChunk: (text: string) => textSanitizer.feed(text),
          flushSanitizer: () => textSanitizer.flush(),
          recordFirstToken: () => this.profiler.recordFirstToken(),
          emitThinking: this.deps.emitThinking ?? false,
          onToolUseCompleted: async (toolUse: ToolUse, am: AssistantMessage | null) => {
            const activeRun = getActiveProcedureRun(this.deps.caseId)
            if (
              activeRun?.needsReconcile &&
              !['reconcile_procedure_input', 'read_chat_memory', 'read_user_profile'].includes(toolUse.name)
            ) {
              reconcileGateBlockedThisIteration = true
              await this.traceWriter.write('loop_decision', `ProcedureRun reconcile gate blocked Tool: ${toolUse.name}`, {
                runId: activeRun.runId,
                procedureId: activeRun.procedureId,
                inputEpoch: activeRun.inputEpoch,
                lastReconciledInputEpoch: activeRun.lastReconciledInputEpoch,
                toolName: toolUse.name,
              })
              missingReasons.set(toolUse.id, 'hook_blocked')
              pendingHookFeedback.push('[PROCEDURE RUNTIME] New customer messages arrived after the last tool/action began. Before calling another tool or finalizing, call reconcile_procedure_input with the active runId and latest inputEpoch.')
              if (!assistantPushed && am) {
                this.messages.push(am)
                assistantPushed = true
              }
              return
            }

            toolBasedOnEpoch.set(toolUse.id, iterationBasedOnInputEpoch)
            recordProcedureToolCall(this.deps.caseId, {
              toolName: toolUse.name,
              toolUseId: toolUse.id,
              basedOnInputEpoch: iterationBasedOnInputEpoch,
              toolInput: toolUse.input,
            })

            // PreToolUse Hook checkpoint
            const preHookEval = await this.hookEngine.evaluate('PreToolUse', {
              ...this.buildHookContext('PreToolUse', {
                toolName: toolUse.name,
                toolInput: toolUse.input,
              }),
            }, buildHitCounts())

            if (preHookEval.summary === 'block') {
              // Record Hook hit for graduated response
              const blockingHooks: string[] = []
              for (const r of preHookEval.results) {
                if (r.action !== 'allow') {
                  this.chatMemory.recordHookHit(r.hookName)
                  if (r.action === 'block') blockingHooks.push(r.hookName)
                }
              }
              await this.traceWriter.write(
                'loop_decision',
                `Hook blocked Tool: ${toolUse.name}`,
                preHookEval as unknown as Record<string, unknown>,
              )
              sendEvent({
                type: 'hook_blocked',
                data: { toolName: toolUse.name, hookNames: blockingHooks },
                timestamp: new Date().toISOString(),
              })
              // S1: record missing reason — post-stream synthesis will build the tool_result.
              // The feedback message comes AFTER the tool_result, not instead of it.
              missingReasons.set(toolUse.id, 'hook_blocked')
              if (preHookEval.feedbackMessage) {
                pendingHookFeedback.push(preHookEval.feedbackMessage)
              }
              if (!assistantPushed && am) {
                this.messages.push(am)
                assistantPushed = true
              }
              return
            }

            // PreToolUse escalated with pendingToolCalls (for example: create_human_task).
            if (preHookEval.pendingToolCalls && preHookEval.pendingToolCalls.length > 0) {
              for (const r of preHookEval.results) {
                if (r.action !== 'allow') this.chatMemory.recordHookHit(r.hookName)
              }
              await this.traceWriter.write(
                'loop_decision',
                `Hook escalated Tool: ${toolUse.name}`,
                preHookEval as unknown as Record<string, unknown>,
              )
              sendEvent({
                type: 'hook_blocked',
                data: { toolName: toolUse.name, hookNames: preHookEval.results.filter(r => r.action === 'escalate').map(r => r.hookName) },
                timestamp: new Date().toISOString(),
              })
              missingReasons.set(toolUse.id, 'hook_escalated')
              if (preHookEval.feedbackMessage) {
                pendingHookFeedback.push(preHookEval.feedbackMessage)
              }
              if (!assistantPushed && am) {
                this.messages.push(am)
                assistantPushed = true
              }
              // Process the escalation
              await hookToolCalls(this.buildToolInterceptorContext(), preHookEval, sendEvent)
              return
            }

            // Enqueue — starts executing immediately.
            // text/thinking blocks that follow will stream to the
            // frontend concurrently while this tool runs.
            toolExecutor.enqueue(toolUse)
          },
        })

        assistantMessage = streamResult.assistantMessage
        fullText = streamResult.fullText
        stopReason = streamResult.stopReason
        usage = streamResult.usage

        if (stopReason) {
          await this.traceWriter.write(
            'stream_event',
            `stop_reason: ${stopReason}`,
            { stopReason, iteration: this.iterationCount },
          )
        }
      } catch (streamErr) {
        const errStr = String(streamErr)
        console.error('[AgentLoop] Stream error:', streamErr)

        if (this.abortController.signal.aborted) {
          // Connection lost — drain pending tools and exit without escalating.
          // The case stays at its current stage so the user can retry.
          await toolExecutor.waitForAll().catch(() => {})
          await this.traceWriter.write('loop_decision', 'Stream aborted (connection lost)', {
            iteration: this.iterationCount,
          })
          return {
            messages: this.messages,
            caseStatus: this.currentStage as CaseStatus,
            transition: 'connection_lost',
            currentStage: this.currentStage,
            reason: 'connection_lost',
          }
        }

        // Reactive compact on 413 during streaming
        if (errStr.includes('413') || errStr.includes('context_length_exceeded')) {
          this.messages = reactiveCompact(this.messages)
          await this.traceWriter.write('loop_decision', 'Reactive compact on stream error', { error: errStr })
          continue
        }

        // Non-connection error: record, let S1 synthesis run, then exit
        streamFatalError = errStr
      }

      streamEndedAt = Date.now()

      // Final usage per assistant completion (streaming APIs may emit usage on multiple deltas).
      if (usage && hasRecognizedTokenUsage(usage)) {
        const calledToolNames = [...blocks.values()].filter(b => b.type === 'tool_use').map(b => b.name)
        // Debug: full API response
        if (debugLogsEnabled) {
          writeDebugResponse(this.deps.caseId, this.iterationCount, this.deps.config.model, debugSeq, {
            stop_reason: stopReason,
            usage,
            text: fullText.slice(0, 100000),
          })
        }
        await this.traceWriter.writeLlmResponse(stopReason, usage, this.iterationCount, fullText, calledToolNames, this.deps.config.model)
        sendEvent({
          type: 'llm_response',
          data: { stopReason, usage, iteration: this.iterationCount, model: this.deps.config.model, textPreview: fullText.slice(0, 3000) },
          timestamp: new Date().toISOString(),
        })
        this.profiler.addTokens(readInputTokens(usage), readOutputTokens(usage))
      }

      // Stream complete — finalize the assistant message
      if (!assistantMessage) {
        throw new Error(`No assistant message received${streamFatalError ? `: ${streamFatalError}` : ''}`)
      }
      assistantMessage.content = fullText
      assistantMessage.isStreaming = false

      // ── Wait for all tools to finish ─────────────────────────
      let toolResults = await toolExecutor.waitForAll()
      const runtimeToolResolution = await new RuntimeManagedToolResolver({
        caseId: this.deps.caseId,
        orgId: this.deps.orgId,
        userId: this.deps.userId,
        chatId: this.deps.chatId,
        config: this.deps.config,
        caseSchema: this.deps.caseSchema,
        messages: this.messages,
        chatMemory: this.chatMemory,
        persistence: this.persistence,
        traceWriter: this.traceWriter,
        dryRun: this.dryRun,
        persistRuntimeMemory: this.deps.persistRuntimeMemory,
        canCreateHumanTaskInGeneralMode: !this.caseLoop,
      }).resolve(toolResults, toolBasedOnEpoch, iterationBasedOnInputEpoch)
      if (runtimeToolResolution.pendingHumanTaskEscalation) {
        this.pendingHumanTaskEscalation = runtimeToolResolution.pendingHumanTaskEscalation
      }
      for (const tr of toolResults) {
        this.profiler.addToolExecution(tr.latencyMs || 0)
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
          this.messages.push(makeUserMessage('[PROCEDURE RUNTIME] A customer-visible reply was withheld because newer input arrived before send. Call reconcile_procedure_input before any further tool use, finalization, or customer reply.'))
          await this.traceWriter.write('loop_decision', 'Stale ProcedureRun text reply withheld', {
            basedOnInputEpoch: iterationBasedOnInputEpoch,
            latestInputEpoch: latestInputEpoch(this.deps.caseId),
            runId: textReplyRuntime.run?.runId,
          })
          stopReason = null
          continue
        }
        if (textReplyRuntime.blockedReason) {
          discardVisibleText()
          assistantMessage.content = ''
          this.messages.push(makeUserMessage('[PROCEDURE RUNTIME] A customer-facing human-handoff promise was withheld because no persisted create_human_task evidence exists yet. Call create_human_task first or revise the reply so it does not claim that handoff is already arranged.'))
          await this.traceWriter.write('loop_decision', 'Unsafe human-handoff promise withheld', {
            basedOnInputEpoch: iterationBasedOnInputEpoch,
            latestInputEpoch: latestInputEpoch(this.deps.caseId),
            runId: textReplyRuntime.run?.runId,
            blockedReason: textReplyRuntime.blockedReason,
          })
          stopReason = null
          continue
        }

        const stopEval = await this.hookEngine.evaluate('Stop', {
          ...this.buildHookContext('Stop', {
            replyDraft: fullText,
          }),
        }, buildHitCounts())

        await this.traceWriter.write(
          'loop_decision',
          `Hook checkpoint Stop: ${stopEval.summary}`,
          stopEval as unknown as Record<string, unknown>,
        )

        if (stopEval.summary === 'warn' || stopEval.summary === 'allow') {
          for (const r of stopEval.results) {
            if (r.action === 'warn') this.chatMemory.recordHookHit(r.hookName)
          }
          flushVisibleText()
          if (stopEval.feedbackMessage && stopEval.summary === 'warn') {
            pendingHookFeedback.push(stopEval.feedbackMessage)
          }
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
                this.messages.push(makeUserMessage(stopAction.feedbackMessage))
              }
              stopReason = null
              continue
            }
            this.persistTurnMemory()
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
        const providerToolTurn = finalizeProviderToolTurn({
          assistantMessage,
          toolUseBlocks: [...blocks.values()],
          completedResults: toolResults.map((r) => ({
            toolUseId: r.toolUse?.id ?? r.name,
            output: r.output,
            isError: (r.output as { ok?: boolean })?.ok === false,
          })),
          missingReasons,
          pendingHookFeedback,
          createId: () => crypto.randomUUID(),
          createdAt: new Date(),
        })

        this.messages.push(...providerToolTurn.messagesToAppend)
        pendingHookFeedback.length = 0
        missingReasons.clear()

        // Dev-only invariant assertion
        if (invariantCheckEnabled) {
          try {
            assertProviderToolTurnInvariant(
              this.messages.filter((m) => 'role' in m) as Array<{ role: string; content: unknown; toolUses?: ToolUse[] }>,
            )
          } catch (err) {
            console.error('[Invariant]', (err as Error).message)
          }
        }
      }

      // ── Stream fatal error after S1 synthesis: exit gracefully ──
      if (streamFatalError) {
        await this.traceWriter.write('loop_decision', 'Fatal stream error after S1 synthesis', {
          error: streamFatalError, iteration: this.iterationCount,
        })
        sendEvent({ type: 'error', data: `Stream error: ${streamFatalError}`, timestamp: new Date().toISOString() })
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
        if (reconcileGateBlockedThisIteration && !fullText && this.nudgeCount < 3) {
          this.nudgeCount++
          const reconcileNudge = '[PROCEDURE RUNTIME] Your previous tool call was blocked because newer customer input arrived. ' +
            'You MUST call reconcile_procedure_input next with the active runId and latest inputEpoch before any other tool call, finalization, or customer-visible reply.'
          if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
          this.messages.push(makeUserMessage(reconcileNudge))
          await this.traceWriter.write('loop_decision', 'Procedure nudge: reconcile required after blocked tool', {
            stage: this.currentStage,
            nudgeCount: this.nudgeCount,
            iteration: this.iterationCount,
          })
          sendEvent({
            type: 'message_stop',
            data: { reason: 'procedure_reconcile_nudge', stage: this.currentStage },
            timestamp: new Date().toISOString(),
          })
          this.iterationCount--
          continue
        }

        // ── Procedure mode: guard against silent end_turn after tool results ──────
        // When the agent just received tool results (there ARE previous tool
        // messages) but produced empty text and no new tool calls, it silently
        // swallowed the findings. Nudge it to either tell the user or finalize.
        if (this.caseLoop?.isProcedureMode() && !fullText) {
          const lastFewMessages = this.messages.slice(-6)
          const hasPendingToolResults = lastFewMessages.some(
            (m) => isInternalProcedureUserMessage(m),
          )
          if (hasPendingToolResults && this.nudgeCount < 3) {
            this.nudgeCount++
            const procedureNudge = '[SYSTEM] You just received investigation results but produced no response. ' +
                'You MUST now either: (1) call finalize_procedure with a conclusion, (2) call create_human_task if escalation is needed, ' +
                'or (3) respond to the customer with findings and next steps. ' +
                'Do not produce empty turns — act on the data you just received.'
            if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
            this.messages.push(makeUserMessage(procedureNudge))
            await this.traceWriter.write('loop_decision', 'Procedure nudge: empty turn after tool results', {
              stage: this.currentStage, nudgeCount: this.nudgeCount, iteration: this.iterationCount,
            })
            sendEvent({
              type: 'message_stop',
              data: { reason: 'procedure_empty_turn_nudge', stage: this.currentStage },
              timestamp: new Date().toISOString(),
            })
            // Don't count the nudge against maxIterations — the model needs
            // one extra turn to correct its mistake (bounded by nudgeCount < 3).
            this.iterationCount--
            continue
          }
        }

        // No tools called — legitimate exit, model wants user input.
        await this.traceWriter.write('loop_decision', 'Exit: no tools called', {
          stopReason, iteration: this.iterationCount, textLength: fullText.length,
          stage: this.currentStage,
        })
        if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
        sendEvent({
          type: 'message_stop',
          data: { reason: 'no_tools', stopReason, usage } as any,
          timestamp: new Date().toISOString(),
        })
        return {
          messages: this.messages,
          // In consultation mode keep the case as waiting_human so the next request
          // re-enters consultation mode rather than reverting to an investigation stage.
          // Otherwise persist the current case status.
          caseStatus: (isConsultation ? 'waiting_human' : this.currentStage) as CaseStatus,
          transition: 'next_turn',
          currentStage: this.currentStage,
        }
      }

      // ── Apply tool results to Case Memory ────────────────────
      for (const result of toolResults) {
        const payload = unwrapToolExecutionPayload(result.output)
        if (shouldPersistToolResultToChatMemory(result.name)) {
          await this.chatMemory.applyToolResult(result.name, payload)
        }
        const basedOnInputEpoch = result.toolUse?.id ? toolBasedOnEpoch.get(result.toolUse.id) : undefined
        if (shouldRecordProcedureEvidence(result.name)) {
          const toolDefinition = this.toolRouter.getTool(result.name)
          recordProcedureToolResult(this.deps.caseId, {
            toolName: result.name,
            toolUseId: result.toolUse?.id,
            basedOnInputEpoch: basedOnInputEpoch ?? iterationBasedOnInputEpoch,
            toolOutput: payload,
            toolError: (result.output as { error?: string })?.error,
            isKnowledgeTool: !!toolDefinition?.knowledgeSourceId,
          })
        }
        await this.traceWriter.write(
          'tool_result',
          `Tool: ${result.name}`,
          { toolName: result.name, output: payload, latencyMs: result.latencyMs, iteration: this.iterationCount, input: result.toolUse?.input, renderHints: result.renderHints, basedOnInputEpoch: basedOnInputEpoch ?? iterationBasedOnInputEpoch },
        )
      }

      // ── PostToolUse Hook evaluation ──
      if (toolResults.length > 0) {
        // Tools were called — reset nudge count (LLM is complying)
        if (this.nudgeCount > 0) this.nudgeCount = 0
        try {
          for (const result of toolResults) {
            const payload = unwrapToolExecutionPayload(result.output)
            const postHookEval = await this.hookEngine.evaluate('PostToolUse', {
              ...this.buildHookContext('PostToolUse', {
                toolName: result.name,
                toolInput: result.toolUse?.input,
                toolOutput: payload,
                toolError: (result.output as { error?: string })?.error,
              }),
            }, buildHitCounts())

            for (const r of postHookEval.results) {
              if (r.action !== 'allow') {
                this.chatMemory.recordHookHit(r.hookName)
                await this.traceWriter.write(
                  'loop_decision',
                  `Hook ${r.action}: ${r.hookName}`,
                  {
                    checkpoint: 'PostToolUse',
                    result: r.action,
                    reason: r.reason,
                    toolName: result.name,
                    model: r.modelUsed,
                  },
                )
              }
            }

            // Inject Hook feedback into message stream
            if (postHookEval.feedbackMessage) {
              this.messages.push(makeUserMessage(postHookEval.feedbackMessage))
            }

            if (postHookEval.pendingToolCalls && postHookEval.pendingToolCalls.length > 0) {
              await hookToolCalls(this.buildToolInterceptorContext(), postHookEval, sendEvent)
            }

            if (!postHookEval.pendingToolCalls || postHookEval.pendingToolCalls.length === 0) {
              if (postHookEval.summary === 'escalate') {
                await hookToolCalls(this.buildToolInterceptorContext(), postHookEval, sendEvent)
              }
            }
          }
        } catch (hookErr) {
          console.error('[AgentLoop] PostToolUse Hook evaluation failed:', hookErr)
        }
      }

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
        this.persistTurnMemory()
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
          this.persistTurnMemory()
          return caseToolResult.result
        }
        if (caseToolResult.type === 'continue') continue
      }

      if (this.pendingHumanTaskEscalation) {
        const pending = this.pendingHumanTaskEscalation
        this.pendingHumanTaskEscalation = null
        const handoffResult = await this.humanTaskHandoffHandler.complete(pending, fullText, sendEvent)
        this.persistTurnMemory()
        return handoffResult
      }

      sendEvent({
        type: 'message_stop',
        data: { reason: 'next_turn', stage: this.currentStage },
        timestamp: new Date().toISOString(),
      })

      // Post-tool auto-escalation: human task was created during this iteration.
      // The LLM has had a chance to respond naturally — now exit to waiting_human.
      if (this.pendingEscalation) {
        this.persistTurnMemory()
        return {
          messages: this.messages,
          caseStatus: 'escalated',
          transition: 'waiting_human',
          currentStage: this.currentStage,
          reason: 'auto_escalated_by_hook',
        }
      }

      // End-turn exit: return cleanly from inside the loop body so we never
      // reach the "Max iterations" trace block below the while condition.
      if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
        this.persistTurnMemory()
        return {
          messages: this.messages,
          caseStatus: this.currentStage as CaseStatus,
          transition: 'next_turn',
          currentStage: this.currentStage,
          reason: stopReason ?? undefined,
        }
      }
    } while (
      this.iterationCount < this.deps.config.maxIterations &&
      stopReason !== 'end_turn' &&
      stopReason !== 'max_tokens'
    )

    // Max iterations reached
    await this.traceWriter.write('loop_decision', 'Exit: max iterations', {
      stopReason, iteration: this.iterationCount, messageCount: this.messages.length,
    })

    // Only escalate when the agent was repeatedly nudged and still failed.
    // If it just ran out of iterations (e.g. when a Procedure needs multiple
    // tool calls), preserve the current status so the
    // next HTTP request can continue from where it left off.
    const shouldEscalate = this.nudgeCount >= 3
    sendEvent({
      type: shouldEscalate ? 'escalated' : 'message_stop',
      data: shouldEscalate
        ? { reason: 'max_iterations', stage: this.currentStage }
        : { reason: 'max_iterations', stopReason, stage: this.currentStage },
      timestamp: new Date().toISOString(),
    })
        return {
      messages: this.messages,
      caseStatus: shouldEscalate ? 'escalated' : (this.currentStage as CaseStatus),
      transition: shouldEscalate ? 'error' : 'next_turn',
      currentStage: this.currentStage,
      reason: 'max_iterations',
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildHookContext(
    checkpoint: HookCheckpoint,
    options: {
      toolName?: string
      toolInput?: unknown
      toolOutput?: unknown
      toolError?: string
      replyDraft?: string
      procedureStepIds?: string[]
    } = {},
  ): HookContext {
    const activeProcedureRun = getActiveProcedureRun(this.deps.caseId)
    const procedureStepIds = options.procedureStepIds ??
      (activeProcedureRun?.currentStepId ? [activeProcedureRun.currentStepId] : [])

    return {
      checkpoint,
      agentConfigId: this.deps.configId,
      caseId: this.deps.caseId,
      chatId: this.deps.chatId ?? undefined,
      caseType: this.deps.caseSchema
        ? {
            type: this.deps.caseSchema.type,
            displayName: this.deps.caseSchema.displayName,
          }
        : undefined,
      procedureStepIds,
      tool: options.toolName
        ? {
            name: options.toolName,
            input: options.toolInput,
            output: options.toolOutput,
            error: options.toolError,
          }
        : undefined,
      caseFacts: this.chatMemory.getContextMap(),
      missingFacts: this.chatMemory.getMissingFacts(),
      previousToolCalls: this.chatMemory.getToolsCalled().map((name) => ({
        name,
        output: this.chatMemory.getToolResult(name),
      })),
      traceSummary: this.chatMemory.getKeyEvents().slice(-10).map((event) => ({
        at: event.at,
        text: event.text,
        source: event.source,
      })),
      replyDraft: options.replyDraft,
      metadata: {
        currentStage: this.currentStage,
        iteration: this.iterationCount,
        procedureRun: activeProcedureRun
          ? {
              runId: activeProcedureRun.runId,
              procedureId: activeProcedureRun.procedureId,
              status: activeProcedureRun.status,
              currentStepId: activeProcedureRun.currentStepId,
              inputEpoch: activeProcedureRun.inputEpoch,
              lastReconciledInputEpoch: activeProcedureRun.lastReconciledInputEpoch,
              needsReconcile: activeProcedureRun.needsReconcile,
            }
          : undefined,
      },
    }
  }

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

  private async writeProviderTranscriptHealth(metrics: TranscriptHealthMetrics): Promise<void> {
    await this.traceWriter.write('provider_transcript_health', 'Provider transcript invariant check', {
      providerTranscriptPersisted: false,
      providerTranscriptPresent: metrics.providerTranscriptPersisted,
      toolPairsChecked: metrics.toolPairsChecked,
      toolPairsRepaired: metrics.toolPairsRepaired,
      orphanToolResultsDropped: metrics.orphanToolResultsDropped,
      legacyRowsSkipped: metrics.legacyRowsSkipped,
      compactPairsSummarized: metrics.compactPairsSummarized,
    })

    for (const detail of metrics.details) {
      const title =
        detail.event === 'synthetic_repair' ? 'Provider transcript synthetic repair' :
        detail.event === 'orphan_drop' || detail.event === 'duplicate_drop' ? 'Provider transcript orphan result dropped' :
        detail.event === 'legacy_skip' ? 'Provider transcript legacy row skipped' :
        'Provider transcript compact pair summarized'
      const actionType =
        detail.event === 'synthetic_repair' ? 'provider_transcript_repair' :
        detail.event === 'orphan_drop' || detail.event === 'duplicate_drop' ? 'provider_transcript_orphan_drop' :
        detail.event === 'legacy_skip' ? 'provider_transcript_legacy_skip' :
        'provider_transcript_compact_summary'
      await this.traceWriter.write(actionType, title, detail as unknown as Record<string, unknown>)
    }
  }

  // -----------------------------------------------------------------------
  getCaseType(): string {
    return this.deps.caseSchema?.type || 'general'
  }

  private persistTurnMemory(): void {
    this.memoryLifecycle.compactUserProfile().catch(() => {})
    this.memoryLifecycle.persistChatSession().catch(() => {})
  }

  private async checkAndCompact(): Promise<{ shouldCompact: boolean; reason?: string }> {
    return this.memoryLifecycle.checkAndCompact()
  }

  private async persistChatSession(): Promise<void> {
    return this.memoryLifecycle.persistChatSession()
  }

  private async compactUserProfile(): Promise<void> {
    return this.memoryLifecycle.compactUserProfile()
  }

  private shouldPersistRuntimeMemory(): boolean {
    return this.memoryLifecycle.shouldPersistRuntimeMemory()
  }

  private async persistChatMemory(): Promise<void> {
    return this.memoryLifecycle.persistChatMemory()
  }

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
