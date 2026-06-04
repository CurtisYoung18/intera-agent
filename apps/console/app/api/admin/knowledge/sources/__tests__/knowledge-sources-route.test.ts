// Route-level guard test for /api/admin/knowledge/sources

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const sourcesByOrg: Record<string, Record<string, unknown>[]> = {
    default: [
      { id: 'ks1', orgId: 'default', name: 'deposit_faq', description: 'Deposit FAQ', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 15, rerankVersion: 'BGE-Rerank', docCorrelation: 0.3, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      { id: 'ks2', orgId: 'default', name: 'withdraw_guide', description: 'Withdraw guide', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 10, rerankVersion: null, docCorrelation: 0.3, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
    orgB: [
      { id: 'ks3', orgId: 'orgB', name: 'org_b_source', description: 'Org B only', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 5, rerankVersion: null, docCorrelation: 0.3, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const mockGetSession = vi.fn()

  return { sourcesByOrg, mockGetSession }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const sources = h.sourcesByOrg[orgId] ?? []
    return {
      orgId,
      knowledgeSource: {
        findMany: vi.fn(async () => sources),
        findFirst: vi.fn(async (args: any) => {
          const id = args?.where?.id
          return sources.find((s) => s.id === id) ?? null
        }),
        create: vi.fn(async (args: any) => {
          const source = { id: `ks_new_${Date.now()}`, ...args.data, orgId, createdAt: new Date(), updatedAt: new Date() }
          if (!h.sourcesByOrg[orgId]) h.sourcesByOrg[orgId] = []
          h.sourcesByOrg[orgId].push(source)
          return source
        }),
        updateMany: vi.fn(async (args: any) => {
          const id = args.where.id
          const source = sources.find((s) => s.id === id)
          if (source) {
            Object.assign(source, args.data)
            return { count: 1 }
          }
          return { count: 0 }
        }),
        deleteMany: vi.fn(async (args: any) => {
          const id = args.where.id
          const idx = sources.findIndex((s) => s.id === id)
          if (idx === -1) return { count: 0 }
          sources.splice(idx, 1)
          return { count: 1 }
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

import { GET, POST } from '@/app/api/admin/knowledge/sources/route'
import { GET as GetById, PUT, DELETE } from '@/app/api/admin/knowledge/sources/[id]/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/knowledge/sources') } as any
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
  h.sourcesByOrg.default = [
    { id: 'ks1', orgId: 'default', name: 'deposit_faq', description: 'Deposit FAQ', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 15, rerankVersion: 'BGE-Rerank', docCorrelation: 0.3, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
    { id: 'ks2', orgId: 'default', name: 'withdraw_guide', description: 'Withdraw guide', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 10, rerankVersion: null, docCorrelation: 0.3, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.sourcesByOrg.orgB = [
    { id: 'ks3', orgId: 'orgB', name: 'org_b_source', description: 'Org B only', groupIds: '[]', dataIds: null, embeddingRate: 0.9, topK: 5, rerankVersion: null, docCorrelation: 0.3, caseTypeTag: null, enabled: true, createdAt: new Date(), updatedAt: new Date() },
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
    const res = await POST(makeRequest({ name: 'new_source', groupIds: ['g1'] }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.source.name).toBe('new_source')
    expect(res.status).toBe(201)
  })
})

describe('G2 — Tenant isolation', () => {
  it('org default only sees its own sources', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data.sources.length).toBe(2)
    expect(body.data.sources.every((s: any) => s.orgId === 'default')).toBe(true)
  })

  it('org A CANNOT see org B source by id', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GetById(makeRequest(), routeCtx('ks3'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Mutations', () => {
  it('DELETE removes source and returns ok', async () => {
    const res = await DELETE(makeRequest(), routeCtx('ks2'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.ok).toBe(true)
  })

  it('PUT updates source', async () => {
    const res = await PUT(makeRequest({ description: 'Updated' }), routeCtx('ks1'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.source.description).toBe('Updated')
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
    const res = await GetById(makeRequest(), routeCtx('nonexistent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})
