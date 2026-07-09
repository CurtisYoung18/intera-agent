// Trace aggregator for Playground.
// Maps fine-grained ActionType events → PlaygroundTraceStep with timing + status.

import type { TraceRecord } from './persistence-port'
import { normalizeTraceActionType, type ActionType } from './trace'
import {
  hasRecognizedTokenUsage,
  readCacheReadTokens,
  readCacheWriteTokens,
  readInputTokens,
  readOutputTokens,
} from './usage-accounting'

export type TraceStage =
  | 'Hooks'
  | 'Knowledge retrieval'
  | 'Tools'
  | 'Procedure'
  | 'Model generation'

export type TraceStatus = 'ok' | 'info' | 'warn' | 'block' | 'neutral'
export type TraceSource = 'caseTypes' | 'hooks' | 'knowledge' | 'tools' | 'agent' | 'humanTasks'
export type PlaygroundToolExecutionMode =
  | 'mocked_dry_run'
  | 'static_fixture'
  | 'runtime_backed'
  | 'runtime_managed'
  | 'unknown'
export type PlaygroundVisionSupport = 'supported' | 'unsupported' | 'unknown'
export type PlaygroundExecutionSurface = 'dry_run_mixed' | 'dry_run_mock_only' | 'runtime_only' | 'unknown'
export type PlaygroundTraceEventKind =
  | 'tool_call'
  | 'tool_result'
  | 'hook_decision'
  | 'runtime_guard'
  | 'stale_evidence'
  | 'model'
  | 'info'

export interface PlaygroundToolExecutionTruth {
  effectiveMode: PlaygroundToolExecutionMode
  label: string
  dryRun: boolean
  definitionMode?: string
  toolCategory?: string
  note?: string
}

export interface PlaygroundToolSchemaSummary {
  providerVisibleToolCount: number
  toolNames: string[]
  hiddenToolNameCount: number
  knowledgeSchemaUnified: boolean
  legacyKnowledgeToolCount: number
  knowledgeSourceCount: number
  approxSchemaTokens: number
}

export interface PlaygroundKnowledgeRetrievalSummary {
  source?: string
  sourceName?: string
  topK?: number
  requestedTopK?: number
  resultCount?: number
  latencyMs?: number
}

export interface PlaygroundCapabilityTruth {
  model: string
  imageSupport: {
    status: PlaygroundVisionSupport
    label: string
    source: 'configured_model_registry' | 'missing_model_metadata'
    note?: string
  }
  executionSurface: {
    mode: PlaygroundExecutionSurface
    label: string
    note?: string
  }
  toolSummary: {
    mockedDryRun: number
    runtimeBacked: number
    runtimeManaged: number
    staticFixture: number
    unknown: number
  }
  warnings: string[]
}

export interface PlaygroundTraceEvent {
  kind: PlaygroundTraceEventKind
  actionType: string
  label: string
  status: TraceStatus
  detail: string
  toolName?: string
  executionTruth?: PlaygroundToolExecutionTruth
  knowledgeSummary?: PlaygroundKnowledgeRetrievalSummary
  payload?: unknown
}

export interface PlaygroundTraceStep {
  stage: string
  source: TraceSource
  status: TraceStatus | 'skipped'
  fired: boolean
  ms: number
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  summary: string
  detail: [string, string][]
  events?: PlaygroundTraceEvent[]
  runtimeTruth?: PlaygroundCapabilityTruth
  json?: Array<Record<string, unknown>>
  /** Model request data captured from llm_request_start (available for Model generation stage). */
  promptData?: { systemPrompt: unknown; messages: unknown[]; toolChoice?: unknown; requestPayloadCaptured?: boolean; toolSchemaSummary?: PlaygroundToolSchemaSummary }
  toolSchemaSummary?: PlaygroundToolSchemaSummary
}

