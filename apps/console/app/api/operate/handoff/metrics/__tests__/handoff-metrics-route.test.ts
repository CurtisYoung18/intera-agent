import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent-a': { id: 'agent-a', orgId: 'default' },
    'agent-b': { id: 'agent-b', orgId: 'default' },
    'foreign-agent': { id: 'foreign-agent', orgId: 'org-b' },
  }
  const cases = [
    {
      id: 'case-a-waiting',
      orgId: 'default',
      chatId: 'chat-a',
      type: 'deposit_not_credited',
      status: 'waiting_human',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:03:00.000Z'),
      humanTasks: [{ status: 'pending', createdAt: new Date('2026-06-16T00:03:00.000Z'), resolvedAt: null }],
      _count: { messages: 2 },
    },
    {
      id: 'case-b-waiting',
      orgId: 'default',
      chatId: 'chat-b',
      type: 'withdrawal_password_reset',
      status: 'waiting_human',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:02:00.000Z'),
      humanTasks: [{ status: 'pending', createdAt: new Date('2026-06-16T00:02:00.000Z'), resolvedAt: null }],
      _count: { messages: 3 },
    },
    {
      id: 'case-a-resolved',
      orgId: 'default',
      chatId: 'chat-a-2',
      type: 'deposit_not_credited',
      status: 'completed',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:01:00.000Z'),
      humanTasks: [],
      _count: { messages: 5 },
    },
  ]
  const runs = [
    { id: 'run-a-waiting', orgId: 'default', caseId: 'case-a-waiting', agentConfigId: 'agent-a' },
    { id: 'run-b-waiting', orgId: 'default', caseId: 'case-b-waiting', agentConfigId: 'agent-b' },
    { id: 'run-a-resolved', orgId: 'default', caseId: 'case-a-resolved', agentConfigId: 'agent-a' },
  ]
  return { mockGetSession, agentConfigs, cases, runs }
})

function matchesWhere(row: any, where: Record<string, any> = {}) {
  if (where.orgId && row.orgId !== where.orgId) return false
  if (where.agentConfigId && row.agentConfigId !== where.agentConfigId) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
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
      raw: {
        procedureRun: {
          findMany: vi.fn(async (args: any) => h.runs
            .filter((row) => matchesWhere(row, args?.where ?? {}))
            .map((row) => ({ caseId: row.caseId }))),
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

import { GET } from '@/app/api/operate/handoff/metrics/route'

function makeRequest(agentId: string) {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/operate/handoff/metrics?agentId=${agentId}`),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
})

describe('/api/operate/handoff/metrics agent scoping', () => {
  it('summarizes only the selected agent cases', async () => {
    const res = await GET(makeRequest('agent-a'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.metrics.totalProcedureRuns).toBe(2)
    expect(body.data.metrics.totalConversations).toBe(2)
    expect(body.data.metrics.activeHandoffProcedureRuns).toBe(1)
    expect(body.data.metrics.totalMessages).toBe(7)
  })

  it('changes metrics when the selected agent changes', async () => {
    const res = await GET(makeRequest('agent-b'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.metrics.totalProcedureRuns).toBe(1)
    expect(body.data.metrics.totalConversations).toBe(1)
    expect(body.data.metrics.activeHandoffProcedureRuns).toBe(1)
    expect(body.data.metrics.totalMessages).toBe(3)
  })

  it('rejects an agent outside the active org', async () => {
    const res = await GET(makeRequest('foreign-agent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })
})
