// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const h = vi.hoisted(() => {
  const mockSelectAgent = vi.fn()
  const mockRefreshConfigs = vi.fn(async () => {})
  const context = {
    selectedAgentId: 'draft-3',
    agentConfigs: [],
    loading: false,
    loadError: null as string | null,
    selectAgent: mockSelectAgent,
    refreshConfigs: mockRefreshConfigs,
    retryLoad: vi.fn(),
  }
  return { context, mockSelectAgent, mockRefreshConfigs }
})

vi.mock('@/lib/agent/agent-context', () => ({
  useAgentContext: () => h.context,
}))

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    toggleLocale: vi.fn(),
    t: (key: string) => key,
  }),
}))

const configs = [
  {
    id: 'history-1',
    name: 'Gaming Support',
    version: 1,
    isActive: false,
    parentId: null,
    model: 'deepseek-v4-flash',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    releaseNote: 'Original launch baseline',
    publishedAt: '2026-06-01T02:00:00.000Z',
    publishedBy: 'launch-owner',
    publisherEmail: 'launch-owner@intera.ai',
    publisherName: 'Launch Owner',
  },
  {
    id: 'live-2',
    name: 'Gaming Support',
    version: 2,
    isActive: true,
    parentId: 'history-1',
    model: 'deepseek-v4-flash',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T01:00:00.000Z',
    releaseNote: 'Stable launch package',
    publishedAt: '2026-06-02T02:00:00.000Z',
    publishedBy: 'lead-delivery',
    publisherEmail: 'lead-delivery@intera.ai',
    publisherName: 'Lead Delivery',
  },
  {
    id: 'draft-3',
    name: 'Gaming Support',
    version: 3,
    isActive: false,
    parentId: 'live-2',
    model: 'deepseek-v4-flash',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T01:00:00.000Z',
    releaseNote: null,
    publishedAt: null,
    publishedBy: null,
    publisherEmail: null,
    publisherName: null,
  },
]

const historyTemplate = {
  schemaVersion: 'intera.agentTemplate.v1',
  metadata: { name: 'Gaming Support' },
  agent: { name: 'Gaming Support', model: 'deepseek-v4-flash', memoryStrategy: { mode: 'compact' } },
  caseTypes: [{ type: 'deposit_issue', displayName: 'Deposit Issue', procedure: { steps: [{ id: 'lookup_deposit', action: 'use', target: 'get_latest_deposit' }] } }],
  procedures: [{ procedureId: 'deposit_issue', caseTypeType: 'deposit_issue', procedure: { steps: [{ id: 'lookup_deposit', action: 'use', target: 'get_latest_deposit' }] } }],
  tools: [{ name: 'get_latest_deposit', description: 'Read latest deposit', mode: 'http', enabled: true }],
  hooks: [{ name: 'risk_gate', checkpoint: 'PreToolUse', handlerKind: 'declarative', handler: { kind: 'declarative' }, enabled: true }],
  hookBindings: [{ hookName: 'risk_gate', scopeType: 'tool', scopeKey: 'tool:get_latest_deposit', toolName: 'get_latest_deposit', enabled: true }],
  scenarios: [],
  scenarioDefinitions: [],
  knowledgeRefs: [],
  integrationRefs: [],
  requiredSecrets: [],
  systemToolPolicy: { runtimeManaged: true, importMode: 'ignore', runtimeManagedTools: [{ name: 'start_procedure' }] },
}

const liveTemplate = {
  ...historyTemplate,
  requiredSecrets: [{ name: 'livechat_bot_access_token', required: true }],
}