/** Bookkeeping actionTypes — excluded from stage bucketing, kept aside for timing + debug JSON. */
const BOOKKEEPING: ReadonlySet<string> = new Set([
  'user_message', 'stream_event', 'agent_tree_node',
  'stream_request_start', 'microcompact', 'queue_message_enqueued', 'queue_message_consumed',
  // Lifecycle events — not user-facing pipeline stages
  'case_created', 'fact_extracted', 'cron_tick',
  'human_task_created', 'human_task_resolved', 'final_resolution',
  'incoming_chat', 'chat_deactivated',
  'case_merged', 'channel_rich_message',
])

const STAGE_MAP: Partial<Record<ActionType | 'kb_search', { stage: TraceStage; source: TraceSource }>> = {
  hook_hit: { stage: 'Hooks', source: 'hooks' },
  kb_search: { stage: 'Knowledge retrieval', source: 'knowledge' },
  tool_call: { stage: 'Tools', source: 'tools' },
  tool_result: { stage: 'Tools', source: 'tools' },
  form_request: { stage: 'Tools', source: 'tools' },
  form_submit: { stage: 'Tools', source: 'tools' },
  llm_request_start: { stage: 'Model generation', source: 'agent' },
  llm_response: { stage: 'Model generation', source: 'agent' },
}

/** Pipeline stages in fixed order — used as fallback when applicableStages is not provided. */
const allStages: { stage: TraceStage; source: TraceSource }[] = [
  { stage: 'Hooks', source: 'hooks' },
  { stage: 'Knowledge retrieval', source: 'knowledge' },
  { stage: 'Tools', source: 'tools' },
  { stage: 'Procedure', source: 'agent' },
  { stage: 'Model generation', source: 'agent' },
]

