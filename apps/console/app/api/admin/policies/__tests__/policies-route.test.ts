// Route-level guard test for /api/admin/policies

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const policiesByOrg: Record<string, Record<string, unknown>[]> = {
    default: [
      { id: 'p1', orgId: 'default', name: 'fraud_check', description: 'Fraud check', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
      { id: 'p2', orgId: 'default', name: 'review_required', description: 'Review', hook: 'postTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
    orgB: [
      { id: 'p3', orgId: 'orgB', name: 'org_b_policy', description: 'Org B only', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const createdPolicies: Record<string, unknown>[] = []
  const mockGetSession = vi.fn()

  return { policiesByOrg, createdPolicies, mockGetSession }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const policies = h.policiesByOrg[orgId] ?? []
    return {
      orgId,
      policy: {
        findMany: vi.fn(async () => policies),
        findUnique: vi.fn(async (args: any) => {
          const name = args?.where?.orgId_name?.name
          return policies.find((p) => p.name === name) ?? null
        }),
        create: vi.fn(async (args: any) => {
          const policy = { id: `p_new_${h.createdPolicies.length}`, ...args.data, orgId, createdAt: new Date(), updatedAt: new Date() }
          h.createdPolicies.push(policy)
          if (!h.policiesByOrg[orgId]) h.policiesByOrg[orgId] = []
          h.policiesByOrg[orgId].push(policy)
          return policy
        }),
        update: vi.fn(async (args: any) => {
          const name = args.where.orgId_name.name
          const policy = policies.find((p) => p.name === name)
          if (!policy) throw new Error('Not found')
          Object.assign(policy, args.data)
          return policy
        }),
        delete: vi.fn(async (args: any) => {
          const name = args.where.orgId_name.name
          const idx = policies.findIndex((p) => p.name === name)
          if (idx === -1) throw new Error('Not found')
          policies.splice(idx, 1)
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
  DEFAULT_POLICIES: [],
  DEFAULT_MODEL: 'deepseek-v4-flash',
}))

import { GET, POST } from '@/app/api/admin/policies/route'
import { GET as GetByName, PUT, DELETE } from '@/app/api/admin/policies/[name]/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/policies') } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createdPolicies.length = 0
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
  h.policiesByOrg.default = [
    { id: 'p1', orgId: 'default', name: 'fraud_check', description: 'Fraud check', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'p2', orgId: 'default', name: 'review_required', description: 'Review', hook: 'postTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.policiesByOrg.orgB = [
    { id: 'p3', orgId: 'orgB', name: 'org_b_policy', description: 'Org B only', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
})

describe('G1 — Uniform envelope', () => {
  it('GET returns ApiOk<{policies}> envelope', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.policies)).toBe(true)
  })

  it('POST with empty body returns validation error (400)', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('POST with valid input returns ApiOk<{policy}> (201)', async () => {
    const res = await POST(makeRequest({ name: 'new_policy', description: 'A new policy' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.policy.name).toBe('new_policy')
    expect(res.status).toBe(201)
  })
})

describe('G2 — Tenant isolation', () => {
  it('org default only sees its own policies', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data.policies.length).toBe(2)
    expect(body.data.policies.every((p: any) => p.orgId === 'default')).toBe(true)
  })

  it('org B only sees its own policies', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'staff' })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data.policies.every((p: any) => p.orgId === 'orgB')).toBe(true)
  })

  it('org A CANNOT see org B policy by name', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GetByName(makeRequest(), routeCtx('org_b_policy'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Mutations', () => {
  it('DELETE removes policy and returns success', async () => {
    const res = await DELETE(makeRequest(), routeCtx('review_required'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  it('PUT updates policy description', async () => {
    const res = await PUT(makeRequest({ description: 'Updated' }), routeCtx('fraud_check'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.policy.description).toBe('Updated')
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

  it('returns 404 for non-existent policy', async () => {
    const res = await GetByName(makeRequest(), routeCtx('nonexistent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})
