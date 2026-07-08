import type { TraceRecord } from '@/lib/agent/persistence-port'
import { runPlaygroundTurn, type PlaygroundResult } from '@/lib/agent/playground-runner'
import type { SavedScenario, ScenarioObservedEvidenceInput, ScenarioReceipt, ScenarioReceiptFailureReason, ScenarioReceiptStatus, ScenarioToolExecutionMode } from '@intera/shared/contracts/scenarios'
import type { ContentBlock, SSEEvent } from '@intera/shared/types'
import { buildScenarioReceipt } from './runner'
import { getProcedureRuntime } from '@/lib/agent/session-store'

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
    caseType: latestTrace?.caseType,
    traceId: latestTrace?.turnId,
    procedureRuns: snapshotProcedureRuns(caseId),
  })
  const errors = events.filter((event) => event.type === 'error')
  const failureReasons = errors.map((event) => ({
    code: 'runtime_event_error',
    message: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
  }))

  return {
    evidence,
    toolExecutionMode: deriveScenarioToolExecutionMode(latestTrace, evidence),
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
  caseType?: string
  traceId?: string
  procedureRuns?: NonNullable<NonNullable<ScenarioObservedEvidenceInput['runtime']>['procedureRuns']>
}): ScenarioObservedEvidenceInput {
  const rawTrace = input.rawTrace ?? []
  const toolCalls = collectToolCalls(input.events, rawTrace)
  const toolResults = collectToolResults(input.events, rawTrace)
  const knowledgeHits = collectKnowledgeHits(toolResults)
  const hookDecisions = collectHookDecisions(input.events, rawTrace)
  const toolsCalled = toolCalls.length > 0
    ? toolCalls.map((call) => call.name)
    : toolResults.map((result) => result.name)
  const humanEvidence = collectHumanTransfer(input.events, toolCalls, toolResults, hookDecisions)
  const runtimeEvidence = collectRuntimeEvidence(rawTrace)
  const transcriptHealth = collectTranscriptHealth(rawTrace)
  const blockedEvent = input.events.find((event) => event.type === 'error')
  const transition = latestMessageStopReason(input.events) ?? 'next_turn'
  const latestProcedureRun = latestProcedureRuntime(input.procedureRuns ?? [])
  const finalStatus = blockedEvent
    ? 'blocked'
    : humanEvidence.humanTransfer
      ? 'waiting_human'
      : input.finalResponse?.trim()
        ? 'completed'
        : transition

  return {
    caseType: input.caseType || undefined,
    toolsCalled,
    toolCalls,
    toolResults,
    knowledgeHits,
    hookDecisions,
    humanTransfer: humanEvidence.humanTransfer,
    handoff: humanEvidence.handoff,
    finalResponse: input.finalResponse,
    finalStatus,
    procedureStatus: latestProcedureRun?.status,
    procedureOutcome: latestProcedureRun?.outcome,
    traceId: input.traceId ?? input.caseId ?? input.chatId,
    runtime: {
      sessionId: input.traceId,
      chatId: input.chatId,
      caseId: input.caseId,
      transition,
      blockedReason: blockedEvent ? eventMessage(blockedEvent) : undefined,
      staleEvidence: runtimeEvidence.staleEvidence,
      reconcileEvidence: runtimeEvidence.reconcileEvidence,
      procedureRuns: input.procedureRuns ?? [],
      eventsObserved: input.events.length,
      transcriptHealth,
    },
  }
}

