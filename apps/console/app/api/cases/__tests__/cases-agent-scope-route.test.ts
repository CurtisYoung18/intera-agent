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
  ]
  const runs = [
    { id: 'run-a-waiting', orgId: 'default', caseId: 'case-a-waiting', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:03:00.000Z') },
    { id: 'run-b-waiting', orgId: 'default', caseId: 'case-b-waiting', agentConfigId: 'agent-b', updatedAt: new Date('2026-06-16T00:02:00.000Z') },
    { id: 'run-a-resolved', orgId: 'default', caseId: 'case-a-resolved', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:01:00.000Z') },
  ]
  return { mockGetSession, agentConfigs, cases, runs }
})

function matchesWhere(row: any, where: Record<string, any> = {}) {
  if (where.orgId && row.orgId !== where.orgId) return false
  if (where.status && row.status !== where.status) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
  if (where.caseId?.in && !where.caseId.in.includes(row.caseId)) return false
  if (where.agentConfigId && row.agentConfigId !== where.agentConfigId) return false
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
      raw: {
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

function makeRequest(agentId: string) {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/cases?status=waiting_human&limit=100&agentId=${agentId}`),
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
    expect(body.data.total).toBe(1)
    expect(body.data.cases).toHaveLength(1)
    expect(body.data.cases[0]).toMatchObject({
      id: 'run-a-waiting',
      runId: 'run-a-waiting',
      status: 'waiting_human',
      goal: 'Agent A handoff',
    })
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