function parseJson(raw?: string | null): Record<string, unknown> | null {
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

function stringifyCompact(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function compactString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function arrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseNestedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function hasOwn(obj: Record<string, unknown> | null | undefined, key: string): boolean {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key)
}

function toolNameFromDefinition(tool: unknown): string | undefined {
  return isRecord(tool) ? compactString(tool.name) : undefined
}

function approximateJsonTokens(value: unknown): number {
  const json = stringifyCompact(value)
  return Math.max(0, Math.ceil(json.length / 4))
}

function schemaEnumCount(tool: unknown, propertyName: string): number | undefined {
  if (!isRecord(tool)) return undefined
  const inputSchema = isRecord(tool.input_schema)
    ? tool.input_schema
    : isRecord(tool.inputSchema)
      ? tool.inputSchema
      : null
  const properties = isRecord(inputSchema?.properties) ? inputSchema.properties : null
  const property = isRecord(properties?.[propertyName]) ? properties[propertyName] : null
  return arrayLength(property?.enum)
}

export function summarizeToolSchemaVisibility(rawTools: unknown): PlaygroundToolSchemaSummary | undefined {
  if (!Array.isArray(rawTools)) return undefined

  const toolNames = rawTools
    .map(toolNameFromDefinition)
    .filter((name): name is string => Boolean(name))
  const legacyKnowledgeToolCount = toolNames.filter((name) => name.startsWith('kb_search_')).length
  const hasUnifiedKnowledge = toolNames.includes('search_knowledge')
  const unifiedKnowledgeTool = rawTools.find((tool) => toolNameFromDefinition(tool) === 'search_knowledge')
  const knowledgeSourceCount =
    schemaEnumCount(unifiedKnowledgeTool, 'source')
      ?? (isRecord(unifiedKnowledgeTool) && Array.isArray(unifiedKnowledgeTool.knowledgeSources)
        ? unifiedKnowledgeTool.knowledgeSources.length
        : 0)

  return {
    providerVisibleToolCount: rawTools.length,
    toolNames: toolNames.slice(0, 12),
    hiddenToolNameCount: Math.max(0, toolNames.length - 12),
    knowledgeSchemaUnified: hasUnifiedKnowledge && legacyKnowledgeToolCount === 0,
    legacyKnowledgeToolCount,
    knowledgeSourceCount,
    approxSchemaTokens: approximateJsonTokens(rawTools),
  }
}

function nestedRecord(value: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const nested = value?.[key]
  return isRecord(nested) ? nested : null
}

function unwrapToolOutput(parsedPayload: Record<string, unknown> | null): Record<string, unknown> | null {
  const output = parseNestedJson(parsedPayload?.output)
  if (isRecord(output)) {
    const nestedOutput = parseNestedJson(output.output)
    if (isRecord(nestedOutput)) return nestedOutput
    return output
  }

  const result = parseNestedJson(parsedPayload?.result)
  return isRecord(result) ? result : null
}

function countKnowledgeResults(output: Record<string, unknown> | null): number | undefined {
  if (!output) return undefined
  if (Array.isArray(output.list)) return output.list.length
  if (Array.isArray(output.data)) return output.data.length
  if (isRecord(output.data) && Array.isArray(output.data.list)) return output.data.list.length
  if (Array.isArray(output.results)) return output.results.length
  if (Array.isArray(output.chunks)) return output.chunks.length
  return undefined
}

export function summarizeKnowledgeRetrievalPayload(
  parsedPayload: Record<string, unknown> | null,
): PlaygroundKnowledgeRetrievalSummary | undefined {
  if (!parsedPayload) return undefined
  const input = nestedRecord(parsedPayload, 'input')
  const output = unwrapToolOutput(parsedPayload)

  const source =
    compactString(input?.source) ??
    compactString(input?.sourceId) ??
    compactString(input?.sourceName) ??
    compactString(parsedPayload.knowledgeSourceKey) ??
    compactString(parsedPayload.source) ??
    compactString(output?.knowledgeSourceKey) ??
    compactString(output?.sourceSelection && isRecord(output.sourceSelection) ? output.sourceSelection.source : undefined)
  const sourceName =
    compactString(parsedPayload.knowledgeSourceName) ??
    compactString(output?.knowledgeSourceName) ??
    compactString(input?.sourceName) ??
    (output?.sourceSelection && isRecord(output.sourceSelection)
      ? compactString(output.sourceSelection.sourceName)
      : undefined)
  const topK =
    finiteNumber(output?.topK) ??
    finiteNumber(parsedPayload.topK) ??
    finiteNumber(input?.topK)
  const requestedTopK = finiteNumber(input?.topK)
  const resultCount = countKnowledgeResults(output)
  const latencyMs = finiteNumber(parsedPayload.latencyMs) ?? finiteNumber(output?.latencyMs)

  if (
    source == null &&
    sourceName == null &&
    topK == null &&
    requestedTopK == null &&
    resultCount == null &&
    latencyMs == null
  ) {
    return undefined
  }

  return {
    source,
    sourceName,
    topK,
    requestedTopK,
    resultCount,
    latencyMs,
  }
}

function hasMeaningfulError(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return value != null
}

function extractEvidenceArray(value: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(value.list)) return value.list
  if (Array.isArray(value.data)) return value.data
  if (isRecord(value.data) && Array.isArray(value.data.list)) return value.data.list
  return undefined
}

function deriveToolResultStatus(record: TraceRecord, parsedPayload: Record<string, unknown> | null): TraceStatus {
  const name = (toolNameFromTrace(record, parsedPayload) || record.title || '').toLowerCase()
  if (name.includes('read_chat_memory') || name.includes('read_user_profile')) {
    return 'info'
  }

  if (typeof parsedPayload?.error === 'string' && parsedPayload.error.trim()) return 'block'

  const hasRawOutput = hasOwn(parsedPayload, 'output')
  const rawOutput = hasRawOutput ? parsedPayload?.output : undefined
  const output = parseNestedJson(rawOutput)

  if (hasRawOutput && (output == null || (typeof output === 'string' && output.trim().length === 0))) {
    return 'block'
  }

  const candidate = isRecord(output)
    ? output
    : isRecord(parsedPayload)
      ? parsedPayload
      : null

  if (candidate) {
    if (candidate.success === false) return 'block'
    if (candidate.ok === false) return 'block'
    if (hasMeaningfulError(candidate.error)) return 'block'
    if (hasMeaningfulError(candidate.errors)) return 'block'

    if (candidate.success === true) {
      const evidence = extractEvidenceArray(candidate)
      if (evidence && evidence.length === 0) return 'info'
    }
  }

  const blob = `${record.detail ?? ''} ${record.payload ?? ''}`
  if (/"ok"\s*:\s*false/i.test(blob)) return 'block'
  if (/\berror\b/i.test(blob)) return 'block'
  if (/\bfailed\b/i.test(blob)) return 'warn'
  return 'ok'
}

