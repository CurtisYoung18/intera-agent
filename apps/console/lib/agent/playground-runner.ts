// Playground turn runner — uses the REAL AgentLoop pipeline with injected
// Prisma persistence (messages written through port) + dry-run tool execution.

import { prisma } from '@intera/shared/prisma'
import { AgentLoop } from './loop'
import { type TraceRecord, createPrismaPersistence } from './persistence-port'
import { aggregateTraces, type PlaygroundTraceStep } from './trace-aggregator'
import type { SSEEvent, CaseSchemaConfig, ContentBlock } from '@intera/shared/types'
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_MODEL } from '@intera/shared/defaults'
import { resolvePrompt, buildPromptContext } from './prompt-resolver'
import { buildModePrompt } from './buildModePrompt'
import { loadAgentConfig } from './config-loader'
import { generateCaseId } from '@/lib/utils'
import { buildModelList } from './build-model-list'

/** Lightweight overrides for playground runs. Real AgentConfig is loaded from DB. */
export interface PlaygroundConfig {
  /** Override agentConfig.debugMode for trace detail. */
  debug?: boolean
  /** Override agentConfig.showThinking to force thinking output for this turn. */
  showThinking?: boolean
}

const MAX_PLAYGROUND_SESSIONS = 5

export interface PlaygroundResult {
  turnId: string
  caseType: string
  reply: string
  blocked: boolean
  trace: PlaygroundTraceStep[]
  resolvedModel: string
  applicableStages: string[]
  totalMs: number
}

/** Run a single playground turn using the REAL AgentLoop pipeline. */
export async function* runPlaygroundTurn(input: {
  orgId: string; message: string; playgroundConfig: PlaygroundConfig; configId?: string | null
  contentBlocks?: ContentBlock[]
  chatId?: string
  userId?: string
}): AsyncGenerator<SSEEvent> {
  const { orgId, message, playgroundConfig: pc, chatId: inputChatId, userId: inputUserId } = input
  const userId = inputUserId || 'playground'
  const turnId = `pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const startTime = Date.now()

  // ── Persistence (Prisma, messages written through port) ──
  const traces: TraceRecord[] = []
  const basePersistence = createPrismaPersistence()
  const persistence: typeof basePersistence = {
    ...basePersistence,
    async saveTrace(record: TraceRecord) {
      traces.push(record)
      await basePersistence.saveTrace(record)
    },
  }

  // ── Load real config from DB ──
  const agentConfig = await loadAgentConfig(input.configId)
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
    sessionBinding: { userId },
    availableTools: [],
  })

  // ── Resolve or create Case for this session ──
  let caseId: string
  let effectiveChatId: string
  let bootstrapNewCase: boolean

  if (inputChatId) {
    const existingCase = await prisma.case.findFirst({
      where: { chatId: inputChatId, type: 'playground', userId },
      select: { id: true },
    })
    if (!existingCase) {
      effectiveChatId = inputChatId
      bootstrapNewCase = true
      caseId = effectiveChatId
    } else {
      effectiveChatId = inputChatId
      bootstrapNewCase = false
      caseId = existingCase.id
    }
  } else {
    // First turn — check per-account cap
    const sessionCount = await prisma.case.count({
      where: { userId, type: 'playground' },
    })
    if (sessionCount >= MAX_PLAYGROUND_SESSIONS) {
      const oldestCases = await prisma.case.findMany({
        where: { userId, type: 'playground' },
        orderBy: { createdAt: 'asc' },
        take: sessionCount - MAX_PLAYGROUND_SESSIONS + 1,
        select: { id: true },
      })
      await prisma.case.deleteMany({
        where: { id: { in: oldestCases.map(c => c.id) } },
      })
    }
    effectiveChatId = `pg_${input.configId || 'default'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    bootstrapNewCase = true
    caseId = effectiveChatId
  }

  // Persist Case before AgentLoop sees it (loop.ts ensureCase only fires on escalation,
  // which requires caseSchema ≠ null — playground always uses caseSchema: null).
  await persistence.ensureCase({
    id: caseId,
    orgId,
    userId,
    type: 'playground',
    status: 'open',
    chatId: effectiveChatId,
  })

  const agentLoop = await AgentLoop.create({
    config: agentConfig,
    configId: input.configId || orgId,
    caseId,
    orgId,
    userId,
    systemPrompt: assembled.prompt,
    coreSystemPrompt: assembled.basePrompt,
    caseSchema: null,
    chatId: effectiveChatId,
    bootstrapNewCase,
    persistence,     // ← Prisma port
    dryRun: true,    // ← operational tools mocked, system_info allowed
  })

  // ── Load conversation history from DB ──
  const priorMessages = await prisma.message.findMany({
    where: { caseId },
    orderBy: { createdAt: 'asc' },
    take: 40,
  })
  if (priorMessages.length > 0) {
    agentLoop.loadMessages(
      priorMessages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        contentBlocks: (m as any).contentBlocks ?? undefined,
        createdAt: m.createdAt,
      })),
    )
  }

  // ── Handshake: tell UI the chatId ──
  yield {
    type: 'session_init' as const,
    data: { chatId: effectiveChatId, caseId },
    timestamp: new Date().toISOString(),
  }

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
    const models = buildModelList()
    const model = models.find(m => m.name === resolvedModel || m.id === resolvedModel)
    const supportsVision = model?.supportsVision ?? false // unknown model → block (fail-safe)
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
      await agentLoop.run(message, sendEvent, input.contentBlocks)
    } catch (err) {
      pending.push({ type: 'error', data: { code: 'internal', message: err instanceof Error ? err.message : 'Agent loop failed' }, timestamp: new Date().toISOString() })
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

  // ── Persist messages to DB (AgentLoop does NOT call saveMessages itself) ──
  await persistence.saveMessages([
    { id: turnId, role: 'user', content: message, caseId },
    { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: reply, caseId },
  ])

  // ── Derive applicable pipeline stages from agent config ──

  // Guardrails are loaded from DB by PolicyEngine (scoped to agentConfigId)
  const guardsConfigured = true

  // Tools and knowledge sources are always available (scoped to agentConfigId)
  const toolsConfigured = true
  const knowledgeConfigured = true
  const stageConfigured = false // playground always has caseSchema: null → no stage configs

  const applicableStages: string[] = ['Guardrails', 'Model generation']
  if (knowledgeConfigured) applicableStages.push('Knowledge retrieval')
  if (toolsConfigured) applicableStages.push('Tools')
  if (stageConfigured) applicableStages.push('Stage SOP')
  // Guardrails always included in base — but only fire if guardsConfigured
  // (fired=false when no guardrail events occur, which is correct)

  // ── Aggregate traces ──
  const totalMs = Date.now() - startTime
  const trace = aggregateTraces(traces, startTime, pc.debug ?? agentConfig.debugMode ?? false, applicableStages)
  const caseType = ''

  const result: PlaygroundResult = { turnId, caseType, reply, blocked, trace, resolvedModel, applicableStages, totalMs }
  yield { type: 'trace', data: { ...result, totalMs }, timestamp: new Date().toISOString() }
  yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: new Date().toISOString() }
}
