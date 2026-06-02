// Intera Harness - Agent Loop (核心引擎)
// Based on Claude Code's query.ts + StreamingToolExecutor pattern
//
// Streaming tool execution: tools begin executing as soon as their
// input_json is complete (content_block_stop), while text/thinking
// continues streaming to the frontend. This is the key difference
// from naive "wait for full response then execute" approaches.

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import { createAgentClient } from './api/provider-config'
import type { Message, AssistantMessage, ToolUse, SSEEvent, CaseSchemaConfig, AgentContext, ToolResult, SkillDefinition } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { StreamingToolExecutor, unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import { ChatMemoryManager, ChatSessionManager } from './memory'
import { PolicyEngine } from './policy'
import { SkillRouter, SOP_INTERNAL_SKILLS } from './skills'
import { TraceWriter } from './trace'
import { CaseAgentLoop, type CaseLoopServices } from './case-agent-loop'
import { ConversationLoop } from './conversation-loop'
import { OrchestratorAgent } from './orchestrator'
import { generateCaseId } from '@/lib/utils'
import { microCompact } from './microCompact'
import { synthesizeMissingToolResults, assertToolResultInvariant } from './tool-result-invariant'
import { classifyError } from './api/error-classifier'
import { withRetry, CannotRetryError, FallbackTriggeredError } from './api/with-retry'
import { trySessionMemoryCompact } from './sessionMemoryCompact'
import { compactConversation, reactiveCompact } from './compact'
import { Profiler } from './profiler'
import type { ExecutionStrategy } from './strategies/types'
import { writeDebugRequest, writeDebugResponse, writeDebugTranscript } from './debug-logger'
import { isInvestigableCaseType } from './case-type-slugs'
import type { AgentConfigData, CaseStatus } from '@intera/shared/types'
import { consumeStream, type StreamContentBlock, type StreamConsumeCallbacks } from './stream-handler'
import { profileKey } from './identity'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { recomputeProfileStats } from '@intera/shared/memory/recomputeStats'

// ---------------------------------------------------------------------------
// StreamingTextSanitizer
// Strips <think>…</think>, orphan </think>, and "Tool X result: …" leakage
// from the streaming text before it reaches the client.  The 60-char hold-back
// ensures patterns that straddle chunk boundaries are caught correctly.
// ---------------------------------------------------------------------------

export class StreamingTextSanitizer {
  private static readonly HOLD_BACK = 60
  private buf = ''
  private inThink = false
  private inToolResult = false

  feed(chunk: string): string {
    this.buf += chunk
    return this.drain()
  }

  flush(): string {
    if (this.inThink || this.inToolResult) {
      this.buf = ''
      return ''
    }
    const out = this.buf
    this.buf = ''
    return out
  }

  private drain(): string {
    let out = ''
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.inThink) {
        const end = this.buf.indexOf('</think>')
        if (end === -1) break
        this.buf = this.buf.slice(end + 8).replace(/^\s+/, '')
        this.inThink = false
        continue
      }
      if (this.inToolResult) {
        const blank = this.buf.indexOf('\n\n')
        if (blank === -1) break
        this.buf = this.buf.slice(blank + 2)
        this.inToolResult = false
        continue
      }

      let earliest = -1
      let kind: 'think' | 'orphan' | 'tool' | null = null
      const tryIdx = (idx: number, k: typeof kind) => {
        if (idx !== -1 && (earliest === -1 || idx < earliest)) {
          earliest = idx
          kind = k
        }
      }
      tryIdx(this.buf.indexOf('<think>'), 'think')
      tryIdx(this.buf.indexOf('</think>'), 'orphan')
      const toolM = this.buf.match(/Tool \w+ result: /)
      tryIdx(toolM ? this.buf.indexOf(toolM[0]) : -1, 'tool')

      if (earliest === -1) {
        const safe = Math.max(0, this.buf.length - StreamingTextSanitizer.HOLD_BACK)
        out += this.buf.slice(0, safe)
        this.buf = this.buf.slice(safe)
        break
      }

      if (kind === 'think') {
        out += this.buf.slice(0, earliest)
        this.buf = this.buf.slice(earliest + '<think>'.length)
        this.inThink = true
      } else if (kind === 'orphan') {
        out += this.buf.slice(0, earliest)
        this.buf = this.buf.slice(earliest + '</think>'.length).replace(/^\s+/, '')
      } else if (kind === 'tool') {
        out += this.buf.slice(0, earliest)
        this.buf = this.buf.slice(earliest + toolM![0].length)
        this.inToolResult = true
      }
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AgentLoopDeps {
  config: AgentConfigData
  caseId: string
  orgId: string
  userId: string
  /** Case-execution prompt (used when case is active). Resolved from CASE_SYSTEM_PROMPT or DB custom prompt. */
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
}

export interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'waiting_form' | 'error' | 'consultation_complete' | 'stage_continue' | 'connection_lost' | 'machine_error'
  currentStage?: string
  reason?: string
  pendingSubAgents?: string[]
}

// ---------------------------------------------------------------------------
// AgentLoop
// ---------------------------------------------------------------------------

export class AgentLoop {
  private messages: Message[] = []
  private chatMemory: ChatMemoryManager
  private policyEngine!: PolicyEngine
  private skillRouter: SkillRouter
  /** Case-specific execution engine — null in Core (discovery) mode. */
  private caseLoop: CaseAgentLoop | null = null
  /** Core (discovery) mode handler — prompt + tool filtering. */
  private conversationLoop: ConversationLoop
  private traceWriter: TraceWriter
  private profiler: Profiler = new Profiler()
  private iterationCount = 0
  private nudgeCount = 0
  private pendingEscalation = false
  private abortController: AbortController
  private aborted = false
  private anthropicClient: Anthropic
  private persistence: import('./persistence-port').PersistencePort
  private dryRun: boolean

  /** Current workflow stage — delegates to caseLoop when active. */
  private get currentStage(): string {
    return this.caseLoop?.currentStage ?? 'created'
  }

  constructor(private deps: AgentLoopDeps) {
    this.chatMemory = new ChatMemoryManager(deps.caseId, deps.config.memoryStrategy)
    this.skillRouter = new SkillRouter(deps.orgId)
    this.traceWriter = new TraceWriter(deps.caseId, deps.dryRun ?? false)
    if (deps.chatId) this.traceWriter.setChatId(deps.chatId)
    this.abortController = new AbortController()
    this.anthropicClient = createAgentClient(deps.config.model)
    // Persistence port — defaults to Prisma if not injected (playground injects memory port)
    this.persistence = deps.persistence || (() => { const { createPrismaPersistence } = require('./persistence-port'); return createPrismaPersistence() })()
    this.dryRun = deps.dryRun ?? false

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
      userId: this.deps.userId,
      chatId: this.deps.chatId,
      config: this.deps.config,
      chatMemory: this.chatMemory,
      getPolicyEngine: () => this.policyEngine,
      traceWriter: this.traceWriter,
      skillRouter: this.skillRouter,
      getMessages: () => this.messages,
      addMessage: (msg) => this.messages.push(msg),
      makeUserMessage: (content) => this.makeUserMessage(content),
      writeProfilerSnapshot: () => this.writeProfilerSnapshot(),
    }
  }

  /** Create and initialize an AgentLoop — loads skills/policies from DB. */
  static async create(deps: AgentLoopDeps): Promise<AgentLoop> {
    const loop = new AgentLoop(deps)
    loop.skillRouter = await SkillRouter.create(deps.orgId, deps.dryRun ?? false)
    loop.policyEngine = await PolicyEngine.create(deps.orgId, deps.config.policyHooks)
    return loop
  }

  // -----------------------------------------------------------------------
  // Dedicated Agent Dispatch on case creation
  // -----------------------------------------------------------------------

  /** Dispatch sub-agents for the current stage (non-blocking, runs alongside ReAct loop). */
  /** Delegate dedicated-agent startup to CaseAgentLoop (case mode only). */
  private async startDedicatedAgents(sendEvent: (event: SSEEvent) => void): Promise<void> {
    await this.caseLoop?.startDedicatedAgents(sendEvent)
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  async run(
    userMessage: string,
    rawSendEvent: (event: SSEEvent) => void,
    preIngestedFacts?: Record<string, string>,
    contentBlocks?: import('@intera/shared/types').ContentBlock[],
  ): Promise<LoopResult> {
    // One-time log on first run
    if (this.deps.config.debugMode) {
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
    const userMsg = this.makeUserMessage(userMessage, contentBlocks)
    this.messages.push(userMsg)
    await this.traceWriter.write('user_message', 'User sent message', userMessage)
    await this.traceWriter.writeAgentTreeNode(agentName, 0, chainId, 'run start')

    // 2. Ingest facts into Case Memory (LLM-based extraction)
    const requiredFacts = this.deps.caseSchema?.requiredFacts
    await this.chatMemory.ingestUserMessageFacts(userMessage, requiredFacts)

    // Re-apply structured form answers so they always beat LLM-extracted facts.
    // LLM extraction may miss fields or overwrite structured data with guesses
    // (e.g. date: "yesterday" instead of date: "昨天上午10点").
    if (preIngestedFacts) {
      this.chatMemory.ingestFormAnswers(preIngestedFacts)
    }

    sendEvent({
      type: 'memory_update',
      data: this.chatMemory.getSummary(),
      timestamp: new Date().toISOString(),
    })

    // 2.5 [DEPRECATED] Per-stage sub-agent dispatch removed.
    // Case agents now run via dispatch_case_agent → Orchestrator background dispatch.
    // Kept as no-op for backward compat with stream route.

    // 3. ReAct loop
    let stopReason: string | null = null
    let usage: Record<string, unknown> | null = null
    // S1 tool-result invariant: track why each tool_use didn't produce a real result
    const missingReasons = new Map<string, import('./tool-result-invariant').SynthesisReason>()
    const pendingPolicyFeedback: string[] = []
    const invariantCheckEnabled = this.deps.config.invariantCheck === true || (typeof process !== 'undefined' && process.env.INTERA_INVARIANT_CHECK === '1')

    while (this.iterationCount < this.deps.config.maxIterations) {
      this.iterationCount++
      this.profiler.incrementIteration()

      // ── Consume queued messages from concurrent requests ──────
      try {
        const { hasSession, getOrCreateSession } = await import('./session-store')
        if (this.deps.caseId && hasSession(this.deps.caseId)) {
          const session = getOrCreateSession(this.deps.caseId)
          let pending
          while ((pending = session.queue.dequeueNonBlocking())) {
            if (pending.content === '__SESSION_CLOSED__') continue
            const hasImages = pending.contentBlocks?.some((b: any) => b.type === 'image')
            this.messages.push({
              id: crypto.randomUUID(),
              role: 'user' as const,
              content: hasImages ? pending.content : `[SYSTEM] The customer sent an additional message while you were working. Process it and respond to the customer with your findings: ${pending.content}`,
              contentBlocks: pending.contentBlocks,
              createdAt: new Date(),
            })
            this.chatMemory.bumpDashboardVersion()
            sendEvent({
              type: 'withheld',
              data: 'Processing additional user input...',
              timestamp: new Date().toISOString(),
            })
          }
        }
      } catch { /* session-store unavailable (e.g. build-time), skip */ }

      // ── Graduated policy escalation check ─────────────────────
      // If any policy has been violated 3+ times in this session, escalate.
      const buildHitCounts = (): Map<string, number> => {
        const m = new Map<string, number>()
        for (const name of this.policyEngine.getPolicyNames()) {
          const c = this.chatMemory.getPolicyHitCount(name)
          if (c > 0) m.set(name, c)
        }
        return m
      }
      {
        const hitCounts = buildHitCounts()
        let maxPolicyHits = 0
        for (const count of hitCounts.values()) {
          if (count > maxPolicyHits) maxPolicyHits = count
        }
        if (maxPolicyHits >= 3) {
          await this.traceWriter.write('loop_decision', 'Exit: max policy violations', {
            policyEscalation: true,
            maxPolicyHits,
            iteration: this.iterationCount,
          })
          sendEvent({
            type: 'error',
            data: `Agent repeatedly violated policies (${maxPolicyHits} hits) — needs human intervention`,
            timestamp: new Date().toISOString(),
          })
          await this.writeProfilerSnapshot()
          return {
            messages: this.messages,
            caseStatus: 'escalated',
            transition: 'error',
            currentStage: this.currentStage,
            reason: 'max_policy_violations',
          }
        }
      }

      // ── isCaseActive for this iteration ─────────────────────────────────
      const isCaseActive = this.caseLoop?.isStageActive() ?? false
      // Consultation mode: human operator is reviewing the case via the same chat UI.
      // Restrict the agent to pure conversation + finalize_consultation only.
      const isConsultation = this.chatMemory.getSummary().caseStatus === 'waiting_human'

      // Emit core_agent_progress and merge background sub-agent results (case mode only).
      if (isCaseActive) {
        this.caseLoop!.emitProgressEvent(this.iterationCount, sendEvent)
        if (this.caseLoop!.mergeNewSubAgentResults()) {
          sendEvent({
            type: 'memory_update',
            data: this.chatMemory.getSummary(),
            timestamp: new Date().toISOString(),
          })
        }
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

      // Per-iteration streaming sanitizer — strips <think>/Tool-result leakage
      // from text_delta events before they reach the client.
      const textSanitizer = new StreamingTextSanitizer()

      // ── StreamingToolExecutor is created BEFORE the stream so tools
      //    can be enqueued incrementally as each tool_use block completes.
      // NOTE: SOP-internal tools (todo_write / todo_read) and dispatch_case_agent are
      // excluded from live skill_result emission — their executor output is just
      // the empty mock fixture. The real results are emitted manually further
      // down (todo list via processTodoTools, caseId via case_created event).
      const sopInternalNames = new Set(SOP_INTERNAL_SKILLS.map((s) => s.name))
      sopInternalNames.add('dispatch_case_agent')
      const toolExecutor = new StreamingToolExecutor(
        this.skillRouter.getToolDefinitions(),
        (toolUse, status, renderHints) => {
          if (sopInternalNames.has(toolUse.name)) return
          const skillDef = this.skillRouter.getSkill(toolUse.name)
          sendEvent({
            type: status === 'executing' ? 'tool_executing' : 'skill_result',
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
      )

      // ── Phase 1: Dual-mode prompt + tool selection ──────────────────────────
      // Core mode  → no active case: conversational discovery.
      // Case/Stage → case past "created": stage-driven execution, tools filtered.
      // Case/SOP   → SOP-driven: todo tools + full skill set, prompt includes SOP doc + todos.
      const allTools = this.skillRouter.getTools()
      let stagePrompt: string
      let stageTools: Tool[]

      if (!isCaseActive) {
        stagePrompt = this.conversationLoop.buildPrompt()
        stageTools = this.conversationLoop.filterTools(allTools)
      } else if (isConsultation) {
        // Customer sent a message while the case is under human specialist review.
        // Acknowledge briefly — no investigation tools allowed.
        stagePrompt = [
          `[INTERA MODE: WAITING_HUMAN | type: ${this.deps.caseSchema?.type || 'unknown'} | stage: ${this.currentStage}]`,
          'This case is currently under review by a human specialist. A human task has been created.',
          '',
          'Your ONLY job: acknowledge the customer\'s message warmly, confirm their case is being reviewed,',
          'and ask them to wait. Do NOT call any tools. Do NOT run any investigation.',
          'Do NOT make promises about outcomes. Keep the response brief (1-2 sentences).',
          '',
          this.deps.systemPrompt,
        ].join('\n')
        stageTools = []  // No tools — pure text acknowledgement only
      } else if (this.deps.caseSchema?.executionMode === 'cc') {
        stagePrompt = this.caseLoop!.buildSopPrompt(
          this.deps.systemPrompt,
          this.chatMemory.getTodos(),
          this.chatMemory.getConfirmedFacts(),
        )
        stageTools = this.caseLoop!.filterSopTools(allTools)
      } else {
        stagePrompt = this.caseLoop!.buildPrompt(this.deps.systemPrompt)
        stageTools = this.caseLoop!.filterTools(allTools, this.nudgeCount)
      }

      const blocks = new Map<number, StreamContentBlock>()
      let assistantMessage: AssistantMessage | null = null
      let assistantPushed = false
      let fullText = ''
      // Reset per-iteration
      stopReason = null
      usage = null

      const iterationStartTime = Date.now()
      let streamEndedAt = iterationStartTime
      let streamFatalError: string | null = null

      if (this.abortController.signal.aborted) break

      const apiMessages = this.buildApiMessages()

      if (this.deps.config.debugMode) {
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
              ...(this.deps.config.showThinking ? {
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
        // Only intentional handoffs (policy escalation, max_nudges) should escalate.
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
          await this.writeProfilerSnapshot()
          return { messages: this.messages, caseStatus: this.currentStage as CaseStatus, transition: 'connection_lost', currentStage: this.currentStage, reason: 'connection_lost' }
        }
        const classified = err instanceof CannotRetryError ? err.errorClass : classifyError(err)
        sendEvent({ type: 'error', data: `LLM API error (${classified})`, timestamp: new Date().toISOString() })
        return { messages: this.messages, transition: 'machine_error' as const, caseStatus: this.currentStage as CaseStatus, reason: `llm_error:${classified}` }
      }

      // Debug: full API request
      let debugSeq = -1
      if (this.deps.config.debugMode) {
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
        this.buildApiMessages(),
      )

      try {
        const streamResult = await consumeStream(stream, blocks, {
          sendEvent,
          sanitizeChunk: (text: string) => textSanitizer.feed(text),
          flushSanitizer: () => textSanitizer.flush(),
          recordFirstToken: () => this.profiler.recordFirstToken(),
          showThinking: this.deps.config.showThinking,
          onToolUseCompleted: async (toolUse: ToolUse, am: AssistantMessage | null) => {
            // PreTool policy check
            const preToolEval = await this.policyEngine.evaluate('preTool', {
              skillName: toolUse.name,
              skillInput: toolUse.input,
              confirmedFacts: this.chatMemory.getConfirmedFacts(),
              skillsCalled: this.chatMemory.getSkillsCalled(),
              skillResults: this.chatMemory.getSummary().skillResults as Record<string, unknown>,
            }, buildHitCounts())

            if (preToolEval.summary === 'blocked') {
              // Record policy hit for graduated response
              const blockingPolicies: string[] = []
              for (const r of preToolEval.results) {
                if (r.result !== 'pass') {
                  this.chatMemory.recordPolicyHit(r.policyName)
                  if (r.result === 'blocked') blockingPolicies.push(r.policyName)
                }
              }
              await this.traceWriter.write(
                'policy_hit',
                `Blocked: ${toolUse.name}`,
                preToolEval as unknown as Record<string, unknown>,
              )
              sendEvent({
                type: 'policy_blocked',
                data: { toolName: toolUse.name, policyNames: blockingPolicies },
                timestamp: new Date().toISOString(),
              })
              // S1: record missing reason — post-stream synthesis will build the tool_result.
              // The feedback message comes AFTER the tool_result, not instead of it.
              missingReasons.set(toolUse.id, 'policy_blocked')
              if (preToolEval.feedbackMessage) {
                pendingPolicyFeedback.push(preToolEval.feedbackMessage)
              }
              if (!assistantPushed && am) {
                this.messages.push(am)
                assistantPushed = true
              }
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
          await this.writeProfilerSnapshot()
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
      if (
        usage &&
        ((usage.input_tokens as number | undefined) != null ||
          (usage.output_tokens as number | undefined) != null ||
          (usage.inputTokens as number | undefined) != null ||
          (usage.outputTokens as number | undefined) != null)
      ) {
        const calledToolNames = [...blocks.values()].filter(b => b.type === 'tool_use').map(b => b.name)
        // Debug: full API response
        if (this.deps.config.debugMode) {
          writeDebugResponse(this.deps.caseId, this.iterationCount, this.deps.config.model, debugSeq, {
            stop_reason: stopReason,
            usage,
            text: fullText.slice(0, 100000),
          })
        }
        await this.traceWriter.writeLlmResponse(stopReason, usage, this.iterationCount, fullText, calledToolNames, this.deps.config.model)
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
      let toolResults = await toolExecutor.waitForAll()
      for (const tr of toolResults) {
        this.profiler.addToolExecution(tr.latencyMs || 0)
      }

      // ── S1: Post-stream synthesis — guarantee one tool_result per tool_use ──
      if (assistantPushed && assistantMessage) {
        const toolUseBlocks = blocks
          ? [...(blocks as unknown as Map<unknown, { type: string; id: string; name: string }>).values()]
            .filter((b) => b.type === 'tool_use')
          : []
        const trimmedToolUseIds = new Set(toolResults.map((r) => r.name))

        // For any tool_use_id without a completed result AND without a missingReasons
        // entry, record 'stream_aborted' (defensive default)
        for (const tuBlock of toolUseBlocks) {
          const id = (tuBlock as { id: string }).id
          if (!trimmedToolUseIds.has(id) && !missingReasons.has(id)) {
            // Check if we can find a matching tool_use in the assistant
            const found = (assistantMessage as { toolUses?: Array<{ id: string }> }).toolUses?.find((t) => t.id === id)
            if (found && !missingReasons.has(id)) {
              missingReasons.set(id, 'stream_aborted')
            }
          }
        }

        // Synthesize results for any missing tool_use blocks
        if (missingReasons.size > 0) {
          const toolUses = (assistantMessage as { toolUses?: ToolUse[] }).toolUses ?? []
          if (toolUses.length > 0) {
            const synthesisBlocks = synthesizeMissingToolResults({
              toolUses,
              completedResults: toolResults.map((r) => ({
                toolUseId: r.toolUse?.id ?? r.name,
                output: r.output,
                isError: (r.output as { ok?: boolean })?.ok === false,
              })),
              missingReasons,
            })

            // Push a user message with synthetic tool_results
            // (content is structured blocks — Anthropic API format, not plain text)
            this.messages.push({
              id: crypto.randomUUID(),
              role: 'user' as const,
              content: synthesisBlocks.map((b) => ({
                type: 'tool_result' as const,
                tool_use_id: b.tool_use_id,
                content: b.content,
                is_error: b.is_error,
              })) as unknown as string,
              createdAt: new Date(),
            })
          }
        }

        // Now push pending policy feedback AFTER the tool_result message
        for (const feedback of pendingPolicyFeedback) {
          this.messages.push(this.makeUserMessage(feedback))
        }
        pendingPolicyFeedback.length = 0
        missingReasons.clear()

        // Dev-only invariant assertion
        if (invariantCheckEnabled) {
          try {
            assertToolResultInvariant(
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
        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          caseStatus: 'escalated',
          transition: 'error',
          currentStage: this.currentStage,
          reason: 'stream_error',
        }
      }

      // ── Step-mode todo interception (pure in-memory, no side effects) ─────
      // todo_write and todo_read bypass the skill executor — their mock outputs
      // are replaced here with real in-memory operations on CaseMemory.
      if (this.deps.caseSchema?.executionMode === 'cc') {
        toolResults = this.processTodoTools(toolResults)

        // Auto-complete todo items whose corresponding investigation tools succeeded.
        // This handles models that forget to call todo_write(complete) after tool results.
        const succeededTools = new Set(
          toolResults
            .filter((r) => !sopInternalNames.has(r.name) && (r.output as any)?.ok !== false)
            .map((r) => r.name),
        )
        if (succeededTools.size > 0) {
          const pendingTodos = this.chatMemory.getTodos().filter((t) => t.status === 'pending')
          for (const todo of pendingTodos) {
            for (const toolName of succeededTools) {
              if (todo.text.includes(toolName)) {
                this.chatMemory.applyTodoAction({
                  action: 'complete',
                  id: todo.id,
                  notes: `${toolName} completed successfully`,
                })
                break
              }
            }
          }
        }

        // Manually fan out skill_result events for SOP-internal tools using
        // the REAL post-intercept output. The live executor callback
        // suppressed them above because at that point the result was just
        // the empty mock fixture. Emitting here ensures the inline todo
        // dashboard in the UI sees the actual todo list.
        for (const tr of toolResults) {
          if (!sopInternalNames.has(tr.name)) continue
          const skillDef = this.skillRouter.getSkill(tr.name)
          // Emit a synthetic "executing" first so the UI's tool-call tracking
          // stays in sync (matches the pair pattern from non-SOP tools).
          sendEvent({
            type: 'tool_executing',
            data: { name: tr.name, status: 'executing', displayVerb: skillDef?.displayVerb },
            timestamp: new Date().toISOString(),
          })
          sendEvent({
            type: 'skill_result',
            data: { name: tr.name, status: 'completed', result: tr.output },
            timestamp: new Date().toISOString(),
          })
        }

        // ── Intercept dispatch_subagent (CC mode sub-agent dispatch) ──
        toolResults = await this.processDispatchSubagent(toolResults, sendEvent)
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
        // No tools called — delegate stage evaluation to CaseAgentLoop.
        // Must NOT gate on isCaseActive: the 'created' → stage-1 bootstrap
        // transition fires here while isCaseActive is still false.
        if (!isConsultation && this.caseLoop?.hasStageConfigs()) {
          const transitionEval = await this.caseLoop.evaluateStageTransitionAfterNoTools(this.iterationCount)

          const nudgeBox = { value: this.nudgeCount }
          const advanced = await this.caseLoop.applyStageTransitionFromEval(transitionEval, nudgeBox, sendEvent)
          this.nudgeCount = nudgeBox.value
          if (advanced) {
            if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
            sendEvent({
              type: 'message_stop',
              data: { reason: 'stage_transition', stage: this.currentStage },
              timestamp: new Date().toISOString(),
            })
            continue
          }

          const stageResult = this.caseLoop.evaluateStageAfterNoTools(this.iterationCount, this.nudgeCount)
          if (stageResult.needsNudge) {
            this.nudgeCount++
            if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
            this.messages.push(this.makeUserMessage(stageResult.nudgeMessage))

            await this.traceWriter.write('loop_decision', 'Nudge: stage incomplete', {
              stage: this.currentStage,
              nudgeCount: this.nudgeCount,
              missingSkills: stageResult.missingSkills,
              missingEvidence: stageResult.missingEvidence,
              iteration: this.iterationCount,
            })

            if (this.nudgeCount >= 3) {
              await this.traceWriter.write('loop_decision', 'Exit: max nudges', {
                stage: this.currentStage, nudgeCount: this.nudgeCount,
              })

              try {
                const resolvedCaseType = this.deps.caseSchema?.type || 'general'
                await this.persistence.ensureCase({
                  id: this.deps.caseId,
                  orgId: this.deps.orgId,
                  userId: this.deps.userId,
                  type: resolvedCaseType,
                  status: 'escalated',
                  blocker: `Agent stuck in stage "${this.currentStage}"`,
                  chatId: this.deps.chatId ?? this.deps.caseId,
                })
                await this.persistence.createHumanTask({
                  caseId: this.deps.caseId,
                  queue: this.deps.caseSchema?.escalateOn?.[0] || 'general',
                  question: `Agent stuck in stage "${this.currentStage}" after 3 nudges. Case type: ${resolvedCaseType}. Skills called: ${this.chatMemory.getSkillsCalled().join(', ')}.`,
                  status: 'pending',
                })
              } catch (err) {
                console.error('[AgentLoop] Failed to auto-create human task:', err)
              }

              // Notify the customer before exiting — a silent escalation is confusing.
              sendEvent({
                type: 'text_delta',
                data: '非常抱歉，您的问题需要由人工专员协助处理。我们已为您创建工单，专员将尽快与您联系，感谢您的耐心等待。',
                timestamp: new Date().toISOString(),
              })
              sendEvent({
                type: 'message_stop',
                data: { reason: 'escalating', stage: this.currentStage },
                timestamp: new Date().toISOString(),
              })
              sendEvent({
                type: 'escalated',
                data: { stage: this.currentStage, reason: 'max_nudges' },
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

        // ── Step mode: guard against silent end_turn after tool results ──────
        // When the agent just received tool results (there ARE previous tool
        // messages) but produced empty text and no new tool calls, it silently
        // swallowed the findings. Nudge it to either tell the user or finalize.
        if (this.deps.caseSchema?.executionMode === 'cc' && !fullText) {
          const lastFewMessages = this.messages.slice(-6)
          const hasPendingToolResults = lastFewMessages.some(
            (m) => m.role === 'assistant' && typeof m.content === 'string' &&
                   m.content.startsWith('Tool ') && !m.content.includes('todo_read'),
          )
          // Also trigger if the model just received failed todo_write results
          // (defensive inference errors) and produced no response.
          const hasFailedTodoWrite = lastFewMessages.some(
            (m) => m.role === 'assistant' && typeof m.content === 'string' &&
                   m.content.includes('Tool todo_write') && m.content.includes('"ok":false'),
          )
          if ((hasPendingToolResults || hasFailedTodoWrite) && this.nudgeCount < 3) {
            this.nudgeCount++
            const sopNudge = hasFailedTodoWrite
              ? '[SYSTEM] Your todo_write calls failed because they were missing required parameters. ' +
                'Call todo_write with action="add" and text="<step description>" for each SOP step. ' +
                'Example: todo_write({ "action": "add", "text": "Check account status" })'
              : '[SYSTEM] You just received investigation results but produced no response. ' +
                'You MUST now either: (1) call finalize_case with a conclusion, (2) call create_human_task if escalation is needed, ' +
                'or (3) respond to the customer with findings and next steps. ' +
                'Do not produce empty turns — act on the data you just received.'
            if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
            this.messages.push(this.makeUserMessage(sopNudge))
            await this.traceWriter.write('loop_decision', 'SOP nudge: empty turn after tool results', {
              stage: this.currentStage, nudgeCount: this.nudgeCount, iteration: this.iterationCount,
            })
            sendEvent({
              type: 'message_stop',
              data: { reason: 'sop_empty_turn_nudge', stage: this.currentStage },
              timestamp: new Date().toISOString(),
            })
            // Don't count the nudge against maxIterations — the model needs
            // one extra turn to correct its mistake (bounded by nudgeCount < 3).
            this.iterationCount--
            continue
          }
        }

        // Stage goals met (or no stage config) — legitimate exit, model wants user input
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
        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          // In consultation mode keep the case as waiting_human so the next request
          // re-enters consultation mode rather than reverting to an investigation stage.
          // Otherwise persist the actual workflow stage.
          caseStatus: (isConsultation ? 'waiting_human' : this.currentStage) as CaseStatus,
          transition: 'next_turn',
          currentStage: this.currentStage,
        }
      }

      // ── Apply tool results to Case Memory ────────────────────
      for (const result of toolResults) {
        const payload = unwrapToolExecutionPayload(result.output)
        await this.chatMemory.applySkillResult(result.name, payload)
        await this.traceWriter.write(
          'skill_result',
          `Skill: ${result.name}`,
          { output: payload, latencyMs: result.latencyMs, iteration: this.iterationCount, skillName: result.name, input: result.toolUse?.input },
        )
      }

      // ── PostTool policy evaluation (batched LLM, single call) ──
      if (toolResults.length > 0) {
        // Tools were called — reset nudge count (LLM is complying)
        if (this.nudgeCount > 0) this.nudgeCount = 0
        try {
        const ctxSummary = toolResults
          .map((r) => `[${r.name}]: ${JSON.stringify(unwrapToolExecutionPayload(r.output))}`)
          .join('\n')
        const executedSkills = toolResults.map((r) => r.name)
        const postToolEval = await this.policyEngine.evaluate('postTool', {
          skillOutput: ctxSummary,
          confirmedFacts: this.chatMemory.getConfirmedFacts(),
          executedSkills,
          skillsCalled: this.chatMemory.getSkillsCalled(),
          skillResults: this.chatMemory.getSummary().skillResults as Record<string, unknown>,
        }, buildHitCounts())

        for (const r of postToolEval.results) {
          if (r.result !== 'pass') {
            this.chatMemory.recordPolicyHit(r.policyName)
            await this.traceWriter.write(
              'policy_hit',
              `${r.result === 'escalated' ? 'Escalated' : 'Blocked'}: ${r.policyName}`,
              { result: r.result, reason: r.reason, model: r.modelUsed },
            )
          }
        }

        // Inject policy feedback into message stream
        if (postToolEval.feedbackMessage) {
          this.messages.push(this.makeUserMessage(postToolEval.feedbackMessage))
        }

        // Auto-escalate on escalated: create human task immediately.
        // The loop continues so the LLM can respond naturally to the user,
        // then the pendingEscalation flag triggers the waiting_human return.
        if (postToolEval.summary === 'escalated') {
          const escalatedReasons = postToolEval.results
            .filter((r) => r.result === 'escalated')
            .map((r) => `${r.policyName}: ${r.reason || 'conflict detected'}`)
            .join('; ')

          await this.traceWriter.write('loop_decision', 'Auto-escalate from postTool policy', {
            policyNames: postToolEval.results.filter((r) => r.result === 'escalated').map((r) => r.policyName),
            reasons: escalatedReasons,
          })

          try {
            const resolvedCaseType = this.deps.caseSchema?.type || 'general'
            await this.persistence.ensureCase({
              id: this.deps.caseId,
              orgId: this.deps.orgId,
              userId: this.deps.userId,
              type: resolvedCaseType,
              status: 'escalated',
              blocker: `Policy escalation: ${escalatedReasons}`,
              chatId: this.deps.chatId ?? this.deps.caseId,
            })
            await this.persistence.createHumanTask({
              caseId: this.deps.caseId,
              queue: this.deps.caseSchema?.escalateOn?.[0] || 'general',
              question: `Auto-escalated by policy conflict_requires_human. ${escalatedReasons}. Skills called: ${this.chatMemory.getSkillsCalled().join(', ')}.`,
              status: 'pending',
            })
          } catch (err) {
            console.error('[AgentLoop] Failed to auto-create human task from postTool:', err)
          }

          // Customer-facing fallback before silent policy escalation
          sendEvent({
            type: 'text_delta',
            data: '非常抱歉，您的问题需要由人工专员协助处理。我们已为您创建工单，专员将尽快与您联系，感谢您的耐心等待。',
            timestamp: new Date().toISOString(),
          })
          sendEvent({
            type: 'escalated',
            data: { stage: this.currentStage, reason: escalatedReasons },
            timestamp: new Date().toISOString(),
          })

          this.pendingEscalation = true
        }
        } catch (policyErr) {
          console.error('[AgentLoop] PostTool evaluation failed:', policyErr)
        }
      }

      // ── Add to message history ───────────────────────────────
      if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
      this.addToolResultMessages(toolResults)

      // ── Step mode: detect todo_write failure + investigation in same batch
      // If the model tried to plan (called todo_write) but the call failed
      // because of wrong format, AND also ran investigation tools in the same
      // turn, we must tell it to fix the plan BEFORE acting on the results.
      // This fires even on non-empty turns (so it's not gated on !fullText).
      if (this.deps.caseSchema?.executionMode === 'cc' && this.nudgeCount < 3) {
        const todoFailed = toolResults.some(
          (r) => r.name === 'todo_write' && !(r.output as Record<string, unknown>)?.ok,
        )
        const nonSopTools = new Set(['todo_write', 'todo_read', 'dispatch_case_agent', 'request_user_input',
          'finalize_case', 'create_human_task', 'finalize_consultation',
          'read_chat_memory', 'read_user_profile'])
        const investigationRan = toolResults.some((r) => !nonSopTools.has(r.name))
        if (todoFailed && investigationRan) {
          this.nudgeCount++
          this.messages.push(this.makeUserMessage(
            `[System] Your todo_write call failed — the "action" field is required. ` +
            `The investigation data above is already collected. You MUST now: ` +
            `(1) Call todo_write({ "action": "add", "text": "..." }) for each SOP step. ` +
            `(2) For steps already covered by the results above, immediately call todo_write({ "action": "complete", "id": "<id>", "notes": "<findings>" }). ` +
            `(3) Then continue with any remaining steps.`,
          ))
          await this.traceWriter.write('loop_decision', 'SOP: failed todo_write + investigation, correction injected', {
            nudgeCount: this.nudgeCount, iteration: this.iterationCount,
          })
        }
      }

      // ── Terminal tool: dispatch_case_agent ─────────────────────────
      const dispatchCaseAgentResult = toolResults.find(
        (r) => r.name === 'dispatch_case_agent',
      )
      if (dispatchCaseAgentResult) {
        const toolInput = dispatchCaseAgentResult.toolUse?.input || {}
        const caseType = String(toolInput.caseType || '')

        if (caseType && isInvestigableCaseType(caseType)) {
          try {
            // Load case type from DB to build schema
            const ctRow = await prisma.caseType.findUnique({
              where: { orgId_type: { orgId: this.deps.orgId, type: caseType } },
            })
            if (ctRow) {
              const stages = (() => { try { return JSON.parse(ctRow.stages) } catch { return [] } })() as string[]
              const requiredFacts = (() => { try { return JSON.parse(ctRow.requiredFacts) } catch { return [] } })() as string[]
              const stageConfigs = (() => { try { return JSON.parse(ctRow.stageConfigs || '{}') } catch { return {} } })() as Record<string, unknown>
              const executionMode = (((ctRow as any).executionMode === 'sop' ? 'cc' : (ctRow as any).executionMode) as 'stage' | 'cc' | undefined) || 'stage'
              const allSkills = this.skillRouter.getToolDefinitions()
              const schema: CaseSchemaConfig = {
                type: ctRow.type, displayName: ctRow.displayName, icon: ctRow.icon,
                description: ctRow.description || undefined,
                requiredFacts: Array.isArray(requiredFacts) ? requiredFacts : [],
                stages: Array.isArray(stages) ? stages : [],
                stageConfigs: stageConfigs as any,
                defaultGoal: ctRow.defaultGoal,
                escalateOn: (() => { try { return JSON.parse(ctRow.escalateOn) } catch { return [] } })() as string[] || [],
                requireHumanReview: (ctRow as any).requireHumanReview === true,
                executionMode,
                sop: (ctRow as any).sop || undefined,
              }

              // Create a new case for this sub-agent investigation
              const subCaseId = generateCaseId()
              await this.persistence.ensureCase({
                id: subCaseId,
                orgId: this.deps.orgId,
                userId: this.deps.userId,
                type: caseType,
                status: 'created',
                chatId: this.deps.chatId ?? this.deps.caseId,
              })

              // Create ChatMemory for the sub-agent's case
              await this.persistence.saveMemory(subCaseId, {
                caseId: subCaseId,
                confirmedFacts: JSON.stringify(this.chatMemory.getConfirmedFacts()),
                skillsCalled: JSON.stringify([]),
                skillResults: JSON.stringify({}),
                keyEvents: JSON.stringify([]),
                humanTaskStatus: 'none',
                needsContinuation: false,
              })

              // Build SubAgentConfig: merge all stage skills + SOP or stage-driven prompt
              const stageSkillNames = new Set<string>()
              for (const sc of Object.values(stageConfigs)) {
                const cfg = sc as Record<string, unknown>
                const skills = Array.isArray(cfg.availableSkills) ? cfg.availableSkills : []
                for (const s of skills) stageSkillNames.add(s)
              }
              // Always allow terminal tools
              for (const t of ['create_human_task', 'finalize_case', 'request_user_input']) {
                stageSkillNames.add(t)
              }
              if (executionMode === 'cc') {
                stageSkillNames.add('todo_write')
                stageSkillNames.add('todo_read')
                stageSkillNames.add('dispatch_subagent')
              }

              const casePrompt = ctRow.defaultGoal || `Investigate and resolve the customer's ${ctRow.displayName} issue.`
              const sopDoc = (ctRow as any).sop?.trim()
              const taskPrompt = executionMode === 'cc' && sopDoc
                ? `[Case Agent: ${ctRow.displayName}]\n\n## SOP\n${sopDoc}\n\n## Goal\n${casePrompt}\n\nFollow the SOP. Use todo_write to plan, then execute each step. Call finalize_case when done.`
                : `[Case Agent: ${ctRow.displayName}]\n\n## Goal\n${casePrompt}\n\nInvestigate through these stages: ${stages.join(' → ')}. Call finalize_case when resolved.`

              const subAgentConfig: import('@intera/shared/types').SubAgentConfig = {
                name: `case_agent_${caseType}`,
                model: this.deps.config.model,
                systemPrompt: this.deps.config.systemPrompt,
                skills: Array.from(stageSkillNames),
                taskTemplate: taskPrompt,
                parallel: true,
                maxIterations: this.deps.config.maxIterations,
                fallbackModel: this.deps.config.fallbackModel,
              }

              if (!this.dryRun) {
                const orchestrator = new OrchestratorAgent(
                  schema,
                  allSkills,
                  this.deps.userId,
                  this.chatMemory,
                )

                const caseMem = this.chatMemory.getSummary()
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
                // Dry-run (playground): never spawn a real background agent or its
                // DB writes. Emit a mock sub_agent_start so the UI/trace still shows
                // the dispatch step, but skip OrchestratorAgent entirely.
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

              await this.traceWriter.write('loop_decision', `Case agent dispatched: ${caseType}`, { caseType, caseId: subCaseId })

              // Replace mock result with real case ID
              for (let i = this.messages.length - 1; i >= 0; i--) {
                const m = this.messages[i]
                if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool dispatch_case_agent result:')) {
                  m.content = `Tool dispatch_case_agent result: ${JSON.stringify({ caseId: subCaseId, status: 'created', note: 'Case agent dispatched in background. Continue the conversation while it works.' })}`
                  break
                }
              }

              // Continue loop — main agent stays in conversation mode
              continue
            }
          } catch (err) {
            console.error('[AgentLoop] Failed to dispatch case agent:', err)
          }
        }
      }

      // ── Data tool: read_chat_memory ──────────────────────
      const readMemResult = toolResults.find(
        (r) => r.name === 'read_chat_memory',
      )
      if (readMemResult) {
        const memSummary = this.chatMemory.getSummary() as unknown as Record<string, unknown>
        const key = profileKey(this.deps.userId, this.deps.chatId)
        const dbProfile = key ? await prisma.userProfile.findUnique({ where: { userId: key } }).catch(() => null) : null
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const m = this.messages[i]
          if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool read_chat_memory result:')) {
            m.content = `Tool read_chat_memory result: ${JSON.stringify({
              confirmedFacts: memSummary.confirmedFacts ?? {},
              skillsCalled: memSummary.skillsCalled ?? [],
              keyEvents: (memSummary.keyEvents as any[])?.slice(-10) ?? [],
              summary: this.chatMemory.hasSummary() ? (memSummary as any).summary : null,
            })}`
            break
          }
        }
      }

      // ── Data tool: read_user_profile ─────────────────────
      const readProfileResult = toolResults.find(
        (r) => r.name === 'read_user_profile',
      )
      if (readProfileResult) {
        const key = profileKey(this.deps.userId, this.deps.chatId)
        const dbProfile = key ? await prisma.userProfile.findUnique({ where: { userId: key } }).catch(() => null) : null
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const m = this.messages[i]
          if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool read_user_profile result:')) {
            m.content = `Tool read_user_profile result: ${JSON.stringify({
              profile: dbProfile?.profile || null,
              stats: dbProfile ? {
                totalChats: dbProfile.totalChats,
                totalCases: dbProfile.totalCases,
                resolvedCases: dbProfile.resolvedCases,
                escalatedCases: dbProfile.escalatedCases,
                lastCaseType: dbProfile.lastCaseType,
                firstSeenAt: dbProfile.firstSeenAt?.toISOString() ?? null,
                lastSeenAt: dbProfile.lastSeenAt?.toISOString() ?? null,
              } : { totalChats: 0, totalCases: 0, resolvedCases: 0, escalatedCases: 0, lastCaseType: null, firstSeenAt: null, lastSeenAt: null },
            })}`
            break
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
          caseStatus: this.currentStage as CaseStatus,
          transition: 'waiting_form',
          currentStage: this.currentStage,
        }
      }

      // ── Phase 2: Delegate case terminal tools to CaseAgentLoop ─────────────
      // Handles: create_human_task, finalize_case, finalize_consultation, stage transition.
      // The nudgeCount is boxed so CaseAgentLoop can reset it on stage transition.
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
          this.compactUserProfile().catch(() => {})
      this.persistChatSession().catch(() => {})
          return caseToolResult.result
        }
        if (caseToolResult.type === 'continue') continue
      }

      sendEvent({
        type: 'message_stop',
        data: { reason: 'next_turn', stage: this.currentStage },
        timestamp: new Date().toISOString(),
      })

      // Post-tool auto-escalation: human task was created during this iteration.
      // The LLM has had a chance to respond naturally — now exit to waiting_human.
      if (this.pendingEscalation) {
        this.compactUserProfile().catch(() => {})
      this.persistChatSession().catch(() => {})
        await this.writeProfilerSnapshot()
        return {
          messages: this.messages,
          caseStatus: 'escalated',
          transition: 'waiting_human',
          currentStage: this.currentStage,
          reason: 'auto_escalated_by_policy',
        }
      }
    }

    // Max iterations reached
    await this.traceWriter.write('loop_decision', 'Exit: max iterations', {
      stopReason, iteration: this.iterationCount, messageCount: this.messages.length,
    })

    // Only escalate when the agent was repeatedly nudged and still failed.
    // If it just ran out of iterations (e.g. in SOP mode where each turn
    // requires multiple tool calls), preserve the current stage so the
    // next HTTP request can continue from where it left off.
    const shouldEscalate = this.nudgeCount >= 3
    sendEvent({
      type: shouldEscalate ? 'escalated' : 'message_stop',
      data: shouldEscalate
        ? { reason: 'max_iterations', stage: this.currentStage }
        : { reason: 'max_iterations', stopReason, stage: this.currentStage },
      timestamp: new Date().toISOString(),
    })
    await this.writeProfilerSnapshot()
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

  /**
   * Intercept step-mode internal tools (todo_write / todo_read) — replace their
   * mock executor outputs with real in-memory CaseMemory operations.
   * Must be called after toolExecutor.waitForAll() when executionMode is 'sop'.
   */
  private processTodoTools(results: ToolExecutionResult[]): ToolExecutionResult[] {
    const sopToolNames = new Set(SOP_INTERNAL_SKILLS.map((s) => s.name))
    return results.map((result) => {
      if (!sopToolNames.has(result.name)) return result

      if (result.name === 'todo_read') {
        return {
          ...result,
          output: {
            ok: true,
            todos: this.chatMemory.getTodos(),
            dashboardVersion: this.chatMemory.getDashboardVersion(),
          },
        }
      }

      if (result.name === 'todo_write') {
        const raw = result.toolUse?.input as Record<string, unknown> | undefined
        // ── Defensive action inference (handles weak models that omit `action`) ──
        // If the model sends { text } without action → treat as "add".
        // If the model sends { id } without action → treat as "complete".
        // If the model sends a top-level `todos` array → batch-add each item.
        // If the model sends no input at all → return current state with guidance.
        let input: { action?: string; id?: string; text?: string; notes?: string; status?: string } | undefined = raw as any

        if (!input) {
          // Model called todo_write() with no arguments.
          // If Zod already rejected this (result.toolUse is missing), preserve its
          // specific error ("Input validation failed: action: Required") instead of
          // replacing it with a less helpful generic message.
          const existingError = (result.output as Record<string, unknown> | null)?.error as string | undefined
          if (!result.toolUse && existingError) {
            return {
              ...result,
              output: {
                ok: false,
                error: `todo_write input invalid: ${existingError}`,
                todos: this.chatMemory.getTodos(),
                dashboardVersion: this.chatMemory.getDashboardVersion(),
              },
            }
          }
          return {
            ...result,
            output: {
              ok: false,
              error: 'todo_write requires action ("add"|"update"|"complete"|"cancel") and relevant fields. Current todos returned so you can proceed.',
              todos: this.chatMemory.getTodos(),
              dashboardVersion: this.chatMemory.getDashboardVersion(),
            },
          }
        }

        if (!input.action) {
          if (Array.isArray((raw as any)?.todos)) {
            // Model tried to send a batch: add each as a separate todo
            const batchItems = (raw as any).todos as Array<{ text?: string; notes?: string }>
            let lastTodos: ReturnType<typeof this.chatMemory.getTodos> = this.chatMemory.getTodos()
            for (const item of batchItems) {
              if (item?.text) {
                const out = this.chatMemory.applyTodoAction({ action: 'add', text: item.text, notes: item.notes })
                lastTodos = out.todos
              }
            }
            return {
              ...result,
              output: { ok: true, todos: lastTodos, dashboardVersion: this.chatMemory.getDashboardVersion() },
            }
          } else if (input.id) {
            input = { ...input, action: 'complete' }
          } else if (input.text) {
            input = { ...input, action: 'add' }
          } else {
            // No recoverable fields — return current todo list so agent can see state
            return {
              ...result,
              output: {
                ok: false,
                error: 'todo_write requires action ("add"|"update"|"complete"|"cancel"). Current todos returned so you can proceed.',
                todos: this.chatMemory.getTodos(),
                dashboardVersion: this.chatMemory.getDashboardVersion(),
              },
            }
          }
        }

        if (!input?.action) {
          return { ...result, output: { ok: false, error: 'Missing required field: action', todos: this.chatMemory.getTodos() } }
        }

        const outcome = this.chatMemory.applyTodoAction(input as any)
        return {
          ...result,
          output: {
            ok: true,
            todos: outcome.todos,
            dashboardVersion: this.chatMemory.getDashboardVersion(),
          },
        }
      }

      return result
    })
  }

  /**
   * Intercept dispatch_subagent calls in CC mode.
   * Replaces the mock result with an actual orchestrator dispatch.
   */
  private async processDispatchSubagent(
    toolResults: ToolExecutionResult[],
    sendEvent: (event: SSEEvent) => void,
  ): Promise<ToolExecutionResult[]> {
    if (!this.caseLoop) return toolResults

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
        await this.caseLoop.dispatchSingle(
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

  private buildApiMessages() {
    const limit = this.deps.config.memoryStrategy.l1MaxMessages * 2
    const recentMessages = this.messages.slice(-limit)

    const toAnthropic = (msg: Message): { role: string; content: string | Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> } => {
      if (msg.contentBlocks?.length) {
        const blocks = msg.contentBlocks.map((b) => {
          if (b.type === 'text') return { type: 'text' as const, text: b.text }
          if (b.type === 'image') return { type: 'image' as const, source: { type: b.source.type, media_type: b.source.media_type, data: b.source.data } }
          return { type: 'text' as const, text: '' }
        })
        return { role: msg.role, content: blocks }
      }
      return { role: msg.role, content: msg.content }
    }

    if (this.chatMemory.hasSummary()) {
      const maxSummaryChars = this.deps.config.memoryStrategy.l2SummaryMaxTokens * 3
      let summaryText = this.chatMemory.getSummary().summary || ''
      if (summaryText.length > maxSummaryChars) {
        summaryText = summaryText.slice(0, maxSummaryChars) + '...'
      }
      const summaryMsg = this.makeUserMessage(
        `[Case context from previous turns — use this to stay oriented]\n${summaryText}`
      )
      const apiSummary = toAnthropic(summaryMsg)
      return [apiSummary, ...recentMessages.map(toAnthropic)] as any
    }

    return recentMessages.map(toAnthropic) as any
  }

  private makeUserMessage(content: string, contentBlocks?: import('@intera/shared/types').ContentBlock[]): Message {
    return {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      contentBlocks,
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
    if (this.chatMemory.hasSummary()) {
      const smResult = trySessionMemoryCompact(
        this.chatMemory.getSummary().summary,
        this.chatMemory.getLastCompactedAt(),
        this.deps.config.memoryStrategy.sessionMemoryMaxAgeMs ?? 1800000,
      )
      if (smResult.used) {
        return { shouldCompact: false, reason: 'session_memory_still_fresh' }
      }
    }

    const messageContents = this.messages.map((m) => typeof m.content === 'string' ? m.content : '')
    const estimatedTokens = this.chatMemory.estimateTokens(messageContents)

    const assessment = this.chatMemory.assessCompaction(estimatedTokens, this.messages.length)

    if (assessment.isBlocking) {
      if (this.chatMemory.isCompactCircuitBroken()) {
        return { shouldCompact: false, reason: 'circuit_breaker' }
      }
      try {
        await this.performCompaction()
        const keepCount = this.chatMemory.compactionKeepCount(this.messages.length)
        if (this.deps.config.memoryStrategy.enableSnip !== false) {
          this.messages = this.messages.slice(-keepCount)
        }
        await this.traceWriter.write('loop_decision', 'Compacted', {
          reason: 'blocking', kept: keepCount, percentLeft: assessment.percentLeft,
        })
        return { shouldCompact: true, reason: 'blocking' }
      } catch {
        this.chatMemory.recordCompactionFailure()
        return { shouldCompact: false, reason: 'failed' }
      }
    }

    if (assessment.shouldCompact) {
      if (this.chatMemory.isCompactCircuitBroken()) {
        return { shouldCompact: false, reason: 'circuit_breaker' }
      }
      try {
        await this.performCompaction()
        const keepCount = this.chatMemory.compactionKeepCount(this.messages.length)
        if (this.deps.config.memoryStrategy.enableSnip !== false) {
          this.messages = this.messages.slice(-keepCount)
        }
        await this.traceWriter.write('loop_decision', 'Compacted', {
          reason: 'auto', kept: keepCount, percentLeft: assessment.percentLeft,
        })
        return { shouldCompact: true, reason: 'auto' }
      } catch {
        this.chatMemory.recordCompactionFailure()
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
    if (this.deps.config.debugMode) {
      writeDebugTranscript(this.deps.caseId, this.messages)
    }
  }

  /** Persist chat-level memory to ChatSession table. */
  private async persistChatSession(): Promise<void> {
    if (!this.deps.chatId) return
    if (this.dryRun) return
    try {
      await prisma.chatSession.upsert({
        where: { chatId: this.deps.chatId },
        update: {
          confirmedFacts: JSON.stringify(this.chatMemory.getConfirmedFacts()),
          keyEvents: JSON.stringify(this.chatMemory.getSummary().keyEvents),
          summary: this.chatMemory.getSummary().summary || undefined,
        },
        create: {
          chatId: this.deps.chatId,
          orgId: this.deps.orgId,
          confirmedFacts: JSON.stringify(this.chatMemory.getConfirmedFacts()),
          keyEvents: JSON.stringify(this.chatMemory.getSummary().keyEvents),
          summary: this.chatMemory.getSummary().summary || undefined,
        },
      })
    } catch (err) {
      console.warn('[AgentLoop] persistChatSession failed:', err)
    }
  }

  /** Standalone compact for UserProfile — takes recent messages, produces a user portrait. */
  private async compactUserProfile(): Promise<void> {
    if (!this.deps.config.memoryStrategy.enableChatMemory) return
    const key = profileKey(this.deps.userId, this.deps.chatId)
    if (!key) return
    try {
      const recentMessages = this.messages.slice(-50)
      const result = await compactConversation(recentMessages, this.deps.config.memoryStrategy)
      const summary = result.summary
      if (!summary) return

      const existing = await prisma.userProfile.findUnique({
        where: { userId: key },
        select: { profile: true },
      }).catch(() => null)
      const maxTokens = this.deps.config.memoryStrategy.chatMemoryMaxTokens ?? 4000
      const merged = mergeProfile(existing?.profile ?? '', summary, maxTokens)
      const stats = await recomputeProfileStats(prisma, key)

      if (!this.dryRun) {
        await prisma.userProfile.upsert({
          where: { userId: key },
          create: { userId: key, profile: merged, ...stats },
          update: { profile: merged, ...stats },
        })
      }
    } catch (err) {
      console.warn('[AgentLoop] compactUserProfile failed:', err)
    }
  }

  private async performCompaction(): Promise<void> {
    this.profiler.incrementCompaction()
    const strategy = this.deps.config.memoryStrategy

    try {
      const result = await compactConversation(this.messages, strategy)
      if (result.summary) {
        this.chatMemory.setSummary(result.summary)
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
    this.chatMemory.recordCompaction()
  }

  // -----------------------------------------------------------------------
  // Unified ReAct Loop (shared by main agent and sub-agents)
  // -----------------------------------------------------------------------

  /**
   * Run a policy-driven ReAct loop.
   *
   * Delegates all behavior decisions (prompt assembly, tool filtering,
   * continuation, terminal tools) to the `ExecutionStrategy`, making the core
   * ReAct iteration reusable across main-agent, sub-agent, stage, and step
   * execution modes.
   *
   * Used by `SubAgent.run()` via `ChecklistPolicy`.
   */
  static async runReActLoop(
    client: Anthropic,
    model: string,
    fallbackModel: string | undefined,
    systemPrompt: string,
    skillDefinitions: SkillDefinition[],
    ctx: AgentContext,
    policy: ExecutionStrategy,
    sendEvent: (event: SSEEvent) => void,
    taskPrompt: string,
    abortController?: AbortController,
  ): Promise<LoopResult> {
    const ac = abortController ?? new AbortController()
    let totalTokens = 0

    // ── Build initial messages ──────────────────────────────────────
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
      { role: 'user', content: taskPrompt },
    ]

    // ── ReAct iteration loop ───────────────────────────────────────
    for (let iter = 0; iter < ctx.maxIterations; iter++) {
      if (ac.signal.aborted) break

      // Build prompt and filter tools via policy
      const stagePrompt = policy.buildPrompt(systemPrompt)
      const allAnthropicTools = AgentLoop.buildAnthropicTools(skillDefinitions)
      const stageTools = policy.filterTools(allAnthropicTools, iter)

      // ── Call LLM ─────────────────────────────────────────────
      let msg: Anthropic.Messages.Message
      try {
        msg = await withRetry(
          (retryClient, retryCtx) => retryClient.messages.create({
            model: retryCtx.model,
            max_tokens: 4096,
            temperature: 0.3,
            system: stagePrompt,
            tools: stageTools.length > 0 ? stageTools : undefined,
            messages: messages as any,
          }, { signal: ac.signal }),
          { querySource: 'sub_agent_loop', model, fallbackModel, signal: ac.signal },
          () => client,
        )
      } catch (err) {
        if (err instanceof FallbackTriggeredError) {
          return { messages: [], caseStatus: 'escalated' as const, transition: 'waiting_human' as const, reason: 'model_fallback_exhausted' }
        }
        if (err instanceof CannotRetryError && err.errorClass === 'aborted') {
          return {
            messages: [],
            caseStatus: 'escalated' as const,
            transition: 'connection_lost' as const,
            reason: 'aborted',
          }
        }
        if (err instanceof CannotRetryError) {
          return { messages: [], caseStatus: 'escalated' as const, transition: 'waiting_human' as const, reason: `sub_agent_llm_${err.errorClass}` }
        }
        throw err
      }

      const usage = (msg as any).usage || {}
      totalTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0)

      // ── Parse response ────────────────────────────────────────
      let textContent = ''
      const toolUses: ToolUse[] = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          textContent += (block as any).text
        } else if (block.type === 'tool_use') {
          toolUses.push({
            id: (block as any).id,
            name: (block as any).name,
            input: (block as any).input || {},
          })
        }
      }

      sendEvent({
        type: 'text_delta',
        data: textContent,
        timestamp: new Date().toISOString(),
      })

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        content: textContent,
        toolUses: toolUses.length > 0 ? toolUses : undefined,
        createdAt: new Date(),
      }

      // ── Intercept terminal tools BEFORE execution ─────────────
      // The policy may claim a tool call and terminate the loop
      // without running it (e.g. finalize_sub_agent).
      for (const tu of toolUses) {
        const terminalResult = policy.handleTerminalTool(tu.name, tu.input)
        if (terminalResult && terminalResult.type === 'handled') {
          messages.push({ role: 'assistant' as const, content: msg.content })
          const result = terminalResult.result
          return {
            messages: [assistantMsg],
            caseStatus: result.caseStatus,
            transition: result.transition as LoopResult['transition'],
            currentStage: result.currentStage,
            reason: result.reason,
            pendingSubAgents: result.pendingSubAgents,
          }
        }
      }

      // ── No tool calls — evaluate continuation ─────────────────
      if (toolUses.length === 0) {
        messages.push({ role: 'assistant' as const, content: msg.content })
        const decision = await policy.evaluateContinuation(assistantMsg, [], iter + 1)

        if (decision.action === 'complete_task') {
          return {
            messages: [assistantMsg],
            caseStatus: 'resolved' as const,
            transition: 'stage_continue' as const,
            reason: 'sub_agent_complete',
          }
        }
        if (decision.action === 'stop') {
          return {
            messages: [assistantMsg],
            caseStatus: 'resolved' as const,
            transition: 'stage_continue' as const,
            reason: decision.reason,
          }
        }
        continue
      }

      // ── Execute tools ─────────────────────────────────────────
      const execResults = await StreamingToolExecutor.executeAll(skillDefinitions, toolUses, undefined, false)

      // Build Anthropic-format tool result blocks
      const toolResultBlocks = execResults.map((er) => {
        const toolUseId =
          er.toolUse?.id ??
          toolUses.find((tu) => tu.name === er.name)?.id ??
          ''
        return {
          type: 'tool_result' as const,
          tool_use_id: toolUseId,
          content: JSON.stringify(unwrapToolExecutionPayload(er.output)),
        }
      })

      // ── S1: Guarantee one tool_result per tool_use ──
      const completedIds = new Set(
        execResults.map((er) => er.toolUse?.id ?? toolUses.find((tu) => tu.name === er.name)?.id ?? ''),
      )
      const missingBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
      for (const tu of toolUses) {
        if (!completedIds.has(tu.id)) {
          missingBlocks.push({
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: JSON.stringify({ error: 'tool_execution_failed', reason: 'executor_did_not_produce_result' }),
          })
        }
      }
      const allToolResultBlocks = [...toolResultBlocks, ...missingBlocks]

      // Add assistant + tool results to message history
      messages.push({ role: 'assistant' as const, content: msg.content })
      messages.push({ role: 'user' as const, content: allToolResultBlocks })

      // ── Emit tool call progress events ────────────────────────
      for (const tu of toolUses) {
        sendEvent({
          type: 'sub_agent_progress',
          data: { agentName: ctx.agentId, toolName: tu.name },
          timestamp: new Date().toISOString(),
        })
      }

      // ── Evaluate continuation after tools ──────────────────────
      const policyToolResults: ToolResult[] = execResults.map((er) => ({
        ok: true,
        output: er.output,
        latencyMs: er.latencyMs,
      }))

      const decision = await policy.evaluateContinuation(assistantMsg, policyToolResults, iter + 1)

      if (decision.action === 'complete_task') {
        return {
          messages: [assistantMsg],
          caseStatus: 'resolved' as const,
          transition: 'stage_continue' as const,
          reason: 'sub_agent_complete',
        }
      }
      if (decision.action === 'stop') {
        return {
          messages: [assistantMsg],
          caseStatus: 'resolved' as const,
          transition: 'stage_continue' as const,
          reason: decision.reason,
        }
      }
    }

    // Max iterations reached
    return {
      messages: [],
      caseStatus: 'escalated' as const,
      transition: 'stage_continue' as const,
      reason: 'max_iterations',
    }
  }

  /** Build Anthropic tool definitions from skill definitions. */
  private static buildAnthropicTools(skillDefinitions: SkillDefinition[]): Tool[] {
    return skillDefinitions
      .filter((s) => s.enabled)
      .map((s) => ({
        name: s.name,
        description: s.description,
        input_schema: s.inputSchema as Tool['input_schema'],
      }))
  }

  getCaseType(): string {
    return this.deps.caseSchema?.type || 'general'
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