function toolNameFromTrace(record: TraceRecord, parsedPayload?: Record<string, unknown> | null): string | undefined {
  const toolName = parsedPayload?.toolName
  if (typeof toolName === 'string' && toolName.trim()) return toolName

  const title = record.title ?? ''
  const match = title.match(/Tool(?: called| result)?:\s*(.+)$/)
  return match?.[1]?.trim() || undefined
}

function hookOutcome(payload?: string | null): 'block' | 'warn' | null {
  const parsed = parseJson(payload)
  if (parsed) {
    const results = Array.isArray(parsed.results) ? parsed.results as Array<Record<string, unknown>> : []
    const summary = String(parsed.summary ?? parsed.result ?? '')
    if (summary === 'blocked' || summary === 'block' || results.some(r => r.result === 'blocked' || r.action === 'block')) {
      return 'block'
    }
    if (summary === 'escalated' || summary === 'warn' || results.some(r => r.result === 'escalated' || r.action === 'warn' || r.action === 'escalate')) {
      return 'warn'
    }
  }
  return null
}

function isHookLoopDecision(title: string): boolean {
  return /^Hook\b/.test(title)
    || title.includes('Stop Hook')
    || title.includes('Auto-escalate from Hook')
    || title === 'Exit: max Hook hits'
}

function isPassiveHookCheckpoint(record: TraceRecord): boolean {
  const actionType = normalizeTraceActionType(record.actionType)
  if (actionType !== 'loop_decision') return false
  if (!isHookLoopDecision(record.title ?? '')) return false

  const parsedPayload = parseJson(record.payload)
  if (!parsedPayload) return false

  const summary = typeof parsedPayload.summary === 'string' ? parsedPayload.summary : ''
  const results = Array.isArray(parsedPayload.results) ? parsedPayload.results : []

  return summary === 'allow' && results.length === 0
}

function isProcedureRuntimeDecision(title: string): boolean {
  return title.includes('Stale ProcedureRun')
    || title.startsWith('Procedure selected inline:')
    || title.startsWith('Procedure nudge:')
}

function mapLoopDecision(record: TraceRecord): { stage: TraceStage; source: TraceSource } | undefined {
  const title = record.title ?? ''
  if (isHookLoopDecision(title)) return { stage: 'Hooks', source: 'hooks' }
  if (isProcedureRuntimeDecision(title)) return { stage: 'Procedure', source: 'agent' }
  return undefined
}

function mapTraceRecord(record: TraceRecord): { stage: TraceStage; source: TraceSource } | undefined {
  const actionType = normalizeTraceActionType(record.actionType)

  if (actionType === 'loop_decision') {
    return mapLoopDecision(record)
  }

  if (actionType.startsWith('kb_search') || record.title?.startsWith('kb_search')) {
    return { stage: 'Knowledge retrieval', source: 'knowledge' }
  }

  if (actionType === 'tool_call' || actionType === 'tool_result') {
    const parsedPayload = parseJson(record.payload)
    if (
      parsedPayload?.isKnowledgeTool === true ||
      typeof parsedPayload?.knowledgeSourceId === 'string' && parsedPayload.knowledgeSourceId.trim()
    ) {
      return { stage: 'Knowledge retrieval', source: 'knowledge' }
    }
    const toolName = toolNameFromTrace(record, parsedPayload)
    if (toolName === 'search_knowledge' || toolName?.startsWith('kb_search_')) {
      return { stage: 'Knowledge retrieval', source: 'knowledge' }
    }
  }

  return STAGE_MAP[actionType as ActionType | 'kb_search'] ?? (actionType === 'tool_call' || actionType === 'tool_result'
    ? { stage: 'Tools', source: 'tools' }
    : undefined)
}

