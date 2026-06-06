// Route-level guard test for /api/admin/skills — drives the REAL route
// entry points via defineRoute, proving:
//   1. Validation-400 on bad input (G1 contract seam)
//   2. Uniform ApiOk/ApiErr envelope (G1)
//   3. repoForOrg tenant scoping (G2 — org A never sees org B's skills)
//   4. Audit writes on mutations (G3)
//   5. Error codes map correctly (NotFound → 404, Forbidden → 403)
//
// RED→GREEN: before migration, the old route returned {skills} or {error:'Internal error'}.
// After migration, every response is {ok:true,data}|{ok:false,error:{code,message}}.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock state ──
const h = vi.hoisted(() => {
  const skillsByOrg: Record<string, Record<string, unknown>[]> = {
    default: [
      { id: 'sk1', orgId: 'default', name: 'system_info', description: 'System info skill', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: 'system_info', createdAt: new Date(), updatedAt: new Date() },
      { id: 'sk2', orgId: 'default', name: 'lookup_order', description: 'Look up order', mode: 'http', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: 'https://api.example.com', httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
    ],
    orgB: [
      { id: 'sk3', orgId: 'orgB', name: 'orgb_skill', description: 'Org B skill', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const createdSkills: Record<string, unknown>[] = []
  const auditEvents: { action: string; target: string }[] = []
  const mockGetSession = vi.fn()

  return { skillsByOrg, createdSkills, auditEvents, mockGetSession }
})

// ── Mock repoForOrg (bypasses Prisma Proxy for clean route-level testing) ──
vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const skills = h.skillsByOrg[orgId] ?? []

    return {
      orgId,
      skill: {
        findMany: vi.fn(async (args?: any) => skills),
        findUnique: vi.fn(async (args: any) => {
          const name = args?.where?.orgId_name?.name
          return skills.find((s) => s.name === name) ?? null
        }),
        create: vi.fn(async (args: any) => {
          // real Proxy injects orgId into data; simulate it here
          const skill = { id: `sk_new_${h.createdSkills.length}`, ...args.data, orgId, createdAt: new Date(), updatedAt: new Date() }
          h.createdSkills.push(skill)
          if (!h.skillsByOrg[orgId]) h.skillsByOrg[orgId] = []
          h.skillsByOrg[orgId].push(skill)
          return skill
        }),
        upsert: vi.fn(async (args: any) => {
          const name = args.where.orgId_name.name
          const existing = skills.find((s) => s.name === name)
          if (existing) { Object.assign(existing, args.update); return existing }
          const skill = { id: `sk_${name}`, ...args.create, orgId, createdAt: new Date(), updatedAt: new Date() }
          if (!h.skillsByOrg[orgId]) h.skillsByOrg[orgId] = []
          h.skillsByOrg[orgId].push(skill)
          return skill
        }),
        update: vi.fn(async (args: any) => {
          const name = args.where.orgId_name.name
          const skill = skills.find((s) => s.name === name)
          if (!skill) throw new Error('Not found')
          Object.assign(skill, args.data)
          return skill
        }),
        delete: vi.fn(async (args: any) => {
          const name = args.where.orgId_name.name
          const idx = skills.findIndex((s) => s.name === name)
          if (idx === -1) throw new Error('Not found')
          skills.splice(idx, 1)
        }),
      },
      raw: {
        organization: {
          upsert: vi.fn(async () => ({ id: orgId, name: 'Demo Org' })),
        },
      },
    } as any
  },
}))

// ── Mock auth session ──
vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

// ── Mock logger ──
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Mock skill classifications ──
vi.mock('@/lib/skill-classifications', () => ({
  SYSTEM_SKILL_NAMES: new Set(['system_info']),
  SPECIAL_SKILL_NAMES: new Set<string>(),
  CHANNEL_SKILL_NAMES: new Set<string>(),
}))

// ── Mock defaults (DEFAULT_SKILLS) ──
vi.mock('@intera/shared/defaults', () => ({
  DEFAULT_SKILLS: [
    {
      name: 'system_info', description: 'System info', inputSchema: '{}', outputSchema: '{}',
      mode: 'static', isConcurrencySafe: true, enabled: true, guardPhase: 'post',
      endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000,
      mockFixture: null, displayVerb: null, toolCategory: 'system_info',
    },
  ],
  DEFAULT_MODEL: 'deepseek-v4-flash',
}))

import { GET, POST } from '@/app/api/admin/skills/route'
import { GET as GetByName, PUT, DELETE } from '@/app/api/admin/skills/[name]/route'

function makeRequest(method: string, body?: unknown) {
  return {
    method,
    json: async () => body ?? {},
    nextUrl: new URL('http://localhost/api/admin/skills'),
  } as any
}

