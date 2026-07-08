// Intera Harness - Streaming Tool Executor
// Based on Claude Code's StreamingToolExecutor pattern
//
// Concurrency model:
//   - isConcurrencySafe=true  → run in parallel
//   - isConcurrencySafe=false → serialized, block all other tools while executing
//
// Supports both batch mode (executeAll) and streaming mode (enqueue + waitForAll).

import type { ToolUse, ToolResult, ToolDefinition } from '@intera/shared/types'
import { knowledgeSourceToolName } from './tool-names'
import {
  KNOWLEDGE_PROVIDER_GPTBOTS,
  UNIFIED_KNOWLEDGE_TOOL_NAME,
  buildKnowledgeSourceOptions,
  isKnowledgeToolName,
  normalizeKnowledgeSourceSelector,
  type KnowledgeSourceOption,
  type KnowledgeSourceRuntimeRow,
} from './knowledge-tooling'

/** Tool execution stores `{ ok, output, latencyMs }`; consumers need the inner tool payload. */
export function unwrapToolExecutionPayload(toolExecutionOutput: unknown): unknown {
  if (!toolExecutionOutput || typeof toolExecutionOutput !== 'object') return toolExecutionOutput
  const tr = toolExecutionOutput as ToolResult
  if ('ok' in tr && tr.ok === true && 'output' in tr) return tr.output
  return toolExecutionOutput
}

type StatusCallback = (
  toolUse: ToolUse,
  status: 'executing' | 'completed' | 'error',
  renderHints?: ToolDefinition['renderHints'],
) => void

interface TrackedTool {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'queued' | 'executing' | 'completed' | 'error'
  isConcurrencySafe: boolean
  definition: ToolDefinition
  result?: ToolResult
}

export interface ToolExecutionResult {
  name: string
  output: unknown
  latencyMs: number
  toolUse?: ToolUse
  renderHints?: ToolDefinition['renderHints']
}

type ToolRepairErrorClass =
  | 'ok_false'
  | 'http_400'
  | 'http_422'
  | 'http_error'
  | 'validation_error'
  | 'network_error'

interface ToolRepairEvent {
  field: string
  before: string
  after: string
  reason: string
}

interface ToolAttemptTrace {
  attempt: number
  input: Record<string, unknown>
  errorClass?: ToolRepairErrorClass
  httpStatus?: number
  responseBody?: unknown
  message?: string
}

interface ToolFailurePayload {
  ok: false
  error_class: ToolRepairErrorClass
  message: string
  http_status?: number
  response_body?: unknown
  attempts: ToolAttemptTrace[]
  repairs: ToolRepairEvent[]
  final_input: Record<string, unknown>
}

class ToolExecutionFailure extends Error {
  constructor(
    message: string,
    readonly payload: ToolFailurePayload,
  ) {
    super(message)
  }
}

class HttpToolFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly responseBody: unknown,
    readonly errorClass: ToolRepairErrorClass,
  ) {
    super(message)
  }
}