function deriveStatus(record: TraceRecord): TraceStatus {
  const { actionType, detail, title } = record
  const parsedPayload = parseJson(record.payload)
  const canonicalActionType = normalizeTraceActionType(actionType)

  if (actionType === 'hook_hit') {
    const outcome = hookOutcome(record.payload)
    if (outcome) return outcome
    if (detail?.includes('block')) return 'block'
    if (detail?.includes('warn') || detail?.includes('escalat')) return 'warn'
    return 'ok'
  }

  if (canonicalActionType === 'loop_decision') {
    if (isHookLoopDecision(title ?? '')) {
      const outcome = hookOutcome(record.payload)
      if (outcome) return outcome
      const blob = `${title ?? ''} ${detail ?? ''} ${record.payload ?? ''}`.toLowerCase()
      if (blob.includes('block')) return 'block'
      if (blob.includes('warn') || blob.includes('escalat') || blob.includes('retry')) return 'warn'
      return 'info'
    }
    if (isProcedureRuntimeDecision(title ?? '')) {
      if ((title ?? '').includes('blocked')) return 'block'
      if ((title ?? '').includes('Stale')) return 'warn'
      if (parsedPayload?.evidenceState === 'stale' || parsedPayload?.stale === true) return 'warn'
      return 'info'
    }
    return 'info'
  }

  if (canonicalActionType === 'tool_result') {
    return deriveToolResultStatus(record, parsedPayload)
  }

  if (canonicalActionType === 'tool_call') {
    const blob = `${detail ?? ''} ${record.payload ?? ''}`
    if (blob.includes('kb_search')) return 'info'
    return 'info'
  }

  return 'ok'
}

function extractUsage(record: TraceRecord): PlaygroundTraceStep['usage'] {
  const raw = record.detail || record.payload
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    const u = isRecord(parsed?.usage) ? parsed.usage : null
    if (u && hasRecognizedTokenUsage(u)) {
      const inputTokens = readInputTokens(u)
      const outputTokens = readOutputTokens(u)
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cacheReadTokens: readCacheReadTokens(u) || undefined,
        cacheWriteTokens: readCacheWriteTokens(u) || undefined,
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function extractToolExecutionTruth(parsedPayload: Record<string, unknown> | null): PlaygroundToolExecutionTruth | undefined {
  const raw = parsedPayload?.executionTruth
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const truth = raw as Record<string, unknown>
  const effectiveMode = typeof truth.effectiveMode === 'string' ? truth.effectiveMode as PlaygroundToolExecutionMode : 'unknown'
  const label = typeof truth.label === 'string' && truth.label.trim() ? truth.label : 'Unknown execution mode'
  return {
    effectiveMode,
    label,
    dryRun: truth.dryRun !== false,
    definitionMode: typeof truth.definitionMode === 'string' ? truth.definitionMode : undefined,
    toolCategory: typeof truth.toolCategory === 'string' ? truth.toolCategory : undefined,
    note: typeof truth.note === 'string' ? truth.note : undefined,
  }
}

function summarizeLoopDecision(record: TraceRecord, parsedPayload: Record<string, unknown> | null): string {
  if (record.detail?.trim()) return record.detail

  if (parsedPayload) {
    if (Array.isArray(parsedPayload.results)) {
      const results = parsedPayload.results
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => {
          const hookName = typeof entry.hookName === 'string' ? entry.hookName : 'hook'
          const action = typeof entry.action === 'string' ? entry.action : (typeof entry.result === 'string' ? entry.result : 'allow')
          const reason = typeof entry.reason === 'string' && entry.reason.trim() ? `: ${entry.reason}` : ''
          return `${hookName} -> ${action}${reason}`
        })
      if (results.length > 0) return results.join('\n')
    }

    const lines: string[] = []
    for (const [key, value] of Object.entries(parsedPayload)) {
      if (key === 'results' || value == null || value === '') continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`${key}: ${String(value)}`)
      }
    }
    if (lines.length > 0) return lines.join('\n')
  }

  return record.title || '(no detail)'
}

