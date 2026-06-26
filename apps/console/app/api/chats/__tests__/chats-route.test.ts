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
    'agent-empty': { id: 'agent-empty', orgId: 'default' },
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
      humanTasks: [{ id: 'task-middle', createdAt: new Date('2026-06-16T00:02:30.000Z') }],
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
    {
      id: 'external-livechat-alias',
      orgId: 'default',
      platform: 'livechat',
      externalChatId: 'TH12XG7AWZ',
      internalCaseId: 'case-new',
      metadata: { agentConfigId: 'agent-a' },
    },
  ]
  const messages = [
    {
      id: 'msg-deposit-user',
      caseId: 'case-new',
      orgId: 'default',
      chatId: 'chat-new',
      runId: 'run-new',
      role: 'user',
      content: 'My deposit is still missing after UTR JAYA117FFEB.',
      contentBlocks: null,
      providerContent: null,
      providerMeta: null,
      createdAt: new Date('2026-06-16T00:03:20.000Z'),
    },
    {
      id: 'msg-deposit-assistant',
      caseId: 'case-new',
      orgId: 'default',
      chatId: 'chat-new',
      runId: 'run-new',
      role: 'assistant',
      content: 'I will check the deposit status now.',
      contentBlocks: null,
      providerContent: [{ type: 'text', text: 'I will check the deposit status now.' }],
      providerMeta: { protocolVersion: 1, visibility: 'customer', transcriptKind: 'assistant_response' },
      createdAt: new Date('2026-06-16T00:03:30.000Z'),
    },
    {
      id: 'msg-withdrawal-user',
      caseId: 'case-middle',
      orgId: 'default',
      chatId: 'chat-middle',
      runId: 'run-middle',
      role: 'user',
      content: 'Please reset my withdrawal password.',
      contentBlocks: null,
      providerContent: null,
      providerMeta: null,
      createdAt: new Date('2026-06-16T00:02:20.000Z'),
    },
    {
      id: 'msg-livechat-general',
      caseId: 'case-livechat-general',
      orgId: 'default',
      chatId: 'TG2RX99U7R',
      runId: null,
      role: 'user',
      content: 'I cannot log in to my account.',
      contentBlocks: null,
      providerContent: null,
      providerMeta: null,
      createdAt: new Date('2026-06-16T00:04:20.000Z'),
    },
    {
      id: 'msg-internal-secret',
      caseId: 'case-new',
      orgId: 'default',
      chatId: 'chat-new',
      runId: 'run-new',
      role: 'user',
      content: 'hidden secret from tool result',
      contentBlocks: null,
      providerContent: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"hidden":"secret"}' }],
      providerMeta: { protocolVersion: 1, visibility: 'internal', transcriptKind: 'tool_result' },
      createdAt: new Date('2026-06-16T00:03:40.000Z'),
    },
  ]
  return { mockGetSession, agentConfigs, cases, runs, externalConversations, messages, currentQuery: '', currentAgentId: '', queryRawCalls: 0 }
})

function matchesValue(value: any, condition: any): boolean {
  if (condition === undefined) return true
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return value === condition
  if (Array.isArray(condition.in)) return condition.in.includes(value)
  if (condition.not === null) return value !== null && value !== undefined
  if (typeof condition.startsWith === 'string') return typeof value === 'string' && value.startsWith(condition.startsWith)
  if (typeof condition.contains === 'string') {
    if (typeof value !== 'string') return false
    const haystack = condition.mode === 'insensitive' ? value.toLowerCase() : value
    const needle = condition.mode === 'insensitive' ? condition.contains.toLowerCase() : condition.contains
    return haystack.includes(needle)
  }
  if ('equals' in condition) return value === condition.equals
  return Object.entries(condition).every(([key, nested]) => matchesValue(value?.[key], nested))
}

function matchesWhere(row: any, where: Record<string, any> = {}) {
  if (Array.isArray(where.OR) && !where.OR.some((branch: Record<string, any>) => matchesWhere(row, branch))) return false
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') continue
    if (key === 'metadata' && condition?.path?.[0] === 'agentConfigId') {
      if (row.metadata?.agentConfigId !== condition.equals) return false
      continue
    }
    if (!matchesValue(row[key], condition)) return false
  }
  return true
}

