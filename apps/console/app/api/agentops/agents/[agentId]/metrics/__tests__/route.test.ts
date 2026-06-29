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
      chatId: 'chat-a',
      userId: 'customer-a',
      type: 'deposit_not_credited',
      status: 'waiting_human',
      source: 'live',
      createdAt: new Date('2026-06-26T00:00:00.000Z'),
      updatedAt: new Date('2026-06-26T00:03:00.000Z'),
      humanTasks: [{ status: 'pending', createdAt: new Date('2026-06-26T00:02:00.000Z'), resolvedAt: null, chatId: 'chat-a', runId: 'run-a' }],
      messages: [
        { id: 'msg-a1', caseId: 'case-a', runId: 'run-a', role: 'user', createdAt: new Date('2026-06-26T00:00:00.000Z'), providerContent: null, providerMeta: null },
        { id: 'msg-a2', caseId: 'case-a', runId: 'run-a', role: 'assistant', createdAt: new Date('2026-06-26T00:00:02.000Z'), providerContent: null, providerMeta: null },
      ],
      _count: { messages: 2 },
    },
    {
      id: 'case-b',
      orgId: 'default',
      chatId: 'chat-b',
      userId: 'customer-b',
      type: 'withdrawal_status',
      status: 'resolved',
      source: 'live',
      createdAt: new Date('2026-06-26T00:00:00.000Z'),
      updatedAt: new Date('2026-06-26T00:03:00.000Z'),
      humanTasks: [],
      messages: [
        { id: 'msg-b1', caseId: 'case-b', runId: 'run-b', role: 'user', createdAt: new Date('2026-06-26T00:00:00.000Z'), providerContent: null, providerMeta: null },
      ],
      _count: { messages: 1 },
    },
  ]
  const runs = [
    { id: 'run-a', orgId: 'default', caseId: 'case-a', agentConfigId: 'agent-a', updatedAt: new Date('2026-06-26T00:03:00.000Z') },
    { id: 'run-b', orgId: 'default', caseId: 'case-b', agentConfigId: 'agent-b', updatedAt: new Date('2026-06-26T00:03:00.000Z') },
  ]
  const traces = [
    {
      id: 'trace-a-1',
      orgId: 'default',
      caseId: 'case-a',
      runId: 'run-a',
      actionType: 'llm_response',
      title: 'LLM response: end_turn',
      detail: null,
      payload: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }),
      createdAt: new Date('2026-06-26T00:00:02.000Z'),
    },
    {
      id: 'trace-b-1',
      orgId: 'default',
      caseId: 'case-b',
      runId: 'run-b',
      actionType: 'tool_result',
      title: 'Tool: secret_b',
      detail: null,
      payload: JSON.stringify({ toolName: 'secret_b', output: { ok: false, error: 'boom' } }),
      createdAt: new Date('2026-06-26T00:00:02.000Z'),
    },
  ]
  return { mockGetSession, agentConfigs, cases, runs, traces }
})

function toTime(value: unknown): number | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.getTime() : null
}

function matchesDate(value: unknown, condition: Record<string, unknown>): boolean {
  const time = toTime(value)
  if (time == null) return false
  const gte = toTime(condition.gte)
  const lt = toTime(condition.lt)
  if (gte != null && time < gte) return false
  if (lt != null && time >= lt) return false
  return true
}

function matchesValue(value: any, condition: any): boolean {
  if (condition === undefined) return true
  if (condition === null || typeof condition !== 'object' || Array.isArray(condition)) return value === condition
  if (Array.isArray(condition.in)) return condition.in.includes(value)
  if (typeof condition.startsWith === 'string') return typeof value === 'string' && value.startsWith(condition.startsWith)
  if ('gte' in condition || 'lt' in condition) return matchesDate(value, condition)
  return Object.entries(condition).every(([key, nested]) => matchesValue(value?.[key], nested))
}

function matchesWhere(row: any, where: Record<string, any> = {}): boolean {
  if (where.NOT && Array.isArray(where.NOT) && where.NOT.some((condition: Record<string, any>) => matchesWhere(row, condition))) {
    return false
  }
  if (where.OR && Array.isArray(where.OR) && !where.OR.some((condition: Record<string, any>) => matchesWhere(row, condition))) {
    return false
  }
  if (where.messages?.some?.createdAt) {
    return (row.messages ?? []).some((message: any) => matchesDate(message.createdAt, where.messages.some.createdAt))
  }
  if (where.humanTasks?.some?.createdAt) {
    return (row.humanTasks ?? []).some((task: any) => matchesDate(task.createdAt, where.humanTasks.some.createdAt))
  }
  for (const [key, condition] of Object.entries(where)) {
    if (['NOT', 'OR', 'messages', 'humanTasks'].includes(key)) continue
    if (!matchesValue(row[key], condition)) return false
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
          .filter((row) => row.orgId === orgId)
          .filter((row) => matchesWhere(row, args?.where ?? {}))),
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
        actionTrace: {
          findMany: vi.fn(async (args: any) => h.traces
            .filter((row) => matchesWhere(row, args?.where ?? {}))
            .map(({ caseId, runId, actionType, title, detail, payload, createdAt }) => ({
              caseId,
              runId,
              actionType,
              title,
              detail,
              payload,
              createdAt,
            }))),
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

function makeRequest(agentId: string) {
  return {
    method: 'GET',
    json: async () => ({}),
    nextUrl: new URL(`http://localhost/api/agentops/agents/${agentId}/metrics?window=1h&to=2026-06-26T01:00:00.000Z`),
  } as any
}

function routeCtx(agentId: string) {
  return { params: Promise.resolve({ agentId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
})

describe('/api/agentops/agents/[agentId]/metrics', () => {
  it('returns only selected-agent scoped metrics and cost null', async () => {
    const res = await GET(makeRequest('agent-a'), routeCtx('agent-a'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.scope.caseIds).toEqual(['case-a'])
    expect(body.data.scope.runIds).toEqual(['run-a'])
    expect(body.data.metrics.handoffRate.denominator).toBe(1)
    expect(body.data.metrics.handoffRate.numerator).toBe(1)
    expect(body.data.metrics.toolErrorRate.observedToolResults).toBe(0)
    expect(body.data.metrics.tokenSummary.totalTokens).toBe(15)
    expect(body.data.metrics.cost.amount).toBeNull()
    expect(JSON.stringify(body)).not.toContain('secret_b')
  })

  it('changes scoped metrics when the selected agent changes', async () => {
    const res = await GET(makeRequest('agent-b'), routeCtx('agent-b'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.scope.caseIds).toEqual(['case-b'])
    expect(body.data.metrics.handoffRate.numerator).toBe(0)
    expect(body.data.metrics.toolErrorRate.observedToolResults).toBe(1)
    expect(body.data.metrics.toolErrorRate.errorCount).toBe(1)
  })

  it('rejects an agent outside the active org', async () => {
    const res = await GET(makeRequest('foreign-agent'), routeCtx('foreign-agent'))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })
})