class PayloadToolFailure extends Error {
  constructor(
    message: string,
    readonly payload: unknown,
    readonly errorClass: ToolRepairErrorClass,
  ) {
    super(message)
  }
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_REPAIR_ATTEMPTS = 3
const READ_ONLY_QUERY_TOOL_NAMES = new Set([
  'check_latest_deposit_status',
  'check_latest_withdrawal_status',
  'turnover_withdraw_condition',
  'turnover_promotion_active_status',
  'promotion',
  'get_account_status',
  'get_id_verification_details',
  'get_recommend_games',
  'get_transaction_history',
  'get_bet_history',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compactText(value: unknown, max = 4000): unknown {
  if (typeof value !== 'string') return value
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function shallowInputCopy(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input }
}

function normalizeDateOnlyField(
  input: Record<string, unknown>,
  field: 'from_date' | 'to_date',
  suffix: '00:00:00' | '23:59:59',
  repairs: ToolRepairEvent[],
): void {
  const value = input[field]
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!DATE_ONLY_PATTERN.test(trimmed)) return
  const repaired = `${trimmed} ${suffix}`
  input[field] = repaired
  repairs.push({
    field,
    before: value,
    after: repaired,
    reason: 'date_only_to_Y-m-d_H:i:s',
  })
}

function normalizeToolInputForExecution(
  _toolName: string,
  input: Record<string, unknown>,
): { input: Record<string, unknown>; repairs: ToolRepairEvent[] } {
  const next = shallowInputCopy(input)
  const repairs: ToolRepairEvent[] = []

  normalizeDateOnlyField(next, 'from_date', '00:00:00', repairs)
  normalizeDateOnlyField(next, 'to_date', '23:59:59', repairs)

  return { input: next, repairs }
}

function shouldAttemptToolRepair(definition: ToolDefinition): boolean {
  if (definition.mode !== 'http') return false
  if (isKnowledgeToolName(definition.name)) return true
  if (definition.toolCategory === 'system_info') return true
  return READ_ONLY_QUERY_TOOL_NAMES.has(definition.name)
}

function isRetryableWithoutInputRepair(errorClass: ToolRepairErrorClass, httpStatus?: number): boolean {
  if (errorClass === 'network_error') return true
  if (errorClass !== 'http_error') return false
  return httpStatus === 429 || (httpStatus != null && httpStatus >= 500)
}

function stringifyFailureBody(body: unknown): string {
  if (typeof body === 'string') return body
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function classifyFailure(status: number | undefined, body: unknown, fallback: ToolRepairErrorClass): ToolRepairErrorClass {
  const text = stringifyFailureBody(body).toLowerCase()
  const looksLikeValidation = /\b(validation|invalid|required|missing|format|schema|does not match|must be|should be)\b/.test(text)
  if (looksLikeValidation) return 'validation_error'
  if (status === 400) return 'http_400'
  if (status === 422) return 'http_422'
  return fallback
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  if (!text) return ''
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function payloadIndicatesFailure(payload: unknown): payload is Record<string, unknown> {
  return isRecord(payload) && payload.ok === false
}

function clampTopK(value: unknown, fallback: number): number {
  const raw = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : fallback
  if (!Number.isFinite(raw)) return Math.min(Math.max(fallback, 1), 15)
  return Math.min(Math.max(Math.round(raw), 1), 15)
}

function stringInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

interface KnowledgeRequestResolution {
  body?: Record<string, unknown>
  source?: KnowledgeSourceOption
  sourceSelection?: Record<string, unknown>
  effectiveTopK?: number
  recoverableError?: Record<string, unknown>
}

/**
 * StreamingToolExecutor — incremental tool execution during LLM streaming.
 *
 * In streaming mode:
 *   enqueue(toolUse) is called as each tool_use block completes in the stream.
 *   The tool starts executing immediately if concurrency allows.
 *   waitForAll() is called after message_stop to collect all results.
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private results: ToolExecutionResult[] = []
  private executingNonConcurrent = false
  private nonConcurrentQueue: TrackedTool[] = []
  private pendingPromises: Promise<void>[] = []

  constructor(
    private toolDefinitions: ToolDefinition[],
    private onStatusChange?: StatusCallback,
    private dryRun?: boolean,
    private agentConfigId?: string,
  ) {}

  /**
   * Called as each tool_use content_block completes in the stream.
   * Dispatches execution immediately for concurrent-safe tools;
   * queues non-concurrent tools for serial execution.
   */
  enqueue(toolUse: ToolUse): void {
    const definition = this.toolDefinitions.find(
      (t) => t.name === toolUse.name,
    )
    if (!definition) {
      this.results.push({
        name: toolUse.name,
        output: {
          ok: false,
          error: `Tool "${toolUse.name}" not found in registry`,
          latencyMs: 0,
        },
        latencyMs: 0,
        toolUse,
      })
      return
    }

    // Two-pass Zod validation (CC pattern): parse input at enqueue time
    // to determine dynamic concurrency safety from parsed data.
    let parsedInput = toolUse.input
    let dynamicConcurrencySafe = definition.isConcurrencySafe
    try {
      if (definition.zodSchema) {
        const parseResult = definition.zodSchema.safeParse(toolUse.input)
        if (parseResult.success) {
          parsedInput = parseResult.data as Record<string, unknown>
        }
      }
    } catch {
      // Schema parse failed — keep original input, use static concurrency flag
    }

    const tracked: TrackedTool = {
      id: toolUse.id,
      name: toolUse.name,
      input: parsedInput,
      status: 'queued',
      isConcurrencySafe: dynamicConcurrencySafe,
      definition,
    }

    this.tools.push(tracked)

    if (tracked.isConcurrencySafe) {
      this.pendingPromises.push(this.runTrackedTool(tracked))
    } else {
      this.nonConcurrentQueue.push(tracked)
      this.drainNonConcurrentQueue()
    }
  }

  /**
   * Called after message_stop. Waits for all tools to finish.
   */
  async waitForAll(): Promise<ToolExecutionResult[]> {
    await Promise.all(this.pendingPromises)
    return this.results
  }

  /**
   * Batch mode — for non-streaming use cases.
   */
  static async executeAll(
    toolDefinitions: ToolDefinition[],
    toolUses: ToolUse[],
    onStatusChange?: StatusCallback,
    dryRun?: boolean,
    agentConfigId?: string,
  ): Promise<ToolExecutionResult[]> {
    const executor = new StreamingToolExecutor(toolDefinitions, onStatusChange, dryRun, agentConfigId)
    for (const toolUse of toolUses) {
      executor.enqueue(toolUse)
    }
    return executor.waitForAll()
  }

  // ============================================
  // Internal execution
  // ============================================

  private drainNonConcurrentQueue(): void {
    if (this.executingNonConcurrent || this.nonConcurrentQueue.length === 0) {
      return
    }

    const next = this.nonConcurrentQueue.shift()!
    this.executingNonConcurrent = true

    this.pendingPromises.push(
      this.runTrackedTool(next).finally(() => {
        this.executingNonConcurrent = false
        // Process next non-concurrent tool if queued
        this.drainNonConcurrentQueue()
      }),
    )
  }

  private async runTrackedTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    const startTime = Date.now()

    const preExecutionRepair = normalizeToolInputForExecution(tool.name, tool.input)
    if (preExecutionRepair.repairs.length > 0) {
      tool.input = preExecutionRepair.input
    }

    const toolUse: ToolUse = {
      id: tool.id,
      name: tool.name,
      input: tool.input,
      status: 'executing',
    }
    this.onStatusChange?.(toolUse, 'executing', tool.definition.renderHints)

    // ── Zod validation (Claude Code pattern: safeParse before execution) ──
    try {
      const zodSchema = tool.definition.zodSchema
      if (zodSchema) {
        const result = zodSchema.safeParse(tool.input)
        if (!result.success) {
          const errors = result.error.issues
            .map((i: { path: (string | number)[]; message: string }) =>
              `  - ${i.path.join('.') || 'input'}: ${i.message}`)
            .join('\n')
          tool.status = 'error'
          tool.result = {
            ok: false,
            output: null,
            error: `Input validation failed:\n${errors}\n\nPlease correct the input and retry.`,
            latencyMs: 0,
          }
          this.onStatusChange?.(
            { id: tool.id, name: tool.name, input: tool.input, result: tool.result },
            'error',
            tool.definition.renderHints,
          )
          this.results.push({ name: tool.name, output: tool.result, latencyMs: 0, toolUse: { id: tool.id, name: tool.name, input: tool.input, status: 'error' as const }, renderHints: tool.definition.renderHints })
          return
        }
        // Use the parsed (and potentially default-filled) input
        tool.input = result.data as Record<string, unknown>
      }
    } catch {
      // Zod schema itself is malformed — skip validation, let execution proceed
    }

    // ── Dry-run chokepoint: operational + unknown tools mocked, system_info allowed ──
    if (this.dryRun) {
      const category = tool.definition.toolCategory
      const isSystemInfo = category === 'system_info'
      if (!isSystemInfo) {
        // Operational or unknown → mock, no real execution
        tool.status = 'completed'
        tool.result = {
          ok: true,
          output: {
            _dryRun: true,
            _note: `Playground: "${tool.name}" (category: ${category || 'unknown'}) intercepted — no side effects.`,
          },
          latencyMs: 1,
        }
        this.onStatusChange?.(
          { id: tool.id, name: tool.name, input: tool.input, result: tool.result },
          'completed',
          tool.definition.renderHints,
        )
        this.results.push({ name: tool.name, output: tool.result, latencyMs: 1, toolUse: { id: tool.id, name: tool.name, input: tool.input, status: 'completed' as const }, renderHints: tool.definition.renderHints })
        return
      }
      // system_info tools: allowed to execute for real in dryRun mode
    }

    try {
      let output: unknown

      if (
        tool.definition.mode === 'system_managed' ||
        tool.definition.mode === 'channel'
      ) {
        // System-managed and channel-dependent tools are handled by the
        // agent loop directly — the executor should never receive them.
        output = { ok: true, handled: tool.definition.mode }
      } else if (tool.definition.mode === 'static_fixture') {
        output = await this.executeMock(tool.definition)
      } else {
        const httpResult = await this.executeHttpWithRepair(tool.definition, tool.input, preExecutionRepair.repairs)
        tool.input = httpResult.input
        output = httpResult.output
      }

      tool.status = 'completed'
      tool.result = {
        ok: true,
        output,
        latencyMs: Date.now() - startTime,
      }
    } catch (error) {
      tool.status = 'error'
      const failurePayload = error instanceof ToolExecutionFailure ? error.payload : undefined
      tool.result = {
        ok: false,
        output: failurePayload ?? null,
        error: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: Date.now() - startTime,
      }
    }

    const completedToolUse: ToolUse = {
      id: tool.id,
      name: tool.name,
      input: tool.input,
      status: tool.status === 'completed' ? 'completed' : 'error',
      result: tool.result,
    }
    this.onStatusChange?.(
      completedToolUse,
      tool.status === 'completed' ? 'completed' : 'error',
      tool.definition.renderHints,
    )

    this.results.push({
      name: tool.name,
      output: tool.result,
      latencyMs: tool.result.latencyMs,
      toolUse: completedToolUse,
      renderHints: tool.definition.renderHints,
    })
  }

  // [MOCK] Returns mockFixture or built-in fallback. Simulates network latency.
  private async executeMock(definition: ToolDefinition): Promise<unknown> {
    await this.sleep(100 + Math.random() * 200)

    // Dynamic mock for get_current_time
    if (definition.name === 'get_current_time') {
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const gmt8 = new Date(now.getTime() + 8 * 3600000)
      return {
        today: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
        day_of_week: days[now.getUTCDay()],
        utc_time: now.toISOString(),
        gmt8_time: gmt8.toISOString(),
        gmt8_date: gmt8.getFullYear() + '-' + pad(gmt8.getMonth() + 1) + '-' + pad(gmt8.getDate()),
      }
    }

    if (definition.mockFixture) {
      return definition.mockFixture
    }

    const defaultResponses: Record<string, unknown> = {
      query_order_status: {
        status: 'pending',
        amount: 0,
        time: new Date().toISOString(),
      },
      query_payment_channel_status: {
        delayed_batch: false,
        channel: 'unknown',
      },
      search_delay_notice: { notices: [] },
      ocr_receipt: { success: true, extracted: {} },
      create_human_task: {
        taskId: crypto.randomUUID(),
        status: 'pending',
      },
      finalize_procedure: {
        status: 'completed',
        resolvedAt: new Date().toISOString(),
      },
    }

    return defaultResponses[definition.name] || { success: true }
  }

  private resolveEnvVars(value: string): string {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
  }

  private async resolveHeaders(
    headers?: Record<string, string>,
  ): Promise<Record<string, string> | undefined> {
    if (!headers) return undefined
    const resolved: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      resolved[k] = this.resolveEnvVars(v)
    }
    return resolved
  }

  private async executeHttp(
    definition: ToolDefinition,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (!definition.endpoint) {
      throw new Error(
        `No endpoint configured for tool "${definition.name}"`,
      )
    }

    const resolvedEndpoint = this.resolveEnvVars(definition.endpoint)
    const resolvedHeaders = await this.resolveHeaders(definition.headers as Record<string, string> | undefined)

    // Knowledge tools resolve source config at execution time so topK/rerank
    // and group bindings match the current KnowledgeSource row.
    let body = input
    let knowledgeResolution: KnowledgeRequestResolution | null = null
    if (isKnowledgeToolName(definition.name)) {
      knowledgeResolution = await this.resolveKnowledgeRequest(definition, input)
      if (knowledgeResolution.recoverableError) {
        return knowledgeResolution.recoverableError
      }
      body = knowledgeResolution.body ?? {
        prompt: input.query,
        top_k: (input.topK as number) ?? 15,
      }
    }

    const method = definition.httpMethod || 'POST'
    const fetchInit: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...resolvedHeaders,
      },
      signal: AbortSignal.timeout(definition.timeoutMs || 10000),
    }
    // GET requests cannot have a body
    if (method !== 'GET') {
      fetchInit.body = JSON.stringify(body)
    }

