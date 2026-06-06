import { describe, it, expect, vi } from 'vitest'
import { consumeStream, type StreamConsumeCallbacks, type StreamContentBlock } from '../../stream-handler'
import { createMockStream, mockTextStream, mockToolUseStream } from '../mocks/anthropic'

function makeCallbacks(overrides?: Partial<StreamConsumeCallbacks>): StreamConsumeCallbacks {
  return {
    sendEvent: vi.fn(),
    sanitizeChunk: (text: string) => text,
    flushSanitizer: () => '',
    recordFirstToken: vi.fn(),
    showThinking: false,
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

  it('emits thinking_delta when showThinking is true', async () => {
    const sendEvent = vi.fn()
    const cbs = makeCallbacks({ sendEvent, showThinking: true })
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

  it('suppresses thinking_delta when showThinking is false', async () => {
    const sendEvent = vi.fn()
    const cbs = makeCallbacks({ sendEvent, showThinking: false })
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
