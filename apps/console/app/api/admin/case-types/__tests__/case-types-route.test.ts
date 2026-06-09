// Route-level guard test for /api/admin/case-types
// Scoped by agentConfigId (not orgId).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const caseTypeRow = (overrides: Record<string, unknown>) => ({
    id: 'ct',
    agentConfigId: 'agent_default_v1',
    type: 'general',
    displayName: 'General',
    description: 'General case',
    icon: ':icon:',
    requiredFacts: '[]',
    defaultGoal: '',
    escalateOn: '[]',
    autoCloseConditions: null,
    enabled: true,
    procedure: null,
    maxAutoTurns: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  })
  const typesByAgent: Record<string, Record<string, unknown>[]> = {
    'agent_default_v1': [
      caseTypeRow({ id: 'ct1', type: 'refund_request', displayName: 'Refund', description: 'Refund case' }),
      caseTypeRow({ id: 'ct2', type: 'deposit_issue', displayName: 'Deposit Issue', description: 'Deposit' }),
    ],
    'test-agent': [
      caseTypeRow({ id: 'ct3', agentConfigId: 'test-agent', type: 'org_b_type', displayName: 'Test Agent Type', description: 'Test only' }),
    ],
  }
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent_default_v1': { id: 'agent_default_v1', orgId: 'default' },
    'test-agent': { id: 'test-agent', orgId: 'test-org' },
  }
  const hooksByAgent: Record<string, Record<string, unknown>[]> = {
    'agent_default_v1': [
      { id: 'h1', agentConfigId: 'agent_default_v1', name: 'investigate_before_resolve', enabled: true },
      { id: 'h2', agentConfigId: 'agent_default_v1', name: 'human_review_before_finalize', enabled: true },
    ],
    'test-agent': [
      { id: 'h3', agentConfigId: 'test-agent', name: 'case_b_policy', enabled: true },
    ],
  }
  const mockGetSession = vi.fn()

  return { typesByAgent, agentConfigs, hooksByAgent, mockGetSession, caseTypeRow }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          const ac = h.agentConfigs[id]
          if (!ac) return null
          if (ac.orgId !== orgId) return null
          return ac
        }),
      },
      raw: {
        caseType: {
          findMany: vi.fn(async (args?: any) => {
            const where = args?.where || {}
            const agentConfigId = where.agentConfigId as string | undefined
            return agentConfigId ? (h.typesByAgent[agentConfigId] ?? []) : []
          }),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, type } = args?.where?.agentConfigId_type ?? {}
            return (h.typesByAgent[agentConfigId] ?? []).find((t: any) => t.type === type) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const ct = { id: `ct_new_${Date.now()}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
            const ac = args.data.agentConfigId
            if (!h.typesByAgent[ac]) h.typesByAgent[ac] = []
            h.typesByAgent[ac].push(ct)
            return ct
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, type } = args.where.agentConfigId_type
            const types = h.typesByAgent[agentConfigId] ?? []
            const ct = types.find((t: any) => t.type === type)
            if (!ct) throw new Error('Not found')
            Object.assign(ct, args.data)
            return ct
          }),
          delete: vi.fn(async (args: any) => {
            const { agentConfigId, type } = args.where.agentConfigId_type
            const types = h.typesByAgent[agentConfigId] ?? []
            const idx = types.findIndex((t: any) => t.type === type)
            if (idx === -1) throw new Error('Not found')
            types.splice(idx, 1)
          }),
        },
        hook: {
          findMany: vi.fn(async (args?: any) => {
            const where = args?.where || {}
            const agentConfigId = where.agentConfigId as string | undefined
            return agentConfigId ? (h.hooksByAgent[agentConfigId] ?? []) : []
          }),
        },
        organization: {
          upsert: vi.fn(async () => ({ id: orgId, name: 'Demo Org' })),
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

vi.mock('@intera/shared/defaults', () => ({
  DEFAULT_CASE_TYPES: [],
  DEFAULT_MODEL: 'deepseek-v4-flash',
}))

import { GET, POST } from '@/app/api/admin/case-types/route'
import { GET as GetByName, PUT, DELETE } from '@/app/api/admin/case-types/[name]/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/case-types?agentConfigId=agent_default_v1') } as any
}

function makeRequestForAgent(agentConfigId: string, body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL(`http://localhost/api/admin/case-types?agentConfigId=${agentConfigId}`) } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
  h.typesByAgent['agent_default_v1'] = [
    h.caseTypeRow({ id: 'ct1', type: 'refund_request', displayName: 'Refund', description: 'Refund case' }),
    h.caseTypeRow({ id: 'ct2', type: 'deposit_issue', displayName: 'Deposit Issue', description: 'Deposit' }),
  ]
  h.typesByAgent['test-agent'] = [
    h.caseTypeRow({ id: 'ct3', agentConfigId: 'test-agent', type: 'org_b_type', displayName: 'Test Agent Type', description: 'Test only' }),
  ]
  h.hooksByAgent['agent_default_v1'] = [
    { id: 'h1', agentConfigId: 'agent_default_v1', name: 'investigate_before_resolve', enabled: true },
    { id: 'h2', agentConfigId: 'agent_default_v1', name: 'human_review_before_finalize', enabled: true },
  ]
  h.hooksByAgent['test-agent'] = [
    { id: 'h3', agentConfigId: 'test-agent', name: 'case_b_policy', enabled: true },
  ]
})

