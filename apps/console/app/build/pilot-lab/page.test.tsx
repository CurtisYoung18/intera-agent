// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockApiClient = vi.fn()
let searchParams = new URLSearchParams()

const labels: Record<string, string> = {
  'pilotLab.tabs.aria': 'Pilot Lab tabs',
  'pilotLab.tabs.pilot': 'Pilot',
  'pilotLab.tabs.pilotDesc': 'Draft changes and Scenario receipts',
  'pilotLab.tabs.playground': 'Playground',
  'pilotLab.tabs.playgroundDesc': 'Manual dry-run and trace debug',
}

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

vi.mock('@/components/locale-provider', () => ({
  useConsoleLocale: () => ({
    locale: 'en',
    toggleLocale: vi.fn(),
    t: (key: string) => labels[key] ?? key,
  }),
}))

vi.mock('@/app/admin/playground/page', () => ({
  default: () => <div data-testid="embedded-playground">Embedded Playground</div>,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => searchParams),
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

const runtimeReceipt = {
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

const fixtureReceipt = {
  ...runtimeReceipt,
  runId: 'fixture-run-1',
  executionMode: 'fixture',
  summary: 'Fixture expectations passed.',
}

const runtimeValidation = {
  state: 'Validated',
  lastValidatedAt: runtimeReceipt.finishedAt,
  lastReceiptId: runtimeReceipt.runId,
  lastReceiptStatus: runtimeReceipt.status,
  lastReceiptExecutionMode: runtimeReceipt.executionMode,
  runtimeValidated: true,
  runtimeValidatedAt: runtimeReceipt.completedAt,
  overrideRequired: false,
}

const fixtureValidation = {
  state: 'Validated',
  lastValidatedAt: fixtureReceipt.finishedAt,
  lastReceiptId: fixtureReceipt.runId,
  lastReceiptStatus: fixtureReceipt.status,
  lastReceiptExecutionMode: fixtureReceipt.executionMode,
  runtimeValidated: false,
  runtimeValidatedAt: null,
  overrideRequired: true,
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

function contextResponse(validation: any = runtimeValidation) {
  return {
    agentConfigId: 'agent-1',
    selected: { id: 'agent-1', name: 'Gaming Support', version: 2, isActive: false, model: 'deepseek-v4-flash', updatedAt: '2026-06-09T00:00:00.000Z', publishedAt: null },
    active: { id: 'agent-live', name: 'Gaming Support', version: 1, isActive: true, model: 'deepseek-v4-flash', updatedAt: '2026-06-08T00:00:00.000Z', publishedAt: '2026-06-08T01:00:00.000Z' },
    draft: { id: 'agent-1', name: 'Gaming Support', version: 2, isActive: false, model: 'deepseek-v4-flash', updatedAt: '2026-06-09T00:00:00.000Z', publishedAt: null },
    permissions: { role: 'admin', canRead: true, canPropose: true, canApply: true, canPublish: false },
    lockedCapabilities: [{ id: 'hook_engine', name: 'Hook Engine', surface: 'runtime', reason: 'runtime-managed', editable: false }],
    configuration: { brain: { model: 'deepseek-v4-flash' }, procedures: [], tools: [], hooks: [], hookBindings: [], knowledge: [], integrations: [], scenarios: [scenario] },
    validation,
  }
}

function setupApi(mode: 'runtime' | 'fixture' = 'runtime') {
  const receipt = mode === 'runtime' ? runtimeReceipt : fixtureReceipt
  const validation = mode === 'runtime' ? runtimeValidation : fixtureValidation
  mockApiClient.mockImplementation(async (url: string, options?: any) => {
    if (url === '/api/admin/config-pilot/context?agentConfigId=agent-1') {
      return { data: contextResponse(validation) }
    }
    if (url === '/api/admin/scenarios?agentConfigId=agent-1') {
      return { data: { scenarios: [scenario], receipts: [receipt], validation } }
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
    if (url === '/api/admin/scenarios/deposit_missing_evidence/run' && options?.method === 'POST') {
      const nextReceipt = options.body.executionMode === 'fixture' ? { ...fixtureReceipt, runId: 'fixture-run-2' } : { ...runtimeReceipt, runId: 'run-2' }
      return {
        data: {
          receipt: nextReceipt,
          validation: nextReceipt.executionMode === 'agentRuntime'
            ? { ...runtimeValidation, lastReceiptId: nextReceipt.runId, runtimeValidatedAt: nextReceipt.completedAt }
            : { ...fixtureValidation, lastReceiptId: nextReceipt.runId },
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

function textIncludes(text: string) {
  return (_content: string, element: Element | null) => Boolean(element?.textContent?.includes(text))
}

async function submitChatPrompt(text = 'Create a deposit handoff Scenario') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Message U-Pilot'), { target: { value: text } })
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  })
}

beforeEach(() => {
  searchParams = new URLSearchParams()
  mockApiClient.mockReset()
  setupApi()
})

afterEach(() => {
  cleanup()
})

describe('PilotLabPage U-Pilot cockpit', () => {
  it('renders the initial chat cockpit around current draft context', async () => {
    await renderPage()

    expect(screen.getByRole('link', { name: /Pilot/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Playground/ })).toBeTruthy()
    expect(screen.getByLabelText('Message U-Pilot')).toBeTruthy()
    expect(await screen.findAllByText('Current context')).toBeTruthy()
    expect(mockApiClient.mock.calls[0][0]).toBe('/api/admin/config-pilot/context?agentConfigId=agent-1')
  }, 10000)

  it('renders playground as a compact workspace without compatibility chrome', async () => {
    searchParams = new URLSearchParams('tab=playground')
    await renderPage()

    expect(screen.getByTestId('embedded-playground')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Pilot Lab tabs' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Playground/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByText('Playground compatibility surface')).toBeNull()
    expect(screen.queryByText(/Compatibility route only/i)).toBeNull()
    expect(screen.queryByText('U-Pilot Chat Cockpit')).toBeNull()
  }, 10000)

  it('shows the initial streaming Pilot greeting after context loads', async () => {
    await renderPage()

    expect((await screen.findAllByText(textIncludes('I have read the current draft'))).length).toBeGreaterThan(0)
  }, 10000)

  it('shows a proposal diff after chat propose, while apply stays disabled before accept', async () => {
    await renderPage()
    await screen.findByLabelText('Message U-Pilot')

    await submitChatPrompt()
    expect(await screen.findByText('Deposit handoff Scenario')).toBeTruthy()

    const applyButton = screen.getByTestId('config-pilot-apply-draft')
    expect(applyButton).toHaveProperty('disabled', true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review diff/ }))
    })
    expect(await screen.findByText('Diff viewer')).toBeTruthy()
    expect(applyButton).toHaveProperty('disabled', true)
  }, 10000)

  it('enables apply only after explicit accept', async () => {
    await renderPage()
    await submitChatPrompt()
    await screen.findByText('Deposit handoff Scenario')
    const applyButton = screen.getByTestId('config-pilot-apply-draft')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review diff/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/I reviewed the diff/))
    })

    await waitFor(() => expect(applyButton).toHaveProperty('disabled', false))
  }, 10000)

  it('applies accepted drafts without calling publish activate deploy or rollback endpoints', async () => {
    await renderPage()
    await submitChatPrompt()
    await screen.findByText('Deposit handoff Scenario')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Review diff/ }))
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/I reviewed the diff/))
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('config-pilot-apply-draft'))
    })

    await waitFor(() => {
      expect(mockApiClient.mock.calls.some(([url, options]) => url === '/api/admin/config-pilot/apply' && options?.method === 'POST')).toBe(true)
    })
    expect(mockApiClient.mock.calls.some(([url]) => typeof url === 'string' && /publish|activate|deploy|rollback/i.test(url))).toBe(false)
  }, 10000)

  it('does not label fixture-only receipts as runtime validated', async () => {
    setupApi('fixture')
    await renderPage()

    expect(await screen.findByText('Fixture-only validation')).toBeTruthy()
    expect(await screen.findByText('Not runtime validated')).toBeTruthy()
    expect(screen.queryByText('Runtime validated')).toBeNull()
  }, 10000)

  it('labels runtime-backed receipts explicitly', async () => {
    await renderPage()

    expect(await screen.findAllByText('Runtime validated')).toBeTruthy()
    expect(await screen.findByText('Agent runtime')).toBeTruthy()
  }, 10000)
})
