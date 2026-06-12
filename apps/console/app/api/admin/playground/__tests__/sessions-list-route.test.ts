import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetActiveVendor: vi.fn(),
  mockCaseFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
  getActiveVendor: h.mockGetActiveVendor,
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg: () => ({
    orgId: 'org-1',
    raw: {
      case: { findMany: h.mockCaseFindMany },
    },
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET } from '@/app/api/admin/playground/sessions/route'

function makeRequest(url = 'http://localhost/api/admin/playground/sessions?configId=agent-1') {
  return {
    method: 'GET',
    nextUrl: new URL(url),
    json: async () => ({}),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'org-1', role: 'admin', userId: 'user-1' })
  h.mockGetActiveVendor.mockResolvedValue({ isAuthed: true, userId: 'user-1' })
  h.mockCaseFindMany.mockResolvedValue([])
})

describe('GET /api/admin/playground/sessions', () => {
  it('lists sessions only inside the current org, current vendor, and selected agent', async () => {
    const createdAt = new Date('2026-06-12T00:00:00.000Z')
    h.mockCaseFindMany.mockResolvedValue([
      {
        chatId: 'pg_agent-1_1_a',
        createdAt,
        messages: [{ content: 'hello from this account' }],
      },
    ])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.mockCaseFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        orgId: 'org-1',
        userId: 'user-1',
        type: 'playground',
        chatId: { startsWith: 'pg_agent-1_' },
      },
    }))
    expect(body.data.sessions).toEqual([
      {
        chatId: 'pg_agent-1_1_a',
        firstMessage: 'hello from this account',
        createdAt: createdAt.toISOString(),
      },
    ])
  })

  it('does not query playground cases when the active vendor has no user id', async () => {
    h.mockGetActiveVendor.mockResolvedValue({ isAuthed: true, userId: undefined })

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(h.mockCaseFindMany).not.toHaveBeenCalled()
    expect(body.data.sessions).toEqual([])
  })
})
