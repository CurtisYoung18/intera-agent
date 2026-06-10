// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
  ApiClientError: class ApiClientError extends Error {
    constructor(public envelope: any) {
      super(envelope.error.message)
    }
  },
}))

vi.mock('@/components/admin/version-context-bar', () => ({
  default: () => null,
  useSelectedAgentId: vi.fn(() => 'agent-1'),
}))

const scenario = {
  id: 'scenario-1',
  agentConfigId: 'agent-1',
  name: 'deposit_missing_evidence',
  displayName: 'Deposit missing evidence',
  description: 'Covers provider evidence and human transfer.',
  locale: 'en-US',
  tags: ['deposit'],
  enabled: true,
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z',
  lastRunId: 'run-1',
  lastRunStatus: 'pass',
  turns: [
    { role: 'user', content: 'My deposit has not arrived yet.' },
    { role: 'assistant', content: 'I checked the available evidence and will transfer this case to a human specialist.' },
  ],
  expected: {
    caseType: 'deposit_issue',
    toolsCalled: ['get_latest_deposit'],
    hooks: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate' }],
    humanTransfer: true,
    finalStatus: 'waiting_human',
    forbiddenPhrases: ['guaranteed compensation'],
    requiredPhrases: ['human specialist'],
  },
}

const receipt = {
  scenarioName: 'deposit_missing_evidence',
  runId: 'run-1',
  status: 'pass',
  executionMode: 'agentRuntime',
  toolExecutionMode: 'mocked',
  startedAt: '2026-06-09T00:01:00.000Z',
  completedAt: '2026-06-09T00:01:03.000Z',
  finishedAt: '2026-06-09T00:01:03.000Z',
  agentConfigId: 'agent-1',
  summary: '7 expectations passed.',
  expected: scenario.expected,
  evidence: {
    caseType: 'deposit_issue',
    toolsCalled: ['get_latest_deposit'],
    toolCalls: [{ name: 'get_latest_deposit', executionMode: 'mocked' }],
    toolResults: [{ name: 'get_latest_deposit', output: { _dryRun: true }, executionMode: 'mocked' }],
    hookDecisions: [{ hookName: 'conflict_requires_human', checkpoint: 'PostToolUse', decision: 'escalate', reason: 'Provider proof mismatch' }],
    knowledgeHits: [{ source: 'fixture', title: 'Deposit runbook' }],
    humanTransfer: true,
    handoff: [{ required: true, target: 'human', reason: 'Needs manual provider review' }],
    finalResponse: 'I checked the available evidence and will transfer this case to a human specialist.',
    finalStatus: 'waiting_human',
  },
  checks: [
    { name: 'tool:get_latest_deposit', passed: true },
    { name: 'hook:conflict_requires_human', passed: true },
    { name: 'human_transfer', passed: true },
    { name: 'final_status', passed: true },
    { name: 'forbidden_phrase:guaranteed compensation', passed: true },
    { name: 'required_phrase:human specialist', passed: true },
  ],
}

const configPilotProposal = {
  id: 'proposal-1',
  targetSurface: 'scenarios',
  title: 'Deposit handoff Scenario',
  summary: 'Creates a draft Scenario for provider evidence and human transfer.',
  rationale: 'The current validation suite needs one repeatable handoff case.',
  patches: [{
    surface: 'scenarios',
    operation: 'create',
    value: {
      name: 'configpilot_deposit_handoff',
      displayName: 'ConfigPilot deposit handoff',
      description: 'Generated through backend ConfigPilot.',
      locale: 'en-US',
      tags: ['configpilot'],
      enabled: true,
      turns: scenario.turns,
      expected: scenario.expected,
    },
  }],
  diffGroups: [{
    id: 'scenarios',
    title: 'Scenarios',
    description: 'Pilot Lab validation cases and receipt expectations.',
    summary: '1 proposed change',
    items: [{
      key: 'configpilot_deposit_handoff.name',
      label: 'configpilot_deposit_handoff / name',
      status: 'added',
      after: 'configpilot_deposit_handoff',
    }],
  }],
  receiptSuggestions: ['Run the generated Scenario before publishing.'],
  runSuggestions: ['Use observed provider evidence for the first run.'],
  safetyNotes: ['Draft only; publish remains locked.'],
}