function formatToolDetail(record: TraceRecord, parsedPayload: Record<string, unknown> | null): string {
  const actionType = normalizeTraceActionType(record.actionType)
  if (!parsedPayload) return record.detail || record.title || ''

  if (actionType === 'tool_call') {
    return parsedPayload.input != null ? `input: ${stringifyCompact(parsedPayload.input)}` : (record.title || '')
  }

  if (actionType === 'tool_result') {
    const parts: string[] = []
    if (parsedPayload.input != null) parts.push(`input: ${stringifyCompact(parsedPayload.input)}`)
    if (parsedPayload.output != null) parts.push(`output: ${stringifyCompact(parsedPayload.output)}`)
    if (typeof parsedPayload.error === 'string' && parsedPayload.error.trim()) parts.push(`error: ${parsedPayload.error}`)
    return parts.length > 0 ? parts.join('\n') : (record.title || '')
  }

  return record.detail || record.title || ''
}

function buildTraceEvent(record: TraceRecord, stage: string): PlaygroundTraceEvent {
  const actionType = normalizeTraceActionType(record.actionType)
  const parsedPayload = parseJson(record.payload)
  const status = deriveStatus(record)

  if (actionType === 'tool_call' || actionType === 'tool_result') {
    const toolName = toolNameFromTrace(record, parsedPayload) || record.title || actionType
    const isKnowledgeEvent =
      parsedPayload?.isKnowledgeTool === true ||
      typeof parsedPayload?.knowledgeSourceId === 'string' && parsedPayload.knowledgeSourceId.trim() ||
      toolName === 'search_knowledge' ||
      toolName.startsWith('kb_search_')
    return {
      kind: actionType,
      actionType,
      label: toolName,
      status,
      detail: formatToolDetail(record, parsedPayload),
      toolName,
      executionTruth: extractToolExecutionTruth(parsedPayload),
      knowledgeSummary: isKnowledgeEvent ? summarizeKnowledgeRetrievalPayload(parsedPayload) : undefined,
      payload: parsedPayload ?? record.payload,
    }
  }

  if (stage === 'Hooks') {
    return {
      kind: 'hook_decision',
      actionType,
      label: record.title || 'Hook decision',
      status,
      detail: summarizeLoopDecision(record, parsedPayload),
      payload: parsedPayload ?? record.payload,
    }
  }

  if (stage === 'Procedure') {
    return {
      kind: record.title?.includes('Stale') ? 'stale_evidence' : 'runtime_guard',
      actionType,
      label: record.title || 'Procedure runtime',
      status,
      detail: summarizeLoopDecision(record, parsedPayload),
      payload: parsedPayload ?? record.payload,
    }
  }

  return {
    kind: stage === 'Model generation' ? 'model' : 'info',
    actionType,
    label: record.title || actionType,
    status,
    detail: record.detail || summarizeLoopDecision(record, parsedPayload),
    payload: parsedPayload ?? record.payload,
  }
}

