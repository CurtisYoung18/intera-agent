// Route-level guard test for /api/admin/config-changed

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  clearConfigCacheCalls: [] as (string | undefined)[],
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/agent/config-cache', () => ({
  clearConfigCache: vi.fn((orgId?: string) => {
    h.clearConfigCacheCalls.push(orgId)
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
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
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
})

describe('G1 — Uniform envelope', () => {
  it('POST returns ApiOk<{success}> envelope', async () => {
    const res = await POST(makeRequest({ orgId: 'default' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  it('POST with empty body still succeeds', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()
    expect(body.ok).toBe(true)
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
