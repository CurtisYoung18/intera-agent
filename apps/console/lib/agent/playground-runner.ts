// Playground turn runner — uses the real AgentLoop runtime with DB-backed config,
// but keeps Playground-safe dry-run interception for side-effecting tools.

import { prisma } from '@intera/shared/prisma'
import { AgentLoop } from './loop'
import { type TraceRecord, createPrismaPersistence } from './persistence-port'
import {
  aggregateTraces,
  type PlaygroundCapabilityTruth,
  type PlaygroundToolExecutionTruth,
  type PlaygroundTraceStep,
} from './trace-aggregator'
import type { ContentBlock, Message, SSEEvent, ToolDefinition } from '@intera/shared/types'
import { buildModePrompt } from './buildModePrompt'
import { loadAgentConfig } from './config-loader'
import { buildModelList } from './build-model-list'
import { resolveEffectiveModel } from './resolve-model'
import { getProcedureRuntime, recordInitialInputEvent } from './session-store'
import { normalizeSSEEvent } from './stream-handler'
import { normalizeContentBlocks } from './message-builder'
import { ToolRouter } from './tools'
import {
  hasProviderOrDisplayContent,
  hydrateMessageFromDb,
  providerTranscriptPersistenceReceipt,
  serializeMessageForPersistence,
} from './provider-transcript'

/** Lightweight overrides for playground runs. Real AgentConfig is loaded from DB. */
export interface PlaygroundConfig {
  /** Override agentConfig.debugMode for trace detail. */
  debug?: boolean
  /** Force thinking output (both request + emit) for this turn. */
  emitThinking?: boolean
  /** Runtime executes configured tools; dry_run intercepts operational tools for side-effect-safe testing. */
  toolExecutionMode?: 'runtime' | 'dry_run'
}

const MAX_PLAYGROUND_SESSIONS = 5

