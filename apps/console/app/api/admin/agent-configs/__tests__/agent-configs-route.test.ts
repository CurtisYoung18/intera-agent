// Route-level guard test for /api/admin/agent-configs

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const configsByOrg: Record<string, Record<string, unknown>[]> = {
    default: [
      { id: 'ac1', orgId: 'default', name: 'Default', version: 1, isActive: true, parentId: null, model: 'deepseek-v4-flash', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20, maxOutputTokens: 4096, systemPrompt: '', coreSystemPrompt: null, showThinking: false, memoryStrategy: '{}', gptbotsApiKey: null, invariantCheck: false, resumePrompt: null, debugMode: false, createdAt: new Date(), updatedAt: new Date() },
      { id: 'ac2', orgId: 'default', name: 'Support Agent', version: 1, isActive: true, parentId: null, model: 'deepseek-v4-flash', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20, maxOutputTokens: null, systemPrompt: '', coreSystemPrompt: null, showThinking: false, memoryStrategy: '{}', gptbotsApiKey: null, invariantCheck: false, resumePrompt: null, debugMode: false, createdAt: new Date(), updatedAt: new Date() },
    ],
    orgB: [
      { id: 'ac3', orgId: 'orgB', name: 'OrgB Agent', version: 1, isActive: true, parentId: null, model: 'deepseek-v4-flash', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20, maxOutputTokens: null, systemPrompt: '', coreSystemPrompt: null, showThinking: false, memoryStrategy: '{}', gptbotsApiKey: null, invariantCheck: false, resumePrompt: null, debugMode: false, createdAt: new Date(), updatedAt: new Date() },
    ],
  }
  const mockGetSession = vi.fn()

  return { configsByOrg, mockGetSession }
})

// Mock clearConfigCache
vi.mock('@/lib/agent/config-cache', () => ({
  clearConfigCache: vi.fn(),
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    const configs = h.configsByOrg[orgId] ?? []
    return {
      orgId,
      agentConfig: {
        findMany: vi.fn(async () => [...configs]),
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          return configs.find((c) => c.id === id) ?? null
        }),
        findFirst: vi.fn(async (args: any) => {
          if (args?.where?.name) {
            return configs.find((c) => c.name === args.where.name) ?? null
          }
          return configs[0] ?? null
        }),
        create: vi.fn(async (args: any) => {
          const config = { id: `ac_new_${Date.now()}`, ...args.data, orgId, createdAt: new Date(), updatedAt: new Date() }
          if (!h.configsByOrg[orgId]) h.configsByOrg[orgId] = []
          h.configsByOrg[orgId].push(config)
          return config
        }),
        count: vi.fn(async () => 0),
        updateMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async (args: any) => {
          const name = args.where.name
          const before = configs.filter((c) => c.name === name).length
          const remaining = configs.filter((c) => c.name !== name)
          h.configsByOrg[orgId] = remaining
          return { count: before }
        }),
        delete: vi.fn(async (args: any) => {
          const id = args.where.id
          const idx = configs.findIndex((c) => c.id === id)
          if (idx === -1) throw new Error('Not found')
          configs.splice(idx, 1)
        }),
      },
      raw: {
        organization: {
          upsert: vi.fn(async () => ({ id: orgId, name: 'Demo Org' })),
        },
        $transaction: vi.fn(async (cb: any) => {
          const tx = {
            tool: { findMany: vi.fn(async () => []), create: vi.fn(async (args: any) => args.data) },
            policy: { findMany: vi.fn(async () => []), create: vi.fn(async (args: any) => args.data) },
            caseType: { findMany: vi.fn(async () => []), create: vi.fn(async (args: any) => args.data) },
            knowledgeSource: { findMany: vi.fn(async () => []), create: vi.fn(async (args: any) => args.data) },
            channelBinding: { findMany: vi.fn(async () => []), create: vi.fn(async (args: any) => args.data) },
            $executeRaw: vi.fn(),
            $queryRaw: vi.fn(),
          }
          if (typeof cb === 'function') return await cb(tx)
          // Array of promises mode
          return await Promise.all(cb)
        }),
        agentConfig: {
          update: vi.fn(async (args: any) => args.data),
          delete: vi.fn(async () => {}),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
      },
    } as any
  },
}))

