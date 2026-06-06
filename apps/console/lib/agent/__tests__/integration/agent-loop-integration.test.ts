import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { APIConnectionError } from '@anthropic-ai/sdk'
import { AgentLoop, type AgentLoopDeps } from '../../loop'
import { ToolRouter } from '../../tools'
import { consumeStream, type StreamConsumeCallbacks, type StreamContentBlock } from '../../stream-handler'
import { mockTextStream, mockToolUseStream, mockAnthropicClient } from '../mocks/anthropic'
import { classifyError } from '../../api/error-classifier'
import { withRetry, CannotRetryError, FallbackTriggeredError } from '../../api/with-retry'
import { synthesizeMissingToolResults, assertToolResultInvariant } from '../../tool-result-invariant'
import type { ToolUse } from '@intera/shared/types'

function makeToolUse(id: string, name: string): ToolUse {
  return { id, name, input: {} }
}

describe('E7 — Integration: Stream + Retry + Invariant', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('full stream flow: text → tool_use → text (multi-iteration simulation)', async () => {
    // Iteration 1: text + dispatch_case_agent tool_use
    const stream1 = mockToolUseStream('dispatch_case_agent', { caseType: 'withdrawal_issue' }, 'tool_001')
    const blocks1 = new Map<number, StreamContentBlock>()

    const events: Array<{ type: string; data: unknown }> = []
    const cbs: StreamConsumeCallbacks = {
      sendEvent: (e) => events.push({ type: e.type, data: e.data }),
      sanitizeChunk: (t) => t,
      flushSanitizer: () => '',
      recordFirstToken: () => {},
      showThinking: false,
      onToolUseCompleted: async () => {},
    }

    const result1 = await consumeStream(stream1 as any, blocks1, cbs)
    expect(result1.stopReason).toBe('tool_use')
    expect(blocks1.size).toBe(1)

    // Build the messages array as the loop would
    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'user', content: 'My withdrawal hasn\'t arrived' },
    ]

    // Simulate the assistant message being pushed
    const toolUses1 = [...blocks1.values()]
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: JSON.parse(b.content) }))

    messages.push({
      role: 'assistant',
      content: result1.fullText,
      toolUses: toolUses1,
    } as any)

    // Simulate tool result
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tool_001', content: JSON.stringify({ caseId: 'case_001', status: 'created' }) },
      ],
    })

    // Iteration 2: text response
    const stream2 = mockTextStream('I have created your withdrawal case. Let me investigate.')
    const blocks2 = new Map<number, StreamContentBlock>()
    const cbs2: StreamConsumeCallbacks = {
      sendEvent: (e) => events.push({ type: e.type, data: e.data }),
      sanitizeChunk: (t) => t,
      flushSanitizer: () => '',
      recordFirstToken: () => {},
      showThinking: false,
      onToolUseCompleted: async () => {},
    }

    const result2 = await consumeStream(stream2 as any, blocks2, cbs)
    expect(result2.stopReason).toBe('end_turn')
    expect(result2.fullText).toBe('I have created your withdrawal case. Let me investigate.')

    messages.push({ role: 'assistant', content: result2.fullText })

    // Verify message sequence
    expect(messages).toHaveLength(4)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[2].role).toBe('user')
    expect(messages[3].role).toBe('assistant')
  })

  it('withRetry + stream creation integration', async () => {
    const client = mockAnthropicClient()
    const connectionErr = new APIConnectionError({ message: 'ECONNREFUSED' } as any)

    client.messages.stream
      .mockRejectedValueOnce(connectionErr)
      .mockRejectedValueOnce(connectionErr)
      .mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) })

    const resultPromise = withRetry(
      async () => client.messages.stream({ model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [] }),
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    ).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e }),
    )

    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(client.messages.stream).toHaveBeenCalledTimes(3)
  })

  it('withRetry exhaustion → CannotRetryError integration', async () => {
    const client = mockAnthropicClient()
    const connectionErr = new APIConnectionError({ message: 'ECONNREFUSED' } as any)
    client.messages.stream.mockRejectedValue(connectionErr)

    const resultPromise = withRetry(
      async () => client.messages.stream({ model: 'claude-sonnet-4-20250514', max_tokens: 100, messages: [] }),
      { querySource: 'main_loop', model: 'claude-sonnet-4-20250514' },
      () => client as any,
    ).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e }),
    )

    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(CannotRetryError)
      expect((result.error as CannotRetryError).errorClass).toBe('transient_network')
    }
  })
})

