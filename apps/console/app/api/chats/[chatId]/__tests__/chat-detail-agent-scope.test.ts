import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent-a': { id: 'agent-a', orgId: 'default' },
    'agent-b': { id: 'agent-b', orgId: 'default' },
    'foreign-agent': { id: 'foreign-agent', orgId: 'org-b' },
  }
  const cases = [
    {
      id: 'case-a',
      orgId: 'default',
      userId: 'user-a',
      chatId: 'shared-chat',
      type: 'deposit_not_credited',
      status: 'active',
      source: 'live',
      goal: 'Agent A chat',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:03:00.000Z'),
      humanTasks: [],
      _count: { messages: 2 },
    },
    {
      id: 'case-b',
      orgId: 'default',
      userId: 'user-b',
      chatId: 'shared-chat',
      type: 'withdrawal_password_reset',
      status: 'waiting_human',
      source: 'live',
      goal: 'Agent B chat',
      createdAt: new Date('2026-06-16T00:00:00.000Z'),
      updatedAt: new Date('2026-06-16T00:02:00.000Z'),
      humanTasks: [{
        id: 'task-b',
        caseId: 'case-b',
        runId: null,
        queue: 'payment_ops',
        status: 'pending',
        question: 'Please review this withdrawal handoff before taking over.',
        notes: null,
        createdAt: new Date('2026-06-16T00:02:30.000Z'),
        resolvedAt: null,
      }],
      _count: { messages: 3 },
    },
  ]
  const runs = [
    { id: 'run-a', orgId: 'default', caseId: 'case-a', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-16T00:03:00.000Z') },
    { id: 'run-b', orgId: 'default', caseId: 'case-b', agentConfigId: 'agent-b', updatedAt: new Date('2026-06-16T00:02:00.000Z') },
  ]
  return { mockGetSession, agentConfigs, cases, runs }
})

function matchesWhere(row: any, where: Record<string, any> = {}) {
  if (where.orgId && row.orgId !== where.orgId) return false
  if (where.agentConfigId && row.agentConfigId !== where.agentConfigId) return false
  if (where.chatId && typeof where.chatId === 'string' && row.chatId !== where.chatId) return false
  if (typeof where.chatId === 'object' && where.chatId?.startsWith && !row.chatId?.startsWith(where.chatId.startsWith)) return false
  if (where.internalCaseId?.not === null && row.internalCaseId === null) return false
  if (where.metadata?.path?.[0] === 'agentConfigId' && row.metadata?.agentConfigId !== where.metadata.equals) return false
  if (where.id && typeof where.id === 'string' && row.id !== where.id) return false
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
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      raw: {
        case: {
          findMany: vi.fn(async (args: any) => h.cases.filter((row) => matchesWhere(row, args?.where ?? {}))),
          findFirst: vi.fn(async (args: any) => h.cases.find((row) => matchesWhere(row, args?.where ?? {})) ?? null),
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

import { GET } from '../route'

function makeRequest(query = '') {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/chats/shared-chat${query}`),
  } as any
}

function routeCtx(chatId = 'shared-chat') {
  return { params: Promise.resolve({ chatId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
})

describe('/api/chats/[chatId] agent scoping', () => {
  it('returns only the selected agent case for a shared chat id', async () => {
    const res = await GET(makeRequest('?agentId=agent-a'), routeCtx())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.session.cases).toHaveLength(1)
    expect(body.data.session.cases[0]).toMatchObject({
      id: 'run-a',
      runId: 'run-a',
      goal: 'Agent A chat',
    })
  })

  it('changes detail cases when the selected agent changes', async () => {
    const res = await GET(makeRequest('?agentId=agent-b'), routeCtx())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.session.userId).toBe('user-b')
    expect(body.data.session.cases).toHaveLength(1)
    expect(body.data.session.cases[0]).toMatchObject({
      id: 'run-b',
      runId: 'run-b',
      goal: 'Agent B chat',
    })
    expect(body.data.session.handoffTasks).toEqual([
      expect.objectContaining({
        id: 'task-b',
        caseId: 'case-b',
        runId: 'run-b',
        procedureType: 'withdrawal_password_reset',
        queue: 'payment_ops',
        status: 'pending',
        question: 'Please review this withdrawal handoff before taking over.',
        createdAt: '2026-06-16T00:02:30.000Z',
      }),
    ])
  })

  it('rejects an agent outside the active org', async () => {
    const res = await GET(makeRequest('?agentId=foreign-agent'), routeCtx())
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })

  it('includes same-chat general cases that have no ProcedureRun for traceability', async () => {
    h.cases.push({
      id: 'case-general',
      orgId: 'default',
      userId: 'user-a',
      chatId: 'shared-chat',
      type: 'general',
      status: 'created',
      source: 'live',
      goal: 'Direct answer without a ProcedureRun',
      createdAt: new Date('2026-06-16T00:01:00.000Z'),
      updatedAt: new Date('2026-06-16T00:04:00.000Z'),
      humanTasks: [],
      _count: { messages: 2 },
    })

    const res = await GET(makeRequest('?agentId=agent-a'), routeCtx())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.session.cases).toHaveLength(2)
    expect(body.data.session.cases.map((caseRow: { id: string }) => caseRow.id)).toEqual([
      'case-general',
      'run-a',
    ])
    expect(body.data.session.cases.find((caseRow: { id: string }) => caseRow.id === 'case-general')).toMatchObject({
      runId: null,
      goal: 'Direct answer without a ProcedureRun',
    })
    expect(body.data.session.cases.some((caseRow: { id: string }) => caseRow.id === 'run-b')).toBe(false)
  })
})
