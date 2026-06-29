import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentOpsSimulationReceipt } from '@intera/shared/contracts/agentops/simulation'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockGetScenario = vi.fn()
  const mockRunAgentOpsSimulation = vi.fn()
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent-a': { id: 'agent-a', orgId: 'default' },
    'draft-a': { id: 'draft-a', orgId: 'default' },
    'foreign-agent': { id: 'foreign-agent', orgId: 'org-b' },
    'foreign-draft': { id: 'foreign-draft', orgId: 'org-b' },
  }
  return {
    mockGetSession,
    mockGetScenario,
    mockRunAgentOpsSimulation,
    agentConfigs,
  }
})

const scenario: SavedScenario = {
  id: 'scenario-1',
  agentConfigId: 'draft-a',
  name: 'deposit_followup',
  displayName: 'Deposit follow-up',
  description: 'Checks a two-turn deposit conversation.',
  locale: 'en-US',
  tags: ['deposit'],
  enabled: true,
  turns: [
    { role: 'user', content: 'My deposit is missing.' },
    { role: 'user', content: 'member id is 12345.' },
  ],
  expected: {},
  createdAt: '2026-06-29T00:00:00.000Z',
  updatedAt: '2026-06-29T00:00:00.000Z',
}

const receipt: AgentOpsSimulationReceipt = {
  schemaVersion: 'agentops.simulation-receipt.v1',
  simulationId: 'sim_test',
  generatedAt: '2026-06-29T00:00:00.000Z',
  status: 'pass',
  mode: 'local_runtime',
  toolPolicy: 'mocked',
  agentId: 'agent-a',
  draftAgentConfigId: 'draft-a',
  source: { type: 'scenario', name: 'deposit_followup' },
  safety: {
    providerCalls: true,
    externalToolCalls: false,
    runtimeToolExecution: false,
    businessSideEffects: false,
    localPersistenceWrites: true,
    productionRuntimeSimulation: false,
    scenarioReceiptsAppended: false,
    scenarioValidationMarkedValidated: false,
    reason: 'local dry-run',
  },
  session: {
    userId: 'agentops-sim:sim_test',
    turnCount: 2,
  },
  turns: [],
  finalEvidence: {
    toolsCalled: [],
    toolCalls: [],
    toolResults: [],
    hookDecisions: [],
    knowledgeHits: [],
    humanTransfer: false,
    handoff: [],
  },
  warnings: [],
}

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const config = h.agentConfigs[args?.where?.id]
          if (!config || config.orgId !== orgId) return null
          return args?.select ? { id: config.id } : config
        }),
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
  getScenario: h.mockGetScenario,
}))

vi.mock('@/lib/agentops/simulation', () => ({
  runAgentOpsSimulation: h.mockRunAgentOpsSimulation,
}))

import { POST } from '../route'

function makeRequest(agentId: string, body: unknown) {
  return {
    method: 'POST',
    json: async () => body,
    nextUrl: new URL(`http://localhost/api/agentops/agents/${agentId}/simulations`),
  } as any
}

function routeCtx(agentId: string) {
  return { params: Promise.resolve({ agentId }) }
}

function simulationBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'local_runtime',
    toolPolicy: 'mocked',
    draftAgentConfigId: 'draft-a',
    source: { type: 'scenario', name: 'deposit_followup' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
  h.mockGetScenario.mockResolvedValue(scenario)
  h.mockRunAgentOpsSimulation.mockResolvedValue(receipt)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/agentops/agents/[agentId]/simulations', () => {
  it('returns 401 without a session', async () => {
    h.mockGetSession.mockResolvedValue(null)

    const res = await POST(makeRequest('agent-a', simulationBody()), routeCtx('agent-a'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.code).toBe('unauthorized')
  })

  it('returns 404 for fake and foreign active agents', async () => {
    const fakeRes = await POST(makeRequest('fake-agent', simulationBody()), routeCtx('fake-agent'))
    const foreignRes = await POST(makeRequest('foreign-agent', simulationBody()), routeCtx('foreign-agent'))

    expect(fakeRes.status).toBe(404)
    expect((await fakeRes.json()).error.code).toBe('not_found')
    expect(foreignRes.status).toBe(404)
    expect((await foreignRes.json()).error.code).toBe('not_found')
  })

  it('returns 404 for a foreign draftAgentConfigId', async () => {
    const res = await POST(
      makeRequest('agent-a', simulationBody({ draftAgentConfigId: 'foreign-draft' })),
      routeCtx('agent-a'),
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error.code).toBe('not_found')
  })

  it('returns 403 in production before loading Scenario fixtures', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const res = await POST(makeRequest('agent-a', simulationBody()), routeCtx('agent-a'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('forbidden')
    expect(h.mockGetScenario).not.toHaveBeenCalled()
    expect(h.mockRunAgentOpsSimulation).not.toHaveBeenCalled()
  })

  it('runs a local mocked multi-turn simulation receipt', async () => {
    const res = await POST(makeRequest('agent-a', simulationBody()), routeCtx('agent-a'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toMatchObject({
      schemaVersion: 'agentops.simulation-receipt.v1',
      mode: 'local_runtime',
      toolPolicy: 'mocked',
      agentId: 'agent-a',
      draftAgentConfigId: 'draft-a',
      safety: {
        providerCalls: true,
        externalToolCalls: false,
        runtimeToolExecution: false,
        businessSideEffects: false,
        scenarioReceiptsAppended: false,
        scenarioValidationMarkedValidated: false,
      },
    })
    expect(h.mockGetScenario).toHaveBeenCalledWith('draft-a', 'deposit_followup')
    expect(h.mockRunAgentOpsSimulation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'default',
      agentId: 'agent-a',
      scenario,
    }))
  })

  it('accepts direct turn scripts without a Scenario lookup', async () => {
    const res = await POST(
      makeRequest('agent-a', simulationBody({
        source: {
          type: 'turn_script',
          name: 'deposit_followup',
          turns: [
            { role: 'user', content: 'My deposit is missing.' },
            { role: 'user', content: 'member id is 12345.' },
          ],
        },
      })),
      routeCtx('agent-a'),
    )

    expect(res.status).toBe(200)
    expect(h.mockGetScenario).not.toHaveBeenCalled()
  })
})
