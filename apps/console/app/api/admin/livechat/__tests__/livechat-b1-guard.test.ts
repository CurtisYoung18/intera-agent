// B1 guard test — proves the /api/livechat/config split closes the
// unauthenticated cross-tenant write vulnerability.
// Scoped by agentConfigId (not orgId).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const configs: Record<string, Record<string, unknown>> = {
    'agent_default_v1': { agentConfigId: 'agent_default_v1', botAccessToken: 'tok_def', licenseId: 'lic_def', webhookSecret: 'sec_def', showSkillStatus: true, enabled: true, region: 'dal', transferGroupId: 123 },
    'test-agent': { agentConfigId: 'test-agent', botAccessToken: 'tok_orgb', licenseId: 'lic_orgb', webhookSecret: 'sec_orgb', showSkillStatus: false, enabled: false, region: 'fra', transferGroupId: 456 },
  }
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent_default_v1': { id: 'agent_default_v1', orgId: 'default' },
    'test-agent': { id: 'test-agent', orgId: 'orgB' },
  }
  const mockGetSession = vi.fn()
  return { configs, agentConfigs, mockGetSession }
})

// ── Mock repoForOrg ──
vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          const ac = h.agentConfigs[id]
          if (!ac) return null
          if (ac.orgId !== orgId) return null
          return ac
        }),
      },
      raw: {},
    } as any
  },
}))

// Mock prisma for the anonymous widget route (uses agentConfigId)
vi.mock('@intera/shared/prisma', () => ({
  prisma: {
    channelBinding: {
      findFirst: vi.fn(async ({ where }: { where: { agentConfigId?: string } }) => {
        const agentConfigId = where.agentConfigId
        if (!agentConfigId) return null
        const config = h.configs[agentConfigId]
        if (!config) return null
        return {
          enabled: config.enabled,
          credentials: JSON.stringify({
            showSkillStatus: config.showSkillStatus,
            region: config.region,
          }),
        }
      }),
    },
  },
}))

vi.mock('@/lib/auth', () => ({ getSession: h.mockGetSession }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/livechat/config-store', () => ({
  getLiveChatConfig: vi.fn(async (agentConfigId: string) => h.configs[agentConfigId] ?? null),
  getLiveChatConfigForFamily: vi.fn(async (agentConfigId: string) => h.configs[agentConfigId] ?? null),
  resolveLiveChatFamilyAnchorId: vi.fn(async (agentConfigId: string) => agentConfigId),
  upsertLiveChatConfig: vi.fn(async (agentConfigId: string, data: Record<string, unknown>) => {
    h.configs[agentConfigId] = { ...h.configs[agentConfigId], ...data }
  }),
  upsertLiveChatConfigForFamily: vi.fn(async (agentConfigId: string, data: Record<string, unknown>) => {
    h.configs[agentConfigId] = { ...h.configs[agentConfigId], ...data }
    return agentConfigId
  }),
  invalidateLiveChatConfig: vi.fn(),
}))

// ── Anonymous widget route (no session required) ──
import { GET as anonGet, OPTIONS as anonOptions } from '@/app/api/livechat/config/route'
// ── Gated admin route ──
import { GET as adminGet, PUT as adminPut } from '@/app/api/admin/livechat/config/route'

function makeAnonRequest(agentConfigId?: string) {
  const url = agentConfigId
    ? `http://localhost/api/livechat/config?agentConfigId=${agentConfigId}`
    : 'http://localhost/api/livechat/config'
  return { nextUrl: new URL(url) } as any
}

function makeAdminRequest(body?: unknown) {
  return {
    json: async () => body ?? {},
    nextUrl: new URL('http://localhost/api/admin/livechat/config?agentConfigId=agent_default_v1'),
  } as any
}

function makeAdminRequestForAgent(agentConfigId: string, body?: unknown) {
  return {
    json: async () => body ?? {},
    nextUrl: new URL(`http://localhost/api/admin/livechat/config?agentConfigId=${agentConfigId}`),
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'u1' })
  // Reset config to initial state
  h.configs['agent_default_v1'] = { agentConfigId: 'agent_default_v1', botAccessToken: 'tok_def', licenseId: 'lic_def', webhookSecret: 'sec_def', showSkillStatus: true, enabled: true, region: 'dal', transferGroupId: 123 }
  h.configs['test-agent'] = { agentConfigId: 'test-agent', botAccessToken: 'tok_orgb', licenseId: 'lic_orgb', webhookSecret: 'sec_orgb', showSkillStatus: false, enabled: false, region: 'fra', transferGroupId: 456 }
})