describe('G1 — Uniform envelope', () => {
  it('GET returns ApiOk<{types}> envelope', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.types)).toBe(true)
  })

  it('POST with empty body returns validation error (400)', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('POST with valid input returns ApiOk<{caseType}> (201)', async () => {
    const res = await POST(makeRequest({ agentConfigId: 'agent_default_v1', type: 'new_type', displayName: 'New Type' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.caseType.type).toBe('new_type')
    expect(res.status).toBe(201)
  })

  it('POST rejects invalid procedure payloads', async () => {
    const res = await POST(makeRequest({
      agentConfigId: 'agent_default_v1',
      type: 'bad_procedure',
      procedure: { steps: [{ id: 'bad', action: 'unknown' }] },
    }))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('POST accepts procedure payloads', async () => {
    const res = await POST(makeRequest({
      agentConfigId: 'agent_default_v1',
      type: 'procedure_case',
      procedure: { steps: [{ id: 'finish', action: 'finalize' }] },
    }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.caseType.procedure).toContain('"finish"')
  })
})

describe('G4 — Procedure payload', () => {
  it('PUT accepts procedure payload', async () => {
    const res = await PUT(
      makeRequestForAgent('agent_default_v1', {
        agentConfigId: 'agent_default_v1',
        procedure: {
        steps: [
            { id: 'step_1', action: 'use', target: 'user', guidance: 'collect user details', when: 'always', required: true },
            { id: 'step_2', action: 'ask', target: 'ops', guidance: 'send alert', when: 'error', required: false },
          ],
        },
      }),
      routeCtx('refund_request'),
    )
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.caseType.procedure).toContain('"step_1"')
  })
})

describe('G2 — Tenant isolation', () => {
  it('agent_default_v1 only sees its own types', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GET(makeRequestForAgent('agent_default_v1'))
    const body = await res.json()
    expect(body.data.types.length).toBe(2)
    expect(body.data.types.every((t: any) => t.agentConfigId === 'agent_default_v1')).toBe(true)
  })

  it('agent_default_v1 CANNOT see test-agent type by name', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GetByName(makeRequestForAgent('agent_default_v1'), routeCtx('org_b_type'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Mutations', () => {
  it('DELETE removes case type and returns success', async () => {
    const res = await DELETE(makeRequestForAgent('agent_default_v1'), routeCtx('refund_request'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  it('PUT updates case type display name', async () => {
    const res = await PUT(makeRequestForAgent('agent_default_v1', { agentConfigId: 'agent_default_v1', displayName: 'Updated Refund' }), routeCtx('refund_request'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.caseType.displayName).toBe('Updated Refund')
  })

  it('PUT rejects invalid procedure updates', async () => {
    const res = await PUT(makeRequestForAgent('agent_default_v1', {
      agentConfigId: 'agent_default_v1',
      procedure: { steps: [{ id: 'bad', action: 'unknown' }] },
    }), routeCtx('refund_request'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
  })
})

describe('Error codes', () => {
  it('returns 401 when no session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent case type', async () => {
    const res = await GetByName(makeRequestForAgent('agent_default_v1'), routeCtx('nonexistent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})
