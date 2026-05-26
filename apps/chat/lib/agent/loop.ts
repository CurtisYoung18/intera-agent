// Intera Harness - Agent Loop (核心引擎)
// Based on Claude Code's query.ts + StreamingToolExecutor pattern
//
// Streaming tool execution: tools begin executing as soon as their
// input_json is complete (content_block_stop), while text/thinking
// continues streaming to the frontend. This is the key difference
// from naive "wait for full response then execute" approaches.

import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Message, AssistantMessage, ToolUse, SSEEvent, CaseSchemaConfig, AgentContext, ToolResult, SkillDefinition } from '@intera/shared/types'
import { prisma } from '@intera/shared/prisma'
import { StreamingToolExecutor, unwrapToolExecutionPayload, type ToolExecutionResult } from './streaming-tool-executor'
import { CaseMemoryManager } from './memory'
import { PolicyEngine } from './policy'
import { SkillRouter, SOP_INTERNAL_SKILLS } from './skills'
import { TraceWriter } from './trace'
import { CaseAgentLoop, type CaseLoopServices } from './case-agent-loop'
import { ConversationLoop } from './conversation-loop'
import { microCompact } from './microCompact'
import { trySessionMemoryCompact } from './sessionMemoryCompact'
import { compactConversation, reactiveCompact } from './compact'
import { Profiler } from './profiler'
import type { ExecutionPolicy } from './policies/types'
import { writeDebugRequest, writeDebugResponse, writeDebugTranscript } from './debug-logger'
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
  customerId: string
  userId: string
  /** Case-execution prompt (used when case is active). Resolved from CASE_SYSTEM_PROMPT or DB custom prompt. */
  systemPrompt: string
  /** Core/discovery prompt (used when no case is active). Resolved from CORE_SYSTEM_PROMPT. Falls back to systemPrompt if unset. */
  coreSystemPrompt?: string
  caseSchema?: CaseSchemaConfig | null
  /** Groups all cases in the same chat session — stored on Case.chatId. */
  chatId?: string | null
  /** When true, the case was created from an intent selection card.
   *  propose_cases is removed from available tools to prevent re-triggering. */
  bootstrapNewCase?: boolean
}

export interface LoopResult {
  messages: Message[]
  caseStatus: CaseStatus
  transition: 'next_turn' | 'resolved' | 'waiting_human' | 'waiting_form' | 'error' | 'consultation_complete' | 'stage_continue' | 'awaiting_clarification' | 'awaiting_interaction' | 'connection_lost'
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

  /** Current workflow stage — delegates to caseLoop when active. */
  private get currentStage(): string {
    return this.caseLoop?.currentStage ?? 'created'
  }

