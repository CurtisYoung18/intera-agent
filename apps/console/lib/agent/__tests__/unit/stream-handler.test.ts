import { describe, it, expect, vi } from 'vitest'
import {
  consumeStream,
  parseToolInput,
  buildToolUsesFromBlocks,
  normalizeSSEEvent,
  type StreamConsumeCallbacks,
  type StreamContentBlock,
} from '../../stream-handler'
import { createMockStream, mockTextStream, mockToolUseStream } from '../mocks/anthropic'

function makeCallbacks(overrides?: Partial<StreamConsumeCallbacks>): StreamConsumeCallbacks {
  return {
    sendEvent: vi.fn(),
    sanitizeChunk: (text: string) => text,
    flushSanitizer: () => '',
    recordFirstToken: vi.fn(),
    emitThinking: false,
    onToolUseCompleted: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('consumeStream', () => {
  it('accumulates text from text_delta events', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockTextStream('Hello, how can I help?')
    const result = await consumeStream(stream as any, blocks, cbs)

    expect(result.fullText).toBe('Hello, how can I help?')
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 50 })
    expect(cbs.sendEvent).toHaveBeenCalled()
  })

  it('handles tool_use block completion', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockToolUseStream('query_order', { caseId: '123' })
    const result = await consumeStream(stream as any, blocks, cbs)

    expect(cbs.onToolUseCompleted).toHaveBeenCalledTimes(1)
    const callArgs = (cbs.onToolUseCompleted as any).mock.calls[0]
    expect(callArgs[0].name).toBe('query_order')
    expect(callArgs[0].input).toEqual({ caseId: '123' })
    expect(result.stopReason).toBe('tool_use')
  })

  it('parses tool use with MiniMax pre-seeded input', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockToolUseStream('query_order', { orderId: 'ORD-001' })
    const result = await consumeStream(stream as any, blocks, cbs)

    expect(cbs.onToolUseCompleted).toHaveBeenCalledTimes(1)
    const callArgs = (cbs.onToolUseCompleted as any).mock.calls[0]
    expect(callArgs[0].input.orderId).toBe('ORD-001')
  })

  it('accumulates text from multiple text blocks', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockTextStream('Part one. Part two. Part three.')
    const result = await consumeStream(stream as any, blocks, cbs)

    expect(result.fullText).toBe('Part one. Part two. Part three.')
  })

  it('records stop_reason and usage from message_delta', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockTextStream('ok', 'claude-sonnet-4-20250514', { input_tokens: 500, output_tokens: 200 })
    const result = await consumeStream(stream as any, blocks, cbs)

    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({ input_tokens: 500, output_tokens: 200 })
  })

  it('calls sanitizeChunk for text content', async () => {
    const sanitizeChunk = vi.fn((text: string) => text.replace(/think/g, ''))
    const cbs = makeCallbacks({ sanitizeChunk })
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockTextStream('I think this is correct')
    await consumeStream(stream as any, blocks, cbs)

    expect(sanitizeChunk).toHaveBeenCalled()
  })

  it('calls recordFirstToken once for text output', async () => {
    const recordFirstToken = vi.fn()
    const cbs = makeCallbacks({ recordFirstToken })
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockTextStream('Hello')
    await consumeStream(stream as any, blocks, cbs)

    expect(recordFirstToken).toHaveBeenCalledTimes(1)
  })

  it('emits thinking_delta when emitThinking is true', async () => {
    const sendEvent = vi.fn()
    const cbs = makeCallbacks({ sendEvent, emitThinking: true })
    const blocks = new Map<number, StreamContentBlock>()

    // Create a stream with thinking content
    const stream = createMockStream([
      { type: 'message_start', message: { id: 'msg_1', model: 'test', role: 'assistant', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', index: 0 } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me analyze this...' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', index: 1 } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Here is the answer.' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'end_turn' }, usage: { input_tokens: 50, output_tokens: 30 } },
      { type: 'message_stop' },
    ])

    await consumeStream(stream as any, blocks, cbs)

    const thinkingEvents = (sendEvent as any).mock.calls.filter(
      (call: any[]) => call[0].type === 'thinking_delta',
    )
    expect(thinkingEvents.length).toBeGreaterThan(0)
  })

  it('suppresses thinking_delta when emitThinking is false', async () => {
    const sendEvent = vi.fn()
    const cbs = makeCallbacks({ sendEvent, emitThinking: false })
    const blocks = new Map<number, StreamContentBlock>()

    const stream = createMockStream([
      { type: 'message_start', message: { id: 'msg_1', model: 'test', role: 'assistant', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', index: 0 } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', index: 1 } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer.' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'end_turn' }, usage: { input_tokens: 50, output_tokens: 10 } },
      { type: 'message_stop' },
    ])

    await consumeStream(stream as any, blocks, cbs)

    const thinkingEvents = (sendEvent as any).mock.calls.filter(
      (call: any[]) => call[0].type === 'thinking_delta',
    )
    expect(thinkingEvents).toHaveLength(0)
  })

  it('flushes sanitizer on message_stop', async () => {
    const flushSanitizer = vi.fn(() => 'flushed')
    const sendEvent = vi.fn()
    const cbs = makeCallbacks({ flushSanitizer, sendEvent })
    const blocks = new Map<number, StreamContentBlock>()

    const stream = mockTextStream('hello')
    await consumeStream(stream as any, blocks, cbs)

    expect(flushSanitizer).toHaveBeenCalled()
  })
})