function setupApi() {
  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url === '/api/admin/scenarios?agentConfigId=agent-1') {
      return {
        data: {
          scenarios: [scenario],
          receipts: [receipt],
          validation: {
            state: 'Validated',
            lastValidatedAt: receipt.finishedAt,
            lastReceiptId: receipt.runId,
            lastReceiptStatus: receipt.status,
            lastReceiptExecutionMode: receipt.executionMode,
            runtimeValidated: true,
            runtimeValidatedAt: receipt.completedAt,
            overrideRequired: false,
          },
        },
      }
    }
    if (url === '/api/admin/scenarios/deposit_missing_evidence/run' && options?.method === 'POST') {
      return {
        data: {
          receipt: { ...receipt, runId: 'run-2', startedAt: '2026-06-09T00:02:00.000Z' },
          validation: {
            state: 'Validated',
            lastValidatedAt: '2026-06-09T00:02:03.000Z',
            lastReceiptId: 'run-2',
            lastReceiptStatus: 'pass',
            lastReceiptExecutionMode: 'agentRuntime',
            runtimeValidated: true,
            runtimeValidatedAt: '2026-06-09T00:02:03.000Z',
            overrideRequired: false,
          },
        },
      }
    }
    if (url === '/api/admin/config-pilot/context?agentConfigId=agent-1') {
      return {
        data: {
          agentConfigId: 'agent-1',
          selected: { id: 'agent-1', name: 'Gaming Support', version: 2, isActive: false, model: 'deepseek-v4-flash', updatedAt: '2026-06-09T00:00:00.000Z', publishedAt: null },
          active: { id: 'agent-live', name: 'Gaming Support', version: 1, isActive: true, model: 'deepseek-v4-flash', updatedAt: '2026-06-08T00:00:00.000Z', publishedAt: '2026-06-08T01:00:00.000Z' },
          draft: { id: 'agent-1', name: 'Gaming Support', version: 2, isActive: false, model: 'deepseek-v4-flash', updatedAt: '2026-06-09T00:00:00.000Z', publishedAt: null },
          permissions: { role: 'admin', canRead: true, canPropose: true, canApply: true, canPublish: false },
          lockedCapabilities: [{ id: 'hook_engine', name: 'Hook Engine', surface: 'runtime', reason: 'runtime-managed', editable: false }],
          configuration: { brain: { model: 'deepseek-v4-flash' }, procedures: [], tools: [], hooks: [], hookBindings: [], knowledge: [], integrations: [], scenarios: [scenario] },
          validation: { state: 'Validated', lastValidatedAt: receipt.finishedAt, lastReceiptId: receipt.runId, lastReceiptStatus: receipt.status, lastReceiptExecutionMode: receipt.executionMode, runtimeValidated: true, runtimeValidatedAt: receipt.completedAt, overrideRequired: false },
        },
      }
    }
    if (url === '/api/admin/config-pilot/propose' && options?.method === 'POST') {
      return {
        data: {
          proposal: configPilotProposal,
          modelUsed: 'config-pilot-test-model',
          promptVersion: 'config-pilot.p1.v1',
        },
      }
    }
    if (url === '/api/admin/config-pilot/apply' && options?.method === 'POST') {
      return {
        data: {
          appliedPatches: [{ surface: 'scenarios', operation: 'create', target: 'configpilot_deposit_handoff' }],
          draftAgentConfigId: 'agent-1',
          createdDraft: false,
          validation: { state: 'Changed since last validation', changedAt: '2026-06-09T00:03:00.000Z', overrideRequired: true },
          artifacts: {
            scenarios: [{
              ...scenario,
              ...configPilotProposal.patches[0].value,
              id: 'scenario-configpilot',
              createdAt: '2026-06-09T00:03:00.000Z',
              updatedAt: '2026-06-09T00:03:00.000Z',
            }],
          },
        },
      }
    }
    if (url === '/api/admin/scenarios' && options?.method === 'POST') {
      return {
        data: {
          scenario: {
            ...scenario,
            ...options.body,
            id: 'scenario-configpilot',
            createdAt: '2026-06-09T00:03:00.000Z',
            updatedAt: '2026-06-09T00:03:00.000Z',
          },
        },
      }
    }
    return { data: {} }
  })
}

async function renderPage() {
  const { default: PilotLabPage } = await import('./page')
  await act(async () => {
    render(<PilotLabPage />)
  })
}

beforeEach(() => {
  mockApiClient.mockReset()
  setupApi()
})

afterEach(() => {
  cleanup()
})

describe('PilotLabPage', () => {
  it('renders saved Scenarios and latest receipt evidence', async () => {
    await renderPage()

    expect((await screen.findAllByText('Deposit missing evidence')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('get_latest_deposit').length).toBeGreaterThan(0)
    expect(screen.getByText('conflict_requires_human')).toBeTruthy()
    expect(screen.getByText('Deposit runbook')).toBeTruthy()
    expect(screen.getByText('Forbidden phrase: guaranteed compensation')).toBeTruthy()
  }, 10000)

  it('runs the selected Scenario through the Scenario run API', async () => {
    await renderPage()

    await screen.findAllByText('Deposit missing evidence')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/scenarios/deposit_missing_evidence/run' && options?.method === 'POST')).toBe(true)
    })
    const runCall = mockApiClient.mock.calls.find(([url, options]) => url === '/api/admin/scenarios/deposit_missing_evidence/run' && options?.method === 'POST')
    expect(runCall?.[1]?.body).toMatchObject({ executionMode: 'agentRuntime' })
  }, 10000)

  it('requires ConfigPilot diff review and confirmation before typed API save', async () => {
    await renderPage()

    await screen.findAllByText('Deposit missing evidence')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ConfigPilot Workspace' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate proposal/ }))
    })
    await screen.findByText('Deposit handoff Scenario')

    const applyButton = screen.getByTestId('config-pilot-apply-draft')
    expect(applyButton).toHaveProperty('disabled', true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review diff/ }))
    })
    expect(applyButton).toHaveProperty('disabled', true)

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/I reviewed the diff/))
    })
    await act(async () => {
      fireEvent.click(applyButton)
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/config-pilot/apply' && options?.method === 'POST')).toBe(true)
    })
    expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/scenarios' && options?.method === 'POST')).toBe(false)
    expect(mockApiClient.mock.calls.some(([url]) => typeof url === 'string' && /activate|publish/i.test(url))).toBe(false)
  }, 10000)
})