  constructor(private deps: AgentLoopDeps) {
    this.caseMemory = new CaseMemoryManager(deps.caseId, deps.config.memoryStrategy)
    this.skillRouter = new SkillRouter(deps.customerId)
    this.traceWriter = new TraceWriter(deps.caseId)
    if (deps.chatId) this.traceWriter.setChatId(deps.chatId)
    this.abortController = new AbortController()
    this.anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
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
      customerId: this.deps.customerId,
      userId: this.deps.userId,
      chatId: this.deps.chatId,
      config: this.deps.config,
      caseMemory: this.caseMemory,
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
    loop.skillRouter = await SkillRouter.create(deps.customerId)
    loop.policyEngine = await PolicyEngine.create(deps.customerId, deps.config.policyHooks)
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
    const userMsg = this.makeUserMessage(userMessage)
    this.messages.push(userMsg)
    await this.traceWriter.write('user_message', 'User sent message', userMessage)
    await this.traceWriter.writeAgentTreeNode(agentName, 0, chainId, 'run start')

    // 2. Ingest facts into Case Memory (LLM-based extraction)
    const requiredFacts = this.deps.caseSchema?.requiredFacts
    await this.caseMemory.ingestUserMessageFacts(userMessage, requiredFacts)

    // Re-apply structured form answers so they always beat LLM-extracted facts.
    // LLM extraction may miss fields or overwrite structured data with guesses
    // (e.g. date: "yesterday" instead of date: "昨天上午10点").
    if (preIngestedFacts) {
      this.caseMemory.ingestFormAnswers(preIngestedFacts)
    }

    sendEvent({
      type: 'memory_update',
      data: this.caseMemory.getSummary(),
      timestamp: new Date().toISOString(),
    })

    // 2.5 Dispatch dedicated agents on case creation (first stage)
    await this.startDedicatedAgents(sendEvent)

    // 2.6 Per-message mode classification
    // When a case is active, classify this user message as case-related or
    // casual/off-topic. Casual messages bypass the Case ReAct loop and are
    // handled by ConversationLoop (lightweight, no stage enforcement).
    //
    // Step mode: fully trust the model (CC pattern) — skip the secondary LLM
    // classification call and always route to the case loop.
    let forceCoreMode = false
    if (this.caseLoop?.isStageActive() && this.deps.caseSchema?.executionMode !== 'sop') {
      const msgMode = await this.classifyMessage(userMessage)
      forceCoreMode = msgMode === 'core'
      if (forceCoreMode) {
        await this.traceWriter.write('loop_decision', 'Per-message route: Core (off-topic)', {
          messageLength: userMessage.length,
          stage: this.currentStage,
        })
      }
    }

    // 3. ReAct loop
    let stopReason: string | null = null
    let usage: Record<string, unknown> | null = null

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
            this.messages.push({
              id: crypto.randomUUID(),
              role: 'user' as const,
              content: `[SYSTEM] 用户补充了新信息：${pending.content}`,
              createdAt: new Date(),
            })
            this.caseMemory.bumpDashboardVersion()
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
          const c = this.caseMemory.getPolicyHitCount(name)
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
      // forceCoreMode is set at the start of run() when the user message was
      // classified as off-topic — it overrides the stage check so casual messages
      // don't enter the Case ReAct loop.
      const isCaseActive = forceCoreMode ? false : (this.caseLoop?.isStageActive() ?? false)
      // Consultation mode: human operator is reviewing the case via the same chat UI.
      // Restrict the agent to pure conversation + finalize_consultation only.
      const isConsultation = this.caseMemory.getSummary().caseStatus === 'waiting_human'

      // Emit core_agent_progress and merge background sub-agent results (case mode only).
      if (isCaseActive) {
        this.caseLoop!.emitProgressEvent(this.iterationCount, sendEvent)
        if (this.caseLoop!.mergeNewSubAgentResults()) {
          sendEvent({
            type: 'memory_update',
            data: this.caseMemory.getSummary(),
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
      // NOTE: SOP-internal tools (todo_write / todo_read) and create_case are
      // excluded from live skill_result emission — their executor output is just
      // the empty mock fixture. The real results are emitted manually further
      // down (todo list via processTodoTools, caseId via case_created event).
      const sopInternalNames = new Set(SOP_INTERNAL_SKILLS.map((s) => s.name))
      sopInternalNames.add('create_case')
      const toolExecutor = new StreamingToolExecutor(
        this.skillRouter.getToolDefinitions(),
        (toolUse, status) => {
          if (sopInternalNames.has(toolUse.name)) return
          const skillDef = this.skillRouter.getSkill(toolUse.name)
          sendEvent({
            type: status === 'executing' ? 'tool_executing' : 'skill_result',
            data: {
              name: toolUse.name,
              status,
              result: status !== 'executing' ? toolUse.result : undefined,
              displayVerb: status === 'executing' ? skillDef?.displayVerb : undefined,
            },
            timestamp: new Date().toISOString(),
          })
        },
      )

      // ── Phase 1: Dual-mode prompt + tool selection ──────────────────────────
      // Core mode  → no active case (or forceCoreMode): conversational discovery.
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
      } else if (this.deps.caseSchema?.executionMode === 'sop') {
        stagePrompt = this.caseLoop!.buildPrompt(this.deps.systemPrompt)
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

      if (this.abortController.signal.aborted) break

      const apiMessages = this.buildApiMessages()

      // ── Auto error recovery: retry once on transient API errors ──
      let stream: ReturnType<typeof this.anthropicClient.messages.stream>
      let streamAttempt = 0
      const maxStreamAttempts = 2

      while (streamAttempt < maxStreamAttempts) {
        streamAttempt++
        try {
          stream = this.anthropicClient.messages.stream({
            model: this.deps.config.model,
            max_tokens: this.deps.config.maxOutputTokens ?? 4096,
            system: stagePrompt,
            messages: apiMessages,
            tools: stageTools,
            ...(this.deps.config.showThinking ? {
              thinking: { type: 'enabled' as const, budget_tokens: this.deps.config.thinkingBudget || 4096 },
            } : {}),
          }, { signal: this.abortController.signal })
          break // success — exit retry loop
        } catch (err) {
          if (streamAttempt >= maxStreamAttempts || this.abortController.signal.aborted) {
            sendEvent({ type: 'error', data: `LLM API error after ${streamAttempt} attempts`, timestamp: new Date().toISOString() })
            await this.traceWriter.write('loop_decision', 'Exit: LLM API error', { error: String(err), attempts: streamAttempt })
            sendEvent({ type: 'escalated', data: { reason: `LLM API error after ${streamAttempt} attempts` }, timestamp: new Date().toISOString() })
            return { messages: this.messages, transition: 'waiting_human' as const, caseStatus: 'escalated' as const }
          }
          await this.traceWriter.write('loop_decision', `LLM stream retry ${streamAttempt}/${maxStreamAttempts}`, { error: String(err) })
          await new Promise((r) => setTimeout(r, 1000 * streamAttempt)) // backoff
        }
      }

      // stream is guaranteed to be assigned here (while loop always breaks or returns)
      stream = stream!

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
              // Some Anthropic-compatible providers (MiniMax, DeepSeek) send the
              // complete tool input in content_block_start.input instead of
              // streaming it via input_json_delta events. Seed content from
              // b.input so those providers don't silently drop the input.
              const seedContent =
                b.input && typeof b.input === 'object' && Object.keys(b.input as Record<string, unknown>).length > 0
                  ? JSON.stringify(b.input)
                  : ''
              blocks.set(event.index, {
                index: event.index,
                type: 'tool_use',
                id: b.id,
                name: b.name,
                content: seedContent,
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
              const cleanChunk = textSanitizer.feed(d.text)
              if (cleanChunk) {
                sendEvent({
                  type: 'text_delta',
                  data: cleanChunk,
                  timestamp: new Date().toISOString(),
                })
              }
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
              const preToolEval = await this.policyEngine.evaluate('preTool', {
                skillName: toolUse.name,
                skillInput: toolUse.input,
                confirmedFacts: this.caseMemory.getConfirmedFacts(),
                skillsCalled: this.caseMemory.getSkillsCalled(),
                skillResults: this.caseMemory.getSummary().skillResults as Record<string, unknown>,
              }, buildHitCounts())

              if (preToolEval.summary === 'blocked') {
                // Record policy hit for graduated response
                const blockingPolicies: string[] = []
                for (const r of preToolEval.results) {
                  if (r.result !== 'pass') {
                    this.caseMemory.recordPolicyHit(r.policyName)
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
                // Inject feedback so the agent knows why and what to do instead
                if (preToolEval.feedbackMessage && assistantMessage) {
                  if (!assistantPushed) {
                    this.messages.push(assistantMessage)
                    assistantPushed = true
                  }
                  this.messages.push(this.makeUserMessage(preToolEval.feedbackMessage))
                }
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
          case 'message_stop': {
            // Flush any text still held back in the sanitizer's lookahead buffer.
            const tail = textSanitizer.flush()
            if (tail) {
              sendEvent({ type: 'text_delta', data: tail, timestamp: new Date().toISOString() })
            }
            break
          }
        }
      }
      } catch (streamErr) {
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
        // Non-connection error: record and exit the loop gracefully
        await this.traceWriter.write('loop_decision', 'Stream error', {
          error: String(streamErr),
          iteration: this.iterationCount,
        })
        break
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

      // ── LLM-based leaked context sanitization ──────────────────
      // MiniMax-class models occasionally leak internal context into
      // text output: <think> blocks, orphan </think>, "Tool X result:"
      // echoes. An LLM eval detects and strips these patterns — more
      // robust than regex against new/evolving leakage formats.
      // Gated behind enableLlmSanitization (off by default).
      if (fullText && this.deps.config.enableLlmSanitization) {
        const sanitized = await this.sanitizeLeakedContext(fullText)
        if (sanitized !== fullText) {
          fullText = sanitized
          assistantMessage.content = sanitized
        }
      }

      // ── Wait for all tools to finish ─────────────────────────
      let toolResults = await toolExecutor.waitForAll()
      for (const tr of toolResults) {
        this.profiler.addToolExecution(tr.latencyMs || 0)
      }

      // ── Step-mode todo interception (pure in-memory, no side effects) ─────
      // todo_write and todo_read bypass the skill executor — their mock outputs
      // are replaced here with real in-memory operations on CaseMemory.
      if (this.deps.caseSchema?.executionMode === 'sop') {
        toolResults = this.processTodoTools(toolResults)

        // Auto-complete todo items whose corresponding investigation tools succeeded.
        // This handles models that forget to call todo_write(complete) after tool results.
        const succeededTools = new Set(
          toolResults
            .filter((r) => !sopInternalNames.has(r.name) && (r.output as any)?.ok !== false)
            .map((r) => r.name),
        )
        if (succeededTools.size > 0) {
          const pendingTodos = this.caseMemory.getTodos().filter((t) => t.status === 'pending')
          for (const todo of pendingTodos) {
            for (const toolName of succeededTools) {
              if (todo.text.includes(toolName)) {
                this.caseMemory.applyTodoAction({
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
        // Skip only when forceCoreMode is true (casual off-topic message).
        // Must NOT gate on isCaseActive: the 'created' → stage-1 bootstrap
        // transition fires here while isCaseActive is still false.
        if (!forceCoreMode && !isConsultation && this.caseLoop?.hasStageConfigs()) {
          const transitionEval = await this.caseLoop.evaluateStageTransitionAfterNoTools(this.iterationCount)
          if (transitionEval.modelUsed) {
            await this.traceWriter.write('stage_eval', `Stage eval: ${this.currentStage} → ${transitionEval.nextStage || 'stay'}`, { model: transitionEval.modelUsed, stage: this.currentStage, shouldTransition: transitionEval.shouldTransition, reason: transitionEval.reason })
          }

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
                await prisma.case.upsert({
                  where: { id: this.deps.caseId },
                  update: { status: 'escalated', blocker: `Agent stuck in stage "${this.currentStage}"` },
                  create: {
                    id: this.deps.caseId,
                    customerId: this.deps.customerId,
                    userId: this.deps.userId,
                    type: resolvedCaseType,
                    status: 'escalated',
                    blocker: `Agent stuck in stage "${this.currentStage}"`,
                  },
                })
                await prisma.humanTask.create({
                  data: {
                    caseId: this.deps.caseId,
                    queue: this.deps.caseSchema?.escalateOn?.[0] || 'general',
                    question: `Agent stuck in stage "${this.currentStage}" after 3 nudges. Case type: ${resolvedCaseType}. Skills called: ${this.caseMemory.getSkillsCalled().join(', ')}.`,
                    status: 'pending',
                  },
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
        if (this.deps.caseSchema?.executionMode === 'sop' && !fullText) {
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

        // ── ReAct compliance guard ──────────────────────────────────────
        // When the model produces text without calling tools, use an LLM eval
        // to check whether the response is a legitimate end-of-turn or the
        // model is "describing instead of doing."
        //
        // Threshold is 1 for all modes — even short Chinese narrations like
        // "现在查询历史工单和知识库。" (13 chars) or "让我再查询一下当前有效的活动详情："
        // (15 chars) slip past a 30-char cutoff yet are exactly the verbal
        // hallucination pattern we need to catch. The LLM eval correctly
        // classifies legitimate short responses ("好的", "明白了").
        //
        // Consultation mode: pure conversation with a human operator is always
        // legitimate — skip the ReAct guard entirely.
        if (!isConsultation && fullText && fullText.length >= 1) {
          const reactResult = await this.evaluateReactCompliance(fullText)

          if (reactResult === 'nudge') {
            this.nudgeCount++
            const nudge = '[SYSTEM] Your last response describes a problem or implies action is needed, ' +
                'but you did not call any tool to act on it. If investigation, verification, or ' +
                'escalation is required, call the appropriate tool now. Describing the need in ' +
                'text is not sufficient — you must use tools to take action.'
            if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
            this.messages.push(this.makeUserMessage(nudge))

            await this.traceWriter.write('loop_decision', 'ReAct nudge: describing without acting', {
              stage: this.currentStage,
              nudgeCount: this.nudgeCount,
              iteration: this.iterationCount,
            })

            sendEvent({
              type: 'message_stop',
              data: { reason: 'react_nudge', stage: this.currentStage },
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
        await this.caseMemory.applySkillResult(result.name, payload)
        await this.traceWriter.write(
          'skill_result',
          `Skill: ${result.name}`,
          { output: payload, latencyMs: result.latencyMs, iteration: this.iterationCount, skillName: result.name },
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
          confirmedFacts: this.caseMemory.getConfirmedFacts(),
          executedSkills,
          skillsCalled: this.caseMemory.getSkillsCalled(),
          skillResults: this.caseMemory.getSummary().skillResults as Record<string, unknown>,
        }, buildHitCounts())

        for (const r of postToolEval.results) {
          if (r.result !== 'pass') {
            this.caseMemory.recordPolicyHit(r.policyName)
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
            await prisma.case.upsert({
              where: { id: this.deps.caseId },
              update: { status: 'escalated', blocker: `Policy escalation: ${escalatedReasons}` },
              create: {
                id: this.deps.caseId,
                customerId: this.deps.customerId,
                userId: this.deps.userId,
                type: resolvedCaseType,
                status: 'escalated',
                blocker: `Policy escalation: ${escalatedReasons}`,
              },
            })
            await prisma.humanTask.create({
              data: {
                caseId: this.deps.caseId,
                queue: this.deps.caseSchema?.escalateOn?.[0] || 'general',
                question: `Auto-escalated by policy conflict_requires_human. ${escalatedReasons}. Skills called: ${this.caseMemory.getSkillsCalled().join(', ')}.`,
                status: 'pending',
              },
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
      if (this.deps.caseSchema?.executionMode === 'sop' && this.nudgeCount < 3) {
        const todoFailed = toolResults.some(
          (r) => r.name === 'todo_write' && !(r.output as Record<string, unknown>)?.ok,
        )
        const nonSopTools = new Set(['todo_write', 'todo_read', 'create_case', 'request_user_input',
          'propose_cases', 'finalize_case', 'create_human_task', 'propose_interaction', 'finalize_consultation'])
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

      // ── Terminal tool: propose_cases (multi-intent clarification) ──
      // Works both with and without an active case — when a case already exists,
      // propose_cases lets the user add additional case types alongside it.
      const proposeResult = toolResults.find(
        (r) => r.name === 'propose_cases',
      )
      if (proposeResult) {
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
            caseStatus: this.currentStage as CaseStatus,
            transition: 'awaiting_clarification',
            currentStage: this.currentStage,
            reason: 'multi_intent_clarification',
          }
        }

        // Empty cases array: replace mock result with feedback so the model doesn't retry
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const m = this.messages[i]
          if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool propose_cases result:')) {
            m.content = `Tool propose_cases result: ${JSON.stringify({ status: 'rejected', message: 'No matching case types found. Respond to the customer with plain text — do NOT call propose_cases again.' })}`
            break
          }
        }
        // Continue loop so the model can respond with plain text
        continue
      }

      // ── Terminal tool: create_case ─────────────────────────
      const createCaseResult = toolResults.find(
        (r) => r.name === 'create_case',
      )
      if (createCaseResult) {
        const toolInput = createCaseResult.toolUse?.input || {}
        const caseType = String(toolInput.caseType || '')

        if (!this.caseLoop && caseType && isInvestigableCaseType(caseType)) {
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
                requireHumanReview: (ctRow as any).requireHumanReview === true,
                // Normalize legacy 'sop' value to 'sop'
                executionMode: (((ctRow as any).executionMode === 'sop' ? 'sop' : (ctRow as any).executionMode) as 'stage' | 'sop' | undefined) || 'stage',
                sop: (ctRow as any).sop || undefined,
              }
              this.deps.caseSchema = schema

              // Phase 2: Create CaseAgentLoop instead of raw StageExecutor + Orchestrator
              this.caseLoop = new CaseAgentLoop(schema, this.makeCaseLoopServices())

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
                  chatId: this.deps.chatId ?? null,
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

              // Replace mock create_case result with real case ID
              for (let i = this.messages.length - 1; i >= 0; i--) {
                const m = this.messages[i]
                if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool create_case result:')) {
                  m.content = `Tool create_case result: ${JSON.stringify({ caseId: this.deps.caseId, status: 'created' })}`
                  break
                }
              }

              // ── SOP mode: MANDATORY planning mandate on every create_case ────
              // The very first action in SOP mode must be todo_write to build
              // the investigation plan. We ALWAYS inject this instruction,
              // whether or not investigation tools were pre-called in the same
              // batch. addToolResultMessages() was already called above so any
              // pre-fetched results are already in this.messages.
              if (this.deps.caseSchema?.executionMode === 'sop') {
                const alreadyCalledTools = toolResults
                  .filter((r) => r.name !== 'create_case')
                  .map((r) => r.name)

                const planMsg = alreadyCalledTools.length > 0
                  ? `[System] Case opened in SOP mode. You called ${alreadyCalledTools.join(', ')} before creating your plan. ` +
                    `YOUR NEXT ACTION (mandatory): call todo_write({ "action": "add", "text": "..." }) once per SOP step. ` +
                    `For steps already covered by the data above, add them then immediately complete them with notes. ` +
                    `The "action" field is required — never omit it.`
                  : `[System] Case opened in SOP mode. YOUR NEXT ACTION (mandatory): call todo_write({ "action": "add", "text": "..." }) ` +
                    `once for every step in the SOP. Do NOT call any investigation tool until todos exist.`

                this.messages.push(this.makeUserMessage(planMsg))
                await this.traceWriter.write('loop_decision', 'SOP: planning mandate injected', {
                  alreadyCalledTools, caseType, iteration: this.iterationCount,
                })
              }

              // Continue loop — next iteration has caseLoop active
              continue
            }
          } catch (err) {
            console.error('[AgentLoop] Failed to create case from create_case tool:', err)
          }
        }

        // create_case called when a case is already active — replace mock
        // result so the LLM doesn't see a fake case_mock_001 ID.
        if (this.caseLoop) {
          const key = 'dupCreateCaseCount'
          const dupCount = (this.caseMemory.getConfirmedFacts()[key] as number) || 0
          const nextCount = dupCount + 1

          for (let i = this.messages.length - 1; i >= 0; i--) {
            const m = this.messages[i]
            if (m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('Tool create_case result:')) {
              if (nextCount >= 2) {
                // Force stop: the model keeps calling create_case despite already_active feedback
                m.content = `Tool create_case result: ${JSON.stringify({ caseId: this.deps.caseId, status: 'already_active', note: 'STOP calling create_case. The case is already active. Respond with text only — do NOT call create_case again.' })}`
                await this.traceWriter.write('loop_decision', 'Create_case called repeatedly despite active case', { count: nextCount })
              } else {
                m.content = `Tool create_case result: ${JSON.stringify({ caseId: this.deps.caseId, status: 'already_active', note: 'Case already exists — continue with the active case' })}`
              }
              break
            }
          }
          this.caseMemory.getConfirmedFacts()[key] = nextCount
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
        if (caseToolResult.type === 'terminal') return caseToolResult.result
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
  // runReActLoop — unified ReAct loop shared by all ExecutionPolicy impls
  // -----------------------------------------------------------------------

  /**
   * Unified ReAct loop encapsulating iteration, streaming, tool execution,
   * error recovery, compaction, and chain tracking. Delegates prompt
   * assembly, tool filtering, continuation decisions, and terminal-tool
   * interception to the supplied {@link ExecutionPolicy}.
   *
   * The existing `run()` method remains unchanged for backward compat.
   */
  async runReActLoop(
    ctx: AgentContext,
    policy: ExecutionPolicy,
    sendEvent: (event: SSEEvent) => void,
    userMessage: string,
  ): Promise<LoopResult> {
    // Wrap sendEvent for abort safety (same pattern as run())
    const safeSendEvent = (event: SSEEvent) => {
      if (this.aborted) return
      try { sendEvent(event) } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          this.aborted = true
          this.abortController.abort()
        }
      }
    }

    // ── Chain tracking ───────────────────────────────────────────
    const agentName = ctx.isSubAgent
      ? `SubAgent[${ctx.agentId.slice(-8)}]`
      : `Main[${ctx.agentId.slice(-8)}]`
    await this.traceWriter.writeAgentTreeNode(agentName, ctx.depth, ctx.chainId, 'runReActLoop start')

    // ── Record user message ──────────────────────────────────────
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      createdAt: new Date(),
    }
    this.messages.push(userMsg)

    // ── ReAct loop ───────────────────────────────────────────────
    const maxIter = ctx.maxIterations || this.deps.config.maxIterations
    let iteration = 0

    while (iteration < maxIter) {
      iteration++
      this.profiler.incrementIteration()

      // ── Compaction ───────────────────────────────────────────
      const compactResult = await this.checkAndCompact()
      if (compactResult.shouldCompact) {
        safeSendEvent({
          type: 'withheld',
          data: 'Compacting context...',
          timestamp: new Date().toISOString(),
        })
      }

      safeSendEvent({
        type: 'stream_request_start',
        data: null,
        timestamp: new Date().toISOString(),
      })

      // ── System prompt via policy ─────────────────────────────
      const basePrompt = this.deps.systemPrompt || ''
      const systemPrompt = policy.buildPrompt(basePrompt)

      // ── Tools: restrict by ctx.allowedTools, then policy ──────
      const allTools = this.skillRouter.getTools()
      const allowedTools = allTools.filter((t) => ctx.allowedTools.has(t.name))
      const tools = policy.filterTools(allowedTools, iteration)

      // ── Streaming text sanitizer (per-iteration) ──────────────
      const textSanitizer = new StreamingTextSanitizer()

      // ── StreamingToolExecutor ────────────────────────────────
      const toolExecutor = new StreamingToolExecutor(
        this.skillRouter.getToolDefinitions(),
        (toolUse, status) => {
          safeSendEvent({
            type: status === 'executing' ? 'tool_executing' : 'skill_result',
            data: {
              name: toolUse.name,
              status,
              result: status !== 'executing' ? toolUse.result : undefined,
            },
            timestamp: new Date().toISOString(),
          })
        },
      )

      // ── Build API messages ───────────────────────────────────
      const apiMessages = this.buildApiMessages()

      // ── Stream with error recovery (+ reactiveCompact on 413) ─
      let stream: ReturnType<typeof this.anthropicClient.messages.stream>
      let streamAttempt = 0
      const maxStreamAttempts = 2

      while (streamAttempt < maxStreamAttempts) {
        streamAttempt++
        try {
          if (this.abortController.signal.aborted) break

          stream = this.anthropicClient.messages.stream({
            model: this.deps.config.model,
            max_tokens: this.deps.config.maxOutputTokens ?? 4096,
            system: systemPrompt,
            messages: apiMessages,
            tools,
            ...(this.deps.config.showThinking ? {
              thinking: { type: 'enabled' as const, budget_tokens: this.deps.config.thinkingBudget || 4096 },
            } : {}),
          }, { signal: this.abortController.signal })
          break
        } catch (err) {
          const errStr = String(err)

          // Reactive compact on 413 / context_length_exceeded
          if (errStr.includes('413') || errStr.includes('context_length_exceeded')) {
            this.messages = reactiveCompact(this.messages)
            await this.traceWriter.write('loop_decision', 'Reactive compact on 413', { error: errStr })
          }

          if (streamAttempt >= maxStreamAttempts || this.abortController.signal.aborted) {
            safeSendEvent({
              type: 'error',
              data: `LLM API error after ${streamAttempt} attempts`,
              timestamp: new Date().toISOString(),
            })
            await this.traceWriter.write('loop_decision', 'Exit: LLM API error', { error: errStr, attempts: streamAttempt })
            await this.writeProfilerSnapshot()
            return {
              messages: this.messages,
              caseStatus: 'escalated' as CaseStatus,
              transition: 'error',
              reason: 'llm_api_error',
            }
          }

          await this.traceWriter.write('loop_decision', `LLM stream retry ${streamAttempt}/${maxStreamAttempts}`, { error: errStr })
          await new Promise((r) => setTimeout(r, 1000 * streamAttempt))
        }
      }

      if (this.abortController.signal.aborted) break
      stream = stream!

      // ── Stream event handling ────────────────────────────────
      const blocks = new Map<number, StreamContentBlock>()
      let assistantMessage: AssistantMessage | null = null
      let assistantPushed = false
      let fullText = ''
      let stopReason: string | null = null
      let usage: Record<string, unknown> | null = null

      const iterationStartTime = Date.now()
      let streamEndedAt = iterationStartTime

      try {
        for await (const event of stream) {
          switch (event.type) {
            case 'message_start':
              assistantMessage = {
                id: event.message.id,
                role: 'assistant',
                content: '',
                createdAt: new Date(),
                isStreaming: true,
              }
              break

            case 'content_block_start': {
              const b = event.content_block
              if (b.type === 'tool_use') {
                const seedContent =
                  b.input && typeof b.input === 'object' && Object.keys(b.input as Record<string, unknown>).length > 0
                    ? JSON.stringify(b.input)
                    : ''
                blocks.set(event.index, {
                  index: event.index,
                  type: 'tool_use',
                  id: b.id,
                  name: b.name,
                  content: seedContent,
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

            case 'content_block_delta': {
              const d = event.delta
              const cb = blocks.get(event.index)
              if (!cb) break

              if (d.type === 'text_delta') {
                if (!fullText) this.profiler.recordFirstToken()
                cb.content += d.text
                fullText += d.text
                const cleanChunk = textSanitizer.feed(d.text)
                if (cleanChunk) {
                  safeSendEvent({
                    type: 'text_delta',
                    data: cleanChunk,
                    timestamp: new Date().toISOString(),
                  })
                }
              } else if (d.type === 'input_json_delta') {
                cb.content += d.partial_json
              } else if (d.type === 'thinking_delta') {
                cb.content += d.thinking
                if (this.deps.config.showThinking) {
                  safeSendEvent({
                    type: 'thinking_delta',
                    data: d.thinking,
                    timestamp: new Date().toISOString(),
                  })
                }
              }
              break
            }

            case 'content_block_stop': {
              const stoppedBlock = blocks.get(event.index)
              if (!stoppedBlock) break
              stoppedBlock.completed = true

              if (stoppedBlock.type === 'tool_use') {
                let input: Record<string, unknown> = {}
                try {
                  input = JSON.parse(stoppedBlock.content || '{}')
                } catch { /* malformed JSON — tool runs with empty input */ }

                const toolUse: ToolUse = {
                  id: stoppedBlock.id,
                  name: stoppedBlock.name,
                  input,
                }
                toolExecutor.enqueue(toolUse)
              }
              break
            }

            case 'message_delta': {
              const msgDelta = event as unknown as {
                type: 'message_delta'
                delta: { stop_reason?: string | null; usage?: Record<string, unknown> }
                usage?: Record<string, unknown>
              }
              const delta = msgDelta.delta
              if (delta?.stop_reason != null) stopReason = delta.stop_reason
              const mergedUsage = msgDelta.usage ?? delta?.usage
              if (mergedUsage) usage = mergedUsage
              break
            }

            case 'message_stop': {
              const tail = textSanitizer.flush()
              if (tail) {
                safeSendEvent({ type: 'text_delta', data: tail, timestamp: new Date().toISOString() })
              }
              break
            }
          }
        }
      } catch (streamErr) {
        const errStr = String(streamErr)

        if (this.abortController.signal.aborted) {
          await toolExecutor.waitForAll().catch(() => {})
          await this.traceWriter.write('loop_decision', 'Stream aborted (connection lost)', { iteration })
          await this.writeProfilerSnapshot()
          return {
            messages: this.messages,
            caseStatus: this.currentStage as CaseStatus,
            transition: 'connection_lost',
            reason: 'connection_lost',
          }
        }

        // Reactive compact on 413 during streaming
        if (errStr.includes('413') || errStr.includes('context_length_exceeded')) {
          this.messages = reactiveCompact(this.messages)
          await this.traceWriter.write('loop_decision', 'Reactive compact on stream error', { error: errStr })
          continue
        }

        await this.traceWriter.write('loop_decision', 'Stream error', { error: errStr, iteration })
        break
      }

      streamEndedAt = Date.now()

      // ── Trace LLM response ───────────────────────────────────
      if (usage) {
        const calledToolNames = [...blocks.values()].filter((b) => b.type === 'tool_use').map((b) => b.name)
        await this.traceWriter.writeLlmResponse(stopReason, usage, iteration, fullText, calledToolNames)
        this.profiler.addTokens(
          Number((usage.input_tokens as number | undefined) ?? (usage.inputTokens as number | undefined) ?? 0),
          Number((usage.output_tokens as number | undefined) ?? (usage.outputTokens as number | undefined) ?? 0),
        )
      }

      // ── Finalize assistant message ────────────────────────────
      if (!assistantMessage) {
        throw new Error('No assistant message received in runReActLoop')
      }
      assistantMessage.content = fullText
      assistantMessage.isStreaming = false

      // ── Wait for tool execution ──────────────────────────────
      const toolResults = await toolExecutor.waitForAll()
      for (const tr of toolResults) {
        this.profiler.addToolExecution(tr.latencyMs || 0)
      }

      // ── Terminal tool interception via policy ─────────────────
      let terminalResult: LoopResult | null = null
      for (const tr of toolResults) {
        const handled = policy.handleTerminalTool(tr.name, tr.toolUse?.input ?? {})
        if (handled?.type === 'handled') {
          terminalResult = handled.result as LoopResult
          break
        }
      }

      // Add assistant + tool results to message history
      if (!assistantPushed) { this.messages.push(assistantMessage); assistantPushed = true }
      this.addToolResultMessages(toolResults)

      if (terminalResult) {
        await this.writeProfilerSnapshot()
        return terminalResult
      }

      // ── Apply tool results to case memory ────────────────────
      for (const result of toolResults) {
        const payload = unwrapToolExecutionPayload(result.output)
        await this.caseMemory.applySkillResult(result.name, payload)
      }

      // ── Evaluate continuation via policy ──────────────────────
      const mappedResults: ToolResult[] = toolResults.map((r) => {
        const inner = r.output as ToolResult | undefined
        return {
          ok: inner?.ok ?? true,
          output: inner?.output ?? r.output,
          error: inner?.error,
          latencyMs: r.latencyMs,
        }
      })

      const continuation = await policy.evaluateContinuation(
        assistantMessage,
        mappedResults,
        iteration,
      )

      switch (continuation.action) {
        case 'continue':
          safeSendEvent({
            type: 'message_stop',
            data: { reason: 'next_turn', stopReason, stage: this.currentStage },
            timestamp: new Date().toISOString(),
          })
          continue

        case 'stop':
          await this.traceWriter.write('loop_decision', 'Exit: policy stop', {
            reason: continuation.reason,
            isError: continuation.isError,
            iteration,
          })
          safeSendEvent({
            type: 'message_stop',
            data: { reason: continuation.reason, stopReason },
            timestamp: new Date().toISOString(),
          })
          await this.writeProfilerSnapshot()
          return {
            messages: this.messages,
            caseStatus: this.currentStage as CaseStatus,
            transition: continuation.isError ? 'error' : 'next_turn',
            currentStage: this.currentStage,
            reason: continuation.reason,
          }

        case 'transition':
          await this.traceWriter.write('loop_decision', `Stage transition: ${continuation.nextStage}`, {
            nextStage: continuation.nextStage,
            iteration,
          })
          safeSendEvent({
            type: 'message_stop',
            data: { reason: 'stage_transition', stage: continuation.nextStage },
            timestamp: new Date().toISOString(),
          })
          continue

        case 'complete_task':
          await this.traceWriter.write('loop_decision', 'Exit: task complete', {
            iteration,
            subAgentResult: continuation.result,
          })
          safeSendEvent({
            type: 'message_stop',
            data: { reason: 'task_complete' },
            timestamp: new Date().toISOString(),
          })
          await this.writeProfilerSnapshot()
          return {
            messages: this.messages,
            caseStatus: this.currentStage as CaseStatus,
            transition: 'next_turn',
            currentStage: this.currentStage,
            reason: 'task_complete',
          }
      }
    }

    // ── Max iterations reached ──────────────────────────────────
    await this.traceWriter.write('loop_decision', 'Exit: max iterations', { iteration, messageCount: this.messages.length })
    safeSendEvent({
      type: 'message_stop',
      data: { reason: 'max_iterations' },
      timestamp: new Date().toISOString(),
    })
    await this.writeProfilerSnapshot()
    return {
      messages: this.messages,
      caseStatus: this.currentStage as CaseStatus,
      transition: 'next_turn',
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
            todos: this.caseMemory.getTodos(),
            dashboardVersion: this.caseMemory.getDashboardVersion(),
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
                todos: this.caseMemory.getTodos(),
                dashboardVersion: this.caseMemory.getDashboardVersion(),
              },
            }
          }
          return {
            ...result,
            output: {
              ok: false,
              error: 'todo_write requires action ("add"|"update"|"complete"|"cancel") and relevant fields. Current todos returned so you can proceed.',
              todos: this.caseMemory.getTodos(),
              dashboardVersion: this.caseMemory.getDashboardVersion(),
            },
          }
        }

        if (!input.action) {
          if (Array.isArray((raw as any)?.todos)) {
            // Model tried to send a batch: add each as a separate todo
            const batchItems = (raw as any).todos as Array<{ text?: string; notes?: string }>
            let lastTodos: ReturnType<typeof this.caseMemory.getTodos> = this.caseMemory.getTodos()
            for (const item of batchItems) {
              if (item?.text) {
                const out = this.caseMemory.applyTodoAction({ action: 'add', text: item.text, notes: item.notes })
                lastTodos = out.todos
              }
            }
            return {
              ...result,
              output: { ok: true, todos: lastTodos, dashboardVersion: this.caseMemory.getDashboardVersion() },
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
                todos: this.caseMemory.getTodos(),
                dashboardVersion: this.caseMemory.getDashboardVersion(),
              },
            }
          }
        }

        if (!input?.action) {
          return { ...result, output: { ok: false, error: 'Missing required field: action', todos: this.caseMemory.getTodos() } }
        }

        const outcome = this.caseMemory.applyTodoAction(input as any)
        return {
          ...result,
          output: {
            ok: true,
            todos: outcome.todos,
            dashboardVersion: this.caseMemory.getDashboardVersion(),
          },
        }
      }

      return result
    })
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
    if (this.deps.config.debugMode) {
      writeDebugTranscript(this.deps.caseId, this.messages)
    }
  }

  /**
   * Per-message classifier — called once at the start of each run() turn
   * when a case is currently active.
   *
   * Returns "core" when the user message is clearly casual / off-topic
   * (greetings, date questions, unrelated queries), so the turn is handled
   * by ConversationLoop without stage enforcement or ReAct pressure.
   *
   * Returns "case" when the message relates to the active case or investigation.
   * Defaults to "case" on any error so we never accidentally drop case context.
   *
   * System/worker continuation messages bypass the LLM and return "case"
   * immediately. Everything else goes to a cheap structured LLM eval.
   */
  private async classifyMessage(userMessage: string): Promise<'case' | 'core'> {
    // System/worker messages are always case-related
    if (
      userMessage.startsWith('[System]') ||
      userMessage.startsWith('[SYSTEM]') ||
      userMessage.startsWith('[Human task') ||
      userMessage.startsWith('[Intent selected') ||
      userMessage.startsWith('Tool ')  // tool result injections
    ) {
      return 'case'
    }

    // All other messages → cheap LLM structured call
    try {
      const caseDisplayName = this.deps.caseSchema?.displayName || this.deps.caseSchema?.type || 'case'

      const classifyTool: Tool = {
        name: 'classify_mode',
        description: 'Classify whether this customer message is about the active case or off-topic.',
        input_schema: {
          type: 'object' as const,
          properties: {
            mode: {
              type: 'string' as const,
              enum: ['case', 'core'],
              description:
                '"case" — message is about the active case, its status, or related financial/account issues. ' +
                '"core" — message is a general question, greeting, acknowledgement, or completely unrelated topic.',
            },
          },
          required: ['mode'],
        },
      }

      const evalModel = this.deps.config.evaluationModel || this.deps.config.model
      const resp = await this.anthropicClient.messages.create({
        model: evalModel,
        max_tokens: 64,
        temperature: 0,
        system: `A customer has an active "${caseDisplayName}" support case in progress. Classify their latest message.`,
        tools: [classifyTool],
        messages: [{ role: 'user', content: userMessage.slice(0, 300) }],
      })

      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          const input = (block as any).input as Record<string, unknown>
          return input.mode === 'core' ? 'core' : 'case'
        }
      }
      return 'case' // safe default — never drop case context accidentally
    } catch (err) {
      console.warn('[AgentLoop] classifyMessage failed, defaulting to case:', err)
      return 'case'
    }
  }

  /**
   * LLM-based leaked-context sanitizer.
   *
   * MiniMax-class models occasionally leak internal context strings into text
   * output: <think> blocks, orphan </think> tags, "Tool X result:" echoes of
   * addToolResultMessages() payloads. An LLM eval detects and removes these
   * patterns — more robust than regex against new/evolving leakage formats.
   *
   * Returns cleaned text, or the original if no leakage is detected.
   */
  private async sanitizeLeakedContext(assistantText: string): Promise<string> {
    const cleanTool: Tool = {
      name: 'clean_response',
      description:
        'Return the user-facing portion of the assistant response with any leaked model-context removed.',
      input_schema: {
        type: 'object' as const,
        properties: {
          has_leaked_context: {
            type: 'boolean' as const,
            description:
              'True if the response contains leaked model internal context ' +
              '(thinking blocks, tool result echoes, system-level content).',
          },
          cleaned_text: {
            type: 'string' as const,
            description:
              'The response with all leaked internal context removed. ' +
              'If has_leaked_context is false, this should match the original text.',
          },
        },
        required: ['has_leaked_context', 'cleaned_text'],
      },
    }

    const evalModel =
      this.deps.config.evaluationModel || this.deps.config.model

    try {
      const msg = await this.anthropicClient.messages.create({
        model: evalModel,
        max_tokens: 1024,
        temperature: 0,
        system:
          'You are a response sanitizer. Some assistant responses accidentally leak ' +
          'internal model context that should NOT be shown to users:\n' +
          '\n' +
          '  1. <think>...</think> blocks — chain-of-thought reasoning\n' +
          '  2. Orphan </think> tags — leaked CoT without opening tag\n' +
          '  3. "Tool <name> result: {...}" — verbatim echoes of tool outputs\n' +
          '     that were injected as assistant messages (addToolResultMessages)\n' +
          '\n' +
          'Your job: detect whether ANY of these patterns appear in the response. ' +
          'If they do, return the cleaned version with the leaked context removed. ' +
          'Preserve all genuine user-facing content exactly as-is.',
        tools: [cleanTool],
        messages: [
          {
            role: 'user',
            content: assistantText,
          },
        ],
      })

      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name === 'clean_response') {
          const input = block.input as { has_leaked_context?: boolean; cleaned_text?: string }
          if (input.has_leaked_context && input.cleaned_text !== undefined) {
            return input.cleaned_text
          }
        }
      }
    } catch {
      // If the sanitizer eval fails, return the original text — better to show
      // potentially noisy output than to drop the response entirely.
    }

    return assistantText
  }

  /**
   * ReAct compliance check — runs when the model produces a text-only turn
   * (no tool calls). Uses a cheap LLM to decide whether the response is a
   * legitimate end-of-turn or the model is "describing instead of doing."
   *
   * Returns "nudge" when the assistant text implies action is needed
   * (investigation, escalation, verification, external help) but no tool
   * was called to perform it. Returns "pass" for genuine clarifications,
   * resolutions, or conversational turns.
   */
  private async evaluateReactCompliance(assistantText: string): Promise<'pass' | 'nudge'> {
    const mem = this.caseMemory.getSummary()
    const skillsAvailable = this.skillRouter
      .getToolDefinitions()
      .map((s) => `${s.name}: ${s.description}`)
      .join('\n')

    const decideTool: Tool = {
      name: 'decide_action',
      description: 'Record whether the assistant response is a valid end-of-turn or needs a nudge.',
      input_schema: {
        type: 'object' as const,
        properties: {
          decision: {
            type: 'string' as const,
            enum: ['pass', 'nudge'],
            description:
              '"pass" — the response asks a clarifying question, delivers a final resolution, ' +
              'provides requested information, or is a natural conversational turn. ' +
              '"nudge" — the response describes a problem, expresses uncertainty, ' +
              'indicates something needs to happen (check, verify, review, escalate, wait for external help), ' +
              'or implies action is required, but no tool was called to perform that action.',
          },
          reason: { type: 'string' as const, description: 'Brief explanation of the decision.' },
        },
        required: ['decision', 'reason'],
      },
    }

    const evalModel =
      this.deps.config.evaluationModel || this.deps.config.model

    // Surface sub-agent findings — these often trigger verbal escalations
    // (the model sees the conflict, then describes escalation instead of acting).
    const subAgentFindings = Object.entries(mem.skillResults as Record<string, unknown>)
      .filter(([k]) => k.startsWith('subagent:'))
      .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 300)}`)
      .join('\n') || '(none)'

    try {
      const msg = await this.anthropicClient.messages.create({
        model: evalModel,
        max_tokens: 128,
        temperature: 0,
        system:
          'You are a ReAct compliance checker for a customer-service agent. ' +
          'Decide whether an assistant text-only response is a legitimate end-of-turn ' +
          'or whether the assistant is "describing instead of doing."',
        tools: [decideTool],
        messages: [
          {
            role: 'user',
            content: [
              'Decide: pass or nudge.',
              '',
              'NUDGE when ANY of these hold:',
              '  • The assistant says it WILL do something concrete (核查/核实/查询/确认/' +
              '提交/转交/升级/escalate/check/verify/look up) but did not call the matching tool.',
              '  • The assistant mentions handing the case to a human/specialist (人工/客服/' +
              'specialist/human) but did not call create_human_task.',
              '  • The assistant describes a problem (conflict / mismatch / missing data) that ' +
              'a tool can resolve, but did not call that tool.',
              '  • The assistant promises future work ("我会..." / "let me...") without doing it now.',
              '',
              'PASS when:',
              '  • The response is a complete final answer for the user.',
              '  • The response asks the user a clarifying question.',
              '  • The response confirms a resolution that has already been performed.',
              '  • The response is conversational (greeting/thanks/acknowledgement) with no implied action.',
              '',
              'Available tools (consider which tool the assistant SHOULD have called):',
              skillsAvailable,
              '',
              'Skills already called this turn: ' + JSON.stringify(mem.skillsCalled),
              'Sub-agent findings (often the trigger for verbal escalation):',
              subAgentFindings,
              '',
              'Assistant response:',
              assistantText.slice(0, 1500),
            ].join('\n'),
          },
        ],
      })

      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          const input = (block as any).input as Record<string, unknown> | undefined
          if (input?.decision === 'nudge') return 'nudge'
          return 'pass'
        }
      }
      return 'pass'
    } catch (err) {
      console.warn('[AgentLoop] ReAct compliance check failed, defaulting to pass:', err)
      return 'pass'
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

  // -----------------------------------------------------------------------
  // Unified ReAct Loop (shared by main agent and sub-agents)
  // -----------------------------------------------------------------------

  /**
   * Run a policy-driven ReAct loop.
   *
   * Delegates all behavior decisions (prompt assembly, tool filtering,
   * continuation, terminal tools) to the `ExecutionPolicy`, making the core
   * ReAct iteration reusable across main-agent, sub-agent, stage, and step
   * execution modes.
   *
   * Used by `SubAgent.run()` via `ChecklistPolicy`.
   */
  static async runReActLoop(
    client: Anthropic,
    systemPrompt: string,
    skillDefinitions: SkillDefinition[],
    ctx: AgentContext,
    policy: ExecutionPolicy,
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
        msg = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          temperature: 0.3,
          system: stagePrompt,
          tools: stageTools.length > 0 ? stageTools : undefined,
          messages: messages as any,
        }, { signal: ac.signal })
      } catch (err) {
        if (ac.signal.aborted) {
          return {
            messages: [],
            caseStatus: 'escalated' as const,
            transition: 'connection_lost' as const,
            reason: 'aborted',
          }
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
      const execResults = await StreamingToolExecutor.executeAll(skillDefinitions, toolUses)

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

      // Add assistant + tool results to message history
      messages.push({ role: 'assistant' as const, content: msg.content })
      messages.push({ role: 'user' as const, content: toolResultBlocks })

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
    this.caseMemory.ingestFormAnswers(answers)
  }

  getMemorySummary() {
    return this.caseMemory.getSummary()
  }

  loadMemory(data: Parameters<CaseMemoryManager['loadFromDb']>[0]) {
    this.caseMemory.loadFromDb(data)
    this.caseLoop?.syncStage()
  }
}
