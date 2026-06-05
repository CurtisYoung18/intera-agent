// Playground turn runner — uses the REAL AgentLoop pipeline with injected
// memory persistence + dry-run tool execution. No DB writes.

import { prisma } from '@intera/shared/prisma'
import { AgentLoop } from './loop'
import { createMemoryPersistence, type TraceRecord } from './persistence-port'
import { aggregateTraces, type PlaygroundTraceStep } from './trace-aggregator'
import type { SSEEvent, CaseSchemaConfig, ContentBlock } from '@intera/shared/types'
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_MODEL } from '@intera/shared/defaults'
import { resolvePrompt, buildPromptContext } from './prompt-resolver'
import { buildModePrompt } from './buildModePrompt'
import { loadAgentConfig } from './config-loader'
import { generateCaseId } from '@/lib/utils'

/** Lightweight overrides for playground runs. Real AgentConfig is loaded from DB. */
export interface PlaygroundConfig {
  /** Override agentConfig.debugMode for trace detail. */
  debug?: boolean
  /** Override agentConfig.showThinking to force thinking output for this turn. */
  showThinking?: boolean
}

export interface PlaygroundResult {
  turnId: string
  caseType: string
  reply: string
  blocked: boolean
  trace: PlaygroundTraceStep[]
  resolvedModel: string
  applicableStages: string[]
}