function extractRuntimeTruthFromTraces(traces: TraceRecord[]): PlaygroundCapabilityTruth | undefined {
  for (const record of traces) {
    const parsed = parseJson(record.payload)
    const truth = parsed?.playgroundCapabilityTruth
    if (!truth || typeof truth !== 'object' || Array.isArray(truth)) continue

    const raw = truth as Record<string, unknown>
    const imageSupport = raw.imageSupport && typeof raw.imageSupport === 'object' && !Array.isArray(raw.imageSupport)
      ? raw.imageSupport as Record<string, unknown>
      : null
    const executionSurface = raw.executionSurface && typeof raw.executionSurface === 'object' && !Array.isArray(raw.executionSurface)
      ? raw.executionSurface as Record<string, unknown>
      : null
    const toolSummary = raw.toolSummary && typeof raw.toolSummary === 'object' && !Array.isArray(raw.toolSummary)
      ? raw.toolSummary as Record<string, unknown>
      : null

    if (!imageSupport || !executionSurface || !toolSummary || typeof raw.model !== 'string') continue

    return {
      model: raw.model,
      imageSupport: {
        status: typeof imageSupport.status === 'string' ? imageSupport.status as PlaygroundVisionSupport : 'unknown',
        label: typeof imageSupport.label === 'string' ? imageSupport.label : 'Unknown',
        source: imageSupport.source === 'configured_model_registry' ? 'configured_model_registry' : 'missing_model_metadata',
        note: typeof imageSupport.note === 'string' ? imageSupport.note : undefined,
      },
      executionSurface: {
        mode: typeof executionSurface.mode === 'string' ? executionSurface.mode as PlaygroundExecutionSurface : 'unknown',
        label: typeof executionSurface.label === 'string' ? executionSurface.label : 'Unknown',
        note: typeof executionSurface.note === 'string' ? executionSurface.note : undefined,
      },
      toolSummary: {
        mockedDryRun: Number(toolSummary.mockedDryRun ?? 0),
        runtimeBacked: Number(toolSummary.runtimeBacked ?? 0),
        runtimeManaged: Number(toolSummary.runtimeManaged ?? 0),
        staticFixture: Number(toolSummary.staticFixture ?? 0),
        unknown: Number(toolSummary.unknown ?? 0),
      },
      warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((entry): entry is string => typeof entry === 'string') : [],
    }
  }

  return undefined
}

