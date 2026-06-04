// B1 guard test — proves the /api/livechat/config split closes the
// unauthenticated cross-tenant write vulnerability.
//
// RED (before B1 fix):
//   - Anonymous PUT to /api/livechat/config took orgId from request BODY
//     with NO session check → anyone could overwrite any org's LiveChat config.
//   - Anonymous GET leaked secrets/metadata (botAccessToken mask, enabled status).
//
// GREEN (after B1 fix):
//   - Anonymous /api/livechat/config is GET-only, returns only non-sensitive
//     fields (enabled, showSkillStatus, region). No PUT, no secrets.
//   - Gated /api/admin/livechat/config requires verified session (401 without).
//   - Gated GET returns full config (secrets masked). Gated PUT scopes to
//     session orgId. Cross-org isolation: org A cannot read/write org B.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const configs: Record<string, Record<string, unknown>> = {
    default: { orgId: 'default', botAccessToken: 'tok_def', licenseId: 'lic_def', webhookSecret: 'sec_def', showSkillStatus: true, enabled: true, region: 'dal', transferGroupId: 123 },
    orgB: { orgId: 'orgB', botAccessToken: 'tok_orgb', licenseId: 'lic_orgb', webhookSecret: 'sec_orgb', showSkillStatus: false, enabled: false, region: 'fra', transferGroupId: 456 },
  }
  const mockGetSession = vi.fn()
  return { configs, mockGetSession }
})

// ── Mock repoForOrg (same pattern as skills-route.test.ts) ──
vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const config = h.configs[orgId]
    return {
      orgId,
      liveChatConfig: {
        findUnique: vi.fn(async () => config),
        upsert: vi.fn(async (args: any) => {
          h.configs[orgId] = { ...h.configs[orgId], ...args.create, ...args.update }
          return h.configs[orgId]
        }),
      },
      raw: {
        liveChatConfig: {
          findUnique: vi.fn(async (args: any) => h.configs[args.where.orgId] ?? null),
        },
      },
    } as any
  },
}))

// Mock prisma for the anonymous widget route (doesn't use repoForOrg)
vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    liveChatConfig: {
      findUnique: vi.fn(async ({ where }: { where: { orgId: string } }) => {
        return h.configs[where.orgId] ?? null
      }),
    },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: h.mockGetSession }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/livechat/config-store', () => ({
  getLiveChatConfig: vi.fn(async (orgId: string) => h.configs[orgId] ?? null),
  invalidateLiveChatConfig: vi.fn(),
}))

// ── Anonymous widget route (no session required) ──
import { GET as anonGet, OPTIONS as anonOptions } from '@/app/api/livechat/config/route'
// ── Gated admin route ──
import { GET as adminGet, PUT as adminPut } from '@/app/api/admin/livechat/config/route'

function makeAnonRequest(orgId?: string) {
  const url = orgId
    ? `http://localhost/api/livechat/config?orgId=${orgId}`
    : 'http://localhost/api/livechat/config'
  return { nextUrl: new URL(url) } as any
}

function makeAdminRequest(body?: unknown) {
  return {
    json: async () => body ?? {},
    nextUrl: new URL('http://localhost/api/admin/livechat/config'),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'u1' })
  // Reset config to initial state
  h.configs.default = { orgId: 'default', botAccessToken: 'tok_def', licenseId: 'lic_def', webhookSecret: 'sec_def', showSkillStatus: true, enabled: true, region: 'dal', transferGroupId: 123 }
  h.configs.orgB = { orgId: 'orgB', botAccessToken: 'tok_orgb', licenseId: 'lic_orgb', webhookSecret: 'sec_orgb', showSkillStatus: false, enabled: false, region: 'fra', transferGroupId: 456 }
})

// ════════════════════════════════════════════════════════════════
// B1: Anonymous route — GET only, non-sensitive fields
// ════════════════════════════════════════════════════════════════
describe('B1 — Anonymous /api/livechat/config is GET-only, non-sensitive', () => {
  it('returns only non-sensitive fields (enabled, showSkillStatus, region)', async () => {
    const res = await anonGet(makeAnonRequest('default'))
    const body = await res.json()

    expect(body.orgId).toBe('default')
    expect(body.enabled).toBe(true)
    expect(body.showSkillStatus).toBe(true)
    expect(body.region).toBe('dal')
    // CRITICAL: no secrets exposed
    expect(body.botAccessToken).toBeUndefined()
    expect(body.licenseId).toBeUndefined()
    expect(body.webhookSecret).toBeUndefined()
    expect(body.transferGroupId).toBeUndefined()
    expect(body.transferMessage).toBeUndefined()
  })

  it('no PUT handler exists (anonymous writes are blocked)', async () => {
    // The anonymous route no longer exports PUT
    const mod = await import('@/app/api/livechat/config/route')
    expect((mod as any).PUT).toBeUndefined()
  })

  it('returns disabled=false for missing org', async () => {
    const res = await anonGet(makeAnonRequest('nonexistent'))
    const body = await res.json()

    expect(body.enabled).toBe(false)
    expect(body.showSkillStatus).toBe(true)
  })

  it('OPTIONS returns CORS headers', async () => {
    const res = await anonOptions()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

// ════════════════════════════════════════════════════════════════
// B1: Gated admin route — session required, cross-org isolation
// ════════════════════════════════════════════════════════════════
describe('B1 — Gated /api/admin/livechat/config requires session', () => {
  it('GET returns 401 without session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await adminGet(makeAdminRequest())
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })

  it('PUT returns 401 without session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await adminPut(makeAdminRequest({ botAccessToken: 'tok', licenseId: 'lic', showSkillStatus: true, enabled: true }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })

  it('GET returns full config with masked secrets for authenticated admin', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'u1' })
    const res = await adminGet(makeAdminRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.config.orgId).toBe('default')
    expect(body.data.config.enabled).toBe(true)
    // Secrets are masked but present (••••••••)
    expect(body.data.config.botAccessToken).toBe('••••••••')
    expect(body.data.config.webhookSecret).toBe('••••••••')
  })

  it('PUT scopes write to session orgId (orgId from body is ignored)', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'admin', userId: 'u1' })
    const res = await adminPut(makeAdminRequest({
      botAccessToken: 'new_token',
      licenseId: 'new_lic',
      showSkillStatus: true,
      enabled: true,
    }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    // orgB's config was updated (NOT default's config)
    expect(h.configs.orgB.botAccessToken).toBe('new_token')
    // default's config was NOT touched
    expect(h.configs.default.botAccessToken).toBe('tok_def')
  })

  it('cross-org: session for org A CANNOT read org B config', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'u1' })
    const res = await adminGet(makeAdminRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    // Session is for 'default', so config returned is default's
    expect(body.data.config.orgId).toBe('default')
    expect(body.data.config.enabled).toBe(true)
    // orgB's config is NOT returned (no cross-org leak)
  })

  it('PUT rejects viewer role (RBAC)', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'viewer', userId: 'u1' })
    const res = await adminPut(makeAdminRequest({
      botAccessToken: 'tok',
      licenseId: 'lic',
      showSkillStatus: true,
      enabled: true,
    }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('forbidden')
  })

  it('PUT validation rejects missing required fields', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'u1' })
    const res = await adminPut(makeAdminRequest({}))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
  })
})
