// Route-level tests for /api/admin/api-keys — defineRoute migration.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/api-auth', () => ({ generateApiKey: vi.fn() }))
vi.mock('@intera/shared/prisma', () => {
  // Return mock model functions so scopedModel() wraps them correctly
  const mockModel = () => new Proxy({}, {
    get(_t: any, p: string) {
      if (typeof p === 'symbol') return undefined
      // Return a mock function for any method call
      return vi.fn().mockResolvedValue(p === 'findMany' ? [] : { id: 'mock-id', name: 'mock', prefix: 'intera_sk_', createdAt: new Date().toISOString() })
    },
  })
  const mockPrisma = new Proxy({}, {
    get(_t: any, p: string) {
      if (typeof p === 'symbol') return undefined
      return mockModel()
    },
  })
  return { prisma: mockPrisma }
})

import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateApiKey } from '@/lib/api-auth'
import { GET, POST } from '../route'

const mockGetSession = getSession as ReturnType<typeof vi.fn>
const mockGenerateKey = generateApiKey as ReturnType<typeof vi.fn>

function mkReq(url = 'http://localhost/api/admin/api-keys', opts?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest(new URL(url), {
    method: opts?.method ?? 'GET',
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/api-keys', () => {
  it('returns 401 without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(mkReq())
    expect(res.status).toBe(401)
  })

  it('returns keys list when authenticated', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
    const res = await GET(mkReq())
    // With mocked prisma, repo.apiKey.findMany returns undefined
    // but the route should not throw — it's wrapped by defineRoute
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

describe('POST /api/admin/api-keys', () => {
  it('returns 401 without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await POST(mkReq('http://localhost/api/admin/api-keys', { method: 'POST', body: {} }))
    expect(res.status).toBe(401)
  })

  it('returns 403 for viewer role (requireRole not met)', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'viewer' })
    const res = await POST(mkReq('http://localhost/api/admin/api-keys', { method: 'POST', body: {} }))
    expect(res.status).toBe(403)
  })

  it('creates key when admin (valid input)', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
    mockGenerateKey.mockReturnValue({
      plaintext: 'intera_sk_live_test123',
      hash: 'abc123hash',
      prefix: 'intera_sk_live_test',
    })
    const res = await POST(mkReq('http://localhost/api/admin/api-keys', {
      method: 'POST',
      body: { name: 'test-key' },
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.plaintext).toBe('intera_sk_live_test123')
  })

  it('rejects invalid body (name as array)', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
    const res = await POST(mkReq('http://localhost/api/admin/api-keys', {
      method: 'POST',
      body: { name: ['not', 'a', 'string'] },
    }))
    expect(res.status).toBe(400)
  })
})
