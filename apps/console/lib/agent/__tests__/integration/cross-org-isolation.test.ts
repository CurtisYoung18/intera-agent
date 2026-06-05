// Cross-org isolation guard test — proves /api/livechat/config
// never leaks sensitive data between orgs and anonymous writes are blocked.
//
// UPDATED for B1: the anonymous route is GET-only, returns only non-sensitive
// fields. PUT was moved to the gated /api/admin/livechat/config route.
// The old /api/livechat/groups is deprecated (returns 410).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const configs: Record<string, Record<string, unknown>> = {
    default: { orgId: 'default', botAccessToken: 'tok_def', licenseId: 'lic_def', webhookSecret: 'sec_def', showSkillStatus: true, enabled: true, region: 'dal' },
    orgB: { orgId: 'orgB', botAccessToken: 'tok_orgb', licenseId: 'lic_orgb', webhookSecret: 'sec_orgb', showSkillStatus: false, enabled: false, region: 'fra' },
  }
  return { configs }
})

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

// Mock prisma (Proxy so repoForOrg can access any model)
const noopModel = new Proxy({}, { get: () => vi.fn() })
vi.mock('@intera/shared/prisma', () => ({
  prisma: new Proxy({
    liveChatConfig: {
      findUnique: vi.fn(async ({ where }: { where: { orgId: string } }) =>
        h.configs[where.orgId] ?? null,
      ),
    },
    channelBinding: {
      findFirst: vi.fn(async () => null), // fall through to livechat_configs
    },
  }, {
    get(target, prop) { if (typeof prop === 'symbol') return undefined; return (target as any)[prop] ?? noopModel },
  }),
}))

import { GET as configGet } from '@/app/api/livechat/config/route'
import { GET as groupsGet } from '@/app/api/livechat/groups/route'

function makeRequest(orgId?: string) {
  const url = orgId
    ? `http://localhost/api/livechat/config?orgId=${orgId}`
    : 'http://localhost/api/livechat/config'
  return { nextUrl: new URL(url) } as any
}

function makeGroupsRequest(orgId?: string) {
  const url = orgId
    ? `http://localhost/api/livechat/groups?orgId=${orgId}`
    : 'http://localhost/api/livechat/groups'
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ════════════════════════════════════════════════════════════════
// B1: Anonymous config GET — non-sensitive fields only
// ════════════════════════════════════════════════════════════════
describe('Cross-org isolation — livechat config GET (B1 fix)', () => {
  it('returns only non-sensitive fields for default org', async () => {
    const res = await configGet(makeRequest('default'))
    const body = await res.json()

    expect(body.orgId).toBe('default')
    expect(body.enabled).toBe(true)
    expect(body.showSkillStatus).toBe(true)
    expect(body.region).toBe('dal')
    // B1: secrets are never exposed to anonymous callers
    expect(body.botAccessToken).toBeUndefined()
    expect(body.licenseId).toBeUndefined()
    expect(body.webhookSecret).toBeUndefined()
  })

  it('returns orgB config with non-sensitive fields only', async () => {
    const res = await configGet(makeRequest('orgB'))
    const body = await res.json()

    expect(body.orgId).toBe('orgB')
    expect(body.enabled).toBe(false)
    expect(body.showSkillStatus).toBe(false)
    expect(body.region).toBe('fra')
  })

  it('returns disabled=false for missing org', async () => {
    const res = await configGet(makeRequest('nonexistent'))
    const body = await res.json()

    expect(body.enabled).toBe(false)
    expect(body.showSkillStatus).toBe(true)
  })

  it('no PUT handler exists (B1: anonymous writes blocked)', async () => {
    const mod = await import('@/app/api/livechat/config/route')
    expect((mod as any).PUT).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// B1: Groups GET deprecated (returns 410)
// ════════════════════════════════════════════════════════════════
describe('Cross-org isolation — groups GET deprecated (B1 fix)', () => {
  it('returns 410 deprecated for groups', async () => {
    const res = await groupsGet(makeGroupsRequest('default'))
    const body = await res.json()

    expect(res.status).toBe(410)
    expect(body.deprecated).toBe(true)
  })
})