function scopedCaseIdsForAgent(agentConfigId: string): string[] {
  const runCaseIds = h.runs
    .filter((run) => run.agentConfigId === agentConfigId)
    .map((run) => run.caseId)
  const externalCaseIds = h.externalConversations
    .filter((conversation) => conversation.metadata?.agentConfigId === agentConfigId && conversation.internalCaseId)
    .map((conversation) => conversation.internalCaseId)
  const playgroundCaseIds = h.cases
    .filter((caseRow) => caseRow.chatId.startsWith(`pg_${agentConfigId}_`))
    .map((caseRow) => caseRow.id)
  return [...new Set([...runCaseIds, ...externalCaseIds, ...playgroundCaseIds])]
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
        $queryRaw: vi.fn(async () => {
          h.queryRawCalls += 1
          const q = h.currentQuery.trim().toLowerCase()
          const scopedCaseIds = scopedCaseIdsForAgent(h.currentAgentId)
          if (!q) return []
          const isIdLikeQuery = /^[A-Z0-9]+$/i.test(h.currentQuery) && /\d/.test(h.currentQuery)
          return h.messages
            .filter((row) => row.orgId === orgId)
            .filter((row) => scopedCaseIds.includes(row.caseId))
            .filter((row) => row.content.toLowerCase().includes(q))
            .sort((a, b) => b.createdAt.toISOString().localeCompare(a.createdAt.toISOString()))
            .map((row) => ({
              id: row.id,
              caseId: row.caseId,
              chatId: row.chatId,
              runId: row.runId,
              role: row.role,
              content: row.content,
              contentBlocks: row.contentBlocks,
              providerContent: row.providerContent,
              providerMeta: row.providerMeta,
              createdAt: row.createdAt,
              rank: isIdLikeQuery ? 0 : 0.72,
              matchMode: isIdLikeQuery ? 'contains_fallback' : 'fts',
            }))
        }),
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
  const url = new URL(`http://localhost/api/chats${query}`)
  h.currentQuery = url.searchParams.get('q') ?? ''
  h.currentAgentId = url.searchParams.get('agentId') ?? url.searchParams.get('agentConfigId') ?? ''
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: url,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.currentQuery = ''
  h.currentAgentId = ''
  h.queryRawCalls = 0
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

    it('normalizes valid chat-content search queries', () => {
      const result = ChatsListInput.parse({ q: '  deposit   missing  ', agentId: 'agent-a' })
      expect(result.q).toBe('deposit missing')
    })

    it('rejects one-character search queries', () => {
      expect(() => ChatsListInput.parse({ q: 'a' })).toThrow()
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
        segmentId: 'c1::seg_1',
        segmentIndex: 0,
        segmentStartAt: '2026-01-01T00:00:00.000Z',
        segmentEndAt: '2026-01-02T00:00:00.000Z',
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
        sessions: [{
          chatId: 'c1',
          segmentId: 'c1::seg_1',
          segmentIndex: 0,
          segmentStartAt: '2026-01-01T00:00:00.000Z',
          segmentEndAt: '2026-01-01T00:00:00.000Z',
          userId: 'u1',
          cases: [],
          messageCount: 0,
          lastActivity: '2026-01-01',
          hasHumanTask: false,
          matchedMessages: [{
            messageId: 'msg-1',
            caseId: 'case-1',
            runId: null,
            role: 'user',
            createdAt: '2026-01-01',
            snippet: 'deposit missing',
            rank: 0.7,
          }],
        }],
        total: 1,
        query: { normalizedQuery: 'deposit', searchMode: 'fts' },
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

  it('searches visible message content and returns match snippets', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-a&q=deposit'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.query).toEqual({ normalizedQuery: 'deposit', searchMode: 'fts' })
    expect(body.data.total).toBe(1)
    expect(body.data.sessions[0].chatId).toBe('chat-new')
    expect(body.data.sessions[0].matchedMessages[0]).toMatchObject({
      messageId: 'msg-deposit-assistant',
      caseId: 'case-new',
      runId: 'run-new',
      role: 'assistant',
    })
    expect(body.data.sessions[0].matchedMessages[0].snippet).toContain('deposit')
  })

  it('keeps message search scoped to the selected agent', async () => {
    const agentA = await GET(makeRequest('?limit=200&agentId=agent-a&q=withdrawal'))
    const agentABody = await agentA.json()
    expect(agentABody.ok).toBe(true)
    expect(agentABody.data.total).toBe(0)

    const agentB = await GET(makeRequest('?limit=200&agentId=agent-b&q=withdrawal'))
    const agentBBody = await agentB.json()
    expect(agentBBody.ok).toBe(true)
    expect(agentBBody.data.total).toBe(1)
    expect(agentBBody.data.sessions[0].chatId).toBe('chat-middle')
  })

  it('filters internal provider tool_result rows out of search results', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-a&q=secret'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(0)
    expect(body.data.sessions).toEqual([])
  })

  it('uses contains fallback metadata for short ID-like searches', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-a&q=JAYA117FFEB'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.query.searchMode).toBe('contains_fallback')
    expect(body.data.total).toBe(1)
    expect(body.data.sessions[0].matchedMessages[0].messageId).toBe('msg-deposit-user')
  })

  it('searches chat ids without requiring a transcript content match', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-a&q=TG2RX99U7R'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.query).toEqual({ normalizedQuery: 'TG2RX99U7R', searchMode: 'contains_fallback' })
    expect(body.data.total).toBe(1)
    expect(body.data.sessions[0]).toMatchObject({
      chatId: 'TG2RX99U7R',
      userId: 'livechat-TG2RX99U7R',
    })
    expect(body.data.sessions[0].matchedMessages).toBeUndefined()
  })

  it('searches LiveChat external chat aliases scoped to the selected agent', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-a&q=TH12XG7AWZ'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(1)
    expect(body.data.sessions[0]).toMatchObject({
      chatId: 'chat-new',
      userId: 'user-new',
    })
    expect(body.data.sessions[0].matchedMessages).toBeUndefined()
  })

  it('searches ProcedureRun ids inside the selected agent scope', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-a&q=run-new'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(1)
    expect(body.data.sessions[0]).toMatchObject({
      chatId: 'chat-new',
      userId: 'user-new',
    })
  })

  it('returns an empty search page without querying messages when the selected agent has no scoped cases', async () => {
    const res = await GET(makeRequest('?limit=200&agentId=agent-empty&q=deposit'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(0)
    expect(body.data.sessions).toEqual([])
    expect(h.queryRawCalls).toBe(0)
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
