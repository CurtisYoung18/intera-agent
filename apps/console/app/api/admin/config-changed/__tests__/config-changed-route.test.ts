// Route-level guard test for /api/admin/config-changed

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  clearConfigCacheCalls: [] as (string | undefined)[],
  markScenarioValidationChangedCalls: [] as string[][],
  mockGetSession: vi.fn(),
  agentConfigs: [
    { id: 'agent_default_v1', orgId: 'default' },
    { id: 'agent_support_v2', orgId: 'default' },
    { id: 'org_b_agent', orgId: 'org-b' },
  ],
}))

vi.mock('@/lib/agent/config-cache', () => ({
  clearConfigCache: vi.fn((orgId?: string) => {
    h.clearConfigCacheCalls.push(orgId)
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findMany: vi.fn(async () => h.agentConfigs.filter((config) => config.orgId === orgId)),
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          const config = h.agentConfigs.find((row) => row.id === id && row.orgId === orgId)
          return config ? { id: config.id } : null
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

vi.mock('@/lib/scenarios/store', () => ({
  markScenarioValidationChanged: vi.fn(async (ids: string[]) => {
    h.markScenarioValidationChangedCalls.push(ids)
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { POST } from '@/app/api/admin/config-changed/route'

function makeRequest(body?: unknown) {
  return { method: 'POST', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/config-changed') } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.clearConfigCacheCalls.length = 0
  h.markScenarioValidationChangedCalls.length = 0
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
})

describe('G1 — Uniform envelope', () => {
  it('POST returns ApiOk<{success}> envelope', async () => {
    const res = await POST(makeRequest({ orgId: 'default' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
    expect(body.data.validationMarked).toEqual(['agent_default_v1', 'agent_support_v2'])
    expect(h.markScenarioValidationChangedCalls[0]).toEqual(['agent_default_v1', 'agent_support_v2'])
  })

  it('POST with empty body still succeeds', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('POST can mark one owned agent config', async () => {
    const res = await POST(makeRequest({ agentConfigId: 'agent_default_v1' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(h.clearConfigCacheCalls).toEqual(['agent_default_v1'])
    expect(body.data.validationMarked).toEqual(['agent_default_v1'])
  })
})

describe('G2 — Tenant isolation', () => {
  it('POST rejects a foreign agentConfigId', async () => {
    const res = await POST(makeRequest({ agentConfigId: 'org_b_agent' }))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('Error codes', () => {
  it('returns 401 when no session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await POST(makeRequest({}))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })
})