function snapshotProcedureRuns(
  caseId: string | undefined,
): NonNullable<NonNullable<ScenarioObservedEvidenceInput['runtime']>['procedureRuns']> {
  if (!caseId) return []
  const runtime = getProcedureRuntime(caseId)
  const runs = [
    ...(runtime.activeProcedureRun ? [runtime.activeProcedureRun] : []),
    ...runtime.pausedProcedureRuns,
    ...runtime.completedProcedureRuns,
  ]
  return runs.map((run) => ({
    runId: run.runId,
    procedureId: run.procedureId,
    displayName: run.displayName,
    status: run.status,
    outcome: run.outcome ?? undefined,
    reason: run.reason,
    version: 'v2',
    updatedAt: run.updatedAt,
    currentStepId: run.currentStepId,
    blockers: [...run.blockers],
    inputs: run.inputs.map((entry) => ({
      eventId: entry.eventId,
      inputEpoch: entry.inputEpoch,
      source: entry.source,
      origin: entry.origin,
      createdAt: entry.createdAt,
      content: entry.content,
      formAnswers: entry.formAnswers,
      summary: entry.summary,
    })),
    branches: run.steps.flatMap((step) =>
      (step.branches ?? []).map((branch) => ({
        stepId: step.id,
        branchId: branch.id,
        kind: branch.kind,
        label: branch.label,
        conditionLabel: branch.conditionLabel,
        status: branch.status,
        reason: branch.reason,
      })),
    ),
    evaluations: run.evaluations.map((entry) => ({
      id: entry.id,
      branchId: entry.branchId,
      conditionId: entry.conditionId,
      label: entry.label,
      decision: entry.decision,
      reason: entry.reason,
      basedOnInputEpoch: entry.basedOnInputEpoch,
      model: entry.model,
      createdAt: entry.createdAt,
      metadata: entry.metadata,
    })),
    evidence: run.evidence.slice(-12).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      stepId: entry.stepId,
      actionId: entry.actionId,
      branchId: entry.branchId,
      label: entry.label,
      toolName: entry.toolName,
      basedOnInputEpoch: entry.basedOnInputEpoch,
      state: entry.state,
      createdAt: entry.createdAt,
      metadata: entry.metadata,
    })),
  }))
}

function latestProcedureRuntime(
  runs: NonNullable<NonNullable<ScenarioObservedEvidenceInput['runtime']>['procedureRuns']>,
) {
  return runs
    .slice()
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))[0]
}

function collectToolCalls(
  events: SSEEvent[],
  rawTrace: TraceRecord[],
): NonNullable<ScenarioObservedEvidenceInput['toolCalls']> {
  const calls: NonNullable<ScenarioObservedEvidenceInput['toolCalls']> = []
  for (const event of events) {
    if (event.type !== 'tool_executing') continue
    const data = isRecord(event.data) ? event.data : {}
    const name = typeof data.name === 'string' ? data.name : undefined
    if (!name) continue
    calls.push({
      name,
      input: isRecord(data.input) ? data.input : undefined,
      executionMode: detectToolExecutionMode(data),
      at: event.timestamp,
    })
  }

  for (const record of rawTrace) {
    if (record.actionType !== 'tool_call') continue
    const payload = parsePayload(record.payload)
    const name = typeof payload?.toolName === 'string' ? payload.toolName : undefined
    if (!name) continue
    const nextCall = {
      name,
      input: payload?.input,
      executionMode: detectToolExecutionMode(payload),
      knowledgeSourceId: typeof payload?.knowledgeSourceId === 'string' ? payload.knowledgeSourceId : undefined,
      knowledgeSourceName: typeof payload?.knowledgeSourceName === 'string' ? payload.knowledgeSourceName : undefined,
      at: asIso(record.createdAt),
    }
    const existingIndex = calls.findIndex((call) => toolInvocationMatches(call, nextCall))
    if (existingIndex >= 0) {
      calls[existingIndex] = { ...calls[existingIndex], ...nextCall }
      continue
    }
    calls.push(nextCall)
  }

  return dedupeBy(calls, (call) => `${call.name}:${call.toolUseId ?? ''}:${JSON.stringify(call.input ?? null)}`)
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
      knowledgeSourceId: typeof data.knowledgeSourceId === 'string' ? data.knowledgeSourceId : undefined,
      knowledgeSourceName: typeof data.knowledgeSourceName === 'string' ? data.knowledgeSourceName : undefined,
      at: event.timestamp,
    })
  }

  for (const record of rawTrace) {
    if (record.actionType !== 'tool_result') continue
    const payload = parsePayload(record.payload)
    const name = typeof payload?.toolName === 'string' ? payload.toolName : undefined
    if (!name) continue
    const evidenceState: 'stale' | 'canonical' | undefined =
      payload?.evidenceState === 'stale'
        ? 'stale'
        : payload?.evidenceState === 'canonical'
          ? 'canonical'
          : undefined
    const nextResult: NonNullable<ScenarioObservedEvidenceInput['toolResults']>[number] = {
      name,
      input: payload?.input,
      output: payload?.output,
      error: typeof payload?.error === 'string' ? payload.error : undefined,
      executionMode: detectToolExecutionMode(payload),
      knowledgeSourceId: typeof payload?.knowledgeSourceId === 'string' ? payload.knowledgeSourceId : undefined,
      knowledgeSourceName: typeof payload?.knowledgeSourceName === 'string' ? payload.knowledgeSourceName : undefined,
      basedOnInputEpoch: typeof payload?.basedOnInputEpoch === 'number' ? payload.basedOnInputEpoch : undefined,
      evidenceState,
      at: asIso(record.createdAt),
    }
    const existingIndex = results.findIndex((result) => toolResultMatches(result, nextResult))
    if (existingIndex >= 0) {
      results[existingIndex] = { ...results[existingIndex], ...nextResult }
      continue
    }
    results.push(nextResult)
  }
  return dropProvisionalSystemManagedResults(
    dedupeBy(results, (result) => `${result.name}:${result.toolUseId ?? ''}:${JSON.stringify(result.output ?? null)}:${result.error ?? ''}`),
  )
}

