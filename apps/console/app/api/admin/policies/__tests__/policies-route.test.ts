// Legacy Policy admin API is retired by the Foundation Reset.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET, POST } from '@/app/api/admin/policies/route'
import { DELETE, GET as GetByName, PUT } from '@/app/api/admin/policies/[name]/route'

function makeRequest(body?: unknown, method?: string) {
  return {
    method: method ?? (body ? 'POST' : 'GET'),
    json: async () => body ?? {},
    nextUrl: new URL('http://localhost/api/admin/policies?agentConfigId=agent_default_v1'),
  } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

async function expectGone(res: Response) {
  const body = await res.json()
  expect(body.ok).toBe(false)
  expect(body.error.code).toBe('not_found')
  expect(body.error.message).toContain('/api/admin/hooks')
  expect(res.status).toBe(410)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
})

describe('Policy API retirement', () => {
  it('GET /api/admin/policies returns 410 Gone', async () => {
    await expectGone(await GET(makeRequest()))
  })

  it('POST /api/admin/policies returns 410 Gone for admins', async () => {
    await expectGone(await POST(makeRequest({ agentConfigId: 'agent_default_v1', name: 'old_policy' })))
  })

  it('GET /api/admin/policies/[name] returns 410 Gone', async () => {
    await expectGone(await GetByName(makeRequest(), routeCtx('old_policy')))
  })

  it('PUT /api/admin/policies/[name] returns 410 Gone for admins', async () => {
    await expectGone(await PUT(makeRequest({ agentConfigId: 'agent_default_v1', description: 'x' }, 'PUT'), routeCtx('old_policy')))
  })

  it('DELETE /api/admin/policies/[name] returns 410 Gone for admins', async () => {
    await expectGone(await DELETE(makeRequest(undefined, 'DELETE'), routeCtx('old_policy')))
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
