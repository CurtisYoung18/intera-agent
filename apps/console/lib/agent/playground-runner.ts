// Playground turn runner — uses the REAL AgentLoop pipeline with injected
// memory persistence + dry-run tool execution. No DB writes.

import { prisma } from '@intera/shared/prisma'
import { AgentLoop } from './loop'
import { createMemoryPersistence, type TraceRecord } from './persistence-port'
import { aggregateTraces, type PlaygroundTraceStep } from './trace-aggregator'
import type { SSEEvent, AgentConfigData, CaseSchemaConfig } from '@intera/shared/types'
import { DEFAULT_SYSTEM_PROMPT, CORE_SYSTEM_PROMPT, CASE_SYSTEM_PROMPT, DEFAULT_MEMORY_STRATEGY, DEFAULT_POLICY_HOOKS } from '@intera/shared/defaults'
import { resolvePrompt, buildPromptContext } from './prompt-resolver'
import { generateCaseId } from '@/lib/utils'

export interface PlaygroundConfig {
  model: 'claude-sonnet' | 'minimax' | 'deepseek'
  persona: 'concise' | 'warm'
  memory: boolean
  knowledge: boolean
  debug: boolean
  guardrails: { pii: boolean; refundPolicy: boolean; profanity: boolean; escalation: boolean }
}

export interface PlaygroundResult {
  turnId: string
  intent: string
  caseType: string
  reply: string
  blocked: boolean
  trace: PlaygroundTraceStep[]
}

function parseNonEmptyJson(raw: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length > 0) return p
  } catch { /* ignore */ }
  return null
}

async function loadAgentConfig(orgId: string): Promise<AgentConfigData> {
  const dbConfig = await prisma.agentConfig.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } })
  if (dbConfig) {
    return {
      model: dbConfig.model,
      temperature: dbConfig.temperature,
      thinkingBudget: dbConfig.thinkingBudget,
      maxIterations: dbConfig.maxIterations,
      maxOutputTokens: (dbConfig as any).maxOutputTokens ?? 4096,
      systemPrompt: dbConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      coreSystemPrompt: (dbConfig as any).coreSystemPrompt || undefined,
      showThinking: dbConfig.showThinking,
      memoryStrategy: (parseNonEmptyJson(dbConfig.memoryStrategy) as any) || { ...DEFAULT_MEMORY_STRATEGY },
      policyHooks: (parseNonEmptyJson(dbConfig.policyHooks) as any) || { ...DEFAULT_POLICY_HOOKS },
      resumePrompt: '',
      formResponseTemplate: '',
      prefixContinuationEnabled: false,
      debugMode: Boolean((dbConfig as any).debugMode),
    }
  }
  return {
    model: 'claude-sonnet-4-20250514', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20,
    maxOutputTokens: 4096, systemPrompt: DEFAULT_SYSTEM_PROMPT, showThinking: false,
    memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY }, policyHooks: { ...DEFAULT_POLICY_HOOKS },
    resumePrompt: '', formResponseTemplate: '', prefixContinuationEnabled: false,
  }
}

/** Run a single playground turn using the REAL AgentLoop pipeline. */
export async function* runPlaygroundTurn(input: {
  orgId: string; message: string; playgroundConfig: PlaygroundConfig
}): AsyncGenerator<SSEEvent> {
  const { orgId, message, playgroundConfig: pc } = input
  const turnId = `pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const startTime = Date.now()

  // ── Memory persistence (zero DB writes) ──
  const { port: persistence, traces: memoryTraces } = createMemoryPersistence()

  // ── Load real config from DB ──
  const agentConfig = await loadAgentConfig(orgId)
  const systemPrompt = (agentConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT)
    + (pc.persona === 'concise' ? '\n\nBe concise and direct.' : '\n\nBe warm and empathetic.')

  // ── Create the REAL AgentLoop with injected port + dryRun ──
  const caseId = turnId
  const chatId = `pg_chat_${Date.now()}`

  const agentLoop = await AgentLoop.create({
    config: agentConfig,
    caseId,
    orgId,
    userId: 'playground',
    systemPrompt,
    coreSystemPrompt: CORE_SYSTEM_PROMPT,
    caseSchema: null,
    chatId,
    bootstrapNewCase: true,
    persistence,     // ← memory port: no DB writes
    dryRun: true,    // ← operational tools mocked, system_info allowed
  })

  // ── Collect events from real pipeline into buffer ──
  let reply = ''
  let blocked = false
  const eventBuffer: SSEEvent[] = []

  const sendEvent = (event: SSEEvent) => {
    // Collect text for reply
    if (event.type === 'text_delta') reply += event.data as string

    // Collect trace-relevant events
    if (['intent_classify', 'policy_hit', 'skill_called', 'skill_result', 'stage_eval', 'llm_request_start', 'llm_response'].includes(event.type as string)) {
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

    eventBuffer.push(event)
  }

  // ── Run the REAL agent loop ──
  try {
    await agentLoop.run(message, sendEvent)
  } catch (err) {
    eventBuffer.push({ type: 'error', data: err instanceof Error ? err.message : 'Agent loop failed', timestamp: new Date().toISOString() })
  }

  // Yield buffered events
  for (const ev of eventBuffer) { yield ev }

  // Add LLM request/response traces if not already captured
  if (!memoryTraces.some(t => t.actionType === 'llm_request_start')) {
    memoryTraces.push({ caseId: turnId, actionType: 'llm_request_start', title: 'LLM request', createdAt: new Date().toISOString() })
  }
  if (!memoryTraces.some(t => t.actionType === 'llm_response')) {
    memoryTraces.push({ caseId: turnId, actionType: 'llm_response', title: `LLM response: ${reply.length} chars`, detail: reply.slice(0, 200), createdAt: new Date().toISOString() })
  }

  // ── Aggregate traces ──
  const trace = aggregateTraces(memoryTraces, startTime, pc.debug)
  const intent = reply ? 'general' : 'none'
  const caseType = ''

  const result: PlaygroundResult = { turnId, intent, caseType, reply, blocked, trace }
  yield { type: 'trace', data: result, timestamp: new Date().toISOString() }
  yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: new Date().toISOString() }
}
