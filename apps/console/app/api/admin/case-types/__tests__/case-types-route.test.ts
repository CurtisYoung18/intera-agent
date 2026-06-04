// Route-level guard test for /api/admin/case-types

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const typesByOrg: Record<string, Record<string, unknown>[]> = {
    default: [
      { id: 'ct1', orgId: 'default', type: 'refund_request', displayName: 'Refund', description: 'Refund case', icon: ':icon:', requiredFacts: '[]', stages: '["created","resolved"]', stageConfigs: null, orchestratorConfig: null, defaultGoal: '', escalateOn: '[]', autoCloseConditions: null, enabled: true, requireHumanReview: false, executionMode: 'stage', sop: null, sopMaxAutoTurns: 10, createdAt: new Date(), updatedAt: new Date() },
      { id: 'ct2', orgId: 'default', type: 'deposit_issue', displayName: 'Deposit Issue', description: 'Deposit', icon: ':icon:', requiredFacts: '[]', stages: '["created","investigating","resolved"]', stageConfigs: null, orchestratorConfig: null, defaultGoal: '', escalateOn: '[]', autoCloseConditions: null, enabled: true, requireHumanReview: false, executionMode: 'stage', sop: null, sopMaxAutoTurns: 10, createdAt: new Date(), updatedAt: new Date() },
    ],
    orgB: [
      { id: 'ct3', orgId: 'orgB', type: 'org_b_type', displayName: 'Org B Type', description: 'B only', icon: ':icon:', requiredFacts: '[]', stages: '["created","resolved"]', stageConfigs: null, orchestratorConfig: null, defaultGoal: '', escalateOn: '[]', autoCloseConditions: null, enabled: true, requireHumanReview: false, executionMode: 'stage', sop: null, sopMaxAutoTurns: 10, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const mockGetSession = vi.fn()

  return { typesByOrg, mockGetSession }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const types = h.typesByOrg[orgId] ?? []
    return {
      orgId,
      caseType: {
        findMany: vi.fn(async () => types),
        findUnique: vi.fn(async (args: any) => {
          const type = args?.where?.orgId_type?.type
          return types.find((t) => t.type === type) ?? null
        }),
        create: vi.fn(async (args: any) => {
          const ct = { id: `ct_new_${Date.now()}`, ...args.data, orgId, createdAt: new Date(), updatedAt: new Date() }
          if (!h.typesByOrg[orgId]) h.typesByOrg[orgId] = []
          h.typesByOrg[orgId].push(ct)
          return ct
        }),
        update: vi.fn(async (args: any) => {
          const type = args.where.orgId_type.type
          const ct = types.find((t) => t.type === type)
          if (!ct) throw new Error('Not found')
          Object.assign(ct, args.data)
          return ct
        }),
        delete: vi.fn(async (args: any) => {
          const type = args.where.orgId_type.type
          const idx = types.findIndex((t) => t.type === type)
          if (idx === -1) throw new Error('Not found')
          types.splice(idx, 1)
        }),
      },
      raw: {
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
  DEFAULT_STAGE_CONFIGS: {},
  DEFAULT_ORCHESTRATOR_CONFIG: { enabled: false, maxParallelAgents: 3 },
  DEFAULT_MODEL: 'deepseek-v4-flash',
}))

import { GET, POST } from '@/app/api/admin/case-types/route'
import { GET as GetByName, PUT, DELETE } from '@/app/api/admin/case-types/[name]/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/case-types') } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
  h.typesByOrg.default = [
    { id: 'ct1', orgId: 'default', type: 'refund_request', displayName: 'Refund', description: 'Refund case', icon: ':icon:', requiredFacts: '[]', stages: '["created","resolved"]', stageConfigs: null, orchestratorConfig: null, defaultGoal: '', escalateOn: '[]', autoCloseConditions: null, enabled: true, requireHumanReview: false, executionMode: 'stage', sop: null, sopMaxAutoTurns: 10, createdAt: new Date(), updatedAt: new Date() },
    { id: 'ct2', orgId: 'default', type: 'deposit_issue', displayName: 'Deposit Issue', description: 'Deposit', icon: ':icon:', requiredFacts: '[]', stages: '["created","investigating","resolved"]', stageConfigs: null, orchestratorConfig: null, defaultGoal: '', escalateOn: '[]', autoCloseConditions: null, enabled: true, requireHumanReview: false, executionMode: 'stage', sop: null, sopMaxAutoTurns: 10, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.typesByOrg.orgB = [
    { id: 'ct3', orgId: 'orgB', type: 'org_b_type', displayName: 'Org B Type', description: 'B only', icon: ':icon:', requiredFacts: '[]', stages: '["created","resolved"]', stageConfigs: null, orchestratorConfig: null, defaultGoal: '', escalateOn: '[]', autoCloseConditions: null, enabled: true, requireHumanReview: false, executionMode: 'stage', sop: null, sopMaxAutoTurns: 10, createdAt: new Date(), updatedAt: new Date() },
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
    const res = await POST(makeRequest({ type: 'new_type', displayName: 'New Type' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.caseType.type).toBe('new_type')
    expect(res.status).toBe(201)
  })
})

describe('G2 — Tenant isolation', () => {
  it('org default only sees its own types', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data.types.length).toBe(2)
    expect(body.data.types.every((t: any) => t.orgId === 'default')).toBe(true)
  })

  it('org A CANNOT see org B type by name', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GetByName(makeRequest(), routeCtx('org_b_type'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Mutations', () => {
  it('DELETE removes case type and returns success', async () => {
    const res = await DELETE(makeRequest(), routeCtx('refund_request'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  it('PUT updates case type display name', async () => {
    const res = await PUT(makeRequest({ displayName: 'Updated Refund' }), routeCtx('refund_request'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.caseType.displayName).toBe('Updated Refund')
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
    const res = await GetByName(makeRequest(), routeCtx('nonexistent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})
