import {
  DEFAULT_AGENTOPS_METRICS,
  type AgentOpsMetricsQuery,
  type AgentOpsMetricsResolvedQuery,
  type AgentOpsMetricsResponse,
  type AgentOpsMetricsWindow,
} from '@intera/shared/contracts/agentops/metrics'
import {
  hasRecognizedTokenUsage,
  readCacheReadTokens,
  readCacheWriteTokens,
  readInputTokens,
  readOutputTokens,
} from '@/lib/agent/usage-accounting'
import { summarizeHandoffMetrics } from '@/lib/operate/handoff-metrics'
import type { AgentCaseScope } from '@/app/api/_agent-scope'
import type { RepoForOrg } from '@/lib/db/repo-for-org'

const WINDOW_MS: Record<AgentOpsMetricsWindow, number> = {
  '20m': 20 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

interface MetricsCaseMessage {
  id?: string
  caseId?: string
  runId?: string | null
  role?: string | null
  createdAt: Date | string
  providerContent?: unknown
  providerMeta?: unknown
}

interface MetricsHumanTask {
  status?: string | null
  createdAt?: Date | string | null
  resolvedAt?: Date | string | null
  chatId?: string | null
  runId?: string | null
}

interface MetricsCaseRow {
  id: string
  chatId: string
  userId?: string | null
  type: string
  status: string
  source?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  humanTasks?: MetricsHumanTask[]
  messages?: MetricsCaseMessage[]
  _count?: {
    messages?: number
  } | null
}

interface MetricsTraceRow {
  caseId?: string
  runId?: string | null
  actionType: string
  title: string
  detail: string | null
  payload: string | null
  createdAt: Date | string
}

interface GetAgentOpsMetricsInput {
  repo: RepoForOrg
  agentId: string
  scope: AgentCaseScope
  query: AgentOpsMetricsQuery
  now?: Date
}

interface NumericSummary {
  average: number | null
  p50: number | null
  sampleCount: number
}

interface EvidenceRunScope {
  selectedRunIds: Set<string>
  caseIdsWithoutSelectedRuns: Set<string>
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function toIso(value: Date): string {
  return value.toISOString()
}

function dateRangeFilter(from: Date, to: Date): Record<string, Date> {
  return { gte: from, lt: to }
}

export function resolveAgentOpsMetricsTimeRange(
  query: AgentOpsMetricsQuery,
  now = new Date(),
): AgentOpsMetricsResolvedQuery {
  const to = toDate(query.to) ?? now
  const from = toDate(query.from) ?? new Date(to.getTime() - WINDOW_MS[query.window])
  return {
    window: query.window,
    from: toIso(from),
    to: toIso(to),
    timezone: query.timezone,
    metrics: query.metrics.length > 0 ? query.metrics : DEFAULT_AGENTOPS_METRICS,
    includeSynthetic: query.includeSynthetic,
  }
}

function parseTracePayload(trace: Pick<MetricsTraceRow, 'payload' | 'detail'>): Record<string, unknown> | null {
  for (const raw of [trace.payload, trace.detail]) {
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Legacy trace detail often contains plain text; ignore it for structured metrics.
    }
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function lowerText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.toLowerCase()
  try {
    return JSON.stringify(value).toLowerCase()
  } catch {
    return String(value).toLowerCase()
  }
}

function toolNameFromTrace(trace: MetricsTraceRow, payload: Record<string, unknown> | null): string | null {
  if (typeof payload?.toolName === 'string' && payload.toolName.trim()) return payload.toolName.trim()
  const match = trace.title.match(/Tool(?: called| result)?:\s*(.+)$/)
  return match?.[1]?.trim() ?? null
}

function hasToolResultProviderBlock(providerContent: unknown): boolean {
  return Array.isArray(providerContent) && providerContent.some((block) => (
    block && typeof block === 'object' && (block as { type?: unknown }).type === 'tool_result'
  ))
}

function isInternalMessage(message: MetricsCaseMessage): boolean {
  const meta = asRecord(message.providerMeta)
  return meta?.visibility === 'internal' ||
    meta?.transcriptKind === 'tool_result' ||
    hasToolResultProviderBlock(message.providerContent)
}

function summarizeNumbers(values: number[]): NumericSummary {
  if (values.length === 0) {
    return { average: null, p50: null, sampleCount: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  const middle = Math.floor((sorted.length - 1) / 2)
  return {
    average: Math.round(sum / sorted.length),
    p50: sorted[middle],
    sampleCount: sorted.length,
  }
}

function summarizeFirstResponseLatency(cases: MetricsCaseRow[]): NumericSummary {
  const samples: number[] = []

  for (const item of cases) {
    const messages = [...(item.messages ?? [])]
      .filter((message) => !isInternalMessage(message))
      .sort((a, b) => {
        const aTime = toDate(a.createdAt)?.getTime() ?? 0
        const bTime = toDate(b.createdAt)?.getTime() ?? 0
        return aTime - bTime
      })

    const firstUser = messages.find((message) => String(message.role ?? '').toLowerCase() === 'user')
    const firstUserAt = toDate(firstUser?.createdAt)
    if (!firstUserAt) continue

    const firstAssistant = messages.find((message) => {
      const at = toDate(message.createdAt)
      return String(message.role ?? '').toLowerCase() === 'assistant' && !!at && at >= firstUserAt
    })
    const firstAssistantAt = toDate(firstAssistant?.createdAt)
    if (!firstAssistantAt) continue

    samples.push(Math.max(0, firstAssistantAt.getTime() - firstUserAt.getTime()))
  }

  return summarizeNumbers(samples)
}

function outputIndicatesToolError(output: unknown): boolean {
  const record = asRecord(output)
  if (!record) return false
  if (record.ok === false) return true
  if (record.status === 'error' || record.status === 'failed') return true
  if (typeof record.error === 'string' && record.error.trim()) return true
  if (typeof record.error_class === 'string' && record.error_class.trim()) return true
  const nested = asRecord(record.output)
  if (nested) return outputIndicatesToolError(nested)
  return false
}

function traceIndicatesTimeout(trace: MetricsTraceRow, payload: Record<string, unknown> | null): boolean {
  const text = lowerText({
    title: trace.title,
    detail: trace.detail,
    payload,
  })
  return text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('etimedout') ||
    text.includes('abortsignal.timeout')
}

function knowledgeResultCount(output: unknown): number | null {
  const record = asRecord(output)
  if (!record) return null

  for (const key of ['list', 'results', 'documents', 'chunks', 'hits', 'items']) {
    const value = record[key]
    if (Array.isArray(value)) return value.length
  }

  for (const key of ['resultCount', 'total', 'count']) {
    const value = asNumber(record[key])
    if (value != null) return value
  }

  const nested = asRecord(record.output) ?? asRecord(record.response_body)
  return nested ? knowledgeResultCount(nested) : null
}

function isKnowledgeTrace(toolName: string | null, payload: Record<string, unknown> | null): boolean {
  return Boolean(
    toolName?.startsWith('kb_search_') ||
    payload?.knowledgeSourceId ||
    payload?.knowledgeSourceName,
  )
}

function summarizeToolErrors(traces: MetricsTraceRow[]) {
  const toolResults = traces.filter((trace) => trace.actionType === 'tool_result')
  let errorCount = 0
  let timeoutCount = 0
  let missingStructuredPayload = 0

  for (const trace of toolResults) {
    const payload = parseTracePayload(trace)
    if (!payload) {
      missingStructuredPayload += 1
      continue
    }

    const isError = outputIndicatesToolError(payload) || outputIndicatesToolError(payload.output)
    const isTimeout = traceIndicatesTimeout(trace, payload)
    if (isError || isTimeout) errorCount += 1
    if (isTimeout) timeoutCount += 1
  }

  const warnings = missingStructuredPayload > 0
    ? [`${missingStructuredPayload} tool_result traces had no structured payload and were not classified.`]
    : []

  return {
    available: toolResults.length > 0,
    value: toolResults.length > 0 ? errorCount / toolResults.length : null,
    numerator: toolResults.length > 0 ? errorCount : null,
    denominator: toolResults.length,
    denominatorKind: 'tool_result_traces',
    unavailableReason: toolResults.length > 0 ? null : 'No tool_result traces in the scoped window.',
    warnings,
    errorCount,
    timeoutCount,
    observedToolResults: toolResults.length,
  }
}

function summarizeKnowledgeMisses(traces: MetricsTraceRow[]) {
  const knowledgeTraces = traces
    .filter((trace) => trace.actionType === 'tool_result')
    .map((trace) => ({ trace, payload: parseTracePayload(trace) }))
    .filter(({ trace, payload }) => isKnowledgeTrace(toolNameFromTrace(trace, payload), payload))

  let missCount = 0
  let denominator = 0
  let unknownKnowledgeResults = 0

  for (const { payload } of knowledgeTraces) {
    if (!payload) {
      unknownKnowledgeResults += 1
      continue
    }

    if (outputIndicatesToolError(payload) || outputIndicatesToolError(payload.output)) {
      denominator += 1
      missCount += 1
      continue
    }

    const count = knowledgeResultCount(payload.output) ?? knowledgeResultCount(payload)
    if (count == null) {
      unknownKnowledgeResults += 1
      continue
    }

    denominator += 1
    if (count === 0) missCount += 1
  }

  const warnings = unknownKnowledgeResults > 0
    ? [`${unknownKnowledgeResults} knowledge tool results lacked a recognized hit-count shape.`]
    : []

  return {
    available: denominator > 0,
    value: denominator > 0 ? missCount / denominator : null,
    numerator: denominator > 0 ? missCount : null,
    denominator,
    denominatorKind: 'classified_knowledge_tool_results',
    unavailableReason: denominator > 0 ? null : 'No classified knowledge retrieval results in the scoped window.',
    warnings,
    observedKnowledgeToolResults: knowledgeTraces.length,
    unknownKnowledgeResults,
  }
}

function summarizeTokens(traces: MetricsTraceRow[]) {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let llmCalls = 0
  let missingUsage = 0

  for (const trace of traces) {
    if (trace.actionType !== 'llm_response') continue
    const payload = parseTracePayload(trace)
    const usage = asRecord(payload?.usage)
    if (!usage || !hasRecognizedTokenUsage(usage)) {
      missingUsage += 1
      continue
    }

    inputTokens += readInputTokens(usage)
    outputTokens += readOutputTokens(usage)
    cacheReadTokens += readCacheReadTokens(usage)
    cacheWriteTokens += readCacheWriteTokens(usage)
    llmCalls += 1
  }

  const warnings = missingUsage > 0
    ? [`${missingUsage} llm_response traces lacked recognized usage fields.`]
    : []

  return {
    available: llmCalls > 0,
    totalTokens: llmCalls > 0 ? inputTokens + outputTokens : null,
    inputTokens: llmCalls > 0 ? inputTokens : null,
    outputTokens: llmCalls > 0 ? outputTokens : null,
    cacheReadTokens: llmCalls > 0 ? cacheReadTokens : null,
    cacheWriteTokens: llmCalls > 0 ? cacheWriteTokens : null,
    llmCalls,
    denominatorKind: 'llm_response_traces_with_usage',
    unavailableReason: llmCalls > 0 ? null : 'No llm_response traces with recognized usage in the scoped window.',
    warnings,
  }
}

function summarizeTraceLatency(traces: MetricsTraceRow[], cases: MetricsCaseRow[]) {
  const wallSamples: number[] = []
  const llmSamples: number[] = []
  const toolSamples: number[] = []

  for (const trace of traces) {
    const payload = parseTracePayload(trace)
    if (!payload) continue

    if (trace.actionType === 'loop_decision' && trace.title === 'Iteration Snapshot') {
      const wallMs = asNumber(payload.wallMs) ?? asNumber(payload.iterationWallMs)
      const llmWallMs = asNumber(payload.llmWallMs)
      const toolsWallMs = asNumber(payload.toolsWallMs)
      if (wallMs != null) wallSamples.push(Math.max(0, wallMs))
      if (llmWallMs != null) llmSamples.push(Math.max(0, llmWallMs))
      if (toolsWallMs != null) toolSamples.push(Math.max(0, toolsWallMs))
    }

    if (trace.actionType === 'tool_result') {
      const latencyMs = asNumber(payload.latencyMs)
      if (latencyMs != null) toolSamples.push(Math.max(0, latencyMs))
    }
  }

  const firstResponseMs = summarizeFirstResponseLatency(cases)
  const traceWallMs = summarizeNumbers(wallSamples)
  const traceLlmMs = summarizeNumbers(llmSamples)
  const traceToolMs = summarizeNumbers(toolSamples)
  const available = firstResponseMs.sampleCount > 0 || traceWallMs.sampleCount > 0

  return {
    available,
    firstResponseMs,
    traceWallMs,
    traceLlmMs: {
      average: traceLlmMs.average,
      sampleCount: traceLlmMs.sampleCount,
    },
    traceToolMs: {
      average: traceToolMs.average,
      sampleCount: traceToolMs.sampleCount,
    },
    denominatorKind: 'visible_message_pairs_and_iteration_snapshots',
    unavailableReason: available ? null : 'No visible message pairs or iteration timing snapshots in the scoped window.',
    warnings: [],
  }
}

function includedRunCount(scope: AgentCaseScope, includedCaseIds: Set<string>): number {
  return scope.runs.filter((run) => includedCaseIds.has(run.caseId)).length
}

function buildEvidenceRunScope(scope: AgentCaseScope): EvidenceRunScope {
  const selectedRunIds = new Set(scope.runIds)
  const casesWithSelectedRuns = new Set(
    scope.runs
      .filter((run) => selectedRunIds.has(run.id))
      .map((run) => run.caseId),
  )

  return {
    selectedRunIds,
    caseIdsWithoutSelectedRuns: new Set(scope.caseIds.filter((caseId) => !casesWithSelectedRuns.has(caseId))),
  }
}

function buildEvidenceWhere(
  evidenceScope: EvidenceRunScope,
  caseIds: Iterable<string>,
): Record<string, unknown> {
  const or: Array<Record<string, unknown>> = []
  const selectedRunIds = [...evidenceScope.selectedRunIds]
  const nullRunCaseIds = [...caseIds].filter((caseId) => evidenceScope.caseIdsWithoutSelectedRuns.has(caseId))

  if (selectedRunIds.length > 0) {
    or.push({ runId: { in: selectedRunIds } })
  }
  if (nullRunCaseIds.length > 0) {
    or.push({ runId: null, caseId: { in: nullRunCaseIds } })
  }

  return { OR: or.length > 0 ? or : [{ runId: { in: [] } }] }
}

function evidenceBelongsToSelectedScope(
  item: { caseId?: string | null; runId?: string | null },
  evidenceScope: EvidenceRunScope,
  fallbackCaseId?: string,
): boolean {
  if (item.runId) return evidenceScope.selectedRunIds.has(item.runId)
  const caseId = item.caseId ?? fallbackCaseId
  return Boolean(caseId && evidenceScope.caseIdsWithoutSelectedRuns.has(caseId))
}

function filterCaseEvidence(cases: MetricsCaseRow[], evidenceScope: EvidenceRunScope): MetricsCaseRow[] {
  return cases.map((item) => ({
    ...item,
    humanTasks: (item.humanTasks ?? []).filter((task) => evidenceBelongsToSelectedScope(task, evidenceScope, item.id)),
    messages: (item.messages ?? []).filter((message) => evidenceBelongsToSelectedScope(message, evidenceScope, item.id)),
  }))
}

function filterTraceEvidence(traces: MetricsTraceRow[], evidenceScope: EvidenceRunScope): MetricsTraceRow[] {
  return traces.filter((trace) => evidenceBelongsToSelectedScope(trace, evidenceScope))
}

function buildHandoffCases(cases: MetricsCaseRow[]): MetricsCaseRow[] {
  return cases
    .map((item) => {
      const visibleMessages = (item.messages ?? []).filter((message) => !isInternalMessage(message))
      const humanTasks = item.humanTasks ?? []
      return {
        ...item,
        messages: visibleMessages,
        humanTasks,
        _count: { messages: visibleMessages.length },
      }
    })
    .filter((item) => (item.messages?.length ?? 0) > 0 || (item.humanTasks?.length ?? 0) > 0)
}

function countIncompleteLegacyHumanTasks(cases: MetricsCaseRow[]): number {
  return cases.reduce((count, item) => (
    count + (item.humanTasks ?? []).filter((task) => !task.runId || !task.chatId).length
  ), 0)
}

function uniqueAttributionModes(
  scope: AgentCaseScope,
  cases: MetricsCaseRow[],
): Array<'procedure_run' | 'livechat_metadata' | 'playground_prefix'> {
  const modes = new Set<'procedure_run' | 'livechat_metadata' | 'playground_prefix'>()

  const runCaseIds = new Set(scope.runs.map((run) => run.caseId))
  for (const item of cases) {
    if (runCaseIds.has(item.id)) {
      modes.add('procedure_run')
    } else if (item.chatId.startsWith(`pg_${scope.agentConfigId}_`)) {
      modes.add('playground_prefix')
    } else {
      modes.add('livechat_metadata')
    }
  }

  return [...modes]
}

function buildNoScopeResponse(
  agentId: string,
  scope: AgentCaseScope,
  resolvedQuery: AgentOpsMetricsResolvedQuery,
  generatedAt: Date,
): AgentOpsMetricsResponse {
  const warning = 'No agent-proven case ids were found for this agent in the current org.'
  return {
    agentId,
    generatedAt: toIso(generatedAt),
    query: resolvedQuery,
    scope: {
      agentConfigId: scope.agentConfigId,
      caseIds: [],
      runIds: [],
    },
    metrics: {
      handoffRate: {
        available: false,
        value: null,
        numerator: null,
        denominator: 0,
        denominatorKind: 'conversation_segments',
        unavailableReason: warning,
        warnings: [warning],
        activeHandoffConversations: 0,
        activeHandoffProcedureRuns: 0,
        activeHumanTasks: 0,
        resolvedHumanTasks: 0,
      },
      toolErrorRate: {
        available: false,
        value: null,
        numerator: null,
        denominator: 0,
        denominatorKind: 'tool_result_traces',
        unavailableReason: 'No tool_result traces in the scoped window.',
        warnings: [],
        errorCount: 0,
        timeoutCount: 0,
        observedToolResults: 0,
      },
      knowledgeMissRate: {
        available: false,
        value: null,
        numerator: null,
        denominator: 0,
        denominatorKind: 'classified_knowledge_tool_results',
        unavailableReason: 'No classified knowledge retrieval results in the scoped window.',
        warnings: [],
        observedKnowledgeToolResults: 0,
        unknownKnowledgeResults: 0,
      },
      tokenSummary: {
        available: false,
        totalTokens: null,
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        llmCalls: 0,
        denominatorKind: 'llm_response_traces_with_usage',
        unavailableReason: 'No llm_response traces with recognized usage in the scoped window.',
        warnings: [],
      },
      latency: {
        available: false,
        firstResponseMs: { average: null, p50: null, sampleCount: 0 },
        traceWallMs: { average: null, p50: null, sampleCount: 0 },
        traceLlmMs: { average: null, sampleCount: 0 },
        traceToolMs: { average: null, sampleCount: 0 },
        denominatorKind: 'visible_message_pairs_and_iteration_snapshots',
        unavailableReason: 'No visible message pairs or iteration timing snapshots in the scoped window.',
        warnings: [],
      },
      cost: {
        available: false,
        amount: null,
        currency: null,
        unavailableReason: 'Provider pricing is not configured in this MVP.',
        warnings: ['Cost is intentionally unavailable; no provider pricing is inferred.'],
      },
    },
    coverage: {
      aggregateDefault: 'agent_proven_only',
      scopedCaseCount: 0,
      includedCaseCount: 0,
      scopedRunCount: scope.runIds.length,
      includedRunCount: 0,
      attributionModes: [],
      legacyOrUnattributedDirectAnswerRows: {
        included: false,
        count: null,
        reason: 'Direct-answer rows without ProcedureRun, LiveChat agent metadata, or playground agent prefix are excluded from aggregate metrics.',
      },
      incompleteLegacyHumanTaskRows: {
        count: 0,
        reason: 'HumanTask rows missing runId or chatId would be reported here if present in scoped evidence.',
      },
      warnings: [warning],
    },
  }
}

export async function getAgentOpsMetrics(input: GetAgentOpsMetricsInput): Promise<AgentOpsMetricsResponse> {
  const now = input.now ?? new Date()
  const resolvedQuery = resolveAgentOpsMetricsTimeRange(input.query, now)
  const from = new Date(resolvedQuery.from)
  const to = new Date(resolvedQuery.to)

  if (input.scope.caseIds.length === 0) {
    return buildNoScopeResponse(input.agentId, input.scope, resolvedQuery, now)
  }

  const evidenceScope = buildEvidenceRunScope(input.scope)
  const scopedEvidenceWhere = buildEvidenceWhere(evidenceScope, input.scope.caseIds)
  const caseWhere: Record<string, unknown> = {
    id: { in: input.scope.caseIds },
    OR: [
      { createdAt: dateRangeFilter(from, to) },
      { updatedAt: dateRangeFilter(from, to) },
      { messages: { some: { createdAt: dateRangeFilter(from, to), ...scopedEvidenceWhere } } },
      { humanTasks: { some: { createdAt: dateRangeFilter(from, to), ...scopedEvidenceWhere } } },
    ],
  }

  if (!resolvedQuery.includeSynthetic) {
    caseWhere.NOT = [
      { source: 'playground' },
      { userId: { startsWith: 'playground-test-' } },
      { chatId: { startsWith: 'pg_' } },
    ]
  }

  const cases = await input.repo.case.findMany({
    where: caseWhere,
    orderBy: { updatedAt: 'desc' as const },
    select: {
      id: true,
      chatId: true,
      userId: true,
      type: true,
      status: true,
      source: true,
      createdAt: true,
      updatedAt: true,
      humanTasks: {
        where: { createdAt: dateRangeFilter(from, to), ...scopedEvidenceWhere },
        select: {
          status: true,
          createdAt: true,
          resolvedAt: true,
          chatId: true,
          runId: true,
        },
      },
      messages: {
        where: { createdAt: dateRangeFilter(from, to), ...scopedEvidenceWhere },
        select: {
          id: true,
          caseId: true,
          runId: true,
          role: true,
          createdAt: true,
          providerContent: true,
          providerMeta: true,
        },
        orderBy: { createdAt: 'asc' as const },
      },
      _count: { select: { messages: true } },
    },
  }) as MetricsCaseRow[]

  const scopedCases = filterCaseEvidence(cases, evidenceScope)
  const includedCaseIds = new Set(scopedCases.map((item) => item.id))
  const traceCaseIds = [...includedCaseIds]
  const traceEvidenceWhere = buildEvidenceWhere(evidenceScope, traceCaseIds)
  const traces = traceCaseIds.length > 0
    ? await input.repo.raw.actionTrace.findMany({
        where: {
          orgId: input.repo.orgId,
          caseId: { in: traceCaseIds },
          createdAt: dateRangeFilter(from, to),
          ...traceEvidenceWhere,
        },
        orderBy: { createdAt: 'asc' as const },
        select: {
          caseId: true,
          runId: true,
          actionType: true,
          title: true,
          detail: true,
          payload: true,
          createdAt: true,
        },
      }) as MetricsTraceRow[]
    : []
  const scopedTraces = filterTraceEvidence(traces, evidenceScope)
  const handoffCases = buildHandoffCases(scopedCases)

  const handoffSummary = summarizeHandoffMetrics(handoffCases)
  const handoffWarnings = [
    'Handoff rate treats handed_off as an outcome, not automatically as a failure.',
  ]
  const incompleteHumanTasks = countIncompleteLegacyHumanTasks(handoffCases)
  if (incompleteHumanTasks > 0) {
    handoffWarnings.push(`${incompleteHumanTasks} HumanTask rows are missing runId or chatId; legacy handoff attribution may be incomplete.`)
  }

  const coverageWarnings = [
    'Aggregates include only agent-proven cases from ProcedureRun.agentConfigId, LiveChat metadata, or playground agent prefix.',
    'legacy_or_unattributed direct-answer rows are excluded rather than assigned to the selected agent.',
    'Null-run evidence is included only for scoped cases without selected ProcedureRun ids.',
  ]
  if (!resolvedQuery.includeSynthetic) {
    coverageWarnings.push('Synthetic Playground/export evidence is excluded by default.')
  }
  if (incompleteHumanTasks > 0) {
    coverageWarnings.push(`${incompleteHumanTasks} incomplete legacy HumanTask rows may understate handoff coverage.`)
  }

  return {
    agentId: input.agentId,
    generatedAt: toIso(now),
    query: resolvedQuery,
    scope: {
      agentConfigId: input.scope.agentConfigId,
      caseIds: traceCaseIds,
      runIds: input.scope.runIds.filter((runId) => input.scope.runs.some((run) => run.id === runId && includedCaseIds.has(run.caseId))),
    },
    metrics: {
      handoffRate: {
        available: handoffSummary.totalConversations > 0,
        value: handoffSummary.totalConversations > 0 ? handoffSummary.escalationRate : null,
        numerator: handoffSummary.totalConversations > 0 ? handoffSummary.escalatedConversations : null,
        denominator: handoffSummary.totalConversations,
        denominatorKind: 'conversation_segments',
        unavailableReason: handoffSummary.totalConversations > 0 ? null : 'No scoped conversation segments in the window.',
        warnings: handoffWarnings,
        activeHandoffConversations: handoffSummary.activeHandoffConversations,
        activeHandoffProcedureRuns: handoffSummary.activeHandoffProcedureRuns,
        activeHumanTasks: handoffSummary.activeHumanTasks,
        resolvedHumanTasks: handoffSummary.resolvedHumanTasks,
      },
      toolErrorRate: summarizeToolErrors(scopedTraces),
      knowledgeMissRate: summarizeKnowledgeMisses(scopedTraces),
      tokenSummary: summarizeTokens(scopedTraces),
      latency: summarizeTraceLatency(scopedTraces, scopedCases),
      cost: {
        available: false,
        amount: null,
        currency: null,
        unavailableReason: 'Provider pricing is not configured in this MVP.',
        warnings: ['Cost is intentionally unavailable; no provider pricing is inferred.'],
      },
    },
    coverage: {
      aggregateDefault: 'agent_proven_only',
      scopedCaseCount: input.scope.caseIds.length,
      includedCaseCount: scopedCases.length,
      scopedRunCount: input.scope.runIds.length,
      includedRunCount: includedRunCount(input.scope, includedCaseIds),
      attributionModes: uniqueAttributionModes(input.scope, scopedCases),
      legacyOrUnattributedDirectAnswerRows: {
        included: false,
        count: null,
        reason: 'Direct-answer rows without ProcedureRun, LiveChat agent metadata, or playground agent prefix are excluded from aggregate metrics.',
      },
      incompleteLegacyHumanTaskRows: {
        count: incompleteHumanTasks,
        reason: 'HumanTask rows missing runId or chatId are counted as incomplete because legacy writes may lack durable attribution fields.',
      },
      warnings: coverageWarnings,
    },
  }
}