    const response = await fetch(resolvedEndpoint, fetchInit)

    if (!response.ok) {
      const responseBody = await readResponseBody(response)
      const errorClass = classifyFailure(response.status, responseBody, 'http_error')
      throw new HttpToolFailure(
        `HTTP ${response.status}: ${response.statusText}${responseBody ? ` - ${stringifyFailureBody(responseBody).slice(0, 1000)}` : ''}`,
        response.status,
        response.statusText,
        responseBody,
        errorClass,
      )
    }

    const data = await response.json()

    // GPTBots vector/match returns list NOT sorted by score when rerank is on.
    // We must sort descending by score so the most relevant chunks surface first.
    // This is idempotent when the list is already sorted (no-rerank path).
    if (
      isKnowledgeToolName(definition.name) &&
      data && Array.isArray((data as Record<string, unknown>).list)
    ) {
      const list = (data as Record<string, unknown>).list as Array<{ score?: number }>
      list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    }

    if (definition.name === UNIFIED_KNOWLEDGE_TOOL_NAME && knowledgeResolution?.source) {
      return {
        ...(isRecord(data) ? data : { data }),
        knowledgeSourceId: knowledgeResolution.source.id,
        knowledgeSourceName: knowledgeResolution.source.name,
        knowledgeSourceKey: knowledgeResolution.source.key,
        knowledgeProvider: KNOWLEDGE_PROVIDER_GPTBOTS,
        query: typeof input.query === 'string' ? input.query : '',
        topK: knowledgeResolution.effectiveTopK,
        sourceSelection: knowledgeResolution.sourceSelection,
      }
    }
    return data
  }

  private async resolveKnowledgeRequest(
    definition: ToolDefinition,
    input: Record<string, unknown>,
  ): Promise<KnowledgeRequestResolution> {
    try {
      const { prisma } = await import('@intera/shared/prisma')

      if (definition.name !== UNIFIED_KNOWLEDGE_TOOL_NAME) {
        const legacySource = await this.resolveLegacyKnowledgeSource(definition)
        if (!legacySource) {
          return {
            body: {
              prompt: input.query,
              top_k: (input.topK as number) ?? 15,
            },
          }
        }
        return this.buildKnowledgeRequestBody(legacySource, input, {
          mode: 'legacy_tool',
          requestedSource: definition.name,
        })
      }

      const enabledSources = await prisma.knowledgeSource.findMany({
        where: { agentConfigId: this.agentConfigId ?? '', enabled: true },
      }) as KnowledgeSourceRuntimeRow[]
      const options = buildKnowledgeSourceOptions(enabledSources, definition.knowledgeSources)

      if (options.length === 0) {
        return {
          recoverableError: {
            recoverable: true,
            errorCode: 'knowledge_source_unavailable',
            message: 'No enabled knowledge source with bound groupIds is available for search_knowledge.',
            query: typeof input.query === 'string' ? input.query : '',
            availableSources: [],
          },
        }
      }

      const requestedSource = stringInput(input, 'source')
        ?? stringInput(input, 'sourceId')
        ?? stringInput(input, 'sourceName')

      if (!requestedSource && options.length > 1) {
        return {
          recoverableError: {
            recoverable: true,
            errorCode: 'source_required',
            message: 'search_knowledge requires a source when multiple knowledge sources are available. Retry with one of the listed source keys.',
            query: typeof input.query === 'string' ? input.query : '',
            availableSources: options.map((option) => this.describeSourceOption(option)),
          },
        }
      }

      const selected = requestedSource
        ? this.matchKnowledgeSourceOption(options, requestedSource)
        : options[0]

      if (!selected) {
        return {
          recoverableError: {
            recoverable: true,
            errorCode: 'unknown_source',
            message: `Unknown knowledge source "${requestedSource}". Retry with one of the listed source keys.`,
            requestedSource,
            query: typeof input.query === 'string' ? input.query : '',
            availableSources: options.map((option) => this.describeSourceOption(option)),
          },
        }
      }

      return this.buildKnowledgeRequestBody(selected, input, {
        mode: requestedSource ? 'explicit' : 'auto_single_source',
        requestedSource,
      })
    } catch {
      if (definition.name === UNIFIED_KNOWLEDGE_TOOL_NAME) {
        return {
          recoverableError: {
            recoverable: true,
            errorCode: 'knowledge_source_resolution_failed',
            message: 'Unable to load knowledge source configuration for search_knowledge. Retry later or escalate if the issue persists.',
            query: typeof input.query === 'string' ? input.query : '',
          },
        }
      }
      return {
        body: {
          prompt: input.query,
          top_k: (input.topK as number) ?? 15,
        },
      }
    }
  }

  private async resolveLegacyKnowledgeSource(definition: ToolDefinition): Promise<KnowledgeSourceOption | null> {
    const { prisma } = await import('@intera/shared/prisma')

    if (definition.knowledgeSourceId) {
      const source = await prisma.knowledgeSource.findFirst({
        where: { agentConfigId: this.agentConfigId ?? '', id: definition.knowledgeSourceId, enabled: true },
      }) as KnowledgeSourceRuntimeRow | null
      return source ? buildKnowledgeSourceOptions([source])[0] ?? null : null
    }

    const enabledSources = await prisma.knowledgeSource.findMany({
      where: { agentConfigId: this.agentConfigId ?? '', enabled: true },
    }) as KnowledgeSourceRuntimeRow[]
    const options = buildKnowledgeSourceOptions(enabledSources)
    return options.find((candidate) => (
      candidate.legacyToolName === definition.name ||
      knowledgeSourceToolName(candidate.name, candidate.id) === definition.name ||
      `kb_search_${candidate.name.replace(/[^a-zA-Z0-9_-]/g, '_')}` === definition.name
    )) ?? null
  }

  private buildKnowledgeRequestBody(
    source: KnowledgeSourceOption,
    input: Record<string, unknown>,
    selection: { mode: string; requestedSource?: string },
  ): KnowledgeRequestResolution {
    const effectiveTopK = source.modelControlTopK
      ? clampTopK(input.topK, source.topK)
      : source.topK
    return {
      source,
      effectiveTopK,
      sourceSelection: {
        mode: selection.mode,
        requestedSource: selection.requestedSource,
        source: source.key,
        sourceName: source.name,
        legacyToolName: source.legacyToolName,
      },
      body: {
        prompt: input.query,
        top_k: effectiveTopK,
        group_ids: [...new Set(source.groupIds)],
        embedding_rate: source.embeddingRate,
        ...(source.rerankVersion && { rerank_version: source.rerankVersion }),
        ...(source.docCorrelation != null && { doc_correlation: source.docCorrelation }),
      },
    }
  }

  private matchKnowledgeSourceOption(
    options: KnowledgeSourceOption[],
    rawSource: string,
  ): KnowledgeSourceOption | undefined {
    const normalized = normalizeKnowledgeSourceSelector(rawSource)
    const lower = rawSource.trim().toLowerCase()
    return options.find((option) => (
      option.key === rawSource ||
      option.key.toLowerCase() === lower ||
      option.id === rawSource ||
      option.name === rawSource ||
      option.name.toLowerCase() === lower ||
      option.legacyToolName === rawSource ||
      normalizeKnowledgeSourceSelector(option.name) === normalized ||
      normalizeKnowledgeSourceSelector(option.legacyToolName) === normalized
    ))
  }

  private describeSourceOption(option: KnowledgeSourceOption): Record<string, unknown> {
    return {
      source: option.key,
      name: option.name,
      description: option.description,
      legacyToolName: option.legacyToolName,
    }
  }

  private async executeHttpWithRepair(
    definition: ToolDefinition,
    input: Record<string, unknown>,
    initialRepairs: ToolRepairEvent[],
  ): Promise<{ output: unknown; input: Record<string, unknown> }> {
    const canRepair = shouldAttemptToolRepair(definition)
    const maxAttempts = canRepair ? MAX_REPAIR_ATTEMPTS : 1
    let currentInput = shallowInputCopy(input)
    const repairs = [...initialRepairs]
    const attempts: ToolAttemptTrace[] = []
    let lastFailure: {
      message: string
      errorClass: ToolRepairErrorClass
      httpStatus?: number
      responseBody?: unknown
    } | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const normalized = normalizeToolInputForExecution(definition.name, currentInput)
      currentInput = normalized.input
      repairs.push(...normalized.repairs)

      try {
        const output = await this.executeHttp(definition, currentInput)
        if (payloadIndicatesFailure(output)) {
          const errorClass = classifyFailure(undefined, output, 'ok_false')
          throw new PayloadToolFailure(`Tool returned ok:false (${errorClass})`, output, errorClass)
        }
        return { output, input: currentInput }
      } catch (error) {
        const failure = this.toStructuredFailure(error)
        lastFailure = failure
        attempts.push({
          attempt,
          input: shallowInputCopy(currentInput),
          errorClass: failure.errorClass,
          httpStatus: failure.httpStatus,
          responseBody: compactText(failure.responseBody),
          message: failure.message,
        })

        if (!canRepair || attempt >= maxAttempts) break

        const repaired = normalizeToolInputForExecution(definition.name, currentInput)
        const changed = repaired.repairs.length > 0
        currentInput = repaired.input
        repairs.push(...repaired.repairs)
        if (!changed && !isRetryableWithoutInputRepair(failure.errorClass, failure.httpStatus)) break
      }
    }

    const message = lastFailure?.message ?? `Tool "${definition.name}" failed.`
    throw new ToolExecutionFailure(message, {
      ok: false,
      error_class: lastFailure?.errorClass ?? 'network_error',
      message,
      http_status: lastFailure?.httpStatus,
      response_body: compactText(lastFailure?.responseBody),
      attempts,
      repairs,
      final_input: currentInput,
    })
  }

  private toStructuredFailure(error: unknown): {
    message: string
    errorClass: ToolRepairErrorClass
    httpStatus?: number
    responseBody?: unknown
  } {
    if (error instanceof HttpToolFailure) {
      return {
        message: error.message,
        errorClass: error.errorClass,
        httpStatus: error.status,
        responseBody: error.responseBody,
      }
    }
    if (error instanceof PayloadToolFailure) {
      return {
        message: error.message,
        errorClass: error.errorClass,
        responseBody: error.payload,
      }
    }
    return {
      message: error instanceof Error ? error.message : 'Unknown network/tool error',
      errorClass: 'network_error',
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
