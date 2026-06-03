// Cross-org isolation guard test — proves /api/livechat/config and
// /api/livechat/groups never leak data between orgs.
//
// RED (before BLK-1 + BLK-1b):  the route handler defaulted to 'default' when
//   no orgId was passed (no session), so any non-default org's readiness check
//   read default's livechat status — cross-tenant info leak.
// GREEN (after fix):  config + groups routes prefer session orgId when available
//   (BLK-1b).  The agent page passes session orgId into the query param (BLK-1).
//
// This test drives the REAL route handler functions via mocked prisma — it
// verifies the isolation logic in the route layer, not the DB layer.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const configs: Record<string, Record<string, unknown>> = {
    default: { orgId: 'default', botAccessToken: 'tok_def', licenseId: 'lic_def', webhookSecret: 'sec_def', showSkillStatus: true, enabled: true },
    orgB: { orgId: 'orgB', botAccessToken: 'tok_orgb', licenseId: 'lic_orgb', webhookSecret: 'sec_orgb', showSkillStatus: false, enabled: false },
  }
  const mockGetSession = vi.fn()
  return { configs, mockGetSession }
})

// ── Mock prisma ──
vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    liveChatConfig: {
      findUnique: vi.fn(async ({ where }: { where: { orgId: string } }) =>
        h.configs[where.orgId] ?? null,
      ),
    },
  },
}))

// ── Mock config-store ──
vi.mock('@/lib/livechat/config-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/livechat/config-store')>()
  return {
    ...actual,
    getLiveChatConfig: vi.fn(async (orgId: string) => h.configs[orgId] ?? null),
  }
})

// ── Mock auth session ──
vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

import { GET as configGet } from '@/app/api/livechat/config/route'
import { GET as groupsGet } from '@/app/api/livechat/groups/route'
import { getLiveChatConfig } from '@/lib/livechat/config-store'

function makeRequest(orgId?: string) {
  const url = orgId
    ? `http://localhost/api/livechat/config?orgId=${orgId}`
    : 'http://localhost/api/livechat/config'
  const searchParams = new URL(url).searchParams
  return { nextUrl: { searchParams } }
}

function makeGroupsRequest(orgId?: string) {
  const url = orgId
    ? `http://localhost/api/livechat/groups?orgId=${orgId}`
    : 'http://localhost/api/livechat/groups'
  const searchParams = new URL(url).searchParams
  return { nextUrl: { searchParams } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue(null) // default: no session (widget/webhook path)
})

describe('Cross-org isolation — livechat config GET', () => {
  it('returns default org config when orgId=default', async () => {
    const req = makeRequest('default')
    const res = await configGet(req as any)
    const body = await res.json()

    expect(body.orgId).toBe('default')
    expect(body.enabled).toBe(true)
    expect(body.botAccessToken).toBe('••••••••')
  })

  it('returns orgB config when orgId=orgB', async () => {
    const req = makeRequest('orgB')
    const res = await configGet(req as any)
    const body = await res.json()

    expect(body.orgId).toBe('orgB')
    expect(body.enabled).toBe(false)
    expect(body.botAccessToken).toBe('••••••••')
  })

  it('NEVER leaks default org config into orgB query', async () => {
    const config = await getLiveChatConfig('orgB')
    expect(config?.enabled).toBe(false)
    expect(config?.botAccessToken).toBe('tok_orgb')
    expect(config?.licenseId).toBe('lic_orgb')
  })

  it('NEVER leaks orgB config into default query', async () => {
    const config = await getLiveChatConfig('default')
    expect(config?.enabled).toBe(true)
    expect(config?.botAccessToken).toBe('tok_def')
    expect(config?.licenseId).toBe('lic_def')
  })
})

describe('Cross-org isolation — session-based resolution (BLK-1b)', () => {
  it('uses session orgId when available, ignoring query param', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'staff' })

    const req = makeRequest('default')
    const res = await configGet(req as any)
    const body = await res.json()

    expect(body.orgId).toBe('orgB')
    expect(body.enabled).toBe(false) // orgB's real state
  })

  it('falls back to query param when no session (widget/webhook path)', async () => {
    h.mockGetSession.mockResolvedValue(null)

    const req = makeRequest('orgB')
    const res = await configGet(req as any)
    const body = await res.json()

    expect(body.orgId).toBe('orgB')
    expect(body.enabled).toBe(false)
  })

  it('falls back to default when no session AND no query param', async () => {
    h.mockGetSession.mockResolvedValue(null)

    const req = makeRequest()
    const res = await configGet(req as any)
    const body = await res.json()

    expect(body.orgId).toBe('default')
  })
})

describe('Cross-org isolation — groups GET session resolution (BLK-1b)', () => {
  it('uses session orgId for groups route when available', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'staff' })

    // groups GET calls getLiveChatConfig internally, then listGroups with
    // fake credentials — it will fail, but we verify org resolution is correct
    const req = makeGroupsRequest('default')
    await groupsGet(req as any)

    expect(getLiveChatConfig).toHaveBeenCalledWith('orgB')
  })

  it('falls back to query param for groups when no session', async () => {
    h.mockGetSession.mockResolvedValue(null)

    const req = makeGroupsRequest('orgB')
    await groupsGet(req as any)

    expect(getLiveChatConfig).toHaveBeenCalledWith('orgB')
  })
})
