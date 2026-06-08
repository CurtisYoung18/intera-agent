// Route-level guard test for /api/admin/policies
// Scoped by agentConfigId (not orgId).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const policiesByAgent: Record<string, Record<string, unknown>[]> = {
    'agent_default_v1': [
      { id: 'p1', agentConfigId: 'agent_default_v1', name: 'fraud_check', description: 'Fraud check', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
      { id: 'p2', agentConfigId: 'agent_default_v1', name: 'review_required', description: 'Review', hook: 'postTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
    'test-agent': [
      { id: 'p3', agentConfigId: 'test-agent', name: 'org_b_policy', description: 'Test agent only', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const caseTypesByAgent: Record<string, Record<string, unknown>[]> = {
    'agent_default_v1': [
      { id: 'ct1', agentConfigId: 'agent_default_v1', type: 'deposit_issue', displayName: 'Deposit', guardrails: '["review_required"]' },
      { id: 'ct2', agentConfigId: 'agent_default_v1', type: 'general_inquiry', displayName: 'General', guardrails: '[]' },
    ],
    'test-agent': [
      { id: 'ct3', agentConfigId: 'test-agent', type: 'org_b_type', displayName: 'Org B Type', guardrails: '["org_b_policy"]' },
    ],
  }
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent_default_v1': { id: 'agent_default_v1', orgId: 'default' },
    'test-agent': { id: 'test-agent', orgId: 'test-org' },
  }
  const createdPolicies: Record<string, unknown>[] = []
  const mockGetSession = vi.fn()

  return { policiesByAgent, caseTypesByAgent, agentConfigs, createdPolicies, mockGetSession }
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
        policy: {
          findMany: vi.fn(async (args?: any) => {
            const where = args?.where || {}
            const agentConfigId = where.agentConfigId as string | undefined
            return agentConfigId ? (h.policiesByAgent[agentConfigId] ?? []) : []
          }),
          findUnique: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args?.where?.agentConfigId_name ?? {}
            return (h.policiesByAgent[agentConfigId] ?? []).find((p: any) => p.name === name) ?? null
          }),
          create: vi.fn(async (args: any) => {
            const policy = { id: `p_new_${h.createdPolicies.length}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
            h.createdPolicies.push(policy)
            const ac = args.data.agentConfigId
            if (!h.policiesByAgent[ac]) h.policiesByAgent[ac] = []
            h.policiesByAgent[ac].push(policy)
            return policy
          }),
          update: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const policies = h.policiesByAgent[agentConfigId] ?? []
            const policy = policies.find((p: any) => p.name === name)
            if (!policy) throw new Error('Not found')
            Object.assign(policy, args.data)
            return policy
          }),
          delete: vi.fn(async (args: any) => {
            const { agentConfigId, name } = args.where.agentConfigId_name
            const policies = h.policiesByAgent[agentConfigId] ?? []
            const idx = policies.findIndex((p: any) => p.name === name)
            if (idx === -1) throw new Error('Not found')
            policies.splice(idx, 1)
          }),
        },
        caseType: {
          findMany: vi.fn(async (args?: any) => {
            const where = args?.where || {}
            const agentConfigId = where.agentConfigId as string | undefined
            return agentConfigId ? (h.caseTypesByAgent[agentConfigId] ?? []) : []
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
  DEFAULT_POLICIES: [],
  DEFAULT_MODEL: 'deepseek-v4-flash',
}))

import { GET, POST } from '@/app/api/admin/policies/route'
import { GET as GetByName, PUT, DELETE } from '@/app/api/admin/policies/[name]/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/policies?agentConfigId=agent_default_v1') } as any
}

function makeRequestForAgent(agentConfigId: string, body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL(`http://localhost/api/admin/policies?agentConfigId=${agentConfigId}`) } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createdPolicies.length = 0
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
  h.policiesByAgent['agent_default_v1'] = [
    { id: 'p1', agentConfigId: 'agent_default_v1', name: 'fraud_check', description: 'Fraud check', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'p2', agentConfigId: 'agent_default_v1', name: 'review_required', description: 'Review', hook: 'postTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.policiesByAgent['test-agent'] = [
    { id: 'p3', agentConfigId: 'test-agent', name: 'org_b_policy', description: 'Test agent only', hook: 'preTool', rule: '{}', enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.caseTypesByAgent['agent_default_v1'] = [
    { id: 'ct1', agentConfigId: 'agent_default_v1', type: 'deposit_issue', displayName: 'Deposit', guardrails: '["review_required"]' },
    { id: 'ct2', agentConfigId: 'agent_default_v1', type: 'general_inquiry', displayName: 'General', guardrails: '[]' },
  ]
  h.caseTypesByAgent['test-agent'] = [
    { id: 'ct3', agentConfigId: 'test-agent', type: 'org_b_type', displayName: 'Org B Type', guardrails: '["org_b_policy"]' },
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
    const res = await POST(makeRequest({ agentConfigId: 'agent_default_v1', name: 'new_policy', description: 'A new policy' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.policy.name).toBe('new_policy')
    expect(res.status).toBe(201)
  })
})

describe('G2 — Tenant isolation', () => {
  it('agent_default_v1 only sees its own policies', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GET(makeRequestForAgent('agent_default_v1'))
    const body = await res.json()
    expect(body.data.policies.length).toBe(2)
    expect(body.data.policies.every((p: any) => p.agentConfigId === 'agent_default_v1')).toBe(true)
  })

  it('test-agent only sees its own policies', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'test-org', role: 'staff' })
    const res = await GET(makeRequestForAgent('test-agent'))
    const body = await res.json()
    expect(body.data.policies.every((p: any) => p.agentConfigId === 'test-agent')).toBe(true)
  })

  it('agent_default_v1 CANNOT see test-agent policy by name', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GetByName(makeRequestForAgent('agent_default_v1'), routeCtx('org_b_policy'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Mutations', () => {
  it('DELETE removes policy and returns success', async () => {
    const res = await DELETE(makeRequestForAgent('agent_default_v1'), routeCtx('fraud_check'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  it('DELETE blocks when a case type activates the policy', async () => {
    const res = await DELETE(makeRequestForAgent('agent_default_v1'), routeCtx('review_required'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('conflict')
    expect(body.error.message).toContain('deposit_issue')
    expect(res.status).toBe(409)
  })

  it('PUT updates policy description', async () => {
    const res = await PUT(makeRequestForAgent('agent_default_v1', { agentConfigId: 'agent_default_v1', description: 'Updated' }), routeCtx('fraud_check'))
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
    const res = await GetByName(makeRequestForAgent('agent_default_v1'), routeCtx('nonexistent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})
