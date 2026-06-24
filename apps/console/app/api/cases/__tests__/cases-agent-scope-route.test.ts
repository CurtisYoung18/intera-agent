import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent-a': { id: 'agent-a', orgId: 'default' },
    'agent-b': { id: 'agent-b', orgId: 'default' },
    'foreign-agent': { id: 'foreign-agent', orgId: 'org-b' },
  }
  const baseDate = new Date('2026-06-16T00:00:00.000Z')
  const cases = [
    {
      id: 'case-a-waiting',
      orgId: 'default',
      userId: 'user-a',
      chatId: 'chat-a',
      type: 'deposit_not_credited',
      status: 'waiting_human',
      source: 'live',
      goal: 'Agent A handoff',
      blocker: null,
      createdAt: baseDate,
      updatedAt: new Date('2026-06-16T00:03:00.000Z'),
      resolvedAt: null,
      memory: { summary: 'A', toolsCalled: '[]' },
      humanTasks: [{ id: 'task-a' }],
      _count: { messages: 2, traces: 1 },
    },
    {
      id: 'case-b-waiting',
      orgId: 'default',
      userId: 'user-b',
      chatId: 'chat-b',
      type: 'withdrawal_password_reset',
      status: 'waiting_human',
      source: 'live',
      goal: 'Agent B handoff',
      blocker: null,
      createdAt: baseDate,
      updatedAt: new Date('2026-06-16T00:02:00.000Z'),
      resolvedAt: null,
      memory: { summary: 'B', toolsCalled: '[]' },
      humanTasks: [{ id: 'task-b' }],
      _count: { messages: 3, traces: 1 },
    },
    {
      id: 'case-a-resolved',
      orgId: 'default',
      userId: 'user-a',
      chatId: 'chat-a-2',
      type: 'deposit_not_credited',
      status: 'completed',
      source: 'live',
      goal: 'Agent A resolved',
      blocker: null,
      createdAt: baseDate,
      updatedAt: new Date('2026-06-16T00:01:00.000Z'),
      resolvedAt: null,
      memory: { summary: 'resolved', toolsCalled: '[]' },
      humanTasks: [],
      _count: { messages: 5, traces: 2 },
    },
    {
      id: 'case-a-escalated',
      orgId: 'default',
      userId: 'user-a',
      chatId: 'chat-a-3',
      type: 'j1n_withdrawal_status',
      status: 'escalated',
      source: 'live',
      goal: 'Agent A hook handoff',
      blocker: null,
      createdAt: baseDate,
      updatedAt: new Date('2026-06-16T00:04:00.000Z'),
      resolvedAt: null,
      memory: { summary: 'hook handoff', toolsCalled: '[]' },
      humanTasks: [{ id: 'task-a-escalated', status: 'pending', resolvedAt: null }],
      _count: { messages: 4, traces: 2 },
    },
    {
      id: 'case-a-escalated-duplicate-chat',
      orgId: 'default',
      userId: 'user-a',
      chatId: 'chat-a-3',
      type: 'j1n_deposit_status',
      status: 'escalated',
      source: 'live',
      goal: 'Same chat second handoff',
      blocker: null,
      createdAt: baseDate,
      updatedAt: new Date('2026-06-16T00:06:00.000Z'),
      resolvedAt: null,
      memory: { summary: 'same chat second handoff', toolsCalled: '[]' },
      humanTasks: [{ id: 'task-a-escalated-duplicate', status: 'pending', resolvedAt: null }],
      _count: { messages: 7, traces: 3 },
    },
    {
      id: 'case-a-fake-waiting',
      orgId: 'default',
      userId: 'user-a',
      chatId: 'chat-a-4',
      type: 'general',
      status: 'waiting_human',
      source: 'live',
      goal: 'Status-only handoff should not count',
      blocker: null,
      createdAt: baseDate,
      updatedAt: new Date('2026-06-16T00:05:00.000Z'),
      resolvedAt: null,
      memory: { summary: 'fake', toolsCalled: '[]' },
      humanTasks: [],
      _count: { messages: 1, traces: 0 },
    },
  ]
  const runs = [
    { id: 'run-a-waiting', orgId: 'default', caseId: 'case-a-waiting', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:03:00.000Z') },
    { id: 'run-b-waiting', orgId: 'default', caseId: 'case-b-waiting', agentConfigId: 'agent-b', updatedAt: new Date('2026-06-16T00:02:00.000Z') },
    { id: 'run-a-resolved', orgId: 'default', caseId: 'case-a-resolved', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:01:00.000Z') },
    { id: 'run-a-escalated', orgId: 'default', caseId: 'case-a-escalated', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:04:00.000Z') },
    { id: 'run-a-escalated-duplicate', orgId: 'default', caseId: 'case-a-escalated-duplicate-chat', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:06:00.000Z') },
    { id: 'run-a-fake-waiting', orgId: 'default', caseId: 'case-a-fake-waiting', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:05:00.000Z') },
  ]
  return { mockGetSession, agentConfigs, cases, runs }
})

function matchesValue(value: any, condition: any): boolean {
  if (condition === undefined) return true
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return value === condition
  if (Array.isArray(condition.in)) return condition.in.includes(value)
  if (Array.isArray(condition.notIn)) return !condition.notIn.includes(value)
  if (typeof condition.startsWith === 'string') return typeof value === 'string' && value.startsWith(condition.startsWith)
  return Object.entries(condition).every(([key, nested]) => matchesValue(value?.[key], nested))
}

function matchesWhere(row: any, where: Record<string, any> = {}) {
  if (where.orgId && row.orgId !== where.orgId) return false
  if (where.status && !matchesValue(row.status, where.status)) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
  if (where.caseId?.in && !where.caseId.in.includes(row.caseId)) return false
  if (where.agentConfigId && row.agentConfigId !== where.agentConfigId) return false
  if (where.chatId && !matchesValue(row.chatId, where.chatId)) return false
  if (where.humanTasks?.some) {
    if (!row.humanTasks.some((task: any) => matchesWhere(task, where.humanTasks.some))) return false
  }
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
          .sort((a, b) => b.updatedAt.toISOString().localeCompare(a.updatedAt.toISOString()))
          .slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? h.cases.length))),
        count: vi.fn(async (args: any) => h.cases.filter((row) => matchesWhere(row, { ...(args?.where ?? {}), orgId })).length),
      },
      externalConversation: {
        findMany: vi.fn(async () => []),
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

import { GET } from '@/app/api/cases/route'

function makeRequest(agentId: string, query = 'status=waiting_human&limit=100') {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/cases?${query}&agentId=${agentId}`),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
})

describe('/api/cases agent scoping', () => {
  it('filters waiting-human cases to the selected agent', async () => {
    const res = await GET(makeRequest('agent-a'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(2)
    expect(body.data.cases).toHaveLength(2)
    expect(body.data.cases.some((item: any) => item.id === 'run-a-fake-waiting')).toBe(true)
    expect(body.data.cases.find((item: any) => item.id === 'run-a-waiting')).toMatchObject({
      id: 'run-a-waiting',
      runId: 'run-a-waiting',
      chatId: 'chat-a',
      status: 'waiting_human',
      goal: 'Agent A handoff',
    })
  })

  it('filters active handoffs by real unresolved HumanTask evidence', async () => {
    const res = await GET(makeRequest('agent-a', 'handoff=active&limit=100'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(3)
    expect(body.data.cases.map((item: any) => item.id)).toEqual(['run-a-escalated-duplicate', 'run-a-escalated', 'run-a-waiting'])
    expect(body.data.cases.some((item: any) => item.id === 'run-a-fake-waiting')).toBe(false)
  })

  it('can group active handoffs by chat for conversation-level pagination', async () => {
    const res = await GET(makeRequest('agent-a', 'handoff=active&groupBy=chat&limit=100'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(2)
    expect(body.data.cases.map((item: any) => item.id)).toEqual(['run-a-escalated-duplicate', 'run-a-waiting'])
    expect(body.data.cases.map((item: any) => item.chatId)).toEqual(['chat-a-3', 'chat-a'])
  })

  it('switches to a different result set for another agent', async () => {
    const res = await GET(makeRequest('agent-b'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.total).toBe(1)
    expect(body.data.cases[0]).toMatchObject({
      id: 'run-b-waiting',
      runId: 'run-b-waiting',
      goal: 'Agent B handoff',
    })
  })

  it('rejects an agent outside the active org', async () => {
    const res = await GET(makeRequest('foreign-agent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })
})
