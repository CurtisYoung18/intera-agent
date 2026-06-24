import { describe, expect, it } from 'vitest'
import { buildApiMessages, buildApiMessagesWithTranscriptHealth, makeInternalRuntimeMessage, makeUserMessage, normalizeContentBlocks } from '../../message-builder'
import {
  assistantProviderContent,
  hydrateMessageFromDb,
  isCustomerVisibleMessage,
  serializeMessageForPersistence,
  toolResultProviderContent,
} from '../../provider-transcript'

const chatMemory = {
  hasSummary: () => false,
  getSummary: () => ({ summary: '', keyEvents: [] }),
} as any

const memoryStrategy = {
  l1MaxMessages: 10,
  l2SummaryMaxTokens: 1000,
} as any

describe('message-builder vision content', () => {
  it('keeps runtime instructions provider-visible but customer-hidden', () => {
    const message = makeInternalRuntimeMessage('[HOOK: Stop]\nRevise before replying.', 'hook_feedback')
    const serialized = serializeMessageForPersistence(message, 'case-1')
    const hydrated = hydrateMessageFromDb({ ...serialized, createdAt: message.createdAt })
    const apiMessages = buildApiMessages([hydrated], chatMemory, memoryStrategy)

    expect(hydrated.content).toBe('')
    expect(hydrated.providerMeta).toMatchObject({ visibility: 'internal', transcriptKind: 'hook_feedback' })
    expect(isCustomerVisibleMessage(hydrated)).toBe(false)
    expect(apiMessages).toEqual([{
      role: 'user',
      content: [{ type: 'text', text: '[HOOK: Stop]\nRevise before replying.' }],
    }])
  })

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

  it('uses persisted providerContent before display content or legacy toolUses', () => {
    const apiMessages = buildApiMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'display text',
        providerContent: assistantProviderContent('provider text', [
          { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
        ]),
        toolUses: [{ id: 'legacy_toolu', name: 'legacy_tool', input: {} }],
        createdAt: new Date(),
      } as any,
      {
        id: 'result-1',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' },
        ]),
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
        createdAt: new Date(),
      } as any,
    ], chatMemory, memoryStrategy)

    expect(apiMessages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'provider text' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: undefined },
        ],
      },
    ])
  })

  it('keeps provider tool pairs together when the message limit starts on a tool_result', () => {
    const result = buildApiMessagesWithTranscriptHealth([
      makeUserMessage('older natural message'),
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        providerContent: assistantProviderContent('', [
          { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
        ]),
        createdAt: new Date(),
      } as any,
      {
        id: 'result-1',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' },
        ]),
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
        createdAt: new Date(),
      } as any,
      makeUserMessage('latest natural message'),
    ], chatMemory, { l1MaxMessages: 1, l2SummaryMaxTokens: 1000 } as any)

    expect(result.messages.map((message: any) => message.role)).toEqual(['assistant', 'user', 'user'])
    expect(result.metrics.toolPairsChecked).toBe(1)
    expect(result.metrics.orphanToolResultsDropped).toBe(0)
    expect(result.metrics.compactPairsSummarized).toBe(1)
  })

  it('preserves repeated persisted tool pairs after reload across a compact window boundary', () => {
    const messages = [
      makeUserMessage('oldest natural message'),
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        providerContent: assistantProviderContent('', [
          { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
        ]),
        createdAt: new Date('2026-06-12T00:00:01.000Z'),
      } as any,
      {
        id: 'result-1',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"deposit":100}' },
        ]),
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
        createdAt: new Date('2026-06-12T00:00:02.000Z'),
      } as any,
      makeUserMessage('middle natural message a'),
      makeUserMessage('middle natural message b'),
      {
        id: 'assistant-2',
        role: 'assistant',
        content: '',
        providerContent: assistantProviderContent('', [
          { id: 'toolu_2', name: 'lookup_withdrawal', input: { member_id: 'M123' } },
        ]),
        createdAt: new Date('2026-06-12T00:00:05.000Z'),
      } as any,
      {
        id: 'result-2',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([
          { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"withdrawal":"blocked"}' },
        ]),
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
        createdAt: new Date('2026-06-12T00:00:06.000Z'),
      } as any,
      makeUserMessage('latest natural message'),
    ]

    const reloaded = messages
      .map((message, index) => ({
        ...serializeMessageForPersistence(message, 'case-1'),
        createdAt: message.createdAt ?? new Date(`2026-06-12T00:00:0${index}.000Z`),
      }))
      .map((row) => hydrateMessageFromDb(row))

    const result = buildApiMessagesWithTranscriptHealth(
      reloaded,
      chatMemory,
      { l1MaxMessages: 3, l2SummaryMaxTokens: 1000 } as any,
    )

    const providerBlocks = result.messages.flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
    expect(providerBlocks.filter((block: any) => block.type === 'tool_use').map((block: any) => block.id)).toEqual(['toolu_1', 'toolu_2'])
    expect(providerBlocks.filter((block: any) => block.type === 'tool_result').map((block: any) => block.tool_use_id)).toEqual(['toolu_1', 'toolu_2'])
    expect(result.metrics.providerTranscriptPersisted).toBe(true)
    expect(result.metrics.toolPairsChecked).toBe(2)
    expect(result.metrics.toolPairsRepaired).toBe(0)
    expect(result.metrics.orphanToolResultsDropped).toBe(0)
    expect(result.metrics.compactPairsSummarized).toBe(1)
  })
})
