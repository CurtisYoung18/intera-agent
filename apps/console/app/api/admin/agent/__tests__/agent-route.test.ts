import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@intera/shared/prisma', () => {
  const mockModel = () => new Proxy({}, {
    get(_t: any, p: string) {
      if (typeof p === 'symbol') return undefined
      return vi.fn().mockResolvedValue(p === 'findMany' ? [] : { id: 'cfg-1', model: 'claude', temperature: 0.5 })
    },
  })
  return { prisma: new Proxy({}, { get() { return mockModel() } }) }
})

import { getSession } from '@/lib/auth'
import { GET } from '../route'

const mockGetSession = getSession as any

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/agent', () => {
  it('returns 401 without session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/admin/agent'))
    expect(res.status).toBe(401)
  })

  it('returns config when authenticated', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
    const res = await GET(new NextRequest('http://localhost/api/admin/agent'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('parses agentId from query params', async () => {
    mockGetSession.mockResolvedValue({ userId: 'u1', orgId: 'acme', role: 'admin' })
    const res = await GET(new NextRequest('http://localhost/api/admin/agent?agentId=cfg-1'))
    expect(res.status).toBe(200)
  })
})
