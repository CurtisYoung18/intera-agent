// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const h = vi.hoisted(() => {
  const mockSelectAgent = vi.fn()
  const mockRefreshConfigs = vi.fn(async () => {})
  const context = {
    selectedAgentId: 'draft-2',
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

const configs = [
  {
    id: 'live-1',
    name: 'Gaming Support',
    version: 1,
    isActive: true,
    parentId: null,
    model: 'deepseek-v4-flash',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    releaseNote: 'Stable launch package',
    publishedAt: '2026-06-02T00:00:00.000Z',
    publishedBy: 'lead-delivery',
  },
  {
    id: 'draft-2',
    name: 'Gaming Support',
    version: 2,
    isActive: false,
    parentId: 'live-1',
    model: 'deepseek-v4-flash',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T01:00:00.000Z',
    releaseNote: null,
    publishedAt: null,
    publishedBy: null,
  },
]

const liveTemplate = {
  schemaVersion: 'intera.agentTemplate.v1',
  metadata: { name: 'Gaming Support' },
  agent: { name: 'Gaming Support', model: 'deepseek-v4-flash', memoryStrategy: { mode: 'compact' } },
  caseTypes: [{ type: 'deposit_issue', displayName: 'Deposit Issue', procedure: { steps: [{ id: 'lookup_deposit', action: 'use', target: 'get_latest_deposit' }] } }],
  tools: [{ name: 'get_latest_deposit', description: 'Read latest deposit', mode: 'http', enabled: true }],
  hooks: [{ name: 'risk_gate', checkpoint: 'PreToolUse', handlerKind: 'declarative', handler: { kind: 'declarative' }, enabled: true }],
  hookBindings: [{ hookName: 'risk_gate', scopeType: 'tool', scopeKey: 'tool:get_latest_deposit', toolName: 'get_latest_deposit', enabled: true }],
  scenarios: [],
}

const draftTemplate = {
  ...liveTemplate,
  agent: { name: 'Gaming Support', model: 'deepseek-v4-flash', memoryStrategy: { mode: 'profile-plus-facts' } },
  tools: [
    ...liveTemplate.tools,
    { name: 'get_deposit_status', description: 'Read status by transaction id', mode: 'http', enabled: true },
  ],
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: vi.fn(async () => body),
    blob: vi.fn(async () => new Blob([JSON.stringify(body)], { type: 'application/json' })),
  } as unknown as Response
}

function installFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/admin/agent-configs') {
      return jsonResponse({ ok: true, data: { configs } })
    }
    if (url === '/api/admin/scenarios?agentConfigId=draft-2') {
      return jsonResponse({
        ok: true,
        data: {
          scenarios: [],
          receipts: [{
            scenarioName: 'deposit_happy_path',
            runId: 'run_123',
            status: 'passed',
            startedAt: '2026-06-04T00:00:00.000Z',
            finishedAt: '2026-06-04T00:02:00.000Z',
            agentConfigId: 'draft-2',
            summary: 'All required evidence matched',
            evidence: { toolsCalled: ['get_deposit_status'], hookDecisions: [], knowledgeHits: [], humanTransfer: false, handoff: [] },
            checks: [],
            traceId: 'trace_123',
          }],
          validation: {
            state: 'Changed since last validation',
            changedAt: '2026-06-04T01:00:00.000Z',
            lastValidatedAt: '2026-06-04T00:02:00.000Z',
            lastReceiptId: 'run_123',
            lastReceiptStatus: 'passed',
            overrideRequired: true,
          },
        },
      })
    }
    if (url === '/api/admin/agent-templates/export?agentConfigId=live-1') {
      return jsonResponse({ ok: true, data: { template: liveTemplate, filename: 'live.intera-agent.json' } })
    }
    if (url === '/api/admin/agent-templates/export?agentConfigId=draft-2') {
      return jsonResponse({ ok: true, data: { template: draftTemplate, filename: 'draft.intera-agent.json' } })
    }
    if (url === '/api/admin/agent-templates/export?agentConfigId=draft-2&download=1') {
      return jsonResponse(draftTemplate)
    }
    if (url === '/api/admin/agent-configs/draft-2/activate' && init?.method === 'PUT') {
      return jsonResponse({ ok: true, data: { config: { ...configs[1], isActive: true }, validation: { overrideRequired: true, overrideReason: 'Reviewed stale receipt.' } } })
    }
    if (url === '/api/admin/agent-configs/draft-2/fork' && init?.method === 'POST') {
      return jsonResponse({ ok: true, data: { config: { ...configs[1], id: 'draft-3', version: 3 } } }, true, 201)
    }
    if (url === '/api/admin/agent-templates/import' && init?.method === 'POST') {
      return jsonResponse({ ok: true, data: { config: { ...configs[1], id: 'imported-1', name: 'Imported Starter' }, imported: {}, warnings: [] } }, true, 201)
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
  await screen.findByText('Manage versions, validate quality, and publish with confidence.')
}

beforeEach(() => {
  vi.clearAllMocks()
  h.context.selectedAgentId = 'draft-2'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReleaseCommandCenter', () => {
  it('renders live, draft, Scenario receipt, and grouped config diff data from APIs', async () => {
    installFetchMock()
    await renderReleaseCommandCenter()

    expect(screen.getByText('Live Version')).toBeDefined()
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
    expect(screen.getByText('Changed since last validation')).toBeDefined()
    expect(screen.getByText('deposit_happy_path')).toBeDefined()
    expect(screen.getByText('get_deposit_status')).toBeDefined()
    expect(screen.getByText('Knowledge')).toBeDefined()
    expect(screen.getAllByText('Package v1 placeholder').length).toBeGreaterThan(0)
  })

  it('requires an override reason before publishing stale validation', async () => {
    const fetchMock = installFetchMock()
    await renderReleaseCommandCenter()

    fireEvent.click(screen.getByRole('button', { name: 'Publish draft' }))
    const publishButton = await screen.findByRole('button', { name: 'Publish version' })
    expect((publishButton as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Release note'), { target: { value: 'Ready after receipt review.' } })
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Reviewed stale receipt.' } })
    expect((publishButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(publishButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/agent-configs/draft-2/activate', expect.objectContaining({ method: 'PUT' }))
    })
    const activateCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/admin/agent-configs/draft-2/activate')
    expect(JSON.parse(String(activateCall?.[1]?.body))).toMatchObject({
      releaseNote: 'Ready after receipt review.',
      overrideValidationReason: 'Reviewed stale receipt.',
    })
  })

  it('calls existing F6 package endpoints and duplicate-version endpoint', async () => {
    const fetchMock = installFetchMock()
    await renderReleaseCommandCenter()

    fireEvent.click(screen.getByRole('button', { name: 'Export package' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/agent-templates/export?agentConfigId=draft-2&download=1')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Version' }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/agent-configs/draft-2/fork', expect.objectContaining({ method: 'POST' }))
    })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([JSON.stringify(draftTemplate)], 'starter.intera-agent.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/agent-templates/import', expect.objectContaining({ method: 'POST' }))
    })
    const importCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/admin/agent-templates/import')
    expect(JSON.parse(String(importCall?.[1]?.body))).toMatchObject({
      parentAgentConfigId: 'draft-2',
      template: expect.objectContaining({ schemaVersion: 'intera.agentTemplate.v1' }),
    })
  })
})
