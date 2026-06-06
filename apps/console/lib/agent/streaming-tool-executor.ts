// Intera Harness - Streaming Tool Executor
// Based on Claude Code's StreamingToolExecutor pattern
//
// Concurrency model:
//   - isConcurrencySafe=true  → run in parallel
//   - isConcurrencySafe=false → serialized, block all other tools while executing
//
// Supports both batch mode (executeAll) and streaming mode (enqueue + waitForAll).

import type { ToolUse, ToolResult, ToolDefinition } from '@intera/shared/types'

/** Tool execution stores `{ ok, output, latencyMs }`; consumers need the inner skill payload. */
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
          this.results.push({ name: tool.name, output: tool.result, latencyMs: 0, toolUse: { id: tool.id, name: tool.name, input: tool.input, status: 'error' as const } })
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
        this.results.push({ name: tool.name, output: tool.result, latencyMs: 1, toolUse: { id: tool.id, name: tool.name, input: tool.input, status: 'completed' as const } })
        return
      }
      // system_info tools: allowed to execute for real in dryRun mode
    }

    try {
      let output: unknown

      if (tool.definition.mode === 'engine_managed' || tool.definition.mode === 'channel') {
        // Engine-managed and channel-dependent skills are handled by the
        // agent loop directly — the executor should never receive them.
        output = { ok: true, handled: tool.definition.mode }
      } else if (tool.definition.mode === 'static') {
        output = await this.executeMock(tool.definition)
      } else {
        output = await this.executeHttp(tool.definition, tool.input)
      }

      tool.status = 'completed'
      tool.result = {
        ok: true,
        output,
        latencyMs: Date.now() - startTime,
      }
    } catch (error) {
      tool.status = 'error'
      tool.result = {
        ok: false,
        output: null,
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
      read_case_history: { cases: [], total: 0 },
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
      finalize_case: {
        status: 'resolved',
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
        `No endpoint configured for skill "${definition.name}"`,
      )
    }

    const resolvedEndpoint = this.resolveEnvVars(definition.endpoint)
    const resolvedHeaders = await this.resolveHeaders(definition.headers as Record<string, string> | undefined)

    // For kb_search_* tools: each knowledge source is a separate skill with its
    // groupIds baked into the endpoint or resolved from DB at execution time.
    let body = input
    if (definition.name.startsWith('kb_search_')) {
      try {
        const { prisma } = await import('@intera/shared/prisma')

        // kb_search_<sourceName>: load the specific source
        let sources: Array<{
          groupIds: string; topK: number; embeddingRate: number;
          docCorrelation: number | null; rerankVersion: string | null;
          modelControlTopK: boolean;
        }> = []

        if (definition.name.startsWith('kb_search_')) {
          const sourceName = definition.name.slice('kb_search_'.length)
          const source = await prisma.knowledgeSource.findFirst({
            where: { agentConfigId: this.agentConfigId ?? '', name: sourceName, enabled: true },
          })
          if (source) sources = [source]
        }

        if (sources.length > 0) {
          const allGroupIds: string[] = []
          let maxTopK = 15
          let embeddingRateSum = 0
          let minDocCorrelation: number | undefined

          for (const s of sources) {
            const ids = JSON.parse(s.groupIds) as string[]
            allGroupIds.push(...ids)
            if (s.topK > maxTopK) maxTopK = s.topK
            embeddingRateSum += s.embeddingRate
            if (s.docCorrelation != null) {
              if (minDocCorrelation == null || s.docCorrelation < minDocCorrelation) {
                minDocCorrelation = s.docCorrelation
              }
            }
          }

          const avgEmbeddingRate = embeddingRateSum / sources.length
          const source = sources[0]
          body = {
            prompt: input.query,
            top_k: source.modelControlTopK
              ? Math.min(Math.max((input.topK as number) ?? source.topK, 1), 30)
              : source.topK,
            group_ids: [...new Set(allGroupIds)],
            embedding_rate: avgEmbeddingRate,
            ...(sources[0]?.rerankVersion && { rerank_version: sources[0].rerankVersion }),
            ...(minDocCorrelation != null && { doc_correlation: minDocCorrelation }),
          }
        } else {
          body = {
            prompt: input.query,
            top_k: (input.topK as number) ?? 15,
          }
        }
      } catch {
        body = {
          prompt: input.query,
          top_k: (input.topK as number) ?? 15,
        }
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
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    // GPTBots vector/match returns list NOT sorted by score when rerank is on.
    // We must sort descending by score so the most relevant chunks surface first.
    // This is idempotent when the list is already sorted (no-rerank path).
    if (
      definition.name.startsWith('kb_search_') &&
      data && Array.isArray((data as Record<string, unknown>).list)
    ) {
      const list = (data as Record<string, unknown>).list as Array<{ score?: number }>
      list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    }
    return data
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
