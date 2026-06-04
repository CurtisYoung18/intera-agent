import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@intera/shared/prisma', () => {
  const mockModel = () => new Proxy({}, {
    get(_t: any, p: string) {
      if (typeof p === 'symbol') return undefined
      return vi.fn().mockResolvedValue(p === 'findMany' ? [] : { id: 'mock-id', name: 'mock', prefix: 'intera_sk_', createdAt: new Date().toISOString() })
    },
  })
  return { prisma: new Proxy({}, { get() { return mockModel() } }) }
})

import { getSession } from '@/lib/auth'
import { DELETE } from '../[id]/route'

const mockGetSession = getSession as any

function mkReq(opts?: { method?: string }) {
  return new Request('http://localhost/api/admin/api-keys/k1', { method: opts?.method ?? 'DELETE' }) as any
}

beforeEach(() => { vi.clearAllMocks() })

describe('DELETE /api/admin/api-keys/[id]', () => {
  it('returns 401 without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await DELETE(mkReq(), { params: Promise.resolve({ id: 'k1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 403 for viewer role', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'viewer' })
    const res = await DELETE(mkReq(), { params: Promise.resolve({ id: 'k1' }) })
    expect(res.status).toBe(403)
  })

  it('revokes key when admin', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
    const res = await DELETE(mkReq(), { params: Promise.resolve({ id: 'k1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
