// Route-level guard test for /api/admin/models
// Note: the route imports from @intera/shared/prisma as a side-effect for env loading.
// This import runs before vitest mocks, so the test covers the real route with real env.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '@/app/api/admin/models/route'

function makeRequest() {
  return { method: 'GET', json: async () => ({}), nextUrl: new URL('http://localhost/api/admin/models') } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
})

describe('G1 — Uniform envelope', () => {
  it('GET returns ApiOk<{models}> envelope', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.models)).toBe(true)
    // Environment variables may not be set in tests, so models may be empty
  })

  it('GET response has correct envelope shape', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body).toHaveProperty('ok')
    expect(body).toHaveProperty('data')
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
})
