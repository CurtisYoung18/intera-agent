// Intera Harness - Streaming Tool Executor
// Based on Claude Code's StreamingToolExecutor pattern
//
// Concurrency model:
//   - isConcurrencySafe=true  → run in parallel
//   - isConcurrencySafe=false → serialized, block all other tools while executing
//
// Supports both batch mode (executeAll) and streaming mode (enqueue + waitForAll).

import type { ToolUse, ToolResult, SkillDefinition } from '@intera/shared/types'

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
) => void

interface TrackedTool {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'queued' | 'executing' | 'completed' | 'error'
  isConcurrencySafe: boolean
  definition: SkillDefinition
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
    private toolDefinitions: SkillDefinition[],
    private onStatusChange?: StatusCallback,
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
      // Tool not found — record error result immediately
      this.results.push({
        name: toolUse.name,
        output: {
          ok: false,
          error: `Tool "${toolUse.name}" not found in registry`,
          latencyMs: 0,
        },
        latencyMs: 0,
      })
      return
    }

    const tracked: TrackedTool = {
      id: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
      status: 'queued',
      isConcurrencySafe: definition.isConcurrencySafe,
      definition,
    }

    this.tools.push(tracked)

    if (tracked.isConcurrencySafe) {
      // Start immediately (parallel with other concurrent tools)
      this.pendingPromises.push(this.runTrackedTool(tracked))
    } else {
      // Queue for serial execution
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
    toolDefinitions: SkillDefinition[],
    toolUses: ToolUse[],
    onStatusChange?: StatusCallback,
  ): Promise<ToolExecutionResult[]> {
    const executor = new StreamingToolExecutor(toolDefinitions, onStatusChange)
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
    this.onStatusChange?.(toolUse, 'executing')

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
          )
          this.results.push({ name: tool.name, output: tool.result, latencyMs: 0 })
          return
        }
        // Use the parsed (and potentially default-filled) input
        tool.input = result.data as Record<string, unknown>
      }
    } catch {
      // Zod schema itself is malformed — skip validation, let execution proceed
    }

    try {
      let output: unknown

      if (tool.definition.mode === 'mock') {
        // [MOCK] Simulated execution with random latency
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
    )

    this.results.push({
      name: tool.name,
      output: tool.result,
      latencyMs: tool.result.latencyMs,
      toolUse: completedToolUse,
    })
  }

  // [MOCK] Returns mockFixture or built-in fallback. Simulates network latency.
  private async executeMock(definition: SkillDefinition): Promise<unknown> {
    await this.sleep(100 + Math.random() * 200)

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
      query_account_status: {
        accountStatus: 'active',
        riskFlag: false,
        banReason: null,
        restrictionTier: 'none',
        lastLoginAt: new Date().toISOString(),
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
      kb_hybrid_retrieve: { results: [], sources: [] },
    }

    return defaultResponses[definition.name] || { success: true }
  }

  private async executeHttp(
    definition: SkillDefinition,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (!definition.endpoint) {
      throw new Error(
        `No endpoint configured for skill "${definition.name}"`,
      )
    }

    const response = await fetch(definition.endpoint, {
      method: definition.httpMethod || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...definition.headers,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(definition.timeoutMs || 8000),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