describe('normalizeSSEEvent', () => {
  it('canonicalizes historical skill event names to tool event names', () => {
    const timestamp = new Date().toISOString()

    expect(normalizeSSEEvent({ type: 'skill_call', data: {}, timestamp }).type).toBe('tool_call')
    expect(normalizeSSEEvent({ type: 'skill_result', data: {}, timestamp }).type).toBe('tool_result')
    expect(normalizeSSEEvent({ type: 'tool_result', data: {}, timestamp }).type).toBe('tool_result')
  })
})

// ── L6 guard: tool-input parsing must never throw ──────────────────────────
// Tool input arrives as streamed input_json fragments. That payload can be
// incomplete/malformed in normal operation — stop_reason:'max_tokens' truncates
// a tool_use mid-stream, or a non-Anthropic provider (MiniMax/DeepSeek) streams
// divergent partial_json. The post-stream S1 synthesis re-derives ToolUse[] from
// the blocks; an unguarded JSON.parse there (loop.ts) crashed the whole turn.
// These guard the shared, guarded parse used by both the stream handler and the
// loop's synthesis step.
describe('parseToolInput (L6)', () => {
  it('parses valid tool input JSON', () => {
    expect(parseToolInput('{"orderId":"ORD-1"}')).toEqual({ orderId: 'ORD-1' })
  })

  it('falls back to {} on truncated/malformed JSON instead of throwing', () => {
    expect(() => parseToolInput('{"orderId": "OR')).not.toThrow()
    expect(parseToolInput('{"orderId": "OR')).toEqual({})
  })

  it('falls back to {} on empty or nullish content', () => {
    expect(parseToolInput('')).toEqual({})
    expect(parseToolInput(undefined)).toEqual({})
    expect(parseToolInput(null)).toEqual({})
  })
})

describe('buildToolUsesFromBlocks (L6)', () => {
  it('builds ToolUse[] from a valid tool_use stream', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()
    await consumeStream(mockToolUseStream('query_order', { orderId: 'ORD-1' }) as any, blocks, cbs)

    expect(buildToolUsesFromBlocks([...blocks.values()])).toEqual([
      { id: 'tool_001', name: 'query_order', input: { orderId: 'ORD-1' } },
    ])
  })

  it('does not throw on a max_tokens-truncated tool_use — yields {} input for error synthesis', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()
    // tool_use whose input_json was cut off mid-stream (truncated → invalid JSON),
    // ended by stop_reason:'max_tokens' — the exact L6 crash condition.
    const stream = createMockStream([
      { type: 'message_start', message: { id: 'msg_1', model: 'm', role: 'assistant', content: [] } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool_001', name: 'query_order', index: 0 },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"orderId": "OR' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'max_tokens' }, usage: { input_tokens: 100, output_tokens: 4096 } },
      { type: 'message_stop' },
    ])
    await consumeStream(stream as any, blocks, cbs)

    const toolUses = buildToolUsesFromBlocks([...blocks.values()])
    expect(toolUses).toEqual([{ id: 'tool_001', name: 'query_order', input: {} }])
  })

  it('ignores non-tool_use blocks', async () => {
    const cbs = makeCallbacks()
    const blocks = new Map<number, StreamContentBlock>()
    await consumeStream(mockTextStream('just text') as any, blocks, cbs)

    expect(buildToolUsesFromBlocks([...blocks.values()])).toEqual([])
  })
})