function collectKnowledgeHits(
  toolResults: NonNullable<ScenarioObservedEvidenceInput['toolResults']>,
): NonNullable<ScenarioObservedEvidenceInput['knowledgeHits']> {
  const hits: NonNullable<ScenarioObservedEvidenceInput['knowledgeHits']> = []

  for (const result of toolResults) {
    const explicitSource = firstNonEmptyString(result as Record<string, unknown>, ['knowledgeSourceName', 'knowledgeSourceId'])
    if (!explicitSource && result.name !== 'search_knowledge' && !result.name.startsWith('kb_search_')) continue
    const query = isRecord(result.input) && typeof result.input.query === 'string'
      ? result.input.query
      : undefined
    const source = explicitSource ?? knowledgeSourceFromToolName(result.name)
    const docs = extractKnowledgeDocuments(result.output)

    for (const doc of docs) {
      hits.push({
        source,
        toolName: result.name,
        query,
        title: firstNonEmptyString(doc, ['title', 'document_name', 'documentName', 'name', 'question', 'heading']) ?? 'Knowledge result',
        snippet: firstNonEmptyString(doc, ['snippet', 'content', 'text', 'answer', 'body', 'summary']),
        documentId: firstNonEmptyString(doc, ['id', 'data_id', 'dataId', 'docId', 'documentId']),
        score: typeof doc.score === 'number' ? doc.score : undefined,
        executionMode: result.executionMode,
        at: result.at,
      })
    }
  }

  return dedupeBy(
    hits,
    (hit) => `${String(hit.source ?? '')}:${String(hit.toolName ?? '')}:${String(hit.documentId ?? '')}:${String(hit.title ?? '')}:${String(hit.at ?? '')}`,
  )
}

