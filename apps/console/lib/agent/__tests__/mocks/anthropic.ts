import { vi } from 'vitest'

export interface MockStreamEvent {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop'
  message?: { id: string; model: string; role: string; content: unknown[] }
  content_block?: {
    type: string
    id?: string
    name?: string
    index: number
    input?: Record<string, unknown>
  }
  delta?: {
    type: string
    text?: string
    partial_json?: string
    thinking?: string
    stop_reason?: string | null
  }
  index?: number
  usage?: { input_tokens: number; output_tokens: number }
}

export function createMockStream(events: MockStreamEvent[]) {
  let closed = false
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        next: async () => {
          if (closed || i >= events.length) return { done: true as const, value: undefined }
          const event = events[i++]
          return { done: false as const, value: event as any }
        },
        return: async () => {
          closed = true
          return { done: true as const, value: undefined }
        },
      }
    },
  }
}

export function mockTextStream(
  text: string,
  model = 'claude-sonnet-4-20250514',
  usage = { input_tokens: 100, output_tokens: 50 },
) {
  return createMockStream([
    { type: 'message_start', message: { id: 'msg_1', model, role: 'assistant', content: [] } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', index: 0 } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'end_turn' }, usage },
    { type: 'message_stop' },
  ])
}

export function mockToolUseStream(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId = 'tool_001',
  model = 'claude-sonnet-4-20250514',
) {
  return createMockStream([
    { type: 'message_start', message: { id: 'msg_1', model, role: 'assistant', content: [] } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: toolId, name: toolName, index: 0 },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { type: 'message_delta', stop_reason: 'tool_use' }, usage: { input_tokens: 100, output_tokens: 50 } },
    { type: 'message_stop' },
  ])
}

export function mockStreamThatBreaks(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId = 'tool_001',
  errorMessage = 'socket hang up',
) {
  // Emits a tool_use start, then throws
  const events: MockStreamEvent[] = [
    { type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4-20250514', role: 'assistant', content: [] } },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: toolId, name: toolName, index: 0 },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) },
    },
  ]

  let i = 0
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (i >= events.length) throw new Error(errorMessage)
          const event = events[i++]
          return { done: false as const, value: event as any }
        },
        return: async () => {
          return { done: true as const, value: undefined }
        },
      }
    },
  }
}

export function mockAnthropicClient() {
  return {
    messages: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  }
}
