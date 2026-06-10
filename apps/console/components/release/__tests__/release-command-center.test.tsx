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

function installFetchMock(options: { forkLimit?: boolean } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/admin/agent-configs') {
      return jsonResponse({ ok: true, data: { configs } })
    }

    if (url === '/api/admin/scenarios?agentConfigId=history-1') {
      return jsonResponse({
        ok: true,
        data: {
          scenarios: [],
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
        },
      })
    }

    if (url === '/api/admin/scenarios?agentConfigId=live-2') {
      return jsonResponse({
        ok: true,
        data: {
          scenarios: [],
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
        },
      })
    }

    if (url === '/api/admin/scenarios?agentConfigId=draft-3') {
      return jsonResponse({
        ok: true,
        data: {
          scenarios: [],
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
        },
      })
    }

    if (url === '/api/admin/agent-templates/export?agentConfigId=history-1') {
      return jsonResponse({ ok: true, data: { template: historyTemplate, filename: 'history.intera-agent.json' } })
    }
    if (url === '/api/admin/agent-templates/export?agentConfigId=live-2') {
      return jsonResponse({ ok: true, data: { template: liveTemplate, filename: 'live.intera-agent.json' } })
    }
    if (url === '/api/admin/agent-templates/export?agentConfigId=draft-3') {
      return jsonResponse({ ok: true, data: { template: draftTemplate, filename: 'draft.intera-agent.json' } })
    }
    if (url === '/api/admin/agent-templates/export?agentConfigId=draft-3&download=1') {
      return jsonResponse(draftTemplate)
    }

    if (url === '/api/admin/agent-configs/draft-3/activate' && init?.method === 'PUT') {
      return jsonResponse({ ok: true, data: { config: { ...configs[2], isActive: true }, validation: { overrideRequired: true, overrideReason: 'Reviewed stale receipt.' } } })
    }
    if (url === '/api/admin/agent-configs/draft-3/fork' && init?.method === 'POST') {
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
      return jsonResponse({ ok: true, data: { config: { ...configs[2], id: 'draft-4', version: 4 } } }, true, 201)
    }

    if (url === '/api/admin/agent-templates/import' && init?.method === 'POST') {
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
      return jsonResponse({ ok: true, data: { config: { ...configs[2], id: 'imported-1', name: 'Imported Starter' }, imported: {}, warnings: [] } }, true, 201)
    }

    throw new Error(`Unexpected fetch: ${url}`)
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
  it('renders timeline, retention guidance, and selected validation evidence', async () => {
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
    expect(screen.getAllByText(/Fixture-only/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Create editable draft' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Rollback preview' })).toBeDefined()
    expect(screen.getByText('Required secrets')).toBeDefined()
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
})