function extractKnowledgeDocuments(output: unknown): Array<Record<string, unknown>> {
  if (!isRecord(output)) return []
  for (const field of ['results', 'list', 'matches', 'items', 'hits']) {
    const value = output[field]
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

function knowledgeSourceFromToolName(toolName: string): string {
  return toolName.replace(/^kb_search_/, '') || toolName
}

function firstNonEmptyString(
  record: Record<string, unknown>,
  fields: string[],
): string | undefined {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
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
  for (const record of rawTrace) {
    const payload = parsePayload(record.payload)
    const title = record.title.toLowerCase()
    if (title.includes('stale') || payload?.evidenceState === 'stale') {
      staleEvidence.push({ title: record.title, payload: payload ?? record.detail ?? null })
    }
  }
  return { staleEvidence, reconcileEvidence: [] }
}

function collectTranscriptHealth(rawTrace: TraceRecord[]): NonNullable<NonNullable<ScenarioObservedEvidenceInput['runtime']>['transcriptHealth']> {
  const health = {
    providerTranscriptPersisted: false,
    toolPairsChecked: 0,
    toolPairsRepaired: 0,
    orphanToolResultsDropped: 0,
    legacyRowsSkipped: 0,
    compactPairsSummarized: 0,
  }

  for (const record of rawTrace) {
    const payload = parsePayload(record.payload)
    if (!payload) continue
    if (record.actionType === 'provider_transcript_persisted') {
      health.providerTranscriptPersisted ||= payload.providerTranscriptPersisted === true
      continue
    }
    if (record.actionType !== 'provider_transcript_health') continue
    health.providerTranscriptPersisted ||= payload.providerTranscriptPersisted === true
    health.toolPairsChecked += asCount(payload.toolPairsChecked)
    health.toolPairsRepaired += asCount(payload.toolPairsRepaired)
    health.orphanToolResultsDropped += asCount(payload.orphanToolResultsDropped)
    health.legacyRowsSkipped += asCount(payload.legacyRowsSkipped)
    health.compactPairsSummarized += asCount(payload.compactPairsSummarized)
  }

  return health
}

function detectToolExecutionMode(value: unknown): ScenarioToolExecutionMode {
  if (isRecord(value) && isRecord(value.executionTruth)) {
    const effectiveMode = value.executionTruth.effectiveMode
    if (effectiveMode === 'mocked_dry_run') return 'mocked'
    if (
      effectiveMode === 'runtime_backed'
      || effectiveMode === 'runtime_managed'
      || effectiveMode === 'static_fixture'
    ) {
      return 'runtime'
    }
  }
  if (hasDryRunMarker(value)) return 'mocked'
  return 'runtime'
}

function deriveScenarioToolExecutionMode(
  latestTrace: PlaygroundResult | null,
  evidence: ScenarioObservedEvidenceInput,
): ScenarioToolExecutionMode {
  const runtimeTruth = latestTrace?.trace.find((step) => step.runtimeTruth)?.runtimeTruth
  switch (runtimeTruth?.executionSurface.mode) {
    case 'dry_run_mixed':
    case 'dry_run_mock_only':
      return 'mocked'
    case 'runtime_only':
      return 'runtime'
    default:
      break
  }

  const executionModes = [
    ...(evidence.toolCalls ?? []).map((call) => call.executionMode),
    ...(evidence.toolResults ?? []).map((result) => result.executionMode),
  ]
  return executionModes.includes('runtime') ? 'runtime' : 'mocked'
}

function toolInvocationMatches(
  left: NonNullable<ScenarioObservedEvidenceInput['toolCalls']>[number],
  right: NonNullable<ScenarioObservedEvidenceInput['toolCalls']>[number],
): boolean {
  return left.name === right.name
    && (left.toolUseId ?? '') === (right.toolUseId ?? '')
    && JSON.stringify(left.input ?? null) === JSON.stringify(right.input ?? null)
}

function toolResultMatches(
  left: NonNullable<ScenarioObservedEvidenceInput['toolResults']>[number],
  right: NonNullable<ScenarioObservedEvidenceInput['toolResults']>[number],
): boolean {
  return left.name === right.name
    && (left.toolUseId ?? '') === (right.toolUseId ?? '')
    && JSON.stringify(left.input ?? null) === JSON.stringify(right.input ?? null)
    && JSON.stringify(left.output ?? null) === JSON.stringify(right.output ?? null)
    && (left.error ?? '') === (right.error ?? '')
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

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
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

function dropProvisionalSystemManagedResults(
  results: NonNullable<ScenarioObservedEvidenceInput['toolResults']>,
): NonNullable<ScenarioObservedEvidenceInput['toolResults']> {
  const hasResolvedHandoff = results.some((result) =>
    result.name === 'create_human_task' &&
    (
      result.error ||
      (isRecord(result.output) && result.output.persisted === true)
    ),
  )
  if (!hasResolvedHandoff) return results
  return results.filter((result) =>
    !(
      result.name === 'create_human_task' &&
      isRecord(result.output) &&
      result.output.handled === 'system_managed'
    ),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
