import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedScenario } from '@intera/shared/contracts/scenarios'

const h = vi.hoisted(() => {
  const mockGetSession = vi.fn()
  const mockGetScenario = vi.fn()
  const mockAppendScenarioReceipt = vi.fn()
  const mockRunScenarioAgentRuntime = vi.fn()
  const mockFetch = vi.fn()
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    'agent-a': { id: 'agent-a', orgId: 'default' },
    'draft-a': { id: 'draft-a', orgId: 'default' },
    'agent-b': { id: 'agent-b', orgId: 'default' },
    'foreign-agent': { id: 'foreign-agent', orgId: 'org-b' },
    'foreign-draft': { id: 'foreign-draft', orgId: 'org-b' },
  }
  return {
    mockGetSession,
    mockGetScenario,
    mockAppendScenarioReceipt,
    mockRunScenarioAgentRuntime,
    mockFetch,
    agentConfigs,
  }
})

const scenario: SavedScenario = {
  id: 'scenario-1',
  agentConfigId: 'draft-a',
  name: 'deposit_gmt_check',
  displayName: 'Deposit GMT check',
  description: 'Verifies deposit replay evidence.',
  locale: 'en-US',
  tags: ['deposit'],
  enabled: true,
  turns: [{ role: 'user', content: 'Check my deposit.' }],
  expected: {
    toolCalls: [{ name: 'get_latest_deposit', minCalls: 1 }],
    hooks: [{ hookName: 'deposit_before_tool', checkpoint: 'PreToolUse', decision: 'allow' }],
  },
  createdAt: '2026-06-26T00:00:00.000Z',
  updatedAt: '2026-06-26T00:00:00.000Z',
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
  appendScenarioReceipt: h.mockAppendScenarioReceipt,
}))

vi.mock('@/lib/scenarios/runtime-runner', () => ({
  runScenarioAgentRuntime: h.mockRunScenarioAgentRuntime,
}))

import { POST } from '../route'

function makeRequest(agentId: string, body: unknown) {
  return {
    method: 'POST',
    json: async () => body,
    nextUrl: new URL(`http://localhost/api/agentops/agents/${agentId}/replay`),
  } as any
}

function routeCtx(agentId: string) {
  return { params: Promise.resolve({ agentId }) }
}

function scenarioReplayBody(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'local_dry_run',
    draftAgentConfigId: 'draft-a',
    source: { type: 'scenario', name: 'deposit_gmt_check' },
    assertions: [{
      type: 'hook_outcome',
      hookName: 'deposit_before_tool',
      checkpoint: 'PreToolUse',
      decision: 'allow',
    }],
    ...overrides,
  }
}

function observedReplayBody(overrides: Record<string, unknown> = {}) {
  return scenarioReplayBody({
    source: {
      type: 'observed',
      scenario: {
        name: 'deposit_gmt_check',
        turns: [{ role: 'user', content: 'Check my deposit.' }],
        expected: {},
      },
    },
    observed: {
      toolCalls: [{
        name: 'get_latest_deposit',
        input: { payload: { gmt: '+5' } },
        executionMode: 'mocked',
      }],
      hookDecisions: [],
    },
    assertions: [{
      type: 'tool_input_equals',
      toolName: 'get_latest_deposit',
      path: 'payload.gmt',
      expected: '+5',
    }],
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', h.mockFetch)
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
  h.mockGetScenario.mockResolvedValue(scenario)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('POST /api/agentops/agents/[agentId]/replay', () => {
  it('returns 401 without a session', async () => {
    h.mockGetSession.mockResolvedValue(null)

    const res = await POST(makeRequest('agent-a', observedReplayBody()), routeCtx('agent-a'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
  })

  it('returns 404 for fake and foreign active agents', async () => {
    const fakeRes = await POST(makeRequest('fake-agent', observedReplayBody()), routeCtx('fake-agent'))
    const fakeBody = await fakeRes.json()
    const foreignRes = await POST(makeRequest('foreign-agent', observedReplayBody()), routeCtx('foreign-agent'))
    const foreignBody = await foreignRes.json()

    expect(fakeRes.status).toBe(404)
    expect(fakeBody.error.code).toBe('not_found')
    expect(foreignRes.status).toBe(404)
    expect(foreignBody.error.code).toBe('not_found')
  })

  it('returns 404 for a foreign draftAgentConfigId', async () => {
    const res = await POST(
      makeRequest('agent-a', observedReplayBody({ draftAgentConfigId: 'foreign-draft' })),
      routeCtx('agent-a'),
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })

  it('returns 403 in production runtime before reading Scenario fixtures', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const res = await POST(makeRequest('agent-a', scenarioReplayBody()), routeCtx('agent-a'))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('forbidden')
    expect(h.mockGetScenario).not.toHaveBeenCalled()
  })

  it('returns a local dry-run replay receipt without runtime, fetch, or Scenario receipt writes', async () => {
    const res = await POST(makeRequest('agent-a', scenarioReplayBody()), routeCtx('agent-a'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toMatchObject({
      schemaVersion: 'agentops.replay-receipt.v1',
      status: 'pass',
      mode: 'local_dry_run',
      agentId: 'agent-a',
      draftAgentConfigId: 'draft-a',
      toolSafety: {
        externalToolCalls: false,
        runtimeToolExecution: false,
        providerCalls: false,
        sideEffects: false,
        scenarioReceiptsAppended: false,
        scenarioValidationMarkedValidated: false,
      },
      scenarioReceipt: {
        scenarioName: 'deposit_gmt_check',
        executionMode: 'fixture',
        toolExecutionMode: 'mocked',
        validationStateChanged: false,
      },
    })
    expect(body.data.assertions[0]).toMatchObject({ status: 'pass', passed: true })
    expect(h.mockGetScenario).toHaveBeenCalledWith('draft-a', 'deposit_gmt_check')
    expect(h.mockRunScenarioAgentRuntime).not.toHaveBeenCalled()
    expect(h.mockAppendScenarioReceipt).not.toHaveBeenCalled()
    expect(h.mockFetch).not.toHaveBeenCalled()
  })
})