const draftTemplate = {
  ...liveTemplate,
  agent: { name: 'Gaming Support', model: 'deepseek-v4-flash', memoryStrategy: { mode: 'profile-plus-facts' } },
  tools: [
    ...liveTemplate.tools,
    { name: 'get_deposit_status', description: 'Read status by transaction id', mode: 'http', enabled: true },
  ],
  scenarioDefinitions: [{
    name: 'deposit_happy_path',
    turns: [{ role: 'user', content: 'My deposit is missing' }],
    expected: { caseType: 'deposit_issue' },
  }],
  knowledgeRefs: [{ name: 'Deposit FAQ', provider: 'gptbots', status: 'enabled', groupRefs: ['deposit'] }],
  integrationRefs: [{ channel: 'livechat', provider: 'livechat', name: 'LiveChat production', status: 'enabled', requiredSecrets: ['livechat_bot_access_token'] }],
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: vi.fn(async () => body),
    blob: vi.fn(async () => new Blob([JSON.stringify(body)], { type: 'application/json' })),
  } as unknown as Response
}

function makeScenarioPayload(overrides: Record<string, unknown>) {
  return {
    scenarios: [],
    receipts: [],
    validation: {
      state: 'Not validated',
      changedAt: null,
      lastValidatedAt: null,
      lastReceiptId: null,
      lastReceiptStatus: null,
      lastReceiptExecutionMode: null,
      runtimeValidated: false,
      runtimeValidatedAt: null,
      overrideRequired: true,
    },
    ...overrides,
  }
}

function buildReleaseFixture(options: {
  configs?: Array<Record<string, unknown>>
  scenariosById?: Record<string, unknown>
  templatesById?: Record<string, unknown>
} = {}): {
  configs: Array<Record<string, unknown>>
  scenariosById: Record<string, unknown>
  templatesById: Record<string, unknown>
} {
  return {
    configs: options.configs ?? configs,
    scenariosById: {
      'history-1': makeScenarioPayload({
        receipts: [{
          scenarioName: 'launch_baseline',
          runId: 'run_history',
          status: 'pass',
          executionMode: 'agentRuntime',
          toolExecutionMode: 'live',
          startedAt: '2026-06-01T02:00:00.000Z',
          completedAt: '2026-06-01T02:02:00.000Z',
          finishedAt: '2026-06-01T02:02:00.000Z',
          agentConfigId: 'history-1',
          summary: 'Original launch validation passed',
          evidence: { toolsCalled: ['get_latest_deposit'], hookDecisions: [], knowledgeHits: [], humanTransfer: false, handoff: [] },
          checks: [{ name: 'baseline', passed: true }],
          traceId: 'trace_history',
        }],
        validation: {
          state: 'Validated',
          changedAt: '2026-06-01T02:02:00.000Z',
          lastValidatedAt: '2026-06-01T02:02:00.000Z',
          lastReceiptId: 'run_history',
          lastReceiptStatus: 'pass',
          lastReceiptExecutionMode: 'agentRuntime',
          runtimeValidated: true,
          runtimeValidatedAt: '2026-06-01T02:02:00.000Z',
          overrideRequired: false,
        },
      }),
      'live-2': makeScenarioPayload({
        receipts: [{
          scenarioName: 'live_release_check',
          runId: 'run_live',
          status: 'pass',
          executionMode: 'agentRuntime',
          toolExecutionMode: 'live',
          startedAt: '2026-06-02T02:00:00.000Z',
          completedAt: '2026-06-02T02:02:00.000Z',
          finishedAt: '2026-06-02T02:02:00.000Z',
          agentConfigId: 'live-2',
          summary: 'Live release validation passed',
          evidence: { toolsCalled: ['get_latest_deposit'], hookDecisions: [], knowledgeHits: [], humanTransfer: false, handoff: [] },
          checks: [{ name: 'baseline', passed: true }],
          traceId: 'trace_live',
        }],
        validation: {
          state: 'Validated',
          changedAt: '2026-06-02T02:02:00.000Z',
          lastValidatedAt: '2026-06-02T02:02:00.000Z',
          lastReceiptId: 'run_live',
          lastReceiptStatus: 'pass',
          lastReceiptExecutionMode: 'agentRuntime',
          runtimeValidated: true,
          runtimeValidatedAt: '2026-06-02T02:02:00.000Z',
          overrideRequired: false,
        },
      }),
      'draft-3': makeScenarioPayload({
        receipts: [{
          scenarioName: 'deposit_happy_path',
          runId: 'run_draft',
          status: 'pass',
          executionMode: 'fixture',
          toolExecutionMode: 'mocked',
          startedAt: '2026-06-04T00:00:00.000Z',
          completedAt: '2026-06-04T00:02:00.000Z',
          finishedAt: '2026-06-04T00:02:00.000Z',
          agentConfigId: 'draft-3',
          summary: 'All required evidence matched',
          evidence: { toolsCalled: ['get_deposit_status'], hookDecisions: [], knowledgeHits: [], humanTransfer: false, handoff: [] },
          checks: [],
          traceId: 'trace_draft',
        }],
        validation: {
          state: 'Changed since last validation',
          changedAt: '2026-06-04T01:00:00.000Z',
          lastValidatedAt: '2026-06-04T00:02:00.000Z',
          lastReceiptId: 'run_draft',
          lastReceiptStatus: 'pass',
          lastReceiptExecutionMode: 'fixture',
          runtimeValidated: false,
          overrideRequired: true,
        },
      }),
      ...(options.scenariosById ?? {}),
    },
    templatesById: {
      'history-1': historyTemplate,
      'live-2': liveTemplate,
      'draft-3': draftTemplate,
      ...(options.templatesById ?? {}),
    },
  }
}

