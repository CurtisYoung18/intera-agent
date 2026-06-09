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
  lastRunStatus: 'passed',
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
  status: 'passed',
  startedAt: '2026-06-09T00:01:00.000Z',
  finishedAt: '2026-06-09T00:01:03.000Z',
  agentConfigId: 'agent-1',
  summary: '7 expectations passed.',
  expected: scenario.expected,
  evidence: {
    caseType: 'deposit_issue',
    toolsCalled: ['get_latest_deposit'],
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
            lastReceiptStatus: 'passed',
            overrideRequired: false,
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
    expect(screen.getByText('get_latest_deposit')).toBeTruthy()
    expect(screen.getByText('conflict_requires_human')).toBeTruthy()
    expect(screen.getByText('Deposit runbook')).toBeTruthy()
    expect(screen.getByText('Forbidden phrase: guaranteed compensation')).toBeTruthy()
  })

  it('runs the selected Scenario through the Scenario run API', async () => {
    await renderPage()

    await screen.findAllByText('Deposit missing evidence')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/scenarios/deposit_missing_evidence/run' && options?.method === 'POST')).toBe(true)
    })
  })

  it('requires ConfigPilot diff review and confirmation before typed API save', async () => {
    await renderPage()

    await screen.findAllByText('Deposit missing evidence')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ConfigPilot Workspace' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Generate proposal/ }))
    })

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
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/scenarios' && options?.method === 'POST')).toBe(true)
    })
    expect(mockApiClient.mock.calls.some(([url]) => typeof url === 'string' && /activate|publish/i.test(url))).toBe(false)
  })
})