/** Run a single playground turn using the REAL AgentLoop pipeline. */
export async function* runPlaygroundTurn(input: {
  orgId: string; message: string; playgroundConfig: PlaygroundConfig; configId?: string | null
  contentBlocks?: ContentBlock[]
}): AsyncGenerator<SSEEvent> {
  const { orgId, message, playgroundConfig: pc } = input
  const turnId = `pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const startTime = Date.now()

  // ── Memory persistence (zero DB writes) ──
  const { port: persistence, traces: memoryTraces } = createMemoryPersistence()

  // ── Load real config from DB ──
  const agentConfig = await loadAgentConfig(orgId, input.configId)
  if (pc.showThinking !== undefined) { (agentConfig as any).showThinking = pc.showThinking }
  const systemPrompt = agentConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT

  // ── Unified prompt assembly (matches production messages/route.ts) ──
  // Fixes bug: coreSystemPrompt was hardcoded to CORE_SYSTEM_PROMPT,
  // ignoring DB-configured coreSystemPrompt. Now reads from DB via buildModePrompt.
  const assembled = await buildModePrompt({
    orgId,
    coreSystemPrompt: agentConfig.coreSystemPrompt ?? null,
    systemPrompt: agentConfig.systemPrompt ?? null,
    caseAddendum: (agentConfig as any).caseAddendum ?? null,
    useLegacyCasePrompt: (agentConfig as any).useLegacyCasePrompt ?? true,
    hasActiveCase: true, // playground always simulates a case
    caseSchema: null,
    caseState: null,
    sessionBinding: { userId: 'playground' },
    availableTools: [],
  })

  // ── Create the REAL AgentLoop with injected port + dryRun ──
  const caseId = turnId
  const chatId = `pg_chat_${Date.now()}`

  const agentLoop = await AgentLoop.create({
    config: agentConfig,
    caseId,
    orgId,
    userId: 'playground',
    systemPrompt: assembled.prompt,
    coreSystemPrompt: assembled.basePrompt,
    caseSchema: null,
    chatId,
    bootstrapNewCase: true,
    persistence,     // ← memory port: no DB writes
    dryRun: true,    // ← operational tools mocked, system_info allowed
  })

  // ── Collect events from real pipeline and stream them as they fire ──
  let reply = ''
  let blocked = false

  // Tiny event bus: sendEvent (called by the agent loop synchronously) pushes
  // into `pending` and signals the consumer. The generator drains `pending`
  // and yields each event in real time.
  const pending: SSEEvent[] = []
  let resolveNext: (() => void) | null = null
  let runDone = false
  const wake = () => { const r = resolveNext; resolveNext = null; r?.() }

  const sendEvent = (event: SSEEvent) => {
    // Collect text for reply
    if (event.type === 'text_delta') reply += event.data as string

    // Collect trace-relevant events into memoryTraces (for final aggregated `trace` payload)
    if (event.type === 'llm_request_start') {
      const d = event.data as any
      memoryTraces.push({
        caseId: turnId,
        actionType: 'llm_request_start',
        title: d?.model ? `LLM request: ${d.model}` : 'LLM request',
        detail: `System prompt: ${(d?.systemPrompt || '').length} chars, ${(d?.messages || []).length} messages`,
        payload: JSON.stringify({
          systemPrompt: d?.systemPrompt,
          messages: d?.messages,
          model: d?.model,
        }),
        createdAt: new Date().toISOString(),
      })
    } else if (['policy_hit', 'skill_called', 'skill_result', 'stage_eval', 'llm_response'].includes(event.type as string)) {
      memoryTraces.push({
        caseId: turnId,
        actionType: event.type as string,
        title: typeof event.data === 'string' ? event.data : JSON.stringify(event.data).slice(0, 200),
        detail: typeof event.data === 'string' ? event.data : undefined,
        createdAt: new Date().toISOString(),
      })
    }

    if (event.type === 'tool_executing') {
      const d = event.data as any
      memoryTraces.push({
        caseId: turnId,
        actionType: 'skill_called',
        title: d?.name ? `${d.name} executing` : 'tool executing',
        detail: d?.dryRun ? 'dry-run' : 'executing',
        createdAt: new Date().toISOString(),
      })
    }

    if (event.type === 'skill_result') {
      const d = event.data as any
      memoryTraces.push({
        caseId: turnId,
        actionType: 'skill_result',
        title: d?.name ? `${d.name} result` : 'tool result',
        detail: d?.dryRun ? 'dry-run result' : 'result',
        createdAt: new Date().toISOString(),
      })
    }

    if (event.type === 'policy_blocked') blocked = true

    // Stream out in real-time (was buffered until end-of-run previously)
    pending.push(event)
    wake()
  }

  // ── Resolve effective model (used by guard + result) ──
  const resolvedModel = agentConfig.model || DEFAULT_MODEL

  // ── Non-vision guard (defense-in-depth) ──
  // UI should gate this first (Task 0h + Task 1), but if bypassed, fail clearly.
  const hasImageBlock = input.contentBlocks?.some(
    (b) => b.type === 'image' || (b as any).source?.type === 'base64',
  )
  if (hasImageBlock) {
    const nonVisionPrefixes = ['deepseek-', 'MiniMax-']
    const supportsVision = !nonVisionPrefixes.some((p) => resolvedModel.startsWith(p))
    if (!supportsVision) {
      yield {
        type: 'error',
        data: { code: 'unsupported_media', message: `${resolvedModel} does not support image input` },
        timestamp: new Date().toISOString(),
      }
      yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: new Date().toISOString() }
      return
    }
  }

  // ── Run the REAL agent loop concurrently with the stream consumer ──
  void (async () => {
    try {
      await agentLoop.run(message, sendEvent, undefined, input.contentBlocks)
    } catch (err) {
      pending.push({ type: 'error', data: err instanceof Error ? err.message : 'Agent loop failed', timestamp: new Date().toISOString() })
    } finally {
      runDone = true
      wake()
    }
  })()

  // Drain pending events as they arrive
  while (true) {
    while (pending.length > 0) {
      yield pending.shift()!
    }
    if (runDone) break
    await new Promise<void>((resolve) => { resolveNext = resolve })
  }

  // Add LLM request/response traces if not already captured (fallback for error paths)
  if (!memoryTraces.some(t => t.actionType === 'llm_request_start')) {
    memoryTraces.push({ caseId: turnId, actionType: 'llm_request_start', title: 'LLM request', detail: 'No prompt data captured', createdAt: new Date().toISOString() })
  }
  if (!memoryTraces.some(t => t.actionType === 'llm_response')) {
    memoryTraces.push({ caseId: turnId, actionType: 'llm_response', title: `LLM response: ${reply.length} chars`, detail: reply.slice(0, 200), createdAt: new Date().toISOString() })
  }

  // ── Derive applicable pipeline stages from agent config ──

  const guardsConfigured = (() => {
    try {
      const hooks = typeof agentConfig.policyHooks === 'string'
        ? JSON.parse(agentConfig.policyHooks)
        : (agentConfig.policyHooks || {})
      const keys = Object.keys(hooks)
      if (keys.length > 0) {
        // Also check if any hook array is non-empty
        return keys.some(k => {
          const arr = hooks[k]
          return Array.isArray(arr) && arr.length > 0
        })
      }
      return false
    } catch { return false }
  })()

  const bindings = agentConfig.capabilityBindings
  const toolsConfigured = !!(bindings?.tools?.length)
  const knowledgeConfigured = !!(bindings?.knowledge?.length)
  const stageConfigured = false // playground always has caseSchema: null → no stage configs

  const applicableStages: string[] = ['Guardrails', 'Model generation']
  if (knowledgeConfigured) applicableStages.push('Knowledge retrieval')
  if (toolsConfigured) applicableStages.push('Skills & tools')
  if (stageConfigured) applicableStages.push('Stage SOP')
  // Guardrails always included in base — but only fire if guardsConfigured
  // (fired=false when no guardrail events occur, which is correct)

  // ── Aggregate traces ──
  const trace = aggregateTraces(memoryTraces, startTime, pc.debug ?? agentConfig.debugMode ?? false, applicableStages)
  const caseType = ''

  const result: PlaygroundResult = { turnId, caseType, reply, blocked, trace, resolvedModel, applicableStages }
  yield { type: 'trace', data: result, timestamp: new Date().toISOString() }
  yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: new Date().toISOString() }
}