vi.mock('@/lib/auth', () => ({
  getSession: h.mockGetSession,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { GET, POST } from '@/app/api/admin/agent-configs/route'
import { PUT, DELETE } from '@/app/api/admin/agent-configs/[id]/route'
import { POST as ForkConfig } from '@/app/api/admin/agent-configs/[id]/fork/route'
import { PUT as ActivateConfig } from '@/app/api/admin/agent-configs/[id]/activate/route'

function makeRequest(body?: unknown) {
  return { method: body ? 'POST' : 'GET', json: async () => body ?? {}, nextUrl: new URL('http://localhost/api/admin/agent-configs') } as any
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
  h.configsByOrg.default = [
    { id: 'ac1', orgId: 'default', name: 'Default', version: 1, isActive: true, parentId: null, model: 'deepseek-v4-flash', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20, maxOutputTokens: 4096, systemPrompt: '', coreSystemPrompt: null, showThinking: false, memoryStrategy: '{}', gptbotsApiKey: null, invariantCheck: false, resumePrompt: null, debugMode: false, createdAt: new Date(), updatedAt: new Date() },
    { id: 'ac2', orgId: 'default', name: 'Support Agent', version: 1, isActive: true, parentId: null, model: 'deepseek-v4-flash', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20, maxOutputTokens: null, systemPrompt: '', coreSystemPrompt: null, showThinking: false, memoryStrategy: '{}', gptbotsApiKey: null, invariantCheck: false, resumePrompt: null, debugMode: false, createdAt: new Date(), updatedAt: new Date() },
  ]
  h.configsByOrg.orgB = [
    { id: 'ac3', orgId: 'orgB', name: 'OrgB Agent', version: 1, isActive: true, parentId: null, model: 'deepseek-v4-flash', temperature: 0.5, thinkingBudget: 4096, maxIterations: 20, maxOutputTokens: null, systemPrompt: '', coreSystemPrompt: null, showThinking: false, memoryStrategy: '{}', gptbotsApiKey: null, invariantCheck: false, resumePrompt: null, debugMode: false, createdAt: new Date(), updatedAt: new Date() },
  ]
})

describe('G1 — Uniform envelope', () => {
  it('GET returns ApiOk<{configs}> envelope', async () => {
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data.configs)).toBe(true)
  })

  it('POST with empty body creates default agent (201)', async () => {
    const res = await POST(makeRequest({}))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.config.name).toBe('Default')
    expect(res.status).toBe(201)
  })
})

describe('G2 — Tenant isolation', () => {
  it('org default only sees its own configs', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data.configs.every((c: any) => c.orgId === 'default')).toBe(true)
  })

  it('org B only sees its own configs', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'orgB', role: 'staff' })
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data.configs.every((c: any) => c.orgId === 'orgB')).toBe(true)
  })

  it('org A CANNOT access org B config by id', async () => {
    h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'staff' })
    const res = await PUT(makeRequest({ name: 'should-fail' }), routeCtx('ac3'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})

describe('G3 — Mutations', () => {
  it('rename propagates to all versions', async () => {
    const res = await PUT(makeRequest({ name: 'Renamed Agent' }), routeCtx('ac1'))
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('fork creates new version', async () => {
    const res = await ForkConfig(makeRequest(), routeCtx('ac1'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.config.parentId).toBe('ac1')
    expect(res.status).toBe(201)
  })

  it('activate returns config info', async () => {
    // ac1 is already active, so this is idempotent
    const res = await ActivateConfig(makeRequest(), routeCtx('ac1'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.config.isActive).toBe(true)
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

  it('returns 404 for non-existent config', async () => {
    const res = await PUT(makeRequest({ name: 'test' }), routeCtx('nonexistent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })
})
