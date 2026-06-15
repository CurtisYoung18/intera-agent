import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const agentConfigs: Record<string, { id: string; orgId: string }> = {
    agent_default_v1: { id: 'agent_default_v1', orgId: 'default' },
    org_b_agent: { id: 'org_b_agent', orgId: 'org-b' },
  }
  const mockGetSession = vi.fn()
  return { agentConfigs, mockGetSession }
})

vi.mock('@/lib/db/repo-for-org', () => ({
  repoForOrg(orgId: string) {
    return {
      orgId,
      agentConfig: {
        findUnique: vi.fn(async (args: any) => {
          const id = args?.where?.id
          const config = h.agentConfigs[id]
          if (!config || config.orgId !== orgId) return null
          return args?.select ? { id: config.id } : config
        }),
        findMany: vi.fn(async () => Object.values(h.agentConfigs).filter((config) => config.orgId === orgId)),
      },
      raw: {
        organization: {
          upsert: vi.fn(async () => ({ id: orgId, name: 'Demo Org' })),
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

vi.mock('@/lib/scenarios/runtime-runner', async () => {
  const runner = await vi.importActual<typeof import('@/lib/scenarios/runner')>('@/lib/scenarios/runner')
  return {
    runScenarioAgentRuntime: vi.fn(async (scenario: any) => runner.buildScenarioReceipt(scenario, {
      caseType: 'deposit_issue',
      toolsCalled: ['get_latest_deposit'],
      toolCalls: [{ name: 'get_latest_deposit', executionMode: 'mocked' }],
      toolResults: [{ name: 'get_latest_deposit', output: { _dryRun: true }, executionMode: 'mocked' }],
      hookDecisions: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
      humanTransfer: true,
      handoff: [{ required: true, target: 'human' }],
      finalResponse: 'I will transfer this case to a human specialist.',
      finalStatus: 'waiting_human',
      procedureStatus: 'completed',
      procedureOutcome: 'handed_off',
    }, {
      executionMode: 'agentRuntime',
      toolExecutionMode: 'mocked',
      traceId: 'trace-runtime-1',
    })),
  }
})

import { GET, POST } from '@/app/api/admin/scenarios/route'
import { DELETE, GET as GetScenario, PUT } from '@/app/api/admin/scenarios/[name]/route'
import { POST as RunScenario } from '@/app/api/admin/scenarios/[name]/run/route'

let tempDir = ''

function makeRequest(agentConfigId = 'agent_default_v1', body?: unknown, method?: string) {
  const url = new URL(`http://localhost/api/admin/scenarios?agentConfigId=${agentConfigId}`)
  return { method: method ?? (body ? 'POST' : 'GET'), json: async () => body ?? {}, nextUrl: url } as any
}

function bodyRequest(body: unknown, method = 'POST') {
  return { method, json: async () => body, nextUrl: new URL('http://localhost/api/admin/scenarios') } as any
}

function routeCtx(name: string) {
  return { params: Promise.resolve({ name }) }
}

function validScenario(name = 'deposit_missing_evidence') {
  return {
    agentConfigId: 'agent_default_v1',
    name,
    displayName: 'Deposit missing evidence',
    tags: ['deposit'],
    turns: [
      { role: 'user', content: 'My deposit has not arrived.' },
      { role: 'assistant', content: 'I will transfer this to a human specialist.' },
    ],
    expected: {
      caseType: 'deposit_issue',
      toolsCalled: ['get_latest_deposit'],
      hooks: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
      humanTransfer: true,
      finalStatus: 'waiting_human',
      procedureStatus: 'completed',
      procedureOutcome: 'handed_off',
      forbiddenPhrases: ['guaranteed compensation'],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mockGetSession.mockResolvedValue({ orgId: 'default', role: 'admin', userId: 'user-1' })
  tempDir = mkdtempSync(path.join(tmpdir(), 'intera-scenarios-'))
  process.env.INTERA_SCENARIO_STORE_PATH = path.join(tempDir, 'scenarios.json')
})

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  delete process.env.INTERA_SCENARIO_STORE_PATH
})

describe('Scenario APIs', () => {
  it('saves, lists, updates, runs, and deletes a Scenario', async () => {
    const createRes = await POST(bodyRequest(validScenario()))
    const createBody = await createRes.json()
    expect(createRes.status).toBe(201)
    expect(createBody.ok).toBe(true)
    expect(createBody.data.scenario.name).toBe('deposit_missing_evidence')

    const listRes = await GET(makeRequest())
    const listBody = await listRes.json()
    expect(listBody.ok).toBe(true)
    expect(listBody.data.scenarios).toHaveLength(1)
    expect(listBody.data.validation.state).toBe('Changed since last validation')

    const getRes = await GetScenario(makeRequest(), routeCtx('deposit_missing_evidence'))
    const getBody = await getRes.json()
    expect(getBody.data.scenario.displayName).toBe('Deposit missing evidence')

    const updateRes = await PUT(bodyRequest({
      agentConfigId: 'agent_default_v1',
      displayName: 'Updated deposit evidence',
    }, 'PUT'), routeCtx('deposit_missing_evidence'))
    const updateBody = await updateRes.json()
    expect(updateBody.ok).toBe(true)
    expect(updateBody.data.scenario.displayName).toBe('Updated deposit evidence')

    const runRes = await RunScenario(bodyRequest({
      agentConfigId: 'agent_default_v1',
      observed: {
        knowledgeHits: [{ source: 'fixture', title: 'Deposit runbook' }],
      },
    }), routeCtx('deposit_missing_evidence'))
    const runBody = await runRes.json()
    expect(runBody.ok).toBe(true)
    expect(runBody.data.receipt.status).toBe('pass')
    expect(runBody.data.receipt.executionMode).toBe('fixture')
    expect(runBody.data.receipt.evidence.knowledgeHits[0]).toMatchObject({ source: 'fixture' })
    expect(runBody.data.validation.state).toBe('Changed since last validation')
    expect(runBody.data.validation.runtimeValidated).toBe(false)
    expect(runBody.data.validation.overrideRequired).toBe(true)

    const runtimeRunRes = await RunScenario(bodyRequest({
      agentConfigId: 'agent_default_v1',
      executionMode: 'agentRuntime',
    }), routeCtx('deposit_missing_evidence'))
    const runtimeRunBody = await runtimeRunRes.json()
    expect(runtimeRunBody.ok).toBe(true)
    expect(runtimeRunBody.data.receipt.status).toBe('pass')
    expect(runtimeRunBody.data.receipt.executionMode).toBe('agentRuntime')
    expect(runtimeRunBody.data.receipt.evidence.toolResults[0]).toMatchObject({ name: 'get_latest_deposit', executionMode: 'mocked' })
    expect(runtimeRunBody.data.validation.state).toBe('Validated')
    expect(runtimeRunBody.data.validation.runtimeValidated).toBe(true)
    expect(runtimeRunBody.data.validation.overrideRequired).toBe(false)

    const deleteRes = await DELETE(makeRequest('agent_default_v1', undefined, 'DELETE'), routeCtx('deposit_missing_evidence'))
    const deleteBody = await deleteRes.json()
    expect(deleteBody.ok).toBe(true)
    expect(deleteBody.data.success).toBe(true)
  })

  it('fails receipts when observed evidence does not match expectations', async () => {
    await POST(bodyRequest(validScenario()))

    const runRes = await RunScenario(bodyRequest({
      agentConfigId: 'agent_default_v1',
      observed: {
        toolsCalled: [],
        hookDecisions: [],
        humanTransfer: false,
        finalStatus: 'completed',
        finalResponse: 'No transfer needed.',
      },
    }), routeCtx('deposit_missing_evidence'))
    const runBody = await runRes.json()
    expect(runBody.data.receipt.status).toBe('fail')
    expect(runBody.data.receipt.failureReasons.map((reason: any) => reason.code)).toContain('required_tool_missing')
    expect(runBody.data.validation.state).toBe('Validation failed')
  })

  it('does not let one org read another org agent scenarios', async () => {
    const res = await GET(makeRequest('org_b_agent'))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
    expect(res.status).toBe(404)
  })

  it('returns 401 without a session', async () => {
    h.mockGetSession.mockResolvedValue(null)
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
    expect(res.status).toBe(401)
  })
})