function parsePayload(raw?: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function toolNameFromTrace(record: TraceRecord, payload?: Record<string, unknown> | null): string | undefined {
  const toolName = payload?.toolName
  if (typeof toolName === 'string' && toolName.trim()) return toolName

  const title = record.title ?? ''
  const match = title.match(/(?:Tool(?: called| result)?|ProcedureRun reconcile gate blocked Tool):\s*(.+)$/)
  return match?.[1]?.trim() || undefined
}

function classifyToolExecution(
  toolName: string,
  definition: ToolDefinition | undefined,
  dryRun: boolean,
): PlaygroundToolExecutionTruth {
  if (!definition) {
    return {
      effectiveMode: 'unknown',
      label: 'Unknown wiring',
      dryRun,
      note: `No active tool definition was found for "${toolName}".`,
    }
  }

  const toolCategory = definition.toolCategory
  const definitionMode = definition.mode
  const isKnowledgeTool = !!definition.knowledgeSourceId

  if (dryRun && toolCategory !== 'system_info') {
    return {
      effectiveMode: 'mocked_dry_run',
      label: 'Mocked in Playground dry-run',
      dryRun,
      definitionMode,
      toolCategory,
      note: 'Operational tools are intercepted in Playground and do not perform live side effects.',
    }
  }

  if (definitionMode === 'static_fixture') {
    return {
      effectiveMode: 'static_fixture',
      label: isKnowledgeTool ? 'Fixture-backed lookup' : 'Static fixture',
      dryRun,
      definitionMode,
      toolCategory,
      note: 'This tool returns fixture data from its stored definition.',
    }
  }

  if (definitionMode === 'http') {
    return {
      effectiveMode: 'runtime_backed',
      label: isKnowledgeTool ? 'Runtime-backed knowledge tool' : 'Runtime-backed tool',
      dryRun,
      definitionMode,
      toolCategory,
      note: 'This tool executes through its configured runtime endpoint.',
    }
  }

  if (definitionMode === 'system_managed' || definitionMode === 'channel' || definitionMode === 'workflow' || definitionMode === 'code_transform') {
    return {
      effectiveMode: 'runtime_managed',
      label: 'Runtime-managed tool',
      dryRun,
      definitionMode,
      toolCategory,
      note: 'This capability is handled directly by the runtime instead of an HTTP mock.',
    }
  }

  return {
    effectiveMode: 'unknown',
    label: 'Unknown execution mode',
    dryRun,
    definitionMode,
    toolCategory,
    note: 'The active runtime could not confirm how this tool executes.',
  }
}

function buildCapabilityTruth(
  resolvedModel: string,
  toolDefinitions: ToolDefinition[],
  dryRun: boolean,
): PlaygroundCapabilityTruth {
  const models = buildModelList()
  const modelMeta = models.find((model) => model.name === resolvedModel || model.id === resolvedModel)

  const toolSummary = {
    mockedDryRun: 0,
    runtimeBacked: 0,
    runtimeManaged: 0,
    staticFixture: 0,
    unknown: 0,
  }

  for (const definition of toolDefinitions) {
    const truth = classifyToolExecution(definition.name, definition, dryRun)
    if (truth.effectiveMode === 'mocked_dry_run') toolSummary.mockedDryRun++
    else if (truth.effectiveMode === 'runtime_backed') toolSummary.runtimeBacked++
    else if (truth.effectiveMode === 'runtime_managed') toolSummary.runtimeManaged++
    else if (truth.effectiveMode === 'static_fixture') toolSummary.staticFixture++
    else toolSummary.unknown++
  }

  const warnings: string[] = []
  if (!modelMeta) {
    warnings.push('Image support is unconfirmed because this model is missing from the active runtime model registry.')
  }
  if (toolSummary.mockedDryRun > 0) {
    warnings.push('Playground is in dry-run mode: operational tools are mocked and cannot perform live side effects.')
  }
  if (toolSummary.staticFixture > 0) {
    warnings.push('Some enabled system-info tools still return fixture data rather than runtime-backed results.')
  }
  if (toolSummary.unknown > 0) {
    warnings.push('Some enabled tools do not have confirmed execution wiring in the active runtime.')
  }

  const executionSurface = (() => {
    if (toolSummary.mockedDryRun > 0 && (toolSummary.runtimeBacked > 0 || toolSummary.runtimeManaged > 0 || toolSummary.staticFixture > 0)) {
      return {
        mode: 'dry_run_mixed' as const,
        label: 'Dry-run mixed surface',
        note: 'Prompting, hooks, and runtime-managed tools are real, while operational tools are mocked.',
      }
    }
    if (toolSummary.mockedDryRun > 0) {
      return {
        mode: 'dry_run_mock_only' as const,
        label: 'Dry-run mocked surface',
        note: 'The active tool surface is intercepted and no live side effects are executed.',
      }
    }
    if (toolSummary.runtimeBacked > 0 || toolSummary.runtimeManaged > 0 || toolSummary.staticFixture > 0) {
      return {
        mode: 'runtime_only' as const,
        label: 'Runtime-backed surface',
        note: 'No operational dry-run interception was detected in the active tool surface.',
      }
    }
    return {
      mode: 'unknown' as const,
      label: 'Unknown execution surface',
      note: 'The active runtime could not confirm whether this surface is mocked or live-backed.',
    }
  })()

  return {
    model: resolvedModel,
    imageSupport: modelMeta
      ? {
          status: modelMeta.supportsVision ? 'supported' : 'unsupported',
          label: modelMeta.supportsVision ? 'Supported' : 'Unsupported',
          source: 'configured_model_registry',
          note: `Resolved from configured model metadata for ${modelMeta.name}.`,
        }
      : {
          status: 'unknown',
          label: 'Unknown',
          source: 'missing_model_metadata',
          note: 'This model is not present in the active /api/admin/models registry.',
        },
    executionSurface,
    toolSummary,
    warnings,
  }
}

function enrichTraceRecord(
  record: TraceRecord,
  toolDefinitions: Map<string, ToolDefinition>,
  capabilityTruth: PlaygroundCapabilityTruth,
  dryRun: boolean,
): TraceRecord {
  const actionType = record.actionType
  const parsed = parsePayload(record.payload)

  if (actionType === 'llm_request_start') {
    const nextPayload = { ...(parsed ?? {}), playgroundCapabilityTruth: capabilityTruth }
    return { ...record, payload: JSON.stringify(nextPayload) }
  }

  if (actionType !== 'tool_call' && actionType !== 'tool_result') {
    return record
  }

  const toolName = toolNameFromTrace(record, parsed)
  if (!toolName) return record

  const definition = toolDefinitions.get(toolName)
  const executionTruth = classifyToolExecution(toolName, definition, dryRun)
  const nextPayload = {
    ...(parsed ?? {}),
    toolName,
    executionTruth,
    knowledgeSourceId: definition?.knowledgeSourceId,
    knowledgeSourceName: definition?.knowledgeSourceName,
  }
  return { ...record, payload: JSON.stringify(nextPayload) }
}

function deriveApplicableStages(toolDefinitions: ToolDefinition[]): string[] {
  const applicable = new Set<string>(['Hooks', 'Model generation'])
  if (toolDefinitions.some((definition) => !!definition.knowledgeSourceId)) {
    applicable.add('Knowledge retrieval')
  }
  if (toolDefinitions.some((definition) => !definition.knowledgeSourceId)) {
    applicable.add('Tools')
  }
  return ['Hooks', 'Knowledge retrieval', 'Tools', 'Procedure', 'Model generation']
    .filter((stage) => applicable.has(stage))
}

function latestProcedureCaseType(caseId: string | undefined): string {
  if (!caseId) return ''
  const runtime = getProcedureRuntime(caseId)
  const completed = runtime.completedProcedureRuns[runtime.completedProcedureRuns.length - 1]
  const paused = runtime.pausedProcedureRuns[runtime.pausedProcedureRuns.length - 1]
  return runtime.activeProcedureRun?.caseType
    ?? completed?.caseType
    ?? paused?.caseType
    ?? ''
}

export interface PlaygroundResult {
  turnId: string
  caseType: string
  reply: string
  blocked: boolean
  trace: PlaygroundTraceStep[]
  rawTrace?: TraceRecord[]
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
  formResult?: {
    caseId?: string
    answers: Record<string, string>
  }
}): AsyncGenerator<SSEEvent> {
  const { orgId, playgroundConfig: pc, chatId: inputChatId, userId: inputUserId, formResult } = input
  const message = formResult
    ? `Tool ask_user_questions result: ${JSON.stringify(formResult.answers)}`
    : input.message
  const agentConfigId = input.configId || orgId
  const contentBlocks = normalizeContentBlocks(input.contentBlocks)
  const dryRun = pc.toolExecutionMode === 'dry_run'
  const userId = inputUserId || 'playground'
  const turnId = `pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const startTime = Date.now()
  const createPlaygroundChatId = () => (
    `pg_${input.configId || 'default'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  )

  // ── Load real config from DB ──
  const agentConfig = await loadAgentConfig(input.configId)
  if (pc.emitThinking !== undefined) { (agentConfig as any).extendedThinking = pc.emitThinking }
  const resolvedModel = resolveEffectiveModel(agentConfig)

  const toolRouter = await ToolRouter.create(agentConfigId, dryRun)
  const toolDefinitions = toolRouter.getToolDefinitions()
  const toolDefinitionMap = new Map(toolDefinitions.map((definition) => [definition.name, definition]))
  const capabilityTruth = buildCapabilityTruth(resolvedModel, toolDefinitions, dryRun)
  const applicableStages = deriveApplicableStages(toolDefinitions)

  const hasImageBlock = contentBlocks?.some(
    (block) => block.type === 'image' || (block as { source?: { type?: string } }).source?.type === 'base64',
  )
  if (hasImageBlock && capabilityTruth.imageSupport.status !== 'supported') {
    const totalMs = Math.max(1, Date.now() - startTime)
    const trace = aggregateTraces([], startTime, pc.debug ?? false, ['Model generation'], capabilityTruth)
    yield {
      type: 'trace',
      data: {
        turnId,
        caseType: '',
        reply: '',
        blocked: true,
        trace,
        resolvedModel,
        applicableStages: ['Model generation'],
        totalMs,
      },
      timestamp: new Date().toISOString(),
    }
    yield {
      type: 'error',
      data: {
        code: 'unsupported_media',
        message: capabilityTruth.imageSupport.status === 'unknown'
          ? '当前模型的图片能力未确认或未接入，请切换到明确支持 vision 的模型。'
          : '当前模型不支持图片，请切换 vision-capable model。',
      },
      timestamp: new Date().toISOString(),
    }
    yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: new Date().toISOString() }
    return
  }

  // ── Persistence (Prisma, messages written through port) ──
  const traces: TraceRecord[] = []
  const basePersistence = createPrismaPersistence()
  const persistence: typeof basePersistence = {
    ...basePersistence,
    async saveTrace(record: TraceRecord) {
      const enriched = enrichTraceRecord(record, toolDefinitionMap, capabilityTruth, dryRun)
      traces.push({ ...enriched, createdAt: enriched.createdAt ?? new Date().toISOString() })
      await basePersistence.saveTrace(enriched)
    },
  }

  // ── Unified prompt assembly (matches production messages/route.ts) ──
  const assembled = await buildModePrompt({
    agentConfigId,
    coreSystemPrompt: agentConfig.coreSystemPrompt ?? null,
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
    // start_procedure mutates Case.type to the real case type, so Playground
    // session continuity must key on chatId + tenant boundary, not type.
    const existingCase = await prisma.case.findFirst({
      where: { orgId, chatId: inputChatId, userId },
      select: { id: true },
    })
    if (!existingCase) {
      effectiveChatId = createPlaygroundChatId()
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
      where: { orgId, userId, chatId: { startsWith: 'pg_' } },
    })
    if (sessionCount >= MAX_PLAYGROUND_SESSIONS) {
      const oldestCases = await prisma.case.findMany({
        where: { orgId, userId, chatId: { startsWith: 'pg_' } },
        orderBy: { createdAt: 'asc' },
        take: sessionCount - MAX_PLAYGROUND_SESSIONS + 1,
        select: { id: true },
      })
      await prisma.case.deleteMany({
        where: { id: { in: oldestCases.map((c: { id: string }) => c.id) } },
      })
    }
    effectiveChatId = createPlaygroundChatId()
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

  recordInitialInputEvent(caseId, {
    content: message,
    contentBlocks,
    origin: 'customer',
    source: formResult ? 'customer_form_result' : 'customer_message',
    formAnswers: formResult?.answers,
  })

  const agentLoop = await AgentLoop.create({
    config: agentConfig,
    configId: agentConfigId,
    caseId,
    orgId,
    userId,
    systemPrompt: assembled.prompt,
    coreSystemPrompt: assembled.basePrompt,
    caseSchema: null,
    chatId: effectiveChatId,
    bootstrapNewCase,
    persistence,     // ← Prisma port
    dryRun,
    persistRuntimeMemory: true,
    emitThinking: pc.emitThinking ?? false,
  })

  // ── Load persisted runtime memory for this Playground chat/case ──
  const persistedCaseMemory = await prisma.chatMemory.findUnique({ where: { caseId } }).catch(() => null)
  if (persistedCaseMemory) {
    agentLoop.loadMemory(persistedCaseMemory)
  } else {
    const persistedChatSession = await prisma.chatSession.findUnique({
      where: { orgId_chatId: { orgId, chatId: effectiveChatId } },
    }).catch(() => null)
    if (persistedChatSession) {
      agentLoop.loadMemory({
        confirmedFacts: persistedChatSession.confirmedFacts,
        keyEvents: persistedChatSession.keyEvents,
        summary: persistedChatSession.summary,
      })
    }
  }

  // ── Load conversation history from DB ──
  const priorMessages = await prisma.message.findMany({
    where: { caseId },
    orderBy: { createdAt: 'asc' },
    take: 40,
  })
  if (priorMessages.length > 0) {
    agentLoop.loadMessages(
      priorMessages.map((m: any) => hydrateMessageFromDb(m)),
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
  let loopMessages: Message[] = []
  const wake = () => { const r = resolveNext; resolveNext = null; r?.() }

  const sendEvent = (event: SSEEvent) => {
    const normalizedEvent = normalizeSSEEvent(event)
    // Collect text for reply
    if (normalizedEvent.type === 'text_delta') reply += normalizedEvent.data as string

    if (normalizedEvent.type === 'hook_blocked') blocked = true

    // Stream out in real-time (was buffered until end-of-run previously)
    pending.push(normalizedEvent)
    wake()
  }

  // ── Run the REAL agent loop concurrently with the stream consumer ──
  void (async () => {
    try {
      const result = await agentLoop.run(message, sendEvent, contentBlocks)
      loopMessages = result.messages
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

  // ── Persist full AgentLoop transcript, including internal provider tool_result rows. ──
  const transcriptMessages = loopMessages
    .filter((msg) => hasProviderOrDisplayContent(msg))
    .map((msg) => serializeMessageForPersistence(msg, caseId))
  if (transcriptMessages.length > 0) {
    await persistence.saveMessages(transcriptMessages)
    const receipt = providerTranscriptPersistenceReceipt(transcriptMessages)
    if (receipt.providerTranscriptPersisted) {
      await persistence.saveTrace({
        caseId,
        chatId: effectiveChatId,
        actionType: 'provider_transcript_persisted',
        title: 'Provider transcript persisted',
        detail: `${receipt.providerTranscriptMessageCount} provider transcript message(s) persisted`,
        payload: JSON.stringify(receipt),
        createdAt: new Date().toISOString(),
      })
    }
  } else {
    await persistence.saveMessages([
      { id: turnId, role: 'user', content: message, contentBlocks, caseId },
      { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: reply, caseId },
    ])
  }

  // ── Aggregate traces ──
  const totalMs = Math.max(1, Date.now() - startTime)
  const trace = aggregateTraces(traces, startTime, pc.debug ?? false, applicableStages, capabilityTruth)
  const caseType = latestProcedureCaseType(caseId)

  const result: PlaygroundResult = {
    turnId,
    caseType,
    reply,
    blocked,
    trace,
    rawTrace: pc.debug ? traces : undefined,
    resolvedModel,
    applicableStages,
    totalMs,
  }
  yield { type: 'trace', data: { ...result, totalMs }, timestamp: new Date().toISOString() }
  yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: new Date().toISOString() }
}