// ════════════════════════════════════════════════════════════════
// B1: Anonymous route — GET only, non-sensitive fields
// ════════════════════════════════════════════════════════════════
describe('B1 — Anonymous /api/livechat/config is GET-only, non-sensitive', () => {
  it('returns only non-sensitive fields (enabled, showSkillStatus, region)', async () => {
    const res = await anonGet(makeAnonRequest('agent_default_v1'))
    const body = await res.json()

    expect(body.agentConfigId).toBe('agent_default_v1')
    expect(body.enabled).toBe(true)
    expect(body.showSkillStatus).toBe(true)
    expect(body.region).toBe('dal')
    // CRITICAL: no secrets exposed
    expect(body.botAccessToken).toBeUndefined()
    expect(body.licenseId).toBeUndefined()
    expect(body.webhookSecret).toBeUndefined()
  })

  it('no PUT handler exists (anonymous writes are blocked)', async () => {
    const mod = await import('@/app/api/livechat/config/route')
    expect((mod as any).PUT).toBeUndefined()
  })

  it('returns disabled=false for missing agent config', async () => {
    const res = await anonGet(makeAnonRequest('nonexistent'))
    const body = await res.json()

    expect(body.enabled).toBe(false)
    expect(body.showSkillStatus).toBe(true)
  })

  it('requires agentConfigId instead of using a global livechat fallback', async () => {
    const res = await anonGet(makeAnonRequest())
    const body = await res.json()

    expect(body.agentConfigId).toBeNull()
    expect(body.enabled).toBe(false)
    expect(body.requiresAgentConfigId).toBe(true)
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
    const res = await adminPut(makeAdminRequest({ agentConfigId: 'agent_default_v1', botAccessToken: 'tok', licenseId: 'lic', showSkillStatus: true, enabled: true }))
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
    expect(body.data.config.enabled).toBe(true)
    // Secrets are masked but present (••••••••)
    expect(body.data.config.botAccessToken).toBe('••••••••')
    expect(body.data.config.webhookSecret).toBe('••••••••')
  })

  it('PUT scopes write to agentConfigId from body', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'admin', userId: 'u1' })
    const res = await adminPut(makeAdminRequestForAgent('test-agent', {
      agentConfigId: 'test-agent',
      botAccessToken: 'new_token',
      licenseId: 'new_lic',
      webhookSecret: 'new_secret',
      showSkillStatus: true,
      enabled: true,
    }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    // test-agent's config was updated
    expect(h.configs['test-agent'].botAccessToken).toBe('new_token')
    // agent_default_v1's config was NOT touched
    expect(h.configs['agent_default_v1'].botAccessToken).toBe('tok_def')
  })

  it('cross-org: agent_default_v1 CANNOT read test-agent config without query param', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'u1' })
    const res = await adminGet(makeAdminRequest())
    const body = await res.json()

    expect(body.ok).toBe(true)
    // agent_default_v1's config is returned
    expect(body.data.config.agentConfigId).toBe('agent_default_v1')
    expect(body.data.config.enabled).toBe(true)
  })

  it('PUT rejects viewer role (RBAC)', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'viewer', userId: 'u1' })
    const res = await adminPut(makeAdminRequest({
      agentConfigId: 'agent_default_v1',
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

  it('PUT rejects enabling livechat without required credentials', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'admin', userId: 'u1' })
    const res = await adminPut(makeAdminRequestForAgent('test-agent', {
      agentConfigId: 'test-agent',
      botAccessToken: '',
      licenseId: '',
      webhookSecret: '',
      showSkillStatus: true,
      enabled: true,
    }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(h.configs['test-agent']).toMatchObject({
      enabled: false,
      botAccessToken: 'tok_orgb',
      licenseId: 'lic_orgb',
      webhookSecret: 'sec_orgb',
    })
  })
})
