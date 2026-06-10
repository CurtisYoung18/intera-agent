import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const configsById: Record<string, Record<string, unknown>> = {
    ac1: { id: 'ac1', orgId: 'default', name: 'Default', version: 1, isActive: true },
    ac2: { id: 'ac2', orgId: 'default', name: 'Default', version: 2, isActive: false },
  }
  const validationByAgent: Record<string, { state: string; overrideRequired: boolean }> = {
    ac1: { state: 'Validated', overrideRequired: false },
    ac2: { state: 'Changed since last validation', overrideRequired: true },
  }
  const mockGetSession = vi.fn()
  const transactions: unknown[][] = []
  return { configsById, validationByAgent, mockGetSession, transactions }
})

vi.mock('@/lib/agent/config-cache', () => ({
  clearConfigCache: vi.fn(),
}))

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const config = h.configsById[args?.where?.id]
          if (!config || config.orgId !== orgId) return null
          return config
        }),
        findFirst: vi.fn(async (args: any) => {
          const name = args?.where?.name
          return Object.values(h.configsById).find((config: any) => config.orgId === orgId && config.name === name && config.isActive) ?? null
        }),
      },
      raw: {
        organization: {
          upsert: vi.fn(async () => ({ id: orgId, name: 'Demo Org' })),
        },
        $transaction: vi.fn(async (ops: unknown[]) => {
          h.transactions.push(ops)
          return Promise.all(ops)
        }),
        agentConfig: {
          updateMany: vi.fn(async () => ({ count: 1 })),
          update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data, isActive: true })),
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

vi.mock('@/lib/scenarios/store', () => ({
  getScenarioValidationSummary: vi.fn(async (agentConfigId: string) => ({
    state: h.validationByAgent[agentConfigId]?.state ?? 'Not validated',
    overrideRequired: h.validationByAgent[agentConfigId]?.overrideRequired ?? true,
  })),
}))

import { PUT as ActivateConfig } from '@/app/api/admin/agent-configs/[id]/activate/route'

function makeRequest(body?: unknown) {
  return {
    method: 'PUT',
    json: async () => body ?? {},
    nextUrl: new URL('http://localhost/api/admin/agent-configs/ac2/activate'),
  } as any
}

function routeCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.transactions.length = 0
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
  h.configsById.ac2.isActive = false
  h.validationByAgent.ac2 = { state: 'Changed since last validation', overrideRequired: true }
})

describe('Scenario activation soft gate', () => {
  it('rejects activation without override reason when validation is stale', async () => {
    const res = await ActivateConfig(makeRequest(), routeCtx('ac2'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(body.error.fields.overrideValidationReason).toContain('required')
    expect(res.status).toBe(400)
    expect(h.transactions).toHaveLength(0)
  })

  it('rejects activation without override reason when validation is fixture-only', async () => {
    h.validationByAgent.ac2 = { state: 'Validated', overrideRequired: true }
    const res = await ActivateConfig(makeRequest(), routeCtx('ac2'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('validation')
    expect(h.transactions).toHaveLength(0)
  })

  it('allows activation with override reason when validation is stale', async () => {
    const res = await ActivateConfig(makeRequest({ overrideValidationReason: 'Reviewed receipt risk before launch.' }), routeCtx('ac2'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.config.isActive).toBe(true)
    expect(body.data.validation.overrideRequired).toBe(true)
    expect(body.data.validation.overrideReason).toBe('Reviewed receipt risk before launch.')
    expect(h.transactions).toHaveLength(1)
  })
})
