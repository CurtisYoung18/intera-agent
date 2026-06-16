// Route-level guard test for /api/admin/knowledge/sources
// Scoped by agentConfigId (not orgId).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const sourcesByAgent: Record<string, Record<string, unknown>[]> = {
    'agent_default_v1': [
      { id: 'ks1', agentConfigId: 'agent_default_v1', name: 'deposit_faq', description: 'Deposit FAQ', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 15, rerankVersion: 'BGE-Rerank', docCorrelation: 0.3, modelControlTopK: false, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      { id: 'ks2', agentConfigId: 'agent_default_v1', name: 'withdraw_guide', description: 'Withdraw guide', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 10, rerankVersion: null, docCorrelation: 0.3, modelControlTopK: false, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
    'test-agent': [
      { id: 'ks3', agentConfigId: 'test-agent', name: 'org_b_source', description: 'Test agent only', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 5, rerankVersion: null, docCorrelation: 0.3, modelControlTopK: false, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent_default_v1': { id: 'agent_default_v1', orgId: 'default' },
    'test-agent': { id: 'test-agent', orgId: 'test-org' },
  }
  const mockGetSession = vi.fn()

  return { sourcesByAgent, agentConfigs, mockGetSession }
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
        knowledgeSource: {
          findMany: vi.fn(async (args?: any) => {
            const where = args?.where || {}
            const agentConfigId = where.agentConfigId as string | undefined
            return agentConfigId ? (h.sourcesByAgent[agentConfigId] ?? []) : []
          }),
          findFirst: vi.fn(async (args: any) => {
            const id = args?.where?.id
            const agentConfigId = args?.where?.agentConfigId
            if (agentConfigId) {
              return (h.sourcesByAgent[agentConfigId] ?? []).find((s: any) => s.id === id) ?? null
            }
            // Fallback: search all
            for (const arr of Object.values(h.sourcesByAgent)) {
              const found = arr.find((s: any) => s.id === id)
              if (found) return found
            }
            return null
          }),
          create: vi.fn(async (args: any) => {
            const source = { id: `ks_new_${Date.now()}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
            const ac = args.data.agentConfigId
            if (!h.sourcesByAgent[ac]) h.sourcesByAgent[ac] = []
            h.sourcesByAgent[ac].push(source)
            return source
          }),
          updateMany: vi.fn(async (args: any) => {
            const { id, agentConfigId } = args.where
            const sources = h.sourcesByAgent[agentConfigId] ?? []
            const source = sources.find((s: any) => s.id === id)
            if (source) {
              Object.assign(source, args.data)
              return { count: 1 }
            }
            return { count: 0 }
          }),
          deleteMany: vi.fn(async (args: any) => {
            const { id, agentConfigId } = args.where
            const sources = h.sourcesByAgent[agentConfigId] ?? []
            const idx = sources.findIndex((s: any) => s.id === id)
            if (idx === -1) return { count: 0 }
            sources.splice(idx, 1)
            return { count: 1 }
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

import { GET, POST } from '@/app/api/admin/knowledge/sources/route'
import { GET as GetById, PUT, DELETE } from '@/app/api/admin/knowledge/sources/[id]/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/knowledge/sources?agentConfigId=agent_default_v1') } as any
}

function makeRequestForAgent(agentConfigId: string, body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL(`http://localhost/api/admin/knowledge/sources?agentConfigId=${agentConfigId}`) } as any
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
  h.sourcesByAgent['agent_default_v1'] = [
    { id: 'ks1', agentConfigId: 'agent_default_v1', name: 'deposit_faq', description: 'Deposit FAQ', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 15, rerankVersion: 'BGE-Rerank', docCorrelation: 0.3, modelControlTopK: false, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'ks2', agentConfigId: 'agent_default_v1', name: 'withdraw_guide', description: 'Withdraw guide', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 10, rerankVersion: null, docCorrelation: 0.3, modelControlTopK: false, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.sourcesByAgent['test-agent'] = [
    { id: 'ks3', agentConfigId: 'test-agent', name: 'org_b_source', description: 'Test agent only', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 5, rerankVersion: null, docCorrelation: 0.3, modelControlTopK: false, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
})

describe('G1 — Uniform envelope', () => {
  it('GET returns ApiOk<{sources}> envelope', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.sources)).toBe(true)
  })

  it('POST with empty body returns validation error (400)', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(res.status).toBe(400)
  })

  it('POST with valid input returns ApiOk<{source}> (201)', async () => {
    const res = await POST(makeRequest({ agentConfigId: 'agent_default_v1', name: 'new_source', groupIds: ['g1'], modelControlTopK: true }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.source.name).toBe('new_source')
    expect(body.data.source.modelControlTopK).toBe(true)
    expect(res.status).toBe(201)
  })

  it('POST rejects sources without bound knowledge bases', async () => {
    const res = await POST(makeRequest({ agentConfigId: 'agent_default_v1', name: 'empty_source', groupIds: [] }))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(body.error.fields.groupIds).toBe('Select at least one knowledge base')
    expect(res.status).toBe(400)
  })
})

describe('G2 — Tenant isolation', () => {
  it('agent_default_v1 only sees its own sources', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GET(makeRequestForAgent('agent_default_v1'))
    const body = await res.json()
    expect(body.data.sources.length).toBe(2)
    expect(body.data.sources.every((s: any) => s.agentConfigId === 'agent_default_v1')).toBe(true)
  })

  it('agent_default_v1 CANNOT see test-agent source by id', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GetById(makeRequestForAgent('agent_default_v1'), routeCtx('ks3'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Mutations', () => {
  it('DELETE removes source and returns ok', async () => {
    const res = await DELETE(makeRequestForAgent('agent_default_v1'), routeCtx('ks2'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.ok).toBe(true)
  })

  it('PUT updates source', async () => {
    const res = await PUT(makeRequestForAgent('agent_default_v1', { agentConfigId: 'agent_default_v1', description: 'Updated', modelControlTopK: true }), routeCtx('ks1'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.source.description).toBe('Updated')
    expect(body.data.source.modelControlTopK).toBe(true)
  })

  it('PUT rejects clearing all bound knowledge bases', async () => {
    const res = await PUT(makeRequestForAgent('agent_default_v1', { agentConfigId: 'agent_default_v1', groupIds: [] }), routeCtx('ks1'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(body.error.fields.groupIds).toBe('Select at least one knowledge base')
    expect(res.status).toBe(400)
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

  it('returns 404 for non-existent source', async () => {
    const res = await GetById(makeRequestForAgent('agent_default_v1'), routeCtx('nonexistent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})
