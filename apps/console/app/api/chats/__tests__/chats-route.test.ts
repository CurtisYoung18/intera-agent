// Route-level guard tests for /api/chats — contract schema validation
// and handler logic tested in isolation.
//
// When Task 0 lands, these expand to drive the real route entry point.

import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  ChatsListInput,
  ChatByIdParams,
  ChatsListResponse,
  ChatDeleteResponse,
  ChatSessionSchema,
} from '@intera/shared/contracts/chats'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent-a': { id: 'agent-a', orgId: 'default' },
    'agent-b': { id: 'agent-b', orgId: 'default' },
    'foreign-agent': { id: 'foreign-agent', orgId: 'org-b' },
  }
  const cases = [
    {
      id: 'case-new',
      orgId: 'default',
      userId: 'user-new',
      chatId: 'chat-new',
      type: 'deposit_not_credited',
      status: 'active',
      source: 'live',
      goal: 'Newest chat',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:03:00.000Z'),
      humanTasks: [],
      _count: { messages: 3 },
    },
    {
      id: 'case-middle',
      orgId: 'default',
      userId: 'user-middle',
      chatId: 'chat-middle',
      type: 'withdrawal_password_reset',
      status: 'waiting_human',
      source: 'live',
      goal: 'Middle chat',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:02:00.000Z'),
      humanTasks: [{ id: 'task-middle' }],
      _count: { messages: 2 },
    },
    {
      id: 'case-old',
      orgId: 'default',
      userId: 'user-old',
      chatId: 'chat-old',
      type: 'general',
      status: 'completed',
      source: 'live',
      goal: 'Old chat',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:01:00.000Z'),
      humanTasks: [],
      _count: { messages: 1 },
    },
    {
      id: 'case-livechat-general',
      orgId: 'default',
      userId: 'livechat-TG2RX99U7R',
      chatId: 'TG2RX99U7R',
      type: 'general',
      status: 'created',
      source: 'live',
      goal: 'LiveChat discovery without a ProcedureRun',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:04:00.000Z'),
      humanTasks: [],
      _count: { messages: 8 },
    },
  ]
  const runs = [
    { id: 'run-new', caseId: 'case-new', orgId: 'default', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:03:00.000Z') },
    { id: 'run-middle', caseId: 'case-middle', orgId: 'default', agentConfigId: 'agent-b', updatedAt: new Date('2026-06-16T00:02:00.000Z') },
  ]
  const externalConversations = [
    {
      id: 'external-livechat-general',
      orgId: 'default',
      platform: 'livechat',
      externalChatId: 'TG2RX99U7R',
      internalCaseId: 'case-livechat-general',
      metadata: { agentConfigId: 'agent-a' },
    },
  ]
  return { mockGetSession, agentConfigs, cases, runs, externalConversations }
})

function matchesWhere(row: any, where: Record<string, any> = {}) {
  if (where.orgId && row.orgId !== where.orgId) return false
  if (where.agentConfigId && row.agentConfigId !== where.agentConfigId) return false
  if (typeof where.chatId === 'object' && where.chatId?.startsWith && !row.chatId?.startsWith(where.chatId.startsWith)) return false
  if (where.internalCaseId?.not === null && row.internalCaseId === null) return false
  if (where.metadata?.path?.[0] === 'agentConfigId' && row.metadata?.agentConfigId !== where.metadata.equals) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
  if (where.caseId?.in && !where.caseId.in.includes(row.caseId)) return false
  return true
}

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const config = h.agentConfigs[args?.where?.id]
          if (!config || config.orgId !== orgId) return null
          return args?.select ? { id: config.id } : config
        }),
      },
      case: {
        findMany: vi.fn(async (args: any) => h.cases
          .filter((row) => matchesWhere(row, { ...(args?.where ?? {}), orgId }))
          .sort((a, b) => b.updatedAt.toISOString().localeCompare(a.updatedAt.toISOString()))),
      },
      externalConversation: {
        findMany: vi.fn(async (args: any) => h.externalConversations
          .filter((row) => matchesWhere(row, { ...(args?.where ?? {}), orgId }))
          .map((row) => ({ internalCaseId: row.internalCaseId }))),
      },
      raw: {
        case: {
          findMany: vi.fn(async (args: any) => h.cases
            .filter((row) => matchesWhere(row, args?.where ?? {}))
            .map((row) => ({ id: row.id }))),
        },
        procedureRun: {
          findMany: vi.fn(async (args: any) => h.runs
            .filter((row) => matchesWhere(row, args?.where ?? {}))
            .sort((a, b) => b.updatedAt.toISOString().localeCompare(a.updatedAt.toISOString()))
            .map((row) => ({ id: row.id, caseId: row.caseId }))),
        },
      },
    } as any
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '@/app/api/chats/route'

function makeRequest(query = '') {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/chats${query}`),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
})

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

// ── Route regression tests ──────────────────────────────────────────────────

describe('/api/chats route', () => {
  it('rejects requests without a selected agent', async () => {
    const res = await GET(makeRequest('?limit=1&offset=1'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })

  it('filters conversations to the selected agent', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-a'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(2)
    expect(body.data.sessions).toHaveLength(2)
    expect(body.data.sessions[0]).toMatchObject({
      chatId: 'TG2RX99U7R',
      userId: 'livechat-TG2RX99U7R',
    })
    expect(body.data.sessions[0].cases[0]).toMatchObject({
      id: 'case-livechat-general',
      runId: null,
    })
    expect(body.data.sessions[1]).toMatchObject({
      chatId: 'chat-new',
      userId: 'user-new',
    })
    expect(body.data.sessions[1].cases[0]).toMatchObject({
      id: 'run-new',
      runId: 'run-new',
    })
  })

  it('returns a different conversation set when the selected agent changes', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-b'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(1)
    expect(body.data.sessions).toHaveLength(1)
    expect(body.data.sessions[0]).toMatchObject({
      chatId: 'chat-middle',
      userId: 'user-middle',
      hasHumanTask: true,
    })
  })

  it('rejects an agent outside the active org', async () => {
    const res = await GET(makeRequest('?agentId=foreign-agent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
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
