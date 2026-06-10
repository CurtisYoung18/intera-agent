import type { TraceRecord } from '@/lib/agent/persistence-port'
import { runPlaygroundTurn, type PlaygroundResult } from '@/lib/agent/playground-runner'
import type { SavedScenario, ScenarioObservedEvidenceInput, ScenarioReceipt, ScenarioReceiptFailureReason, ScenarioReceiptStatus, ScenarioToolExecutionMode } from '@intera/shared/contracts/scenarios'
import type { ContentBlock, SSEEvent } from '@intera/shared/types'
import { buildScenarioReceipt } from './runner'

interface RuntimeExecutorInput {
  scenario: SavedScenario
  orgId: string
  agentConfigId: string
  userId?: string
}

interface RuntimeExecutorResult {
  evidence: ScenarioObservedEvidenceInput
  toolExecutionMode: ScenarioToolExecutionMode
  traceId?: string
  statusOverride?: ScenarioReceiptStatus
  failureReasons?: ScenarioReceiptFailureReason[]
}

export interface RunScenarioAgentRuntimeOptions {
  orgId: string
  agentConfigId: string
  userId?: string
  execute?: (input: RuntimeExecutorInput) => Promise<RuntimeExecutorResult>
}

export async function runScenarioAgentRuntime(
  scenario: SavedScenario,
  options: RunScenarioAgentRuntimeOptions,
): Promise<ScenarioReceipt> {
  const startedAt = new Date().toISOString()
  try {
    const execution = await (options.execute ?? executeScenarioThroughPlayground)({
      scenario,
      orgId: options.orgId,
      agentConfigId: options.agentConfigId,
      userId: options.userId,
    })
    return buildScenarioReceipt(scenario, execution.evidence, {
      executionMode: 'agentRuntime',
      toolExecutionMode: execution.toolExecutionMode,
      startedAt,
      completedAt: new Date().toISOString(),
      statusOverride: execution.statusOverride,
      failureReasons: execution.failureReasons,
      traceId: execution.traceId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return buildScenarioReceipt(scenario, {
      finalStatus: 'blocked',
      runtime: {
        blockedReason: message,
        staleEvidence: [],
        reconcileEvidence: [],
      },
    }, {
      executionMode: 'agentRuntime',
      toolExecutionMode: 'mocked',
      startedAt,
      completedAt: new Date().toISOString(),
      statusOverride: 'blocked',
      failureReasons: [{
        code: 'runtime_execution_error',
        message,
      }],
    })
  }
}

export async function executeScenarioThroughPlayground(input: RuntimeExecutorInput): Promise<RuntimeExecutorResult> {
  const events: SSEEvent[] = []
  const rawTrace: TraceRecord[] = []
  let chatId: string | undefined
  let caseId: string | undefined
  let finalResponse = ''
  let latestTrace: PlaygroundResult | null = null

  const userTurns = input.scenario.turns.filter((turn) => turn.role === 'user')
  const turns = userTurns.length > 0 ? userTurns : input.scenario.turns.slice(0, 1)

  for (const turn of turns) {
    let turnResponse = ''
    const stream = runPlaygroundTurn({
      orgId: input.orgId,
      message: turn.content,
      playgroundConfig: { debug: true, emitThinking: false },
      configId: input.agentConfigId,
      chatId,
      userId: input.userId ?? `scenario:${input.scenario.id}`,
      contentBlocks: turn.contentBlocks as ContentBlock[] | undefined,
    })

    for await (const event of stream) {
      events.push(event)
      if (event.type === 'session_init' && isRecord(event.data)) {
        chatId = typeof event.data.chatId === 'string' ? event.data.chatId : chatId
        caseId = typeof event.data.caseId === 'string' ? event.data.caseId : caseId
      }
      if (event.type === 'text_delta') turnResponse += String(event.data ?? '')
      if (event.type === 'trace' && isRecord(event.data)) {
        latestTrace = event.data as unknown as PlaygroundResult
        if (Array.isArray(latestTrace.rawTrace)) rawTrace.push(...latestTrace.rawTrace)
      }
    }

    if (turnResponse.trim()) finalResponse = turnResponse
  }

  const evidence = buildRuntimeEvidence({
    events,
    rawTrace,
    finalResponse,
    chatId,
    caseId,
    traceId: latestTrace?.turnId,
  })
  const errors = events.filter((event) => event.type === 'error')
  const failureReasons = errors.map((event) => ({
    code: 'runtime_event_error',
    message: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
  }))

  return {
    evidence,
    toolExecutionMode: 'mocked',
    traceId: latestTrace?.turnId ?? caseId ?? chatId,
    statusOverride: errors.length > 0 ? 'blocked' : undefined,
    failureReasons,
  }
}

export function buildRuntimeEvidence(input: {
  events: SSEEvent[]
  rawTrace?: TraceRecord[]
  finalResponse?: string
  chatId?: string
  caseId?: string
  traceId?: string
}): ScenarioObservedEvidenceInput {
  const rawTrace = input.rawTrace ?? []
  const toolCalls = collectToolCalls(input.events)
  const toolResults = collectToolResults(input.events, rawTrace)
  const hookDecisions = collectHookDecisions(input.events, rawTrace)
  const toolsCalled = toolCalls.length > 0
    ? toolCalls.map((call) => call.name)
    : toolResults.map((result) => result.name)
  const humanEvidence = collectHumanTransfer(input.events, toolCalls, toolResults, hookDecisions)
  const runtimeEvidence = collectRuntimeEvidence(rawTrace)
  const blockedEvent = input.events.find((event) => event.type === 'error')
  const finalStatus = blockedEvent
    ? 'blocked'
    : humanEvidence.humanTransfer
      ? 'waiting_human'
      : input.finalResponse?.trim()
        ? 'completed'
        : latestMessageStopReason(input.events) ?? 'next_turn'

  return {
    toolsCalled,
    toolCalls,
    toolResults,
    hookDecisions,
    humanTransfer: humanEvidence.humanTransfer,
    handoff: humanEvidence.handoff,
    finalResponse: input.finalResponse,
    finalStatus,
    traceId: input.traceId ?? input.caseId ?? input.chatId,
    runtime: {
      sessionId: input.traceId,
      chatId: input.chatId,
      caseId: input.caseId,
      blockedReason: blockedEvent ? eventMessage(blockedEvent) : undefined,
      staleEvidence: runtimeEvidence.staleEvidence,
      reconcileEvidence: runtimeEvidence.reconcileEvidence,
      eventsObserved: input.events.length,
    },
  }
}

function collectToolCalls(events: SSEEvent[]): NonNullable<ScenarioObservedEvidenceInput['toolCalls']> {
  const calls: NonNullable<ScenarioObservedEvidenceInput['toolCalls']> = []
  for (const event of events) {
    if (event.type !== 'tool_executing') continue
    const data = isRecord(event.data) ? event.data : {}
    const name = typeof data.name === 'string' ? data.name : undefined
    if (!name) continue
    calls.push({
      name,
      input: isRecord(data.input) ? data.input : undefined,
      executionMode: 'mocked',
      at: event.timestamp,
    })
  }
  return calls
}

function collectToolResults(
  events: SSEEvent[],
  rawTrace: TraceRecord[],
): NonNullable<ScenarioObservedEvidenceInput['toolResults']> {
  const results: NonNullable<ScenarioObservedEvidenceInput['toolResults']> = []
  for (const event of events) {
    if (event.type !== 'tool_result') continue
    const data = isRecord(event.data) ? event.data : {}
    const name = typeof data.name === 'string' ? data.name : undefined
    if (!name) continue
    const result = isRecord(data.result) ? data.result : undefined
    results.push({
      name,
      output: result?.output ?? result,
      error: typeof result?.error === 'string' ? result.error : undefined,
      executionMode: detectToolExecutionMode(result),
      at: event.timestamp,
    })
  }

  for (const record of rawTrace) {
    if (record.actionType !== 'tool_result') continue
    const payload = parsePayload(record.payload)
    const name = typeof payload?.toolName === 'string' ? payload.toolName : undefined
    if (!name) continue
    results.push({
      name,
      input: payload?.input,
      output: payload?.output,
      error: typeof payload?.error === 'string' ? payload.error : undefined,
      executionMode: detectToolExecutionMode(payload?.output),
      basedOnInputEpoch: typeof payload?.basedOnInputEpoch === 'number' ? payload.basedOnInputEpoch : undefined,
      evidenceState: payload?.evidenceState === 'stale' ? 'stale' : undefined,
      at: asIso(record.createdAt),
    })
  }
  return dedupeBy(results, (result) => `${result.name}:${result.toolUseId ?? ''}:${result.at ?? ''}:${JSON.stringify(result.output ?? null)}`)
}

function collectHookDecisions(
  events: SSEEvent[],
  rawTrace: TraceRecord[],
): NonNullable<ScenarioObservedEvidenceInput['hookDecisions']> {
  const decisions: NonNullable<ScenarioObservedEvidenceInput['hookDecisions']> = []

  for (const record of rawTrace) {
    const payload = parsePayload(record.payload)
    if (record.actionType === 'hook_hit' && typeof payload?.hookName === 'string') {
      decisions.push({
        hookName: payload.hookName,
        checkpoint: parseCheckpoint(payload.checkpoint) ?? 'Stop',
        decision: parseDecision(payload.result) ?? 'warn',
        reason: typeof payload.reason === 'string' ? payload.reason : undefined,
        at: asIso(record.createdAt),
      })
      continue
    }

    if (record.actionType !== 'loop_decision') continue
    const checkpoint = parseCheckpoint(payload?.checkpoint) ?? checkpointFromTitle(record.title)
    const results = Array.isArray(payload?.results) ? payload.results : []
    for (const result of results) {
      if (!isRecord(result) || typeof result.hookName !== 'string') continue
      const decision = parseDecision(result.action ?? result.result)
      if (!decision) continue
      decisions.push({
        hookName: result.hookName,
        checkpoint: checkpoint ?? 'Stop',
        decision,
        reason: typeof result.reason === 'string' ? result.reason : undefined,
        toolName: typeof payload?.toolName === 'string' ? payload.toolName : undefined,
        model: typeof result.modelUsed === 'string' ? result.modelUsed : undefined,
        at: asIso(record.createdAt),
      })
    }

    if (typeof payload?.hookNames !== 'undefined' && Array.isArray(payload.hookNames)) {
      for (const hookName of payload.hookNames) {
        if (typeof hookName !== 'string') continue
        decisions.push({
          hookName,
          checkpoint: checkpoint ?? 'PreToolUse',
          decision: 'escalate',
          reason: typeof payload.reasons === 'string' ? payload.reasons : undefined,
          at: asIso(record.createdAt),
        })
      }
    }
  }

  for (const event of events) {
    if (event.type !== 'hook_blocked') continue
    const data = isRecord(event.data) ? event.data : {}
    const hookNames = Array.isArray(data.hookNames) ? data.hookNames : []
    for (const hookName of hookNames) {
      if (typeof hookName !== 'string') continue
      decisions.push({
        hookName,
        checkpoint: 'PreToolUse',
        decision: 'block',
        toolName: typeof data.toolName === 'string' ? data.toolName : undefined,
        at: event.timestamp,
      })
    }
  }

  return dedupeBy(decisions, (decision) => `${decision.hookName}:${decision.checkpoint}:${decision.decision}:${decision.toolName ?? ''}:${decision.at ?? ''}`)
}

function collectHumanTransfer(
  events: SSEEvent[],
  toolCalls: NonNullable<ScenarioObservedEvidenceInput['toolCalls']>,
  toolResults: NonNullable<ScenarioObservedEvidenceInput['toolResults']>,
  hookDecisions: NonNullable<ScenarioObservedEvidenceInput['hookDecisions']>,
): Pick<ScenarioObservedEvidenceInput, 'humanTransfer' | 'handoff'> {
  const handoff: NonNullable<ScenarioObservedEvidenceInput['handoff']> = []
  for (const event of events) {
    if (event.type !== 'human_task_created' && event.type !== 'escalated') continue
    const data = isRecord(event.data) ? event.data : {}
    handoff.push({
      required: true,
      queue: typeof data.queue === 'string' ? data.queue : undefined,
      reason: typeof data.reason === 'string' ? data.reason : event.type,
      target: 'human',
      payload: data,
    })
  }

  for (const result of toolResults) {
    if (result.name !== 'create_human_task') continue
    handoff.push({
      required: true,
      reason: 'create_human_task observed in runtime trace',
      target: 'human',
      payload: isRecord(result.output) ? result.output : { output: result.output },
    })
  }

  const humanTransfer = handoff.length > 0 ||
    toolCalls.some((call) => call.name === 'create_human_task') ||
    toolResults.some((result) => result.name === 'create_human_task') ||
    hookDecisions.some((decision) => decision.decision === 'escalate')

  return { humanTransfer, handoff }
}

function collectRuntimeEvidence(rawTrace: TraceRecord[]): {
  staleEvidence: Record<string, unknown>[]
  reconcileEvidence: Record<string, unknown>[]
} {
  const staleEvidence: Record<string, unknown>[] = []
  const reconcileEvidence: Record<string, unknown>[] = []
  for (const record of rawTrace) {
    const payload = parsePayload(record.payload)
    const title = record.title.toLowerCase()
    if (title.includes('stale') || payload?.evidenceState === 'stale') {
      staleEvidence.push({ title: record.title, payload: payload ?? record.detail ?? null })
    }
    if (title.includes('reconcile') || payload?.source === 'reconcile') {
      reconcileEvidence.push({ title: record.title, payload: payload ?? record.detail ?? null })
    }
  }
  return { staleEvidence, reconcileEvidence }
}

function detectToolExecutionMode(value: unknown): ScenarioToolExecutionMode {
  if (hasDryRunMarker(value)) return 'mocked'
  return 'runtime'
}

function hasDryRunMarker(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasDryRunMarker)
  const record = value as Record<string, unknown>
  if (record._dryRun === true) return true
  return Object.values(record).some(hasDryRunMarker)
}

function checkpointFromTitle(title: string): 'PreToolUse' | 'PostToolUse' | 'Stop' | undefined {
  if (title.includes('PreToolUse')) return 'PreToolUse'
  if (title.includes('PostToolUse')) return 'PostToolUse'
  if (title.includes('Stop')) return 'Stop'
  if (title.startsWith('Hook blocked Tool') || title.startsWith('Hook escalated Tool')) return 'PreToolUse'
  return undefined
}

function parseCheckpoint(value: unknown): 'PreToolUse' | 'PostToolUse' | 'Stop' | undefined {
  if (value === 'PreToolUse' || value === 'PostToolUse' || value === 'Stop') return value
  return undefined
}

function parseDecision(value: unknown): 'allow' | 'warn' | 'block' | 'escalate' | undefined {
  if (value === 'allow' || value === 'warn' || value === 'block' || value === 'escalate') return value
  if (value === 'blocked') return 'block'
  if (value === 'escalated') return 'escalate'
  return undefined
}

function parsePayload(payload: string | null | undefined): Record<string, unknown> | undefined {
  if (!payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function latestMessageStopReason(events: SSEEvent[]): string | undefined {
  const event = [...events].reverse().find((item) => item.type === 'message_stop')
  if (!event || !isRecord(event.data)) return undefined
  return typeof event.data.reason === 'string' ? event.data.reason : undefined
}

function eventMessage(event: SSEEvent): string {
  if (typeof event.data === 'string') return event.data
  if (isRecord(event.data) && typeof event.data.message === 'string') return event.data.message
  return JSON.stringify(event.data)
}

function asIso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  return value
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = keyFor(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
