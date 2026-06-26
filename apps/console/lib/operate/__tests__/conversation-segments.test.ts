import { describe, expect, it } from 'vitest'
import { splitCasesIntoConversationSegments } from '@/lib/operate/conversation-segments'

describe('splitCasesIntoConversationSegments', () => {
  it('splits the same external chat after 60 minutes of customer silence', () => {
    const segments = splitCasesIntoConversationSegments([
      {
        id: 'case-1',
        chatId: 'TH239H8SAF',
        createdAt: '2026-06-24T10:00:00.000Z',
        updatedAt: '2026-06-24T10:05:00.000Z',
        humanTasks: [],
        _count: { messages: 2 },
        messages: [
          { id: 'm1', caseId: 'case-1', role: 'user', createdAt: '2026-06-24T10:00:00.000Z' },
          { id: 'm2', caseId: 'case-1', role: 'assistant', createdAt: '2026-06-24T10:05:00.000Z' },
        ],
      },
      {
        id: 'case-2',
        chatId: 'TH239H8SAF',
        createdAt: '2026-06-24T11:01:00.000Z',
        updatedAt: '2026-06-24T11:04:00.000Z',
        humanTasks: [],
        _count: { messages: 2 },
        messages: [
          { id: 'm3', caseId: 'case-2', role: 'user', createdAt: '2026-06-24T11:01:00.000Z' },
          { id: 'm4', caseId: 'case-2', role: 'assistant', createdAt: '2026-06-24T11:04:00.000Z' },
        ],
      },
    ])

    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.segmentId).sort()).toEqual([
      'TH239H8SAF::seg_1',
      'TH239H8SAF::seg_2',
    ])
  })

  it('keeps messages inside one segment when the customer returns before 60 minutes', () => {
    const segments = splitCasesIntoConversationSegments([
      {
        id: 'case-1',
        chatId: 'TH239H8SAF',
        createdAt: '2026-06-24T10:00:00.000Z',
        updatedAt: '2026-06-24T10:50:00.000Z',
        humanTasks: [],
        _count: { messages: 3 },
        messages: [
          { id: 'm1', caseId: 'case-1', role: 'user', createdAt: '2026-06-24T10:00:00.000Z' },
          { id: 'm2', caseId: 'case-1', role: 'assistant', createdAt: '2026-06-24T10:02:00.000Z' },
          { id: 'm3', caseId: 'case-1', role: 'user', createdAt: '2026-06-24T10:50:00.000Z' },
        ],
      },
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0].messageCount).toBe(3)
  })

  it('does not split an active long chat unless one adjacent customer gap reaches 60 minutes', () => {
    const segments = splitCasesIntoConversationSegments([
      {
        id: 'case-1',
        chatId: 'TH239H8SAF',
        createdAt: '2026-06-24T10:00:00.000Z',
        updatedAt: '2026-06-24T11:12:00.000Z',
        humanTasks: [],
        _count: { messages: 5 },
        messages: [
          { id: 'm1', caseId: 'case-1', role: 'user', createdAt: '2026-06-24T10:00:00.000Z' },
          { id: 'm2', caseId: 'case-1', role: 'assistant', createdAt: '2026-06-24T10:01:00.000Z' },
          { id: 'm3', caseId: 'case-1', role: 'user', createdAt: '2026-06-24T10:30:00.000Z' },
          { id: 'm4', caseId: 'case-1', role: 'assistant', createdAt: '2026-06-24T10:31:00.000Z' },
          { id: 'm5', caseId: 'case-1', role: 'user', createdAt: '2026-06-24T11:10:00.000Z' },
        ],
      },
    ])

    expect(segments).toHaveLength(1)
    expect(segments[0].messageCount).toBe(5)
  })

  it('ignores internal tool-result user messages as customer activity', () => {
    const segments = splitCasesIntoConversationSegments([
      {
        id: 'case-1',
        chatId: 'TH239H8SAF',
        createdAt: '2026-06-24T10:00:00.000Z',
        updatedAt: '2026-06-24T11:30:00.000Z',
        humanTasks: [],
        _count: { messages: 3 },
        messages: [
          { id: 'm1', caseId: 'case-1', role: 'user', createdAt: '2026-06-24T10:00:00.000Z' },
          {
            id: 'm2',
            caseId: 'case-1',
            role: 'user',
            createdAt: '2026-06-24T11:30:00.000Z',
            providerMeta: { visibility: 'internal', transcriptKind: 'tool_result' },
            providerContent: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }],
          },
        ],
      },
    ])

    expect(segments).toHaveLength(1)
  })
})