describe('E7 — Integration: S1 Invariant + Tool Execution', () => {
  it('synthesize + assert after mid-stream break simulation', () => {
    // Simulate a stream breaking after emitting a tool_use but before execution
    const toolUses = [
      makeToolUse('tu_1', 'query_order'),
      makeToolUse('tu_2', 'query_order_status'),
    ]

    // Only one tool completed; tu_2 missing with stream_aborted reason
    const completedResults = [
      { toolUseId: 'tu_1', output: { ok: true, orderId: 'ORD-001' }, isError: false },
    ]
    const missingReasons = new Map<string, 'stream_aborted'>([['tu_2', 'stream_aborted']])

    const blocks = synthesizeMissingToolResults({ toolUses, completedResults, missingReasons })
    expect(blocks).toHaveLength(2)
    expect(blocks.find((b) => b.tool_use_id === 'tu_1')!.is_error).toBe(false)
    expect(blocks.find((b) => b.tool_use_id === 'tu_2')!.is_error).toBe(true)
    expect(blocks.find((b) => b.tool_use_id === 'tu_2')!.content).toContain('stream')

    // Build messages as the loop would and verify invariant passes
    const messages = [
      { role: 'user' as const, content: '' },
      { role: 'assistant' as const, content: '', toolUses },
      {
        role: 'user' as const,
        content: blocks.map((b) => ({
          type: 'tool_result' as const,
          tool_use_id: b.tool_use_id,
          content: b.content,
          is_error: b.is_error,
        })),
      },
    ]

    expect(() => assertToolResultInvariant(messages)).not.toThrow()
  })

  it('invariant catches programmer error (unmatched tool_use with no missing reason)', () => {
    const toolUses = [makeToolUse('orphan', 'broken_tool')]
    const completedResults: Array<{ toolUseId: string; output: unknown; isError: boolean }> = []
    const missingReasons = new Map() // empty — no reason for orphan

    expect(() =>
      synthesizeMissingToolResults({ toolUses, completedResults, missingReasons }),
    ).toThrow(/programmer error/)
  })
})

describe('E7 — Integration: ToolRouter + Tool Discovery', () => {
  it('all built-in tools are discoverable', () => {
    const router = new ToolRouter('integration-test')

    // Verify critical tools are present
    const requiredSkills = [
      'dispatch_case_agent',
      'finalize_case',
      'create_human_task',
    ]

    for (const name of requiredSkills) {
      const skill = router.getTool(name)
      expect(skill, `${name} should be registered`).toBeDefined()
      expect(skill!.name).toBe(name)
    }
  })

  it('getToolDefinitions returns valid skill definitions', () => {
    const router = new ToolRouter('integration-test')
    const tools = router.getToolDefinitions()

    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    }
  })

  it('dispatch_case_agent is in tool definitions', () => {
    const router = new ToolRouter('integration-test')
    const tools = router.getToolDefinitions()
    const dispatchTool = tools.find((t) => t.name === 'dispatch_case_agent')

    expect(dispatchTool).toBeDefined()
    expect(dispatchTool!.inputSchema.properties).toHaveProperty('caseType')
  })
})

describe('E7 — Integration: Error Classification Chain', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('classifyError → withRetry: connection error triggers retry', async () => {
    const err = new APIConnectionError({ message: 'socket hang up' } as any)
    const cls = classifyError(err)
    expect(cls).toBe('transient_network')

    // Verify this classification is retryable
    const client = mockAnthropicClient()
    client.messages.create
      .mockRejectedValueOnce(err)
      .mockResolvedValue({ content: [], stop_reason: 'end_turn', usage: {} })

    const resultPromise = withRetry(
      (c) => c.messages.create({ model: 'test', max_tokens: 100, messages: [] }),
      { querySource: 'main_loop', model: 'test' },
      () => client as any,
    ).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e }),
    )

    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(client.messages.create).toHaveBeenCalledTimes(2) // initial + 1 retry
  })

  it('classifyError → withRetry: auth error does NOT retry', async () => {
    const err = new Anthropic.APIError(401, undefined, 'Unauthorized', undefined)
    const cls = classifyError(err)
    expect(cls).toBe('auth')

    // Verify auth is NOT retryable
    const client = mockAnthropicClient()
    client.messages.create.mockRejectedValue(err)

    const result = await withRetry(
      (c) => c.messages.create({ model: 'test', max_tokens: 100, messages: [] }),
      { querySource: 'main_loop', model: 'test' },
      () => client as any,
    ).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: e }),
    )

    expect(result.ok).toBe(false)
    expect(client.messages.create).toHaveBeenCalledTimes(1) // no retries
  })
})
