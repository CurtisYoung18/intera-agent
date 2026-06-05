import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@intera/shared/prisma', () => {
  const mockModel = () => new Proxy({}, {
    get(_t: any, p: string) {
      if (typeof p === 'symbol') return undefined
      return vi.fn().mockResolvedValue([])
    },
  })
  return { prisma: new Proxy({}, { get() { return mockModel() } }) }
})

import { getSession } from '@/lib/auth'
import { POST } from '../test/route'

const mockGetSession = getSession as any

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/knowledge/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('POST /api/admin/knowledge/test', () => {
  it('returns 401 without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await POST(mkReq({ query: 'test' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when query is missing', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
    const res = await POST(mkReq({}) as any)
    expect(res.status).toBe(400)
  })
})