/** Aggregate raw TraceRecord[] into Playground stages with timing. */
export function aggregateTraces(
  traces: TraceRecord[],
  startTime: number,
  debug: boolean,
  applicableStages?: string[],
  capabilityTruth?: PlaygroundCapabilityTruth,
): PlaygroundTraceStep[] {
  const stageMap = new Map<string, { records: TraceRecord[]; earliest: number }>()
  const bookkeeping: TraceRecord[] = []

  for (const trace of traces) {
    const mapping = mapTraceRecord(trace)
    if (!mapping) {
      bookkeeping.push(trace)
      continue
    }

    if (mapping.stage === 'Hooks' && isPassiveHookCheckpoint(trace)) {
      bookkeeping.push(trace)
      continue
    }

    if (BOOKKEEPING.has(trace.actionType) && normalizeTraceActionType(trace.actionType) !== 'loop_decision') {
      bookkeeping.push(trace)
      continue
    }

    const existing = stageMap.get(mapping.stage)
    const recordTime = new Date(trace.createdAt || Date.now()).getTime()
    if (!existing) {
      stageMap.set(mapping.stage, { records: [trace], earliest: recordTime })
    } else {
      existing.records.push(trace)
      if (recordTime < existing.earliest) {
        existing.earliest = recordTime
      }
    }
  }

  const firedStages = new Set(stageMap.keys())
  const ordered = allStages.filter((stageDef) =>
    firedStages.has(stageDef.stage) || (applicableStages ?? allStages.map(a => a.stage)).includes(stageDef.stage),
  )

  const steps = ordered.map(({ stage, source }) => {
    const entry = stageMap.get(stage)
    const fired = !!(entry && entry.records.length > 0)

    if (!fired) {
      return {
        stage,
        source,
        status: 'skipped',
        fired: false,
        ms: 0,
        summary: '(no events)',
        detail: [],
        events: [],
      } satisfies PlaygroundTraceStep
    }

    const records = entry!.records
    const times = records.map(r => new Date(r.createdAt || Date.now()).getTime()).sort((a, b) => a - b)
    const ms = times.length > 1 ? Math.max(0, times[times.length - 1] - times[0]) : 0

    const statuses = records.map((record) => deriveStatus(record))
    const worstStatus = statuses.includes('block') ? 'block'
      : statuses.includes('warn') ? 'warn'
      : statuses.includes('info') ? 'info'
      : 'ok'

    const summary = records.map((record) => record.title).filter(Boolean).join(' → ') || '(no summary)'
    const detail = records.slice(0, 10).map((record) => {
      const actionType = normalizeTraceActionType(record.actionType)
      if (actionType === 'tool_call' || actionType === 'tool_result') {
        return [actionType, formatToolDetail(record, parseJson(record.payload))] as [string, string]
      }
      return [actionType, summarizeLoopDecision(record, parseJson(record.payload))] as [string, string]
    })

    const step: PlaygroundTraceStep = {
      stage,
      source,
      status: worstStatus as TraceStatus,
      fired: true,
      ms,
      summary,
      detail,
      events: records.map((record) => buildTraceEvent(record, stage)),
    }

    if (stage === 'Model generation') {
      const llmReqRecord = records.find(r => r.actionType === 'llm_request_start')
      const parsedRequest = parseJson(llmReqRecord?.payload)
      const toolSchemaSummary = summarizeToolSchemaVisibility(parsedRequest?.tools)
      if (parsedRequest?.systemPrompt || parsedRequest?.messages || parsedRequest?.lastMessages || parsedRequest?.tools) {
        step.promptData = {
          systemPrompt: parsedRequest?.systemPrompt ?? '',
          messages: Array.isArray(parsedRequest?.messages)
            ? parsedRequest.messages
            : Array.isArray(parsedRequest?.lastMessages)
              ? parsedRequest.lastMessages
              : [],
          toolChoice: parsedRequest?.toolChoice,
          requestPayloadCaptured: parsedRequest?.requestPayloadCaptured === true,
          toolSchemaSummary,
        }
      }
      step.toolSchemaSummary = toolSchemaSummary

      const iterationSnapshots = bookkeeping.filter((record) =>
        record.actionType === 'loop_decision' && record.title === 'Iteration Snapshot',
      )
      const realLlmMs = iterationSnapshots.reduce((sum, record) => {
        const parsed = parseJson(record.payload)
        return sum + (typeof parsed?.llmWallMs === 'number' ? parsed.llmWallMs : 0)
      }, 0)
      if (realLlmMs > 0) {
        step.ms = realLlmMs
      }

      const llmRespRecords = records.filter(r => r.actionType === 'llm_response')
      if (llmRespRecords.length > 0) {
        let totalInput = 0
        let totalOutput = 0
        let totalCacheRead = 0
        let totalCacheWrite = 0
        for (const record of llmRespRecords) {
          const usage = extractUsage(record)
          if (!usage) continue
          totalInput += usage.inputTokens
          totalOutput += usage.outputTokens
          totalCacheRead += usage.cacheReadTokens ?? 0
          totalCacheWrite += usage.cacheWriteTokens ?? 0
        }
        if (totalInput > 0 || totalOutput > 0) {
          step.usage = {
            inputTokens: totalInput,
            outputTokens: totalOutput,
            totalTokens: totalInput + totalOutput,
            cacheReadTokens: totalCacheRead || undefined,
            cacheWriteTokens: totalCacheWrite || undefined,
          }
        }
      }
    }

    if (debug) {
      const exportRecords = records.map((record) => ({
        actionType: record.actionType,
        title: record.title,
        detail: record.detail,
        createdAt: record.createdAt,
        payload: record.payload ? (() => {
          try { return JSON.parse(record.payload) } catch { return record.payload }
        })() : undefined,
      }))

      if (stage === 'Model generation') {
        const iterationSnapshotRows = bookkeeping
          .filter((record) => record.actionType === 'loop_decision' && record.title === 'Iteration Snapshot')
          .map((record) => ({
            actionType: record.actionType,
            title: record.title,
            detail: record.detail,
            createdAt: record.createdAt,
            payload: record.payload ? (() => {
              try { return JSON.parse(record.payload) } catch { return record.payload }
            })() : undefined,
          }))

        step.json = [...exportRecords, ...iterationSnapshotRows]
      } else {
        step.json = exportRecords
      }
    }

    return step
  })

  const runtimeTruth = capabilityTruth ?? extractRuntimeTruthFromTraces(traces)
  if (runtimeTruth && steps.length > 0) {
    steps[0] = { ...steps[0], runtimeTruth }
  }

  return steps
}