function installFetchMock(options: {
  configs?: Array<Record<string, unknown>>
  scenariosById?: Record<string, unknown>
  templatesById?: Record<string, unknown>
  forkLimit?: boolean
} = {}) {
  const fixture = buildReleaseFixture(options)
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/admin/agent-configs') {
      return jsonResponse({ ok: true, data: { configs: fixture.configs } })
    }

    if (url.pathname === '/api/admin/scenarios') {
      const agentConfigId = url.searchParams.get('agentConfigId')
      const payload = agentConfigId ? fixture.scenariosById[agentConfigId] : null
      if (!payload) throw new Error(`Unexpected scenarios request: ${String(input)}`)
      return jsonResponse({ ok: true, data: payload })
    }

    if (url.pathname === '/api/admin/agent-templates/export') {
      const agentConfigId = url.searchParams.get('agentConfigId')
      const template = agentConfigId ? fixture.templatesById[agentConfigId] : null
      if (!template) throw new Error(`Unexpected export request: ${String(input)}`)
      if (url.searchParams.get('download') === '1') return jsonResponse(template)
      return jsonResponse({ ok: true, data: { template, filename: `${agentConfigId}.intera-agent.json` } })
    }

    if (url.pathname.match(/^\/api\/admin\/agent-configs\/[^/]+\/activate$/) && init?.method === 'PUT') {
      const targetId = url.pathname.split('/')[4]
      const target = fixture.configs.find((config) => config.id === targetId)
      if (!target) throw new Error(`Unexpected activate request: ${String(input)}`)
      return jsonResponse({ ok: true, data: { config: { ...target, isActive: true }, validation: { overrideRequired: true, overrideReason: 'Reviewed stale receipt.' } } })
    }
    if (url.pathname.match(/^\/api\/admin\/agent-configs\/[^/]+\/fork$/) && init?.method === 'POST') {
      if (options.forkLimit) {
        return jsonResponse({
          ok: false,
          error: {
            code: 'validation',
            message: 'Agent "Gaming Support" already has 5 versions. Maximum retained versions is 5.',
            fields: { maxVersions: '5' },
          },
        }, false, 400)
      }
      const targetId = url.pathname.split('/')[4]
      const target = fixture.configs.find((config) => config.id === targetId)
      if (!target) throw new Error(`Unexpected fork request: ${String(input)}`)
      return jsonResponse({ ok: true, data: { config: { ...target, id: 'draft-4', version: Number(target.version) + 1 } } }, true, 201)
    }

    if (url.pathname === '/api/admin/agent-templates/import' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      if (body.dryRun) {
        return jsonResponse({
          ok: true,
          data: {
            dryRun: true,
            report: {
              canImport: true,
              warnings: ['1 required secret placeholders must be supplied after import.'],
              errors: [],
              requiredSecrets: [{ name: 'livechat_bot_access_token', required: true }],
              unsupportedIntegrations: [{ channel: 'discord', reason: 'Channel "discord" is not currently provisioned by package import.' }],
              missingKnowledgeRefs: [{ name: 'Deposit FAQ', provider: 'gptbots' }],
              conflicts: [{ code: 'existing_draft', message: 'Agent "Gaming Support" has 1 existing draft version(s).', severity: 'warning', target: 'Gaming Support' }],
              plannedCreates: { agentConfigs: 1, scenarios: 1 },
              plannedUpdates: {},
              packageCoverage: { brain: 1, procedures: 1, tools: 2, hooks: 1, hookBindings: 1, scenarios: 1, knowledgeRefs: 1, integrationRefs: 1, requiredSecrets: 1 },
            },
          },
        })
      }
      const importBase = fixture.configs.find((config) => config.id === 'draft-3') ?? fixture.configs[fixture.configs.length - 1] ?? {}
      return jsonResponse({ ok: true, data: { config: { ...importBase, id: 'imported-1', name: 'Imported Starter' }, imported: {}, warnings: [] } }, true, 201)
    }

    throw new Error(`Unexpected fetch: ${String(input)}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function renderReleaseCommandCenter() {
  const { default: ReleaseCommandCenter } = await import('@/components/release/release-command-center')
  await act(async () => {
    render(<ReleaseCommandCenter />)
  })
  await screen.findByText('Agent version timeline')
}

beforeEach(() => {
  vi.clearAllMocks()
  h.context.selectedAgentId = 'draft-3'
  if (!('createObjectURL' in URL)) {
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true })
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
  }
  if (!('revokeObjectURL' in URL)) {
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true })
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  }
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ReleaseCommandCenter', () => {
  it('renders timeline and retention guidance without the separate validation evidence rail', async () => {
    installFetchMock()
    await renderReleaseCommandCenter()

    expect(screen.getByText('Live version')).toBeDefined()
    expect(screen.getByText('Draft version')).toBeDefined()
    expect(screen.getByText('Historical versions')).toBeDefined()
    expect(screen.getByText('3 of 5 retained')).toBeDefined()
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Historical').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Changed since last validation').length).toBeGreaterThan(0)
    expect(screen.queryByText('Validation evidence')).toBeNull()
    expect(screen.getByRole('button', { name: 'Create editable draft' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Rollback preview' })).toBeDefined()
    expect(screen.getByText('Required secrets')).toBeDefined()
    expect(screen.getAllByText(/lead-delivery@intera.ai/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Stable launch package/).length).toBeGreaterThan(0)
  })

  it('requires an override reason before publishing stale validation', async () => {
    const fetchMock = installFetchMock()
    await renderReleaseCommandCenter()

    fireEvent.click(screen.getByRole('button', { name: 'Publish selected version' }))
    const publishButton = await screen.findByRole('button', { name: 'Publish version' })
    expect((publishButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Release note'), { target: { value: 'Ready after receipt review.' } })
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Reviewed stale receipt.' } })
    expect((publishButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(publishButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/agent-configs/draft-3/activate', expect.objectContaining({ method: 'PUT' }))
    })
    const activateCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/admin/agent-configs/draft-3/activate')
    expect(JSON.parse(String(activateCall?.[1]?.body))).toMatchObject({
      releaseNote: 'Ready after receipt review.',
      overrideValidationReason: 'Reviewed stale receipt.',
    })
  })

  it('calls version control package endpoints and shows rollback preview', async () => {
    const fetchMock = installFetchMock()
    await renderReleaseCommandCenter()

    fireEvent.click(screen.getByRole('button', { name: 'Export selected package' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/agent-templates/export?agentConfigId=draft-3&download=1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Rollback preview' }))
    expect(await screen.findByText('Rollback diff preview')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Create editable draft' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/agent-configs/draft-3/fork', expect.objectContaining({ method: 'POST' }))
    })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([JSON.stringify(draftTemplate)], 'starter.intera-agent.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByText('Import dry-run report')
    expect(screen.getByText('livechat_bot_access_token')).toBeDefined()
    expect(screen.getByText(/discord/)).toBeDefined()
    expect(screen.getAllByText('Deposit FAQ').length).toBeGreaterThan(0)

    const dryRunCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/admin/agent-templates/import' && JSON.parse(String(init?.body)).dryRun)
    expect(JSON.parse(String(dryRunCall?.[1]?.body))).toMatchObject({
      parentAgentConfigId: 'draft-3',
      dryRun: true,
      strategy: 'createDraft',
      template: expect.objectContaining({ schemaVersion: 'intera.agentTemplate.v1' }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/admin/agent-templates/import' && !JSON.parse(String(init?.body)).dryRun)).toBe(true)
    })
    const applyCall = fetchMock.mock.calls.find(([url, init]) => String(url) === '/api/admin/agent-templates/import' && !JSON.parse(String(init?.body)).dryRun)
    expect(JSON.parse(String(applyCall?.[1]?.body))).toMatchObject({
      parentAgentConfigId: 'draft-3',
      strategy: 'createDraft',
    })
  })

  it('surfaces version cap typed errors from duplicate version', async () => {
    installFetchMock({ forkLimit: true })
    await renderReleaseCommandCenter()

    fireEvent.click(screen.getByRole('button', { name: 'Create editable draft' }))

    await screen.findByText(/Maximum retained versions is 5/)
  })

  it('keeps historical-only families out of the draft lane and uses rollback copy for reactivation', async () => {
    h.context.selectedAgentId = 'history-1'
    installFetchMock({
      configs: [
        {
          id: 'history-1',
          name: 'Gaming Support',
          version: 1,
          isActive: false,
          parentId: null,
          model: 'deepseek-v4-flash',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T01:00:00.000Z',
          releaseNote: 'Original launch baseline',
          publishedAt: '2026-06-01T02:00:00.000Z',
          publishedBy: 'launch-owner',
          publisherEmail: 'launch-owner@intera.ai',
          publisherName: 'Launch Owner',
        },
        {
          id: 'live-3',
          name: 'Gaming Support',
          version: 3,
          isActive: true,
          parentId: 'history-1',
          model: 'deepseek-v4-flash',
          createdAt: '2026-06-03T00:00:00.000Z',
          updatedAt: '2026-06-03T01:00:00.000Z',
          releaseNote: 'Current production baseline',
          publishedAt: '2026-06-03T02:00:00.000Z',
          publishedBy: 'release-captain',
          publisherEmail: 'release-captain@intera.ai',
          publisherName: 'Release Captain',
        },
      ],
      scenariosById: {
        'live-3': makeScenarioPayload({
          receipts: [{
            scenarioName: 'live_release_check',
            runId: 'run_live_3',
            status: 'pass',
            executionMode: 'agentRuntime',
            toolExecutionMode: 'live',
            startedAt: '2026-06-03T02:00:00.000Z',
            completedAt: '2026-06-03T02:02:00.000Z',
            finishedAt: '2026-06-03T02:02:00.000Z',
            agentConfigId: 'live-3',
            summary: 'Live release validation passed',
            evidence: { toolsCalled: ['get_latest_deposit'], hookDecisions: [], knowledgeHits: [], humanTransfer: false, handoff: [] },
            checks: [{ name: 'baseline', passed: true }],
            traceId: 'trace_live_3',
          }],
          validation: {
            state: 'Validated',
            changedAt: '2026-06-03T02:02:00.000Z',
            lastValidatedAt: '2026-06-03T02:02:00.000Z',
            lastReceiptId: 'run_live_3',
            lastReceiptStatus: 'pass',
            lastReceiptExecutionMode: 'agentRuntime',
            runtimeValidated: true,
            runtimeValidatedAt: '2026-06-03T02:02:00.000Z',
            overrideRequired: false,
          },
        }),
      },
      templatesById: {
        'live-3': liveTemplate,
      },
    })

    await renderReleaseCommandCenter()

    expect(screen.getByText('Create a candidate first')).toBeDefined()
    expect(screen.queryByText('Draft ready for review')).toBeNull()
    expect(screen.getByText('Rollback preview between live v3 and historical v1.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Rollback preview' })).toBeDefined()
  })

  it('treats a direct child of live as the only candidate and routes the review CTA to it', async () => {
    h.context.selectedAgentId = 'live-3'
    installFetchMock({
      configs: [
        {
          id: 'history-2',
          name: 'Gaming Support',
          version: 2,
          isActive: false,
          parentId: null,
          model: 'deepseek-v4-flash',
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T01:00:00.000Z',
          releaseNote: 'Earlier retained release',
          publishedAt: '2026-06-02T02:00:00.000Z',
          publishedBy: 'ops-2',
          publisherEmail: 'ops-2@intera.ai',
          publisherName: 'Ops Two',
        },
        {
          id: 'live-3',
          name: 'Gaming Support',
          version: 3,
          isActive: true,
          parentId: 'history-2',
          model: 'deepseek-v4-flash',
          createdAt: '2026-06-03T00:00:00.000Z',
          updatedAt: '2026-06-03T01:00:00.000Z',
          releaseNote: 'Current production baseline',
          publishedAt: '2026-06-03T02:00:00.000Z',
          publishedBy: 'release-captain',
          publisherEmail: 'release-captain@intera.ai',
          publisherName: 'Release Captain',
        },
        {
          id: 'draft-4',
          name: 'Gaming Support',
          version: 4,
          isActive: false,
          parentId: 'live-3',
          model: 'deepseek-v4-flash',
          createdAt: '2026-06-04T00:00:00.000Z',
          updatedAt: '2026-06-04T01:00:00.000Z',
          releaseNote: null,
          publishedAt: null,
          publishedBy: null,
          publisherEmail: null,
          publisherName: null,
        },
      ],
      scenariosById: {
        'history-2': makeScenarioPayload({
          validation: {
            state: 'Validated',
            changedAt: '2026-06-02T02:02:00.000Z',
            lastValidatedAt: '2026-06-02T02:02:00.000Z',
            lastReceiptId: 'run_history_2',
            lastReceiptStatus: 'pass',
            lastReceiptExecutionMode: 'agentRuntime',
            runtimeValidated: true,
            runtimeValidatedAt: '2026-06-02T02:02:00.000Z',
            overrideRequired: false,
          },
        }),
        'live-3': makeScenarioPayload({
          validation: {
            state: 'Validated',
            changedAt: '2026-06-03T02:02:00.000Z',
            lastValidatedAt: '2026-06-03T02:02:00.000Z',
            lastReceiptId: 'run_live_3',
            lastReceiptStatus: 'pass',
            lastReceiptExecutionMode: 'agentRuntime',
            runtimeValidated: true,
            runtimeValidatedAt: '2026-06-03T02:02:00.000Z',
            overrideRequired: false,
          },
        }),
        'draft-4': makeScenarioPayload({
          validation: {
            state: 'Changed since last validation',
            changedAt: '2026-06-04T01:00:00.000Z',
            lastValidatedAt: '2026-06-04T00:02:00.000Z',
            lastReceiptId: 'run_draft_4',
            lastReceiptStatus: 'pass',
            lastReceiptExecutionMode: 'fixture',
            runtimeValidated: false,
            overrideRequired: true,
          },
        }),
      },
      templatesById: {
        'history-2': historyTemplate,
        'live-3': liveTemplate,
        'draft-4': draftTemplate,
      },
    })

    await renderReleaseCommandCenter()

    expect(screen.getByText('Draft ready for review')).toBeDefined()
    expect(screen.getByText('Review v4')).toBeDefined()
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Historical').length).toBeGreaterThan(0)
  })
})
