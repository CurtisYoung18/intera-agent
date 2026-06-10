import { describe, expect, it } from 'vitest'
import { buildApiMessages, makeUserMessage, normalizeContentBlocks } from '../../message-builder'

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

  it('normalizes browser data URLs before building API messages', () => {
    const message = makeUserMessage('describe', [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'data:image/png;base64,abc123',
        },
      },
    ])

    const apiMessages = buildApiMessages([message], chatMemory, memoryStrategy)

    expect(apiMessages[0].content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
    ])
  })

  it('accepts legacy image_url blocks and flattens nested browser payloads', () => {
    const normalized = normalizeContentBlocks([
      [
        { type: 'text', text: 'inspect' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,def456' } },
      ],
    ])

    expect(normalized).toEqual([
      { type: 'text', text: 'inspect' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'def456' } },
    ])
  })

  it('drops malformed image blocks instead of sending invalid content to providers', () => {
    expect(normalizeContentBlocks([
      { type: 'image', source: { type: 'base64', media_type: 'text/html', data: 'abc123' } },
      { type: 'image', source: { type: 'url', media_type: 'image/png', data: 'abc123' } },
      { type: 'unknown', payload: [] },
    ])).toBeUndefined()
  })
})
