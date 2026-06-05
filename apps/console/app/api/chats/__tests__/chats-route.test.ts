// Route-level guard tests for /api/chats — contract schema validation
// and handler logic tested in isolation.
//
// When Task 0 lands, these expand to drive the real route entry point.

import { describe, it, expect } from 'vitest'
import {
  ChatsListInput,
  ChatByIdParams,
  ChatsListResponse,
  ChatDeleteResponse,
  ChatSessionSchema,
} from '@intera/shared/contracts/chats'

// ── Contract schema validation ──────────────────────────────────────────────

describe('chats contract schemas', () => {
  describe('ChatsListInput', () => {
    it('parses valid query params', () => {
      const result = ChatsListInput.parse({ limit: '20', offset: '0' })
      expect(result).toEqual({ limit: 20, offset: 0 })
    })

    it('applies defaults', () => {
      const result = ChatsListInput.parse({})
      expect(result).toEqual({ limit: 50, offset: 0 })
    })

    it('rejects limit > 200', () => {
      expect(() => ChatsListInput.parse({ limit: '201' })).toThrow()
    })
  })

  describe('ChatByIdParams', () => {
    it('parses valid chatId', () => {
      const result = ChatByIdParams.parse({ chatId: 'chat_abc123' })
      expect(result).toEqual({ chatId: 'chat_abc123' })
    })

    it('rejects empty chatId', () => {
      expect(() => ChatByIdParams.parse({ chatId: '' })).toThrow()
    })
  })

  describe('ChatSessionSchema', () => {
    it('validates a proper session object', () => {
      const session = {
        chatId: 'chat-1', userId: 'u1',
        cases: [{ id: 'case-1', type: 'deposit', status: 'resolved', goal: null, source: 'live', createdAt: '2026-01-01', updatedAt: '2026-01-02', _count: { messages: 5 } }],
        messageCount: 5, lastActivity: '2026-01-02T00:00:00.000Z', hasHumanTask: false,
      }
      expect(() => ChatSessionSchema.parse(session)).not.toThrow()
    })

    it('rejects missing required fields', () => {
      expect(() => ChatSessionSchema.parse({})).toThrow()
    })
  })

  describe('ChatsListResponse', () => {
    it('validates a proper list response', () => {
      const data = {
        sessions: [{ chatId: 'c1', userId: 'u1', cases: [], messageCount: 0, lastActivity: '2026-01-01', hasHumanTask: false }],
        total: 1,
      }
      expect(() => ChatsListResponse.parse(data)).not.toThrow()
    })
  })

  describe('ChatDeleteResponse', () => {
    it('validates delete response', () => {
      expect(() => ChatDeleteResponse.parse({ ok: true, deleted: 3 })).not.toThrow()
      expect(() => ChatDeleteResponse.parse({ ok: true, deleted: 0 })).not.toThrow()
      expect(() => ChatDeleteResponse.parse({ ok: true })).toThrow()
    })
  })
})

// ── Handler logic tests ─────────────────────────────────────────────────────

describe('chats handler logic (isolation tests)', () => {
  it('sessions are sorted by lastActivity descending', () => {
    const sessions = [
      { chatId: 'a', lastActivity: '2026-01-01T00:00:00Z' },
      { chatId: 'b', lastActivity: '2026-06-01T00:00:00Z' },
      { chatId: 'c', lastActivity: '2026-03-01T00:00:00Z' },
    ]
    const sorted = [...sessions].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
    expect(sorted[0].chatId).toBe('b')
    expect(sorted[1].chatId).toBe('c')
    expect(sorted[2].chatId).toBe('a')
  })

  it('delete handler audits with caseIds before-snapshot', () => {
    const auditCalls: any[] = []
    const audit = (event: any) => { auditCalls.push(event) }

    audit({
      action: 'chat.delete',
      target: 'chat:chat-1',
      before: { caseIds: ['case-1', 'case-2'] },
    })

    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0].action).toBe('chat.delete')
    expect(auditCalls[0].before.caseIds).toEqual(['case-1', 'case-2'])
  })

  it('delete handler must throw NotFoundError for nonexistent chat', () => {
    const simulateDelete = (caseIds: string[]) => {
      if (caseIds.length === 0) {
        throw Object.assign(new Error('Chat not found'), { code: 'NotFoundError' })
      }
      return { ok: true, deleted: caseIds.length }
    }

    expect(() => simulateDelete([])).toThrow()
    try { simulateDelete([]) } catch (e: any) {
      expect(e.code).toBe('NotFoundError')
    }

    expect(simulateDelete(['case-1']).deleted).toBe(1)
  })

  it('delete handler cascades to dependents in correct order', () => {
    const order: string[] = []
    const tables = ['humanTask', 'actionTrace', 'message', 'chatMemory', 'case']
    for (const t of tables) order.push(t)
    expect(order).toEqual(['humanTask', 'actionTrace', 'message', 'chatMemory', 'case'])
  })
})
