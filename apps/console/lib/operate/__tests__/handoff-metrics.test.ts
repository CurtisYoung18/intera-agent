import { describe, expect, it } from 'vitest'
import { summarizeHandoffMetrics } from '@/lib/operate/handoff-metrics'

describe('summarizeHandoffMetrics', () => {
  it('counts conversations, handoff rate, active handoffs, and task pressure from real cases', () => {
    const metrics = summarizeHandoffMetrics([
      {
        id: 'case-1',
        chatId: 'chat-a',
        type: 'deposit_issue',
        status: 'waiting_human',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T01:00:00.000Z',
        humanTasks: [{ status: 'pending', createdAt: '2026-06-12T01:00:00.000Z' }],
        _count: { messages: 4 },
      },
      {
        id: 'case-2',
        chatId: 'chat-a',
        type: 'withdrawal_issue',
        status: 'resolved',
        createdAt: '2026-06-12T00:30:00.000Z',
        updatedAt: '2026-06-12T01:30:00.000Z',
        humanTasks: [{ status: 'resolved', resolvedAt: '2026-06-12T01:40:00.000Z' }],
        _count: { messages: 2 },
      },
      {
        id: 'case-3',
        chatId: 'chat-b',
        type: 'account_issue',
        status: 'created',
        createdAt: '2026-06-12T01:00:00.000Z',
        updatedAt: '2026-06-12T01:10:00.000Z',
        humanTasks: [],
        _count: { messages: 1 },
      },
      {
        id: 'case-4',
        chatId: 'chat-c',
        type: 'deposit_issue',
        status: 'waiting_human',
        createdAt: '2026-06-11T23:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
        humanTasks: [],
        _count: { messages: 3 },
      },
    ], new Date('2026-06-12T02:00:00.000Z'))

    expect(metrics.totalConversations).toBe(3)
    expect(metrics.totalProcedureRuns).toBe(4)
    expect(metrics.totalMessages).toBe(10)
    expect(metrics.escalatedConversations).toBe(1)
    expect(metrics.escalatedProcedureRuns).toBe(2)
    expect(metrics.escalationRate).toBeCloseTo(1 / 3)
    expect(metrics.activeHandoffConversations).toBe(1)
    expect(metrics.activeHandoffProcedureRuns).toBe(1)
    expect(metrics.activeHumanTasks).toBe(1)
    expect(metrics.resolvedHumanTasks).toBe(1)
    expect(metrics.handoffProcedureTypes).toBe(1)
    expect(metrics.latestActivityAt).toBe('2026-06-12T01:30:00.000Z')
  })
})