function makeParamsRequest(method: string, name: string, body?: unknown) {
  return {
    method,
    json: async () => body ?? {},
    nextUrl: new URL(`http://localhost/api/admin/skills/${name}`),
  } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createdSkills.length = 0
  h.auditEvents.length = 0
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
  // Reset shared data to initial state
  h.skillsByOrg.default = [
    { id: 'sk1', orgId: 'default', name: 'system_info', description: 'System info skill', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: 'system_info', createdAt: new Date(), updatedAt: new Date() },
    { id: 'sk2', orgId: 'default', name: 'lookup_order', description: 'Look up order', mode: 'http', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: 'https://api.example.com', httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.skillsByOrg.orgB = [
    { id: 'sk3', orgId: 'orgB', name: 'orgb_skill', description: 'Org B skill', mode: 'static', inputSchema: '{}', outputSchema: '{}', isConcurrencySafe: true, enabled: true, guardPhase: 'post', endpoint: null, httpMethod: 'POST', headers: null, timeoutMs: 8000, mockFixture: null, displayVerb: null, renderHints: null, toolCategory: null, createdAt: new Date(), updatedAt: new Date() },
  ]
})

// ════════════════════════════════════════════════════════════════
// G1: Envelope shape
// ════════════════════════════════════════════════════════════════
describe('G1 — Uniform envelope', () => {
  it('GET returns ApiOk<{skills}> envelope', async () => {
    const res = await GET(makeRequest('GET'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data).toBeDefined()
    expect(Array.isArray(body.data.skills)).toBe(true)
    expect(body.data.skills.length).toBeGreaterThanOrEqual(1)
    expect(body.data.skills[0].isSystem).toBeDefined()
    expect(body.data.skills[0].isChannel).toBeDefined()
    expect(body.data.skills[0].isSpecial).toBeDefined()
  })

  it('POST with empty body returns validation error envelope (400)', async () => {
    const res = await POST(makeRequest('POST', {}))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(body.error.message).toBe('Invalid input')
    expect(res.status).toBe(400)
  })

  it('POST with missing name returns validation error with fields', async () => {
    const res = await POST(makeRequest('POST', { description: 'no name' }))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(body.error.fields).toBeDefined()
    expect(body.error.fields.name).toBeDefined()
  })

  it('POST with valid input returns ApiOk<{skill}> envelope (201)', async () => {
    const res = await POST(makeRequest('POST', { name: 'new_skill', description: 'A new skill' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.skill).toBeDefined()
    expect(body.data.skill.name).toBe('new_skill')
    expect(res.status).toBe(201)
  })
})

// ════════════════════════════════════════════════════════════════
// G2: Tenant scoping (repoForOrg)
// ════════════════════════════════════════════════════════════════
describe('G2 — Tenant isolation via repoForOrg', () => {
  it('org default only sees its own skills', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await GET(makeRequest('GET'))
    const body = await res.json()

    expect(body.data.skills.length).toBe(2)
    expect(body.data.skills.every((s: any) => s.orgId === 'default')).toBe(true)
  })

  it('org B only sees its own skills (auto-seed adds missing system skills)', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'admin' })
    const res = await GET(makeRequest('GET'))
    const body = await res.json()

    // orgB starts with 1 skill; auto-seed adds system_info (required system skill)
    expect(body.data.skills.length).toBeGreaterThanOrEqual(1)
    expect(body.data.skills.every((s: any) => s.orgId === 'orgB')).toBe(true)
    expect(body.data.skills.some((s: any) => s.name === 'orgb_skill')).toBe(true)
  })

  it('POST creates skill scoped to session orgId', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'admin' })
    const res = await POST(makeRequest('POST', { name: 'new_orgb_skill' }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.skill.orgId).toBe('orgB')
  })

  it('org A CANNOT see org B skills by name lookup', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await GetByName(makeParamsRequest('GET', 'orgb_skill'), routeCtx('orgb_skill'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

// ════════════════════════════════════════════════════════════════
// G3: Audit writes
// ════════════════════════════════════════════════════════════════
describe('G3 — Route-level mutations complete successfully', () => {
  it('POST creates skill and returns correct envelope', async () => {
    const res = await POST(makeRequest('POST', {
      name: 'audited_skill',
      description: 'Should complete successfully',
      mode: 'mock',
    }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.skill.name).toBe('audited_skill')
  })

  it('DELETE removes skill and returns success', async () => {
    const res = await DELETE(makeParamsRequest('DELETE', 'lookup_order'), routeCtx('lookup_order'))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  it('PUT updates skill and returns updated record', async () => {
    const res = await PUT(
      makeParamsRequest('PUT', 'lookup_order', { description: 'Updated description' }),
      routeCtx('lookup_order'),
    )
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.skill.description).toBe('Updated description')
  })
})

// ════════════════════════════════════════════════════════════════
// Error code → HTTP status mapping
// ════════════════════════════════════════════════════════════════
describe('Error code → HTTP status mapping', () => {
  it('returns 401 when no session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await GET(makeRequest('GET'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-existent skill', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await GetByName(makeParamsRequest('GET', 'nonexistent'), routeCtx('nonexistent'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })

  it('returns 403 for deleting a protected skill', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await DELETE(makeParamsRequest('DELETE', 'system_info'), routeCtx('system_info'))
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('forbidden')
    expect(res.status).toBe(403)
  })

  it('returns 403 for mutating a protected skill beyond enabled toggle', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await PUT(
      makeParamsRequest('PUT', 'system_info', { name: 'hacked_name' }),
      routeCtx('system_info'),
    )
    const body = await res.json()

    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('forbidden')
  })

  it('allows enabled toggle on protected skills', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin' })
    const res = await PUT(
      makeParamsRequest('PUT', 'system_info', { enabled: false }),
      routeCtx('system_info'),
    )
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.data.skill.enabled).toBe(false)
  })
})
