import { describe, expect, it } from 'vitest'
import {
  assistantProviderContent,
  hasProviderOrDisplayContent,
  hydrateMessageFromDb,
  isCustomerVisibleMessage,
  normalizeProviderContent,
  normalizeProviderTranscriptMessages,
  providerTranscriptPersistenceReceipt,
  providerTranscriptCompactText,
  serializeMessageForPersistence,
  toolResultProviderContent,
} from '../provider-transcript'
import type { Message } from '@intera/shared/types'

describe('provider transcript serialization', () => {
  it('persists and hydrates assistant tool_use provider blocks', () => {
    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Let me check.',
      providerContent: assistantProviderContent('Let me check.', [
        { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
      ]),
      providerMeta: {
        protocolVersion: 1,
        providerFamily: 'anthropic',
        visibility: 'customer',
        transcriptKind: 'assistant_response',
        toolUseIds: ['toolu_1'],
      },
      createdAt: new Date('2026-06-12T00:00:00Z'),
    }

    const serialized = serializeMessageForPersistence(message, 'case-1')
    expect(serialized.createdAt).toEqual(message.createdAt)
    expect(serialized.providerContent).toEqual([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
    ])

    const hydrated = hydrateMessageFromDb({
      ...serialized,
      createdAt: message.createdAt,
    })
    expect(hydrated.providerContent).toEqual(serialized.providerContent)
    expect((hydrated as Message & { toolUses?: unknown[] }).toolUses).toEqual([
      { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
    ])
  })

  it('persists and hydrates internal user tool_result provider blocks without display text', () => {
    const message: Message = {
      id: 'tool-result-1',
      role: 'user',
      content: '',
      providerContent: toolResultProviderContent([
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: false },
      ]),
      providerMeta: {
        protocolVersion: 1,
        providerFamily: 'anthropic',
        visibility: 'internal',
        transcriptKind: 'tool_result',
        toolUseIds: ['toolu_1'],
      },
      createdAt: new Date('2026-06-12T00:00:01Z'),
    }

    expect(hasProviderOrDisplayContent(message)).toBe(true)
    const serialized = serializeMessageForPersistence(message, 'case-1')
    expect(serialized.content).toBe('')
    expect(serialized.providerContent).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: false },
    ])

    const hydrated = hydrateMessageFromDb({ ...serialized, createdAt: message.createdAt })
    expect(hydrated.providerContent).toEqual(serialized.providerContent)
    expect(isCustomerVisibleMessage(hydrated)).toBe(false)
  })

  it('hides provider-only assistant tool_use rows from customer-visible surfaces', () => {
    const message = hydrateMessageFromDb({
      id: 'assistant-tool-use-only',
      role: 'assistant',
      content: '',
      providerContent: assistantProviderContent('', [
        { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
      ]),
      providerMeta: {
        protocolVersion: 1,
        providerFamily: 'anthropic',
        visibility: 'customer',
        transcriptKind: 'assistant_response',
        toolUseIds: ['toolu_1'],
      },
      createdAt: new Date('2026-06-12T00:00:02Z'),
    })

    expect(hasProviderOrDisplayContent(message)).toBe(true)
    expect(isCustomerVisibleMessage(message)).toBe(false)
  })

  it('normalizes old in-memory tool_result content arrays as provider content', () => {
    const blocks = normalizeProviderContent([
      { type: 'tool_result', tool_use_id: 'toolu_legacy', content: { ok: true } },
    ])

    expect(blocks).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_legacy', content: '{"ok":true}', is_error: undefined },
    ])
  })

  it('projects provider-only tool_use and tool_result rows into compactable evidence text', () => {
    const assistantText = providerTranscriptCompactText({
      id: 'assistant-tool-use',
      role: 'assistant',
      content: '',
      providerContent: assistantProviderContent('', [
        { id: 'toolu_1', name: 'lookup_deposit', input: { member_id: 'M123' } },
      ]),
      createdAt: new Date(),
    } as Message)
    const resultText = providerTranscriptCompactText({
      id: 'tool-result',
      role: 'user',
      content: '',
      providerContent: toolResultProviderContent([
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"deposit":100}' },
      ]),
      providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
      createdAt: new Date(),
    } as Message)

    expect(assistantText).toContain('assistant tool_use')
    expect(assistantText).toContain('lookup_deposit')
    expect(resultText).toContain('user tool_result')
    expect(resultText).toContain('"deposit":100')
  })

  it('counts provider transcript persistence receipt from serialized rows', () => {
    expect(providerTranscriptPersistenceReceipt([
      { providerContent: [{ type: 'text', text: 'visible' }] },
      { providerContent: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
      { providerContent: null },
    ])).toEqual({
      providerTranscriptPersisted: true,
      providerTranscriptMessageCount: 2,
      providerTranscriptBlockCount: 2,
    })
  })
})

describe('provider transcript invariant normalizer', () => {
  it('keeps matching assistant tool_use and user tool_result pairs', () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        providerContent: assistantProviderContent('', [{ id: 't1', name: 'read', input: {} }]),
        createdAt: new Date(),
      } as Message,
      {
        id: 'r1',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
        createdAt: new Date(),
      } as Message,
    ]

    const result = normalizeProviderTranscriptMessages(messages)

    expect(result.messages).toHaveLength(2)
    expect(result.metrics.toolPairsChecked).toBe(1)
    expect(result.metrics.toolPairsRepaired).toBe(0)
    expect(result.metrics.orphanToolResultsDropped).toBe(0)
  })

  it('synthesizes missing tool_result before natural user interleaving', () => {
    const result = normalizeProviderTranscriptMessages([
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        providerContent: assistantProviderContent('', [{ id: 't1', name: 'read', input: {} }]),
        createdAt: new Date(),
      } as Message,
      {
        id: 'u1',
        role: 'user',
        content: 'next natural message',
        createdAt: new Date(),
      } as Message,
    ])

    expect(result.metrics.toolPairsRepaired).toBe(1)
    expect(result.messages[1].providerMeta?.transcriptKind).toBe('synthetic_repair')
    expect(result.messages[1].providerContent?.[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
      is_error: true,
    })
    expect(result.messages[2].content).toBe('next natural message')
  })

  it('drops orphan and duplicate tool_result blocks', () => {
    const result = normalizeProviderTranscriptMessages([
      {
        id: 'orphan',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([{ type: 'tool_result', tool_use_id: 'missing', content: 'bad' }]),
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
        createdAt: new Date(),
      } as Message,
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        providerContent: assistantProviderContent('', [{ id: 't1', name: 'read', input: {} }]),
        createdAt: new Date(),
      } as Message,
      {
        id: 'r1',
        role: 'user',
        content: '',
        providerContent: toolResultProviderContent([
          { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 't1', content: 'dup' },
        ]),
        providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
        createdAt: new Date(),
      } as Message,
    ])

    expect(result.metrics.orphanToolResultsDropped).toBe(2)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].providerContent).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: undefined },
    ])
  })
})
