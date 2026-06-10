import { describe, expect, it } from 'vitest'
import { buildApiMessages, makeUserMessage } from '../../message-builder'

const chatMemory = {
  hasSummary: () => false,
  getSummary: () => ({ summary: '', keyEvents: [] }),
} as any

const memoryStrategy = {
  l1MaxMessages: 10,
  l2SummaryMaxTokens: 1000,
} as any

describe('message-builder vision content', () => {
  it('keeps user text when a message also has image content blocks', () => {
    const message = makeUserMessage('描述一下这张图', [{
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    }])

    const apiMessages = buildApiMessages([message], chatMemory, memoryStrategy)

    expect(apiMessages[0].content).toEqual([
      { type: 'text', text: '描述一下这张图' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
    ])
  })

  it('does not duplicate existing text blocks', () => {
    const message = makeUserMessage('describe', [
      { type: 'text', text: 'describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
    ])

    const apiMessages = buildApiMessages([message], chatMemory, memoryStrategy)

    expect(apiMessages[0].content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
    ])
  })
})
